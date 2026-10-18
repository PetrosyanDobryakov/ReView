/**
 * Board file share — local-first export/import for Vercel/static hosting.
 *
 * A .review file is a JSON envelope with a base64-encoded Yjs update plus
 * board metadata. Images are already stored as data URLs inside the Y.Doc,
 * so the update carries everything.
 */

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { getBoard, createBoard, deleteBoardData, type BoardMeta } from './boards';
import { getCurrentBoardId, doc, flushPendingPatches, META_OWNER_ID, META_TITLE } from './store';
import { flushIndexedDbPersistence, withIdbTimeout } from './idbFlush';
import {
  MAX_V2_FILE_BYTES,
  createBoardFileV2,
  parseBoardFileV2,
  sniffBoardFileVersion,
  sniffMime,
  type BoardFileV2,
} from './boardFileV2';
import { collectBlobHashes, loadBlob, mediaBlobStore } from './mediaBlobs';

const FILE_VERSION = 1;
const FILE_EXT = '.review';
const MIME_JSON = 'application/json';

// File-import limits (defense in depth: file.text() / JSON.parse / base64 decode / Y.applyUpdate all bounded)
// 32MB covers realistic photo boards; transient base64 (~43MB string) is fine on desktop.
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_UPDATE_BYTES = 32 * 1024 * 1024;
/** v1/v2 import pre-guard (version-specific caps apply after sniffing). */
export { MAX_V2_FILE_BYTES };
export const MAX_BASE64_CHARS = 45 * 1024 * 1024; // ceil(32MB*4/3) ≈ 42.7MB

export type BoardFile = {
  v: number;
  kind: 'review-board';
  boardId: string;
  name: string;
  teamId: string;
  createdAt: number;
  exportedAt: number;
  appVersion: string;
  pages: string[];
  // base64 of Y.encodeStateAsUpdate(doc)
  update: string;
};

function toBase64(bytes: Uint8Array): string {
  if (bytes.length > MAX_UPDATE_BYTES) throw new Error('update too large');
  if (bytes.length === 0) return '';
  // chunked to avoid O(n²) string concat and btoa max-string/arg limits on MB-scale updates
  const CHUNK = 0x8000;
  const aligned = CHUNK - (CHUNK % 3); // 32766, multiple of 3 so chunked btoa can be joined safely
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += aligned) {
    const slice = bytes.subarray(i, i + aligned);
    let str = '';
    for (let j = 0; j < slice.length; j++) str += String.fromCharCode(slice[j]);
    parts.push(btoa(str));
  }
  return parts.join('');
}

function fromBase64(b64: string): Uint8Array {
  // Strip whitespace/newlines that may be introduced by line-wrapped or hand-edited .review files
  const clean = b64.replace(/\s+/g, '');
  if (clean.length > MAX_BASE64_CHARS) throw new Error('update too large');
  if (clean.length === 0) return new Uint8Array(0);
  // chunked atob to avoid max-string limits; chunk size multiple of 4
  const CHUNK = 0x8000;
  const aligned = CHUNK - (CHUNK % 4); // 32768, multiple of 4 so chunked atob joins correctly
  if (clean.length <= aligned) {
    const bin = atob(clean);
    if (bin.length > MAX_UPDATE_BYTES) throw new Error('update too large');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  let padding = 0;
  if (clean.endsWith('==')) padding = 2;
  else if (clean.endsWith('=')) padding = 1;
  const total = Math.floor(clean.length * 3 / 4) - padding;
  if (total > MAX_UPDATE_BYTES) throw new Error('update too large');
  const out = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < clean.length; i += aligned) {
    const bin = atob(clean.slice(i, i + aligned));
    for (let j = 0; j < bin.length; j++) out[offset++] = bin.charCodeAt(j);
  }
  return out;
}

function dbName(boardId: string): string {
  return `review-v1-${boardId}`;
}

function withSyncTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return withIdbTimeout(promise, label);
}

