/**
 * `.review` file envelope v2 — pure module (no engine/store imports).
 *
 * v1 inlines every media byte as base64 inside one Yjs update (32 MB cap).
 * v2 keeps the (slim, post-blob) doc update plus a `{ hash: base64 }` blob
 * dictionary. Import accepts v1 and v2; v1 boards migrate on open.
 *
 * Honest ceiling: files are for boards up to ~100 MB; bigger boards travel
 * via P2P or a board-folder copy (base64 costs +33% and RAM).
 */

import { isBlobHash } from './blobs.ts';

export const FILE_VERSION_V2 = 2;
/** v2 files may be bigger than v1 (blobs ride alongside, not inside, the doc). */
export const MAX_V2_FILE_BYTES = 100 * 1024 * 1024;
/** One blob entry cap (mirrors the transfer cap). */
export const MAX_V2_BLOB_BYTES = 32 * 1024 * 1024;
/** Slim doc update cap (same as v1 — the doc itself must stay lean). */
export const MAX_V2_UPDATE_BYTES = 32 * 1024 * 1024;

export interface BoardFileV2 {
  v: 2;
  kind: 'review-board';
  boardId: string;
  name: string;
  teamId: string;
  createdAt: number;
  exportedAt: number;
  appVersion: string;
  pages: string[];
  /** base64 of Y.encodeStateAsUpdate (slim doc, refs only). */
  docUpdate: string;
  /** sha256 hex → base64 bytes. */
  blobs: Record<string, string>;
}

export interface ParsedBoardFileV2 {
  boardId: string;
  name: string;
  teamId: string;
  createdAt: number;
  exportedAt: number;
  appVersion: string;
  pages: string[];
  docUpdate: Uint8Array;
  blobs: Map<string, Uint8Array>;
}

/** Chunked bytes → base64 (avoids O(n²) concat and arg limits). */
export function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const buf = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(e: string): string } } }).Buffer;
  if (buf) return buf.from(bytes).toString('base64');
  const CHUNK = 0x8000;
  const aligned = CHUNK - (CHUNK % 3);
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += aligned) {
    const slice = bytes.subarray(i, i + aligned);
    let str = '';
    for (let j = 0; j < slice.length; j++) str += String.fromCharCode(slice[j]);
    parts.push(btoa(str));
  }
  return parts.join('');
}

/** base64 → bytes with an output cap. Null on any malformed/oversize input. */
export function base64ToBytes(b64: string, maxBytes: number): Uint8Array | null {
  if (typeof b64 !== 'string') return null;
  const clean = b64.replace(/\s+/g, '');
  if (!clean) return null;
  let padding = 0;
  if (clean.endsWith('==')) padding = 2;
  else if (clean.endsWith('=')) padding = 1;
  const total = Math.floor((clean.length * 3) / 4) - padding;
  if (!Number.isFinite(total) || total <= 0 || total > maxBytes) return null;
  const buf = (globalThis as { Buffer?: { from(s: string, e: string): Uint8Array } }).Buffer;
  if (buf) {
    try {
      const out = Uint8Array.from(buf.from(clean, 'base64'));
      if (out.length !== total || out.length > maxBytes) return null;
      return out;
    } catch {
      return null;
    }
  }
  if (typeof atob === 'undefined') return null;
  try {
    const CHUNK = 0x8000;
    const aligned = CHUNK - (CHUNK % 4);
    const out = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < clean.length; i += aligned) {
      const bin = atob(clean.slice(i, i + aligned));
      for (let j = 0; j < bin.length; j++) out[offset++] = bin.charCodeAt(j);
    }
    if (offset !== total) return null;
    return out;
  } catch {
    return null;
  }
}

export type BoardFileV2Error = 'too_large' | 'invalid';

