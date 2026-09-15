import * as Y from 'yjs';

/** SQLite DO `put()` key+value must stay under 2 MiB. Leave headroom. */
export const STORAGE_CHUNK = 1_500_000;
/** Full-doc encode at most once per second; tails cover the gap. */
export const FULL_PERSIST_MS = 1000;
export const PUT_BATCH = 80;
export const MAX_WS_MESSAGE = 32 * 1024 * 1024;

export type BlobStorage = {
  get<T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined>;
  put(key: string | Record<string, unknown>, value?: unknown): Promise<void>;
  delete(key: string | string[]): Promise<boolean | number>;
};

export function asUint8(data: unknown): Uint8Array | null {
  if (data == null) return null;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return null;
}

export function splitChunks(bytes: Uint8Array, size = STORAGE_CHUNK): Uint8Array[] {
  if (bytes.length === 0) return [new Uint8Array(0)];
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    out.push(bytes.slice(i, Math.min(bytes.length, i + size)));
  }
  return out;
}

export function joinChunks(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function shouldFullPersist(lastPersist: number, now: number, interval = FULL_PERSIST_MS): boolean {
  return now - lastPersist >= interval;
}

export function createAsyncGate(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<void> = Promise.resolve();
  return (fn) => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export function mergeTails(prev: Uint8Array | null, updates: Uint8Array[]): Uint8Array | null {
  const parts = (prev ? [prev, ...updates] : updates).filter((u) => u && u.length > 0);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0]!;
  return Y.mergeUpdates(parts);
}

function asMap(got: unknown): Map<string, unknown> | null {
  if (got instanceof Map) return got as Map<string, unknown>;
  if (got && typeof got === 'object' && !ArrayBuffer.isView(got) && !(got instanceof Uint8Array)) {
    return new Map(Object.entries(got as Record<string, unknown>));
  }
  return null;
}

/** Durable Object storage may round-trip integers as number or decimal string. */
export function storageCount(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return 0;
}

function genBase(prefix: string, gen: number): string {
  return `${prefix}:${gen}`;
}

async function readChunked(storage: BlobStorage, base: string, n: number): Promise<Uint8Array | null> {
  const keys = Array.from({ length: n }, (_, i) => `${base}:${i}`);
  const got = await storage.get(keys);
  const map = asMap(got);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const v = map ? map.get(`${base}:${i}`) : undefined;
    const u = asUint8(v);
    if (!u) return null;
    parts.push(u);
  }
  return joinChunks(parts);
}

async function deleteChunked(storage: BlobStorage, base: string, n: number, extra: string[] = []): Promise<void> {
  const keys = [...extra, `${base}:n`];
  const count = Math.max(n, 1);
  for (let i = 0; i < count; i++) keys.push(`${base}:${i}`);
  await storage.delete(keys);
}

/**
 * Generation-addressed blobs: chunks are written under `prefix:<gen>:*`, then
 * a single `prefix:gen` pointer flips. Crash before the flip leaves the previous
 * generation readable; crash after leaves only orphaned unused keys.
 */
export async function writeBlob(storage: BlobStorage, prefix: string, bytes: Uint8Array): Promise<void> {
  const prevGen = storageCount(await storage.get(`${prefix}:gen`));
  const nextGen = prevGen + 1;
  const base = genBase(prefix, nextGen);
  const chunks = splitChunks(bytes);
  for (let off = 0; off < chunks.length; off += PUT_BATCH) {
    const slice = chunks.slice(off, off + PUT_BATCH);
    const entries: Record<string, unknown> = {};
    slice.forEach((c, j) => {
      entries[`${base}:${off + j}`] = c;
    });
    if (off + slice.length >= chunks.length) entries[`${base}:n`] = chunks.length;
    await storage.put(entries);
  }
  await storage.put({ [`${prefix}:gen`]: nextGen });

  const leftover = [prefix, `${prefix}:n`];
  if (prevGen > 0) {
    const prevN = storageCount(await storage.get(`${genBase(prefix, prevGen)}:n`));
    await deleteChunked(storage, genBase(prefix, prevGen), prevN, leftover);
  } else {
    const legacyN = storageCount(await storage.get(`${prefix}:n`));
    await deleteChunked(storage, prefix, legacyN, leftover);
  }
}

export async function readBlob(storage: BlobStorage, prefix: string): Promise<Uint8Array | null> {
  const gen = storageCount(await storage.get(`${prefix}:gen`));
  if (gen > 0) {
    const n = storageCount(await storage.get(`${genBase(prefix, gen)}:n`));
    if (n > 0) return readChunked(storage, genBase(prefix, gen), n);
    return null;
  }
  const n = storageCount(await storage.get(`${prefix}:n`));
  if (n > 0) return readChunked(storage, prefix, n);
  return asUint8(await storage.get(prefix));
}

export async function deleteBlob(storage: BlobStorage, prefix: string): Promise<void> {
  const gen = storageCount(await storage.get(`${prefix}:gen`));
  const keys = [prefix, `${prefix}:n`, `${prefix}:gen`];
  if (gen > 0) {
    const n = storageCount(await storage.get(`${genBase(prefix, gen)}:n`));
    keys.push(`${genBase(prefix, gen)}:n`);
    for (let i = 0; i < Math.max(n, 1); i++) keys.push(`${genBase(prefix, gen)}:${i}`);
  }
  const legacyN = storageCount(await storage.get(`${prefix}:n`));
  for (let i = 0; i < Math.max(legacyN, 1); i++) keys.push(`${prefix}:${i}`);
  await storage.delete(keys);
}

/** Drop the tail only when the encoded snapshot still matches the live doc. */
export function canDropPersistedTail(encodeGen: number, currentGen: number, pendingCount: number): boolean {
  return encodeGen === currentGen && pendingCount === 0;
}

/** Empty-room GC must not wipe storage while a persist is still dirty or queued. */
export function canGcEmptyRoom(socketCount: number, dirty: boolean, pendingCount: number): boolean {
  return socketCount <= 0 && !dirty && pendingCount <= 0;
}