async function destroyPersist(persist: IndexeddbPersistence): Promise<void> {
  try {
    await Promise.race([
      persist.destroy() as Promise<unknown>,
      new Promise<void>((resolve) => setTimeout(resolve, 800)),
    ]);
  } catch {}
}

export type LoadUpdateResult =
  | { ok: true; update: Uint8Array }
  | { ok: false; error: 'load_failed' | 'too_large' };

export async function loadUpdateForBoard(boardId: string): Promise<LoadUpdateResult> {
  if (getCurrentBoardId() === boardId) {
    try {
      flushPendingPatches();
      const u = Y.encodeStateAsUpdate(doc);
      if (u.length > MAX_UPDATE_BYTES) return { ok: false, error: 'too_large' };
      return { ok: true, update: u };
    } catch {
      return { ok: false, error: 'load_failed' };
    }
  }
  const tmp = new Y.Doc();
  const persist = new IndexeddbPersistence(dbName(boardId), tmp);
  try {
    await withSyncTimeout(persist.whenSynced as Promise<unknown>, `loadUpdateForBoard:${boardId}`) as Promise<unknown>;
    const u = Y.encodeStateAsUpdate(tmp);
    if (u.length > MAX_UPDATE_BYTES) return { ok: false, error: 'too_large' };
    return { ok: true, update: u };
  } catch (err) {
    try { console.warn('[boardShare] loadUpdateForBoard failed', boardId, err); } catch {}
    return { ok: false, error: 'load_failed' };
  } finally {
    await destroyPersist(persist);
    tmp.destroy();
  }
}

async function flushPersist(persist: IndexeddbPersistence): Promise<boolean> {
  return flushIndexedDbPersistence(persist);
}

export async function writeUpdateToBoard(
  boardId: string,
  update: Uint8Array,
  mutate?: (tmp: Y.Doc) => void
): Promise<void> {
  if (update.length > MAX_UPDATE_BYTES) throw new Error('update too large');
  if (getCurrentBoardId() === boardId) {
    Y.applyUpdate(doc, update);
    mutate?.(doc);
    return;
  }
  const tmp = new Y.Doc();
  const persist = new IndexeddbPersistence(dbName(boardId), tmp);
  try {
    await withSyncTimeout(persist.whenSynced as Promise<unknown>, `writeUpdateToBoard:${boardId}`) as Promise<unknown>;
    Y.applyUpdate(tmp, update);
    mutate?.(tmp);
    const flushed = await flushPersist(persist);
    if (!flushed) throw new Error('idb flush failed');
    await new Promise<void>((r) => setTimeout(r, 0));
  } finally {
    await destroyPersist(persist);
    tmp.destroy();
  }
}

/** Clear exporter/owner identity so a local copy or import can rename. */
export function stripCopiedIdentity(tmp: Y.Doc): void {
  try {
    const copyMeta = tmp.getMap('meta');
    if (copyMeta.has(META_TITLE)) copyMeta.delete(META_TITLE);
    if (copyMeta.has(META_OWNER_ID)) copyMeta.delete(META_OWNER_ID);
  } catch {
    /* keep content even if the meta strip fails */
  }
}

function safeFileName(name: string): string {
  const s = name.trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 40) || 'board';
  return s;
}

/**
 * Collect the blob bytes referenced by a doc update (v2 export).
 * Null = no media (stay on legacy v1 for max compat). Bytes this device lacks
 * are asked from peers; whatever nobody has is left out (those shapes show a
 * placeholder, exactly as they do on the board itself).
 */
async function buildBoardFileV2Payload(update: Uint8Array): Promise<Map<string, Uint8Array> | null> {
  try {
    const probe = new Y.Doc();
    try {
      Y.applyUpdate(probe, update);
      const shapes = probe.getMap('shapes');
      const hashes = collectBlobHashes(
        shapes.entries() as unknown as Iterable<[string, { get(key: string): unknown }]>
      );
      if (!hashes.length) return null;
      const out = new Map<string, Uint8Array>();
      for (const hash of hashes) {
        const row = await loadBlob(hash);
        if (row) out.set(hash, row.bytes);
      }
      return out;
    } finally {
      probe.destroy();
    }
  } catch {
    return null;
  }
}

