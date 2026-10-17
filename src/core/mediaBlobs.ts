/**
 * Media ingest into the blob store — Stage 2, phase A (dual-write).
 *
 * New inserts keep writing `src`/`pages` exactly as before (old clients and all
 * render paths keep working) and additionally store the bytes content-addressed
 * plus a `blob`/`thumb` reference patched onto the shape. Nothing here ever
 * throws to callers: failures resolve to null and the board keeps its `src`.
 *
 * DOM-free at import time (thumb rendering degrades to null without canvas);
 * the shape patcher is injected so Node tests never touch the real store.
 */

import {
  CompositeBlobStore,
  IdbBlobStore,
  MemoryBlobStore,
  THUMB_JPEG_QUALITY,
  THUMB_MAX_DIM,
  hashBytes,
  type BlobRef,
  type BlobStore,
} from './blobs.ts';

/** Upper bound for one ingested payload (mirrors the 32 MB transfer cap). */
export const INGEST_MAX_BYTES = 32 * 1024 * 1024;

export type ShapePatcher = (shapeId: string, patch: Record<string, unknown>) => void;

export interface IngestDeps {
  store?: BlobStore;
  patch?: ShapePatcher;
  /** Bail out when the user already left the board (avoids cross-board writes). */
  isCurrent?: () => boolean;
}

export interface DecodedDataUrl {
  bytes: Uint8Array;
  mime: string;
}

let sharedStore: BlobStore | null = null;

/** App-wide two-level media cache (memory → IndexedDB `review-blobs`). */
export function mediaBlobStore(): BlobStore {
  if (!sharedStore) {
    sharedStore = new CompositeBlobStore(new MemoryBlobStore(), new IdbBlobStore());
  }
  return sharedStore;
}

/** Split `data:<mime>[;...];base64,<payload>` (whitespace-tolerant). */
export function decodeDataUrl(src: string): DecodedDataUrl | null {
  if (typeof src !== 'string') return null;
  const comma = src.indexOf(',');
  if (comma < 0) return null;
  const head = src.slice(0, comma);
  const match = /^data:([^;,]+)(?:;[^,]*)?;base64$/i.exec(head);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!mime.includes('/')) return null;
  const clean = src.slice(comma + 1).replace(/\s+/g, '');
  if (!clean) return null;
  try {
    const bytes = base64ToBytes(clean);
    if (!bytes || bytes.length === 0 || bytes.length > INGEST_MAX_BYTES) return null;
    return { bytes, mime };
  } catch {
    return null;
  }
}

function base64ToBytes(clean: string): Uint8Array | null {
  const buf = (globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer;
  if (buf) {
    try {
      const out = Uint8Array.from(buf.from(clean, 'base64'));
      return out.length ? out : null;
    } catch {
      return null;
    }
  }
  if (typeof atob === 'undefined') return null;
  try {
    // Chunked atob: avoids max-string/arg limits on MB-scale payloads.
    const CHUNK = 0x8000;
    const aligned = CHUNK - (CHUNK % 4);
    let total = 0;
    const parts: string[] = [];
    for (let i = 0; i < clean.length; i += aligned) {
      const bin = atob(clean.slice(i, i + aligned));
      parts.push(bin);
      total += bin.length;
    }
    if (!total) return null;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const bin of parts) {
      for (let j = 0; j < bin.length; j++) out[offset++] = bin.charCodeAt(j);
    }
    return out;
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    try {
      if (typeof document === 'undefined' || typeof Image === 'undefined') {
        reject(new Error('mediaBlobs: no DOM for thumbnails'));
        return;
      }
      const img = new Image();
      img.onload = () => resolve({ w: Math.max(1, img.naturalWidth), h: Math.max(1, img.naturalHeight) });
      img.onerror = () => reject(new Error('mediaBlobs: thumbnail source failed to load'));
      img.src = src;
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * LOD preview: longest side THUMB_MAX_DIM px, JPEG. Returns null without DOM
 * or on any failure — callers treat null as "no preview", never as an error.
 */
export async function makeThumbBytes(src: string): Promise<Uint8Array | null> {
  try {
    if (typeof document === 'undefined') return null;
    const { w, h } = await loadImage(src);
    const scale = Math.min(1, THUMB_MAX_DIM / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('mediaBlobs: thumb draw failed'));
      img.src = src;
    });
    ctx.drawImage(img, 0, 0, tw, th);
    const url = canvas.toDataURL('image/jpeg', THUMB_JPEG_QUALITY);
    return decodeDataUrl(url)?.bytes ?? null;
  } catch {
    return null;
  }
}

/**
 * Store one dataURL as blobs. Returns the shape fields to patch
 * ({ blob, thumb, mime, bytes }) or null when ingest is impossible.
 * Never throws.
 */
export async function ingestDataUrlAsBlob(
  src: string,
  opts?: { store?: BlobStore; withThumb?: boolean }
): Promise<BlobRef | null> {
  try {
    const decoded = decodeDataUrl(src);
    if (!decoded) return null;
    const store = opts?.store ?? mediaBlobStore();
    const blob = await hashBytes(decoded.bytes);
    await store.put(blob, decoded.bytes, decoded.mime);
    let thumb: string | null = null;
    if (opts?.withThumb !== false && decoded.mime.startsWith('image/')) {
      const thumbBytes = await makeThumbBytes(src);
      if (thumbBytes && thumbBytes.length) {
        thumb = await hashBytes(thumbBytes);
        await store.put(thumb, thumbBytes, 'image/jpeg');
      }
    }
    return { blob, thumb, mime: decoded.mime, bytes: decoded.bytes.length };
  } catch {
    return null;
  }
}

function currentOk(deps: IngestDeps | undefined): boolean {
  try {
    return deps?.isCurrent ? deps.isCurrent() : true;
  } catch {
    return false;
  }
}

function applyPatch(deps: IngestDeps | undefined, shapeId: string, patch: Record<string, unknown>): void {
  try {
    deps?.patch?.(shapeId, patch);
  } catch {
    /* phase A is best-effort */
  }
}

/** Phase-A dual-write for a single-src shape (image / video). Never throws. */
export async function attachImageBlobs(
  shapeId: string,
  src: string,
  deps?: IngestDeps
): Promise<BlobRef | null> {
  const ref = await ingestDataUrlAsBlob(src, { store: deps?.store });
  if (!ref || !currentOk(deps)) return ref;
  applyPatch(deps, shapeId, { blob: ref.blob, thumb: ref.thumb, mime: ref.mime, bytes: ref.bytes });
  return ref;
}

/**
 * Phase-A dual-write for a doc shape (page dataURLs → pageBlobs/pageThumbs).
 * Pages that fail to ingest are skipped; the shape keeps `pages` regardless.
 * Never throws.
 */
export async function attachDocBlobs(
  shapeId: string,
  pages: string[],
  deps?: IngestDeps
): Promise<{ pageBlobs: string[]; pageThumbs: Array<string | null> } | null> {
  try {
    const store = deps?.store ?? mediaBlobStore();
    const pageBlobs: string[] = [];
    const pageThumbs: Array<string | null> = [];
    for (const page of pages) {
      if (!currentOk(deps)) return null;
      const ref = await ingestDataUrlAsBlob(page, { store });
      if (!ref) return null;
      pageBlobs.push(ref.blob);
      pageThumbs.push(ref.thumb);
    }
    if (!currentOk(deps)) return null;
    applyPatch(deps, shapeId, { pageBlobs, pageThumbs });
    return { pageBlobs, pageThumbs };
  } catch {
    return null;
  }
}
