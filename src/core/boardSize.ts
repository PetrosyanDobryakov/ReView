/** Estimate local storage weight of a board's IndexedDB document. */

export function boardPersistenceDbName(boardId: string): string {
  return `review-v1-${boardId}`;
}

function byteLengthOf(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value === 'number' || typeof value === 'boolean') return 8;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + byteLengthOf(item), 0);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value).length * 2;
    } catch {
      return 64;
    }
  }
  return 0;
}

function sumStore(db: IDBDatabase, storeName: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      if (!db.objectStoreNames.contains(storeName)) {
        resolve(0);
        return;
      }
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.openCursor();
      let total = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(total);
          return;
        }
        total += byteLengthOf(cursor.key) + byteLengthOf(cursor.value);
        cursor.continue();
      };
      req.onerror = () => resolve(total);
    } catch {
      resolve(0);
    }
  });
}

async function databaseExists(name: string): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  const listed = indexedDB.databases;
  if (typeof listed === 'function') {
    try {
      const dbs = await listed.call(indexedDB);
      return dbs.some((d) => d.name === name);
    } catch {
      /* fall through */
    }
  }
  return new Promise((resolve) => {
    let resolved = false;
    const done = (v: boolean) => {
      if (resolved) return;
      resolved = true;
      resolve(v);
    };
    try {
      const req = indexedDB.open(name);
      req.onupgradeneeded = () => {
        // Missing DB — abort creation.
        try {
          req.transaction?.abort();
        } catch {
          /* ignore */
        }
        done(false);
      };
      req.onsuccess = () => {
        const db = req.result;
        const empty = db.objectStoreNames.length === 0;
        db.close();
        if (empty) {
          try {
            indexedDB.deleteDatabase(name);
          } catch {
            /* ignore */
          }
          done(false);
          return;
        }
        done(true);
      };
      req.onerror = () => done(false);
    } catch {
      done(false);
    }
  });
}

/** Returns approximate byte size of the board's IndexedDB, or 0 if missing. */
export async function estimateBoardBytes(boardId: string): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  const name = boardPersistenceDbName(boardId);
  const exists = await databaseExists(name);
  if (!exists) return 0;

  const openAndSum = (): Promise<number> =>
    new Promise((resolve) => {
      try {
        const req = indexedDB.open(name);
        req.onsuccess = async () => {
          const db = req.result;
          try {
            const names = Array.from(db.objectStoreNames);
            let total = 0;
            for (const storeName of names) {
              total += await sumStore(db, storeName);
            }
            db.close();
            resolve(total);
          } catch {
            try {
              db.close();
            } catch {
              /* ignore */
            }
            resolve(0);
          }
        };
        req.onerror = () => resolve(0);
        // Blocked means another connection is upgrading — retry rather than treat as empty.
        req.onblocked = () => {
          /* resolved by retry loop */
        };
      } catch {
        resolve(0);
      }
    });

  for (let attempt = 0; attempt < 4; attempt++) {
    const size = await Promise.race([
      openAndSum(),
      new Promise<number>((resolve) => {
        globalThis.setTimeout(() => resolve(-1), 400 + attempt * 200);
      }),
    ]);
    if (size >= 0) return size;
    await new Promise((r) => globalThis.setTimeout(r, 120 + attempt * 80));
  }
  return 0;
}

export async function deleteBoardDatabase(boardId: string): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return true;
  const name = boardPersistenceDbName(boardId);
  return new Promise<boolean>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      req.onsuccess = () => done(true);
      req.onerror = () => done(false);
      // Blocked often still completes later; treat as soft failure so callers can warn.
      req.onblocked = () => done(false);
      globalThis.setTimeout(() => done(false), 4000);
    } catch {
      resolve(false);
    }
  });
}

/** Human-readable size for the home list. */
export function formatBoardWeight(bytes: number, locale: string): string {
  if (!bytes || bytes <= 0) return '—';
  const kb = bytes / 1024;
  if (kb < 1) {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes) + ' B';
  }
  if (kb < 1024) {
    const digits = kb < 10 ? 1 : 0;
    return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(kb) + ' KB';
  }
  const mb = kb / 1024;
  const digits = mb < 10 ? 1 : 0;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(mb) + ' MB';
}