/** Build the share payload for a board (no side effects). */
export type BoardFileError = 'missing' | 'load_failed' | 'too_large';
export async function buildBoardFile(boardId: string): Promise<{ file: BoardFile | BoardFileV2 } | { error: BoardFileError }> {
  const meta = getBoard(boardId);
  if (!meta) return { error: 'missing' };
  const loaded = await loadUpdateForBoard(boardId);
  if (!loaded.ok) {
    try { console.warn('[boardShare] buildBoardFile: no update for board', boardId, loaded.error); } catch {}
    return { error: loaded.error };
  }
  const update = loaded.update;
  if (update.length > MAX_UPDATE_BYTES) return { error: 'too_large' };
  // pre-check predicted base64/JSON size before 4/3x blowup + JSON.stringify + Blob triple allocation
  const predictedB64Len = Math.ceil(update.length / 3) * 4;
  if (predictedB64Len > MAX_BASE64_CHARS) return { error: 'too_large' };
  let pages: string[] = ['main'];
  try {
    if (getCurrentBoardId() === boardId) {
      const { listPages } = await import('./store');
      pages = listPages();
    } else {
      const tmp = new Y.Doc();
      const persist = new IndexeddbPersistence(dbName(boardId), tmp);
      try {
        await withSyncTimeout(persist.whenSynced as Promise<unknown>, `buildBoardFile:pages:${boardId}`) as Promise<unknown>;
        pages = (tmp.getArray('pages').toArray() as string[]).slice();
        if (!pages.length) pages = ['main'];
      } finally {
        await destroyPersist(persist);
        tmp.destroy();
      }
    }
  } catch (err) {
    try { console.warn('[boardShare] buildBoardFile pages fallback', boardId, err); } catch {}
    pages = ['main'];
  }
  const appVersion = (() => {
    try { return (import.meta as unknown as { env?: Record<string,string> }).env?.VITE_APP_VERSION ?? '0.12.0'; } catch { return '0.12.0'; }
  })();
  // Stage 2 v2: slim update + blob dictionary. Falls back to legacy v1 below
  // (in phase A `src` is intact, so the v1 file stays complete).
  try {
    const payload = await buildBoardFileV2Payload(update);
    if (payload) {
      const v2 = createBoardFileV2({
        boardId: meta.id,
        name: meta.name,
        teamId: meta.teamId,
        createdAt: meta.createdAt,
        exportedAt: Date.now(),
        appVersion,
        pages,
        docUpdate: update,
        blobs: [...payload.entries()].map(([hash, bytes]) => ({ hash, bytes })),
      });
      if ('file' in v2) return { file: v2.file };
    }
  } catch {
    /* fall through to v1 */
  }
  let b64: string;
  try {
    b64 = toBase64(update);
  } catch {
    return { error: 'too_large' };
  }
  if (b64.length > MAX_BASE64_CHARS) return { error: 'too_large' };
  // estimated JSON size = base64 + envelope (~512 bytes); bound JSON.stringify + Blob allocation
  if (b64.length + 1024 > MAX_FILE_BYTES) return { error: 'too_large' };
  return {
    file: {
      v: FILE_VERSION,
      kind: 'review-board',
      boardId: meta.id,
      name: meta.name,
      teamId: meta.teamId,
      createdAt: meta.createdAt,
      exportedAt: Date.now(),
      appVersion,
      pages,
      update: b64,
    },
  };
}

/** Base64 payload length + file cap for either envelope version. */
function boardFilePayloadLength(file: BoardFile | BoardFileV2): number {
  return 'update' in file ? file.update.length : file.docUpdate.length;
}

