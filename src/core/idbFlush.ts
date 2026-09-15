import { IndexeddbPersistence, storeState } from 'y-indexeddb';

/** IndexedDB blocked/quota can hang forever — race every await with a timeout. */
export const IDB_FLUSH_TIMEOUT_MS = 3500;

export function withIdbTimeout<T>(promise: Promise<T>, label: string, ms = IDB_FLUSH_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * y-indexeddb `storeState` does not await `addAutoKey`. A follow-up readwrite
 * `count()` is the real commit barrier.
 */
export async function waitForIdbIdle(persist: IndexeddbPersistence): Promise<boolean> {
  const db = (persist as unknown as { db: IDBDatabase | null }).db;
  if (!db) return false;
  const names = Array.from(db.objectStoreNames);
  const target = names.find((n) => n !== 'custom') ?? names[0];
  if (!target) return false;
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), IDB_FLUSH_TIMEOUT_MS);
    try {
      const tx = db.transaction([target], 'readwrite');
      tx.oncomplete = () => {
        clearTimeout(timer);
        done(true);
      };
      tx.onerror = () => {
        clearTimeout(timer);
        done(false);
      };
      tx.onabort = () => {
        clearTimeout(timer);
        done(false);
      };
      tx.objectStore(target).count();
    } catch {
      clearTimeout(timer);
      done(false);
    }
  });
}

export async function flushIndexedDbPersistence(persist: IndexeddbPersistence): Promise<boolean> {
  try {
    await Promise.race([
      (storeState as unknown as (p: unknown, f?: boolean) => Promise<void>)(persist, true),
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('storeState timeout')), IDB_FLUSH_TIMEOUT_MS);
      }),
    ]);
  } catch {
    /* y-indexeddb storeState does not await addAutoKey; the barrier below does */
  }
  return waitForIdbIdle(persist);
}