export function createBoardFileV2(input: {
  boardId: string;
  name: string;
  teamId: string;
  createdAt: number;
  exportedAt: number;
  appVersion: string;
  pages: string[];
  docUpdate: Uint8Array;
  blobs: Array<{ hash: string; bytes: Uint8Array }>;
}): { file: BoardFileV2 } | { error: BoardFileV2Error } {
  const { docUpdate, blobs } = input;
  if (!input.boardId || !input.teamId || typeof input.name !== 'string') return { error: 'invalid' };
  if (!docUpdate || docUpdate.length === 0 || docUpdate.length > MAX_V2_UPDATE_BYTES) {
    return { error: docUpdate && docUpdate.length > 0 ? 'too_large' : 'invalid' };
  }
  const seen = new Set<string>();
  let total = docUpdate.length;
  for (const b of blobs) {
    if (!isBlobHash(b.hash) || seen.has(b.hash)) return { error: 'invalid' };
    seen.add(b.hash);
    if (!b.bytes || b.bytes.length === 0 || b.bytes.length > MAX_V2_BLOB_BYTES) return { error: 'too_large' };
    total += b.bytes.length;
    if (total > MAX_V2_FILE_BYTES) return { error: 'too_large' };
  }
  // base64 inflates ~4/3; bound the JSON before allocating it.
  if (Math.ceil(total / 3) * 4 + 2048 > MAX_V2_FILE_BYTES) return { error: 'too_large' };
  const dict: Record<string, string> = {};
  for (const b of blobs) dict[b.hash] = bytesToBase64(b.bytes);
  return {
    file: {
      v: 2,
      kind: 'review-board',
      boardId: input.boardId,
      name: input.name,
      teamId: input.teamId,
      createdAt: input.createdAt,
      exportedAt: input.exportedAt,
      appVersion: input.appVersion,
      pages: input.pages.length ? input.pages : ['main'],
      docUpdate: bytesToBase64(docUpdate),
      blobs: dict,
    },
  };
}

/** Strict v2 parse. Null on anything unexpected (v1 files return null too). */
export function parseBoardFileV2(raw: unknown): ParsedBoardFileV2 | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'review-board' || r.v !== 2) return null;
  if (typeof r.boardId !== 'string' || !r.boardId) return null;
  if (typeof r.teamId !== 'string' || !r.teamId) return null;
  if (typeof r.name !== 'string') return null;
  if (!Array.isArray(r.pages) || !r.pages.every((p) => typeof p === 'string' && p)) return null;
  if (typeof r.docUpdate !== 'string' || !r.docUpdate) return null;
  if (!r.blobs || typeof r.blobs !== 'object' || Array.isArray(r.blobs)) return null;
  const docUpdate = base64ToBytes(r.docUpdate, MAX_V2_UPDATE_BYTES);
  if (!docUpdate) return null;
  const blobs = new Map<string, Uint8Array>();
  let total = docUpdate.length;
  for (const [hash, b64] of Object.entries(r.blobs as Record<string, unknown>)) {
    if (!isBlobHash(hash) || blobs.has(hash)) return null;
    if (typeof b64 !== 'string' || !b64) return null;
    const bytes = base64ToBytes(b64, MAX_V2_BLOB_BYTES);
    if (!bytes) return null;
    total += bytes.length;
    if (total > MAX_V2_FILE_BYTES) return null;
    blobs.set(hash, bytes);
  }
  // Bound the JSON envelope itself before callers stringify/parse big files.
  const blobValues = Object.values(r.blobs as Record<string, unknown>);
  let approxJson = (r.docUpdate as string).length;
  for (const b64 of blobValues) {
    if (typeof b64 === 'string') approxJson += b64.length;
  }
  if (approxJson + 2048 > MAX_V2_FILE_BYTES) return null;
  return {
    boardId: r.boardId,
    name: r.name,
    teamId: r.teamId,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
    exportedAt: typeof r.exportedAt === 'number' ? r.exportedAt : 0,
    appVersion: typeof r.appVersion === 'string' ? r.appVersion : '',
    pages: (r.pages as string[]).slice(),
    docUpdate,
    blobs,
  };
}

/**
 * Mime sniff by magic bytes (covers everything our ingest pipeline stores).
 * The shape's own `mime` field stays authoritative for render decisions;
 * this only feeds the blob-store row on import.
 */
export function sniffMime(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
  ) {
    return 'video/mp4';
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'video/webm';
  }
  return 'application/octet-stream';
}

/** 1 for legacy files, 2 for v2, null for garbage. */
export function sniffBoardFileVersion(raw: unknown): 1 | 2 | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'review-board') return null;
  if (r.v === 2 && typeof r.docUpdate === 'string' && r.blobs && typeof r.blobs === 'object') return 2;
  if (typeof r.v === 'number' && typeof r.update === 'string') return 1;
  return null;
}