function boardFileCap(file: BoardFile | BoardFileV2): number {
  return 'update' in file ? MAX_FILE_BYTES : MAX_V2_FILE_BYTES;
}

/** Trigger a download for a board's .review file. */
export async function exportBoardFile(boardId: string): Promise<'ok' | 'too_large' | 'failed'> {
  const built = await buildBoardFile(boardId);
  if (!('file' in built)) return built.error === 'too_large' ? 'too_large' : 'failed';
  const file = built.file;
  // guard JSON.stringify + Blob triple allocation with max-bytes cap
  if (boardFilePayloadLength(file) > MAX_BASE64_CHARS) return 'too_large';
  const json = JSON.stringify(file);
  if (json.length > boardFileCap(file)) return 'too_large';
  const blob = new Blob([json], { type: MIME_JSON });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const meta = getBoard(boardId);
  a.href = url;
  a.download = `${safeFileName(meta?.name ?? boardId)}${FILE_EXT}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'ok';
}

/** Share via Web Share API when available, otherwise fall back to download. */
export async function shareBoard(boardId: string): Promise<'shared' | 'downloaded' | 'failed' | 'too_large'> {
  const built = await buildBoardFile(boardId);
  if (!('file' in built)) return built.error === 'too_large' ? 'too_large' : 'failed';
  const file = built.file;
  if (boardFilePayloadLength(file) > MAX_BASE64_CHARS) return 'too_large';
  const meta = getBoard(boardId);
  const filename = `${safeFileName(meta?.name ?? boardId)}${FILE_EXT}`;
  // guard JSON.stringify + Blob triple allocation with max-bytes cap
  const json = JSON.stringify(file);
  if (json.length > boardFileCap(file)) return 'too_large';
  const blob = new Blob([json], { type: MIME_JSON });
  try {
    const nav = navigator as unknown as { share?: (d: unknown) => Promise<void>; canShare?: (d: unknown) => boolean };
    if (nav.share && nav.canShare) {
      const f = new File([blob], filename, { type: MIME_JSON });
      if (nav.canShare({ files: [f] })) {
        await nav.share({ files: [f], title: meta?.name ?? 'ReView board', text: `ReView board — ${meta?.name ?? boardId}` });
        return 'shared';
      }
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return 'failed';
    // fall through to download for other share errors
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}

export type ImportErrorCode =
  | 'file_too_large'
  | 'read_failed'
  | 'invalid_json'
  | 'invalid_file'
  | 'invalid_update'
  | 'write_failed';

export type ImportResult =
  | { ok: true; board: BoardMeta }
  | { ok: false; error: ImportErrorCode };

export function importErrorI18nKey(
  error: string
):
  | 'importErrorReadFailed'
  | 'importErrorInvalidJson'
  | 'importErrorInvalidFile'
  | 'importErrorInvalidUpdate'
  | 'importErrorTooLarge'
  | 'importErrorWriteFailed'
  | 'importFailed' {
  switch (error) {
    case 'read_failed':
      return 'importErrorReadFailed';
    case 'invalid_json':
      return 'importErrorInvalidJson';
    case 'invalid_file':
      return 'importErrorInvalidFile';
    case 'invalid_update':
      return 'importErrorInvalidUpdate';
    case 'file_too_large':
      return 'importErrorTooLarge';
    case 'write_failed':
      return 'importErrorWriteFailed';
    default:
      return 'importFailed';
  }
}

function parseBoardFile(raw: unknown): BoardFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'review-board') return null;
  if (typeof r.update !== 'string' || !r.update) return null;
  if (r.update.length > MAX_BASE64_CHARS) return null;
  if (typeof r.name !== 'string') return null;
  if (typeof r.v !== 'number' || !Number.isFinite(r.v)) return null;
  if (typeof r.boardId !== 'string' || !r.boardId) return null;
  if (typeof r.teamId !== 'string' || !r.teamId) return null;
  if (!Array.isArray(r.pages) || !r.pages.every((p) => typeof p === 'string' && p)) return null;
  return r as BoardFile;
}

/**
 * Import a v2 .review file (slim update + blob dict).
 * All-or-nothing: a v2 doc carries no `src` fallback, so missing/unverifiable
 * blob bytes fail the whole import instead of creating a board with holes.
 */
async function importBoardFileV2(raw: unknown): Promise<ImportResult> {
  const payload = parseBoardFileV2(raw);
  if (!payload) return { ok: false, error: 'invalid_file' };
  try {
    const probe = new Y.Doc();
    try {
      Y.applyUpdate(probe, payload.docUpdate);
    } finally {
      probe.destroy();
    }
  } catch {
    return { ok: false, error: 'invalid_update' };
  }
  const name = (payload.name && payload.name.trim().slice(0, 40)) || payload.boardId || 'Imported board';
  const teamId = typeof payload.teamId === 'string' && payload.teamId ? payload.teamId : 'default';
  const created = createBoard(name, teamId, 'local');
  try {
    await writeUpdateToBoard(created.id, payload.docUpdate, stripCopiedIdentity);
  } catch {
    await deleteBoardData(created.id);
    return { ok: false, error: 'write_failed' };
  }
  try {
    // put() re-hashes every blob: tampered bytes fail the import, not the board.
    const store = mediaBlobStore();
    for (const [hash, bytes] of payload.blobs) {
      await store.put(hash, bytes, sniffMime(bytes));
    }
  } catch {
    await deleteBoardData(created.id);
    return { ok: false, error: 'write_failed' };
  }
  return { ok: true, board: created };
}

/** Import a .review JSON file — creates a new local board with the payload's content. */
export async function importBoardFile(file: File): Promise<ImportResult> {
  if (typeof file.size === 'number' && file.size > MAX_V2_FILE_BYTES) {
    return { ok: false, error: 'file_too_large' };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: 'read_failed' };
  }
  if (text.length > MAX_V2_FILE_BYTES) return { ok: false, error: 'file_too_large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  // Stage 2 v2 envelope (slim update + blob dict); legacy v1 flows below untouched.
  if (sniffBoardFileVersion(parsed) === 2) return importBoardFileV2(parsed);
  const payload = parseBoardFile(parsed);
  if (!payload) return { ok: false, error: 'invalid_file' };
  if (payload.update.length > MAX_BASE64_CHARS) return { ok: false, error: 'file_too_large' };
  let update: Uint8Array;
  try {
    update = fromBase64(payload.update);
  } catch {
    return { ok: false, error: 'invalid_update' };
  }
  if (update.length > MAX_UPDATE_BYTES) return { ok: false, error: 'file_too_large' };
  if (update.length === 0) return { ok: false, error: 'invalid_update' };
  // Validate that it is a Yjs update (apply to temp doc)
  try {
    const probe = new Y.Doc();
    Y.applyUpdate(probe, update);
    probe.destroy();
  } catch {
    return { ok: false, error: 'invalid_update' };
  }
  const name = (payload.name && payload.name.trim().slice(0, 40)) || payload.boardId || 'Imported board';
  const teamId = typeof payload.teamId === 'string' && payload.teamId ? payload.teamId : 'default';
  const created = createBoard(name, teamId, 'local');
  try {
    await writeUpdateToBoard(created.id, update, stripCopiedIdentity);
  } catch {
    await deleteBoardData(created.id);
    return { ok: false, error: 'write_failed' };
  }
  return { ok: true, board: created };
}

/** Convenience: import from a JSON string (e.g. pasted). */
export async function importBoardFromText(text: string): Promise<ImportResult> {
  if (text.length > MAX_FILE_BYTES) return { ok: false, error: 'file_too_large' };
  const blob = new Blob([text], { type: MIME_JSON });
  const f = new File([blob], 'pasted.review', { type: MIME_JSON });
  return importBoardFile(f);
}

export const BOARD_FILE_EXT = FILE_EXT;
