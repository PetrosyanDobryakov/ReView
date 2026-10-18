/**
 * Content-addressed media blobs — Stage 2 foundation (desktop plan, spec 2.1–2.3).
 *
 * A blob is immutable bytes addressed by sha256 hex of the FINAL (post-compress)
 * bytes. Y.Doc stores only small refs ({@link BlobRef}); bytes travel out of band.
 *
 * This module is deliberately dependency-free and DOM-free at import time so it
 * runs in the browser, the Tauri webview, and plain Node (tests).
 *
 * NOT wired into the engine yet — no behavior change anywhere by importing this.
 */

export const BLOBS_DB_NAME = 'review-blobs';
export const BLOBS_STORE_NAME = 'blobs';

/** Long side of the LOD preview, px (spec 2.1). */
export const THUMB_MAX_DIM = 256;
/** JPEG quality for the LOD preview (spec 2.1). */
export const THUMB_JPEG_QUALITY = 0.7;
/** On-screen size under which the thumb is enough (spec 2.4). */
export const LOD_FULL_MIN_SCREEN_PX = 400;

/** Default cap for the in-memory render cache (spec 2.3). */
export const MEMORY_BLOB_CAP_BYTES = 64 * 1024 * 1024;

/**
 * Small media reference stored in Y.Doc instead of a dataURL.
 * `blob` is always present; `thumb` is null when no preview exists
 * (e.g. video poster capture failed — UI falls back to an icon).
 */
export interface BlobRef {
  blob: string;
  thumb: string | null;
  mime: string;
  /** Byte size of the full blob (progress UI). */
  bytes: number;
}

export interface StoredBlob {
  bytes: Uint8Array;
  mime: string;
  storedAt: number;
}

export interface BlobStore {
  get(hash: string): Promise<StoredBlob | null>;
  has(hash: string): Promise<boolean>;
  /** Idempotent. Rejects when bytes do not hash to `hash`. */
  put(hash: string, bytes: Uint8Array, mime: string): Promise<void>;
  delete(hash: string): Promise<boolean>;
}

const HASH_RE = /^[0-9a-f]{64}$/;

/** True for a well-formed sha256 hex blob id. */
export function isBlobHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_RE.test(value);
}

/** True for a well-formed {@link BlobRef}. Does not touch any store. */
export function isBlobRef(value: unknown): value is BlobRef {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (!isBlobHash(r.blob)) return false;
  if (r.thumb !== null && r.thumb !== undefined && !isBlobHash(r.thumb)) return false;
  if (typeof r.mime !== 'string' || !r.mime.includes('/')) return false;
  return typeof r.bytes === 'number' && Number.isFinite(r.bytes) && r.bytes >= 0;
}

function getSubtleCrypto(): SubtleCrypto {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) throw new Error('blobs: WebCrypto SHA-256 is unavailable in this runtime');
  return subtle;
}

/** sha256 hex of bytes. Throws on empty input (empty blobs are never stored). */
export async function hashBytes(data: Uint8Array): Promise<string> {
  if (data.length === 0) throw new Error('blobs: refusing to hash empty input');
  const digest = await getSubtleCrypto().digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  const view = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0');
  return out;
}

/**
 * In-memory LRU blob cache. Eviction is by insertion recency (a `get` refreshes);
 * oversized single blobs (> cap) are kept anyway — the cap bounds the cache,
 * not addressability.
 */
export class MemoryBlobStore implements BlobStore {
  private readonly map = new Map<string, StoredBlob>();
  private sizeBytes = 0;
  private readonly maxBytes: number;

  constructor(maxBytes: number = MEMORY_BLOB_CAP_BYTES) {
    this.maxBytes = maxBytes;
  }

  get size(): number {
    return this.sizeBytes;
  }

  get count(): number {
    return this.map.size;
  }

  async get(hash: string): Promise<StoredBlob | null> {
    const hit = this.map.get(hash) ?? null;
    if (hit) {
      // Refresh recency.
      this.map.delete(hash);
      this.map.set(hash, hit);
    }
    return hit;
  }

  async has(hash: string): Promise<boolean> {
    return this.map.has(hash);
  }

  async put(hash: string, bytes: Uint8Array, mime: string): Promise<void> {
    if (!isBlobHash(hash)) throw new Error('blobs: put with malformed hash');
    const actual = await hashBytes(bytes);
    if (actual !== hash) throw new Error('blobs: hash mismatch on put');
    const prev = this.map.get(hash);
    if (prev) {
      this.sizeBytes -= prev.bytes.byteLength;
      this.map.delete(hash);
    }
    this.map.set(hash, { bytes: bytes.slice(), mime, storedAt: Date.now() });
    this.sizeBytes += bytes.byteLength;
    this.evict();
  }

  async delete(hash: string): Promise<boolean> {
    const prev = this.map.get(hash);
    if (!prev) return false;
    this.map.delete(hash);
    this.sizeBytes -= prev.bytes.byteLength;
    return true;
  }

  clear(): void {
    this.map.clear();
    this.sizeBytes = 0;
  }

  private evict(): void {
    while (this.sizeBytes > this.maxBytes && this.map.size > 1) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      const victim = this.map.get(oldest.value);
      this.map.delete(oldest.value);
      if (victim) this.sizeBytes -= victim.bytes.byteLength;
    }
  }
}

type IdbBlobRow = {
  bytes: Uint8Array;
  mime: string;
  storedAt: number;
};

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openBlobsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(BLOBS_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(BLOBS_STORE_NAME)) {
          db.createObjectStore(BLOBS_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('blobs: idb open failed'));
      req.onblocked = () => reject(new Error('blobs: idb open blocked'));
    } catch (e) {
      reject(e);
    }
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('blobs: idb request failed'));
  });
}

