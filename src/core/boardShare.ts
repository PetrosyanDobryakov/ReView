/**
 * Board file share — local-first export/import for Vercel/static hosting.
 *
 * A .review file is a JSON envelope with a base64-encoded Yjs update plus
 * board metadata. Images are already stored as data URLs inside the Y.Doc,
 * so the update carries everything.
 */

import * as Y from 'yjs';
import { IndexeddbPersistence, storeState } from 'y-indexeddb';
import { getBoard, createBoard, type BoardMeta } from './boards';
import { getCurrentBoardId, doc } from './store';

const FILE_VERSION = 1;
const FILE_EXT = '.review';
const MIME_JSON = 'application/json';

// File-import limits (defense in depth: file.text() / JSON.parse / base64 decode / Y.applyUpdate all bounded)
// Mirror Engine.ts 8MB image guard — unbounded file.text()/JSON/fromBase64/Y.applyUpdate led to quota/memory exhaustion
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_UPDATE_BYTES = 8 * 1024 * 1024;
export const MAX_BASE64_CHARS = 11 * 1024 * 1024; // ceil(8MB*4/3) ≈ 10.7MB

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

// IndexeddbPersistence.whenSynced only resolves on 'synced' (y-indexeddb.js:80) and
// _db (y-indexeddb.js:71/83) has no timeout/reject path, so IDB blocked/quota
// can hang forever — race every await with a timeout.
const PERSIST_SYNC_TIMEOUT_MS = 3500;

function withSyncTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${PERSIST_SYNC_TIMEOUT_MS}ms`)), PERSIST_SYNC_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}

async function destroyPersist(persist: IndexeddbPersistence): Promise<void> {
  try {
    await Promise.race([
      persist.destroy() as Promise<unknown>,
      new Promise<void>((resolve) => setTimeout(resolve, 800)),
    ]);
  } catch {}
}

async function loadUpdateForBoard(boardId: string): Promise<Uint8Array | null> {
  if (getCurrentBoardId() === boardId) {
    try {
      const u = Y.encodeStateAsUpdate(doc);
      if (u.length > MAX_UPDATE_BYTES) return null;
      return u;
    } catch {
      return null;
    }
  }
  const tmp = new Y.Doc();
  const persist = new IndexeddbPersistence(dbName(boardId), tmp);
  try {
    await withSyncTimeout(persist.whenSynced as Promise<unknown>, `loadUpdateForBoard:${boardId}`) as Promise<unknown>;
    if (tmp.getMap('shapes').size === 0 && tmp.getArray('order').length === 0 && tmp.getArray('pages').length === 0) {
      // still export — empty board is valid (meta only)
    }
    const u = Y.encodeStateAsUpdate(tmp);
    if (u.length > MAX_UPDATE_BYTES) return null;
    return u;
  } catch (err) {
    try { console.warn('[boardShare] loadUpdateForBoard failed', boardId, err); } catch {}
    return null;
  } finally {
    await destroyPersist(persist);
    tmp.destroy();
  }
}

async function writeUpdateToBoard(boardId: string, update: Uint8Array): Promise<void> {
  if (update.length > MAX_UPDATE_BYTES) throw new Error('update too large');
  if (getCurrentBoardId() === boardId) {
    Y.applyUpdate(doc, update);
    return;
  }
  const tmp = new Y.Doc();
  const persist = new IndexeddbPersistence(dbName(boardId), tmp);
  try {
    await withSyncTimeout(persist.whenSynced as Promise<unknown>, `writeUpdateToBoard:${boardId}`) as Promise<unknown>;
    Y.applyUpdate(tmp, update);
    // y-indexeddb's _storeUpdate is fire-and-forget (addAutoKey without
    // awaiting the transaction), so destroy() can race the flush. Use the
    // public storeState() helper which targets the correct objectStore
    // internally and returns a promise that resolves after the IndexedDB
    // transaction commits — no private _db or hardcoded 'updates' name.
    let flushed = false;
    try {
      await Promise.race([
        (storeState as unknown as (p: unknown, f?: boolean) => Promise<void>)(persist, true).then(() => {
          flushed = true;
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch {
      // storage failure — fall through to best-effort yield
    }
    if (!flushed) {
      // Fallback barrier using public persist.db and dynamic store names
      // (avoids hardcoding 'updates' / private _db).
      const db = (persist as unknown as { db: IDBDatabase | null }).db;
      if (db) {
        const names = Array.from(db.objectStoreNames);
        const target = names.find((n) => n !== 'custom') ?? names[0];
        if (target) {
          await new Promise<void>((resolve) => {
            let settled = false;
            const done = () => {
              if (!settled) {
                settled = true;
                resolve();
              }
            };
            try {
              const tx = db.transaction([target], 'readwrite');
              tx.oncomplete = done;
              tx.onerror = done;
              tx.onabort = done;
              try {
                const req = tx.objectStore(target).count();
                req.onsuccess = () => {};
                req.onerror = done;
              } catch {
                done();
              }
              setTimeout(done, 2000);
            } catch {
              done();
            }
          });
        } else {
          await new Promise<void>((r) => setTimeout(r, 80));
        }
      } else {
        await new Promise<void>((r) => setTimeout(r, 80));
      }
    }
    // Yield one macrotask so lib0 rtop promise continuations settle.
    await new Promise<void>((r) => setTimeout(r, 0));
  } finally {
    await destroyPersist(persist);
    tmp.destroy();
  }
}

function safeFileName(name: string): string {
  const s = name.trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 40) || 'board';
  return s;
}

/** Build the share payload for a board (no side effects). */
export async function buildBoardFile(boardId: string): Promise<BoardFile | null> {
  const meta = getBoard(boardId);
  if (!meta) return null;
  const update = await loadUpdateForBoard(boardId);
  if (!update) {
    try { console.warn('[boardShare] buildBoardFile: no update for board', boardId); } catch {}
    return null;
  }
  if (update.length > MAX_UPDATE_BYTES) return null;
  // pre-check predicted base64/JSON size before 4/3x blowup + JSON.stringify + Blob triple allocation
  const predictedB64Len = Math.ceil(update.length / 3) * 4;
  if (predictedB64Len > MAX_BASE64_CHARS) return null;
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
  let b64: string;
  try {
    b64 = toBase64(update);
  } catch {
    return null;
  }
  if (b64.length > MAX_BASE64_CHARS) return null;
  // estimated JSON size = base64 + envelope (~512 bytes); bound JSON.stringify + Blob allocation
  if (b64.length + 1024 > MAX_FILE_BYTES) return null;
  return {
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
  };
}

/** Trigger a download for a board's .review file. */
export async function exportBoardFile(boardId: string): Promise<boolean> {
  const file = await buildBoardFile(boardId);
  if (!file) return false;
  // guard JSON.stringify + Blob triple allocation with max-bytes cap
  if (file.update.length > MAX_BASE64_CHARS) return false;
  const json = JSON.stringify(file);
  if (json.length > MAX_FILE_BYTES) return false;
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
  return true;
}

/** Share via Web Share API when available, otherwise fall back to download. */
export async function shareBoard(boardId: string): Promise<'shared' | 'downloaded' | 'failed'> {
  const file = await buildBoardFile(boardId);
  if (!file) return 'failed';
  if (file.update.length > MAX_BASE64_CHARS) return 'failed';
  const meta = getBoard(boardId);
  const filename = `${safeFileName(meta?.name ?? boardId)}${FILE_EXT}`;
  // guard JSON.stringify + Blob triple allocation with max-bytes cap
  const json = JSON.stringify(file);
  if (json.length > MAX_FILE_BYTES) return 'failed';
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

export type ImportResult =
  | { ok: true; board: BoardMeta }
  | { ok: false; error: string };

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

/** Import a .review JSON file — creates a new local board with the payload's content. */
export async function importBoardFile(file: File): Promise<ImportResult> {
  if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
    return { ok: false, error: 'file_too_large' };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: 'read_failed' };
  }
  if (text.length > MAX_FILE_BYTES) return { ok: false, error: 'file_too_large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
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
    await writeUpdateToBoard(created.id, update);
  } catch {
    // board meta exists even if content write failed
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
