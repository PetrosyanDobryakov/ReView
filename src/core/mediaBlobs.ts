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
  LOD_FULL_MIN_SCREEN_PX,
  MemoryBlobStore,
  THUMB_JPEG_QUALITY,
  THUMB_MAX_DIM,
  createBlobObjectUrl,
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
 * Read path: blob hash → renderable object URL.
 *
 * Synchronous paint code uses {@link resolvedBlobUrl} (cache hit only) and
 * falls back to `src` while bytes load. {@link ensureBlobUrl} loads in the
 * background with in-flight dedup (one store read per hash no matter how many
 * frames ask) and a short negative cache so missing blobs don't hammer IDB.
 * Loaded URLs warm the existing engine image/video cache (`blob:` URLs are
 * accepted), whose load listeners already trigger repaint — no new repaint
 * plumbing needed.
 */

const resolvedUrls = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
const negativeUntil = new Map<string, number>();

/** How long a store miss suppresses retries (ms). */
export const BLOB_NEGATIVE_TTL_MS = 30_000;

/** Sync cache read for paint. Null = not loaded (yet or at all). */
export function resolvedBlobUrl(hash: string): string | null {
  return resolvedUrls.get(hash) ?? null;
}

/** Background load of one blob into an object URL. Never throws. */
export function ensureBlobUrl(hash: string, store?: BlobStore): Promise<string | null> {
  const hit = resolvedUrls.get(hash);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(hash);
  if (pending) return pending;
  const quietUntil = negativeUntil.get(hash) ?? 0;
  if (quietUntil > Date.now()) return Promise.resolve(null);
  const job = (async (): Promise<string | null> => {
    try {
      const row = await (store ?? mediaBlobStore()).get(hash);
      if (!row) {
        negativeUntil.set(hash, Date.now() + BLOB_NEGATIVE_TTL_MS);
        return null;
      }
      negativeUntil.delete(hash);
      const url = createBlobObjectUrl(row.bytes, row.mime);
      if (!url) {
        negativeUntil.set(hash, Date.now() + BLOB_NEGATIVE_TTL_MS);
        return null;
      }
      resolvedUrls.set(hash, url);
      return url;
    } catch {
      negativeUntil.set(hash, Date.now() + BLOB_NEGATIVE_TTL_MS);
      return null;
    } finally {
      inflight.delete(hash);
    }
  })();
  inflight.set(hash, job);
  return job;
}

/** Drop a resolved URL (future GC wiring). Returns true when one existed. */
export function releaseResolvedBlobUrl(hash: string): boolean {
  const url = resolvedUrls.get(hash);
  if (!url) return false;
  resolvedUrls.delete(hash);
  try {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  } catch {
    /* ignore */
  }
  return true;
}

/** Test hook: clear resolver caches. */
export function __clearBlobResolverForTests(): void {
  for (const [, url] of resolvedUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
  resolvedUrls.clear();
  inflight.clear();
  negativeUntil.clear();
}

/** Which resolution to load for an on-screen size (pure, spec 2.4). */
export function selectBlobKind(screenPx: number): 'full' | 'thumb' {
  return screenPx >= LOD_FULL_MIN_SCREEN_PX ? 'full' : 'thumb';
}

/**
 * Paint source for a single-src view (pure).
 * Resolved blob wins (full, else thumb); otherwise legacy `src`.
 */
export function selectPaintSrc(
  src: string | undefined,
  fullUrl: string | null,
  thumbUrl: string | null
): string {
  return fullUrl ?? thumbUrl ?? src ?? '';
}

/**
 * Paint source for one doc page (pure).
 * Resolved page blob wins (full, else thumb); otherwise legacy page dataURL.
 */
export function selectDocPaintSrc(
  pageDataUrl: string | undefined,
  pageBlobUrl: string | null,
  pageThumbUrl: string | null
): string {
  return pageBlobUrl ?? pageThumbUrl ?? pageDataUrl ?? '';
}

export interface BlobMediaView {
  type?: string;
  blob?: string | null;
  thumb?: string | null;
  mime?: string;
  pageBlobs?: string[];
  pageThumbs?: Array<string | null>;
}

/**
 * Per-frame warmer for visible views: kicks background loads for the LOD
 * resolution the view needs right now. Fire-and-forget, never throws.
 * `pageIndex` is the resolved doc page (doc shapes only).
 */
export function warmVisibleBlobMedia(
  v: BlobMediaView,
  screenPx: number,
  pageIndex?: number,
  store?: BlobStore
): void {
  try {
    if (v.type === 'image' || v.type === 'video' || (!v.type && (v.blob || v.thumb))) {
      if (selectBlobKind(screenPx) === 'full') {
        if (v.blob) void ensureBlobUrl(v.blob, store);
      } else if (v.thumb) {
        void ensureBlobUrl(v.thumb, store);
      } else if (v.blob) {
        void ensureBlobUrl(v.blob, store);
      }
      return;
    }
    if (v.type === 'doc' && pageIndex !== undefined) {
      const full = v.pageBlobs?.[pageIndex];
      const thumb = v.pageThumbs?.[pageIndex];
      if (selectBlobKind(screenPx) === 'full') {
        if (full) void ensureBlobUrl(full, store);
      } else if (thumb) {
        void ensureBlobUrl(thumb, store);
      } else if (full) {
        void ensureBlobUrl(full, store);
      }
    }
  } catch {
    /* warmer is best-effort */
  }
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