/**
 * Persistent browser blob cache in its own database (`review-blobs`) —
 * board documents in `review-v1-*` are never touched by this store.
 * Every operation races a timeout so a wedged/quota-blocked IndexedDB
 * degrades to a miss instead of hanging the board (same posture as idbFlush).
 */
export class IdbBlobStore implements BlobStore {
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;
  private readonly timeoutMs: number;

  constructor(timeoutMs = 3500) {
    this.timeoutMs = timeoutMs;
  }

  static isSupported(): boolean {
    return idbAvailable();
  }

  private ensureDb(): Promise<IDBDatabase> {
    if (!idbAvailable()) return Promise.reject(new Error('blobs: IndexedDB unavailable'));
    if (this.db) return Promise.resolve(this.db);
    if (!this.opening) {
      this.opening = openBlobsDb().then(
        (db) => {
          this.db = db;
          return db;
        },
        (e: unknown) => {
          this.opening = null;
          throw e;
        }
      );
    }
    return this.opening;
  }

  private withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout after ${this.timeoutMs}ms`)), this.timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }) as Promise<T>;
  }

  async get(hash: string): Promise<StoredBlob | null> {
    try {
      const db = await this.withTimeout(this.ensureDb(), 'blobs: open');
      const tx = db.transaction([BLOBS_STORE_NAME], 'readonly');
      const row = await this.withTimeout(
        idbRequest(tx.objectStore(BLOBS_STORE_NAME).get(hash) as IDBRequest<IdbBlobRow | undefined>),
        'blobs: get'
      );
      if (!row) return null;
      return { bytes: row.bytes, mime: row.mime, storedAt: row.storedAt };
    } catch {
      return null;
    }
  }

  async has(hash: string): Promise<boolean> {
    return (await this.get(hash)) !== null;
  }

  async put(hash: string, bytes: Uint8Array, mime: string): Promise<void> {
    if (!isBlobHash(hash)) throw new Error('blobs: put with malformed hash');
    const actual = await hashBytes(bytes);
    if (actual !== hash) throw new Error('blobs: hash mismatch on put');
    const db = await this.withTimeout(this.ensureDb(), 'blobs: open');
    const tx = db.transaction([BLOBS_STORE_NAME], 'readwrite');
    const row: IdbBlobRow = { bytes: bytes.slice(), mime, storedAt: Date.now() };
    await this.withTimeout(
      idbRequest(tx.objectStore(BLOBS_STORE_NAME).put(row, hash)),
      'blobs: put'
    );
  }

  async delete(hash: string): Promise<boolean> {
    try {
      const db = await this.withTimeout(this.ensureDb(), 'blobs: open');
      const tx = db.transaction([BLOBS_STORE_NAME], 'readwrite');
      const existed = (await this.get(hash)) !== null;
      await this.withTimeout(idbRequest(tx.objectStore(BLOBS_STORE_NAME).delete(hash)), 'blobs: delete');
      return existed;
    } catch {
      return false;
    }
  }

  /** All stored hashes — used by mark-and-sweep GC (desktop plan 2.7). */
  async allHashes(): Promise<string[]> {
    try {
      const db = await this.withTimeout(this.ensureDb(), 'blobs: open');
      const tx = db.transaction([BLOBS_STORE_NAME], 'readonly');
      const keys = await this.withTimeout(
        idbRequest(tx.objectStore(BLOBS_STORE_NAME).getAllKeys() as IDBRequest<IDBValidKey[]>),
        'blobs: keys'
      );
      return keys.filter((k): k is string => typeof k === 'string' && isBlobHash(k));
    } catch {
      return [];
    }
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      /* ignore */
    }
    this.db = null;
    this.opening = null;
  }
}

/**
 * Two-level store: `fast` (memory) in front of `slow` (idb/fs).
 * Reads backfill the fast level; writes go to durable first, then cache.
 */
export class CompositeBlobStore implements BlobStore {
  private readonly fast: BlobStore;
  private readonly slow: BlobStore;

  constructor(fast: BlobStore, slow: BlobStore) {
    this.fast = fast;
    this.slow = slow;
  }

  async get(hash: string): Promise<StoredBlob | null> {
    const hit = await this.fast.get(hash);
    if (hit) return hit;
    const miss = await this.slow.get(hash);
    if (miss) {
      try {
        await this.fast.put(hash, miss.bytes, miss.mime);
      } catch {
        /* cache backfill is best-effort */
      }
    }
    return miss;
  }

  async has(hash: string): Promise<boolean> {
    if (await this.fast.has(hash)) return true;
    return this.slow.has(hash);
  }

  async put(hash: string, bytes: Uint8Array, mime: string): Promise<void> {
    await this.slow.put(hash, bytes, mime);
    try {
      await this.fast.put(hash, bytes, mime);
    } catch {
      /* cache fill is best-effort */
    }
  }

  async delete(hash: string): Promise<boolean> {
    const results = await Promise.all([this.fast.delete(hash), this.slow.delete(hash)]);
    return results[0] || results[1];
  }
}

/**
 * Object URL for handing blob bytes to the existing engine image/video cache
 * (it already accepts `blob:` URLs). Browser-only helper — returns null where
 * object URLs are unavailable. Callers must `URL.revokeObjectURL` on release.
 */
export function createBlobObjectUrl(bytes: Uint8Array, mime: string): string | null {
  try {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    if (typeof Blob === 'undefined') return null;
    const copy = bytes.slice();
    const buf = copy.buffer as ArrayBuffer;
    return URL.createObjectURL(new Blob([buf], { type: mime }));
  } catch {
    return null;
  }
}
