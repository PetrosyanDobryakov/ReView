/**
 * Desktop app only: every saved board is mirrored to a plain file in the
 * app's data folder (`boards/<id>.review` = Yjs snapshot, `<id>.json` = name
 * and team). The files are the durable copy: if the webview's IndexedDB is
 * lost (new profile, changed port/origin), boards come back from disk.
 */

import * as Y from 'yjs';
import { getBoard, importBoardMeta, type BoardMeta } from './boards';
import { isWriteGestureActive, lastGestureEndMs } from './writeGate';
import { isDesktop, listBoardFiles, loadBoardFile, saveBoardFile } from '../net/p2p/desktop';

const SAVE_DEBOUNCE_MS = 1_500;
/** Do not encode right after a gesture: tool switch / copy / zoom land here. */
const SAVE_POST_GESTURE_GRACE_MS = 8_000;
/** Full-doc encodes block the thread for seconds on huge boards — back off. */
const SAVE_MIN_INTERVAL_BIG_MS = 60_000;
const SAVE_MIN_INTERVAL_MID_MS = 15_000;
const SAVE_BIG_BYTES = 50_000_000;
const SAVE_MID_BYTES = 10_000_000;
/** While a stroke/drag is open, defer (input blackouts are the worst kind). */
const SAVE_GESTURE_RETRY_MS = 2_000;
/**
 * Don't encode right after ANY interaction (tool switch, paste, zoom):
 * the save would land exactly on the next input. Wait for quiet.
 */
const SAVE_QUIET_MS = 10_000;
/** Hidden tabs defer (the live tab's IDB is the store; pagehide flush covers close). */
const SAVE_HIDDEN_RETRY_MS = 30_000;
/** Give up waiting for a worker snapshot after this long (then encode synchronously). */
const MIRROR_WORKER_TIMEOUT_MS = 120_000;

/** Last user interaction (pointer/key/wheel), for keeping encodes off the input path. */
let lastInteractAt = 0;
if (typeof window !== 'undefined' && isDesktop()) {
  const noteInteract = () => {
    lastInteractAt = Date.now();
  };
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
    try {
      window.addEventListener(type, noteInteract, { passive: true, capture: true });
    } catch {
      /* ignore */
    }
  }
}

/** Pending-save flushers of open mirrors (one per open board). */
const flushers = new Set<() => Promise<void>>();

/** Write every pending board file now (window close, app quit). */
export async function flushDesktopMirrors(): Promise<void> {
  await Promise.all([...flushers].map((f) => f().catch(() => {})));
}

if (typeof window !== 'undefined' && isDesktop()) {
  // The app calls this from its close handler, then closes once it resolves.
  (window as unknown as { __reviewFlushBoards?: () => Promise<void> }).__reviewFlushBoards = flushDesktopMirrors;
  (window as unknown as { __reviewBeforeQuit?: () => Promise<void> }).__reviewBeforeQuit = async () => {
    await flushDesktopMirrors();
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('quit_ready');
  };
}

/** Put boards that exist on disk but not in this origin's registry back on Home. */
export async function restoreDesktopBoards(): Promise<number> {
  if (!isDesktop()) return 0;
  const files = await listBoardFiles();
  let added = 0;
  for (const f of files) {
    if (getBoard(f.id)) continue;
    const meta = f.meta as Partial<BoardMeta> | null;
    importBoardMeta({
      id: f.id,
      name: typeof meta?.name === 'string' && meta.name ? meta.name : f.id,
      teamId: typeof meta?.teamId === 'string' ? meta.teamId : 'default',
      createdAt: typeof meta?.createdAt === 'number' ? meta.createdAt : f.savedAt,
      updatedAt: f.savedAt,
      status: meta?.status === 'remote' || meta?.status === 'shared' ? meta.status : 'local',
      savedLocally: meta?.status === 'remote' ? true : undefined,
    });
    added += 1;
  }
  return added;
}

/**
 * Merge the disk copy into `doc` once, then keep the file in step with edits.
 * Full snapshots are encoded in a Web Worker (a second doc copy fed with
 * every applied update), so the main thread never blocks on
 * Y.encodeStateAsUpdate. `seed` replays a known-good snapshot into a fresh
 * worker (used after compaction swaps the live doc). Falls back to a sync
 * encode when workers are unavailable. pagehide flushes always encode
 * synchronously: the app is closing, nothing left to disturb.
 * Returns a stop function that writes any pending change first.
 */
export function attachDesktopMirror(
  doc: Y.Doc,
  boardId: string,
  opts: { load?: boolean; seed?: Uint8Array } = {}
): () => void {
  if (!isDesktop()) return () => {};
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  /** Estimated doc bytes (last encode + increments since) for the interval. */
  let lastSavedBytes = 0;
  let lastSavedAt = 0;
  let pendingBytes = 0;
  /** Last full-encode cost: pace the next save so the duty cycle stays sane. */
  let lastEncodeMs = 0;
  /** Never let pacing delay a save past this (durability still matters). */
  const SAVE_MAX_INTERVAL_MS = 10 * 60_000;

  const intervalFor = (est: number): number =>
    est > SAVE_BIG_BYTES
      ? SAVE_MIN_INTERVAL_BIG_MS
      : est > SAVE_MID_BYTES
        ? SAVE_MIN_INTERVAL_MID_MS
        : SAVE_DEBOUNCE_MS;

  let inFlight: Promise<unknown> = Promise.resolve();

  // --- Worker snapshots (encode off the main thread) ---
  type WorkerOut =
    | { t: 'ready' }
    | { t: 'snapshot'; token: number; buf: ArrayBuffer }
    | { t: 'error'; token: number; message: string };
  let worker: Worker | null = null;
  let workerFailed = false;
  let snapToken = 0;
  const snapWaiters = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  /** True once the worker has seen real content (else a snapshot would be empty). */
  let workerFed = false;

  function killWorker(markFailed: boolean): void {
    const w = worker;
    worker = null;
    if (markFailed) workerFailed = true;
    if (w) {
      try {
        w.terminate();
      } catch {
        /* ignore */
      }
    }
    for (const [, w8] of snapWaiters) {
      try {
        clearTimeout(w8.timer);
      } catch {
        /* ignore */
      }
      try {
        w8.reject(new Error('mirror worker gone'));
      } catch {
        /* ignore */
      }
    }
    snapWaiters.clear();
  }

  function feedWorker(update: Uint8Array): void {
    // No outbox: if there is no live worker the update is simply not tracked;
    // the next save falls back to a sync encode, which covers everything.
    const w = worker;
    if (!w || workerFailed) return;
    try {
      // Structured clone (not transfer): the same buffer is still needed by
      // sync/persist handlers running after this one.
      w.postMessage({ t: 'update', buf: update.slice() });
      workerFed = true;
    } catch {
      killWorker(true);
    }
  }

  function ensureWorker(seed?: Uint8Array): Worker | null {
    if (worker || workerFailed || stopped) return worker;
    let w: Worker;
    try {
      w = new Worker(new URL('./desktopMirrorWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      workerFailed = true;
      return null;
    }
    w.onmessage = (ev: MessageEvent) => {
      const m = ev.data as WorkerOut | null;
      if (!m || typeof m !== 'object') return;
      if (m.t === 'ready' || worker !== w) return;
      if (m.t === 'snapshot') {
        const w8 = snapWaiters.get(m.token);
        if (!w8) return;
        snapWaiters.delete(m.token);
        try {
          clearTimeout(w8.timer);
        } catch {
          /* ignore */
        }
        w8.resolve(new Uint8Array(m.buf));
        return;
      }
      if (m.t === 'error') {
        const w8 = snapWaiters.get(m.token);
        if (!w8) return;
        snapWaiters.delete(m.token);
        try {
          clearTimeout(w8.timer);
        } catch {
          /* ignore */
        }
        w8.reject(new Error(m.message || 'mirror worker failed'));
      }
    };
    w.onerror = () => {
      if (worker === w) killWorker(true);
    };
    worker = w;
    if (seed && seed.length) {
      // Fresh worker, known-good state: seed first, later updates follow in order.
      try {
        const copy = seed.slice();
        w.postMessage({ t: 'seed', buf: copy.buffer }, [copy.buffer]);
        workerFed = true;
      } catch {
        killWorker(true);
        return null;
      }
    }
    return w;
  }

  function requestWorkerSnapshot(): Promise<Uint8Array> {
    const w = ensureWorker();
    // Never snapshot an unfed worker: it would return an empty doc and the
    // backup file would be wiped. The caller falls back to a sync encode.
    if (!w || !workerFed) return Promise.reject(new Error('mirror worker has no content yet'));
    const token = (snapToken = (snapToken + 1) >>> 0);
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        snapWaiters.delete(token);
        reject(new Error('mirror worker timeout'));
      }, MIRROR_WORKER_TIMEOUT_MS);
      snapWaiters.set(token, { resolve, reject, timer });
      try {
        w.postMessage({ t: 'snapshot', token });
      } catch (err) {
        snapWaiters.delete(token);
        try {
          clearTimeout(timer);
        } catch {
          /* ignore */
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Seed the live worker from a fresh full snapshot (post-compact hand-off). */
  function seedWorkerFromMain(full: Uint8Array): void {
    const w = worker;
    if (!w || workerFailed || stopped) return;
    try {
      const copy = full.slice();
      w.postMessage({ t: 'seed', buf: copy.buffer }, [copy.buffer]);
      workerFed = true;
    } catch {
      killWorker(true);
    }
  }
  const save = (force = false, syncEncode = false): Promise<unknown> => {
    timer = null;
    if (!dirty) return inFlight;
    if (!force) {
      if (isWriteGestureActive()) {
        // Mid-stroke/drag: retry shortly, never encode under the pointer.
        if (!timer) timer = setTimeout(() => void save(), SAVE_GESTURE_RETRY_MS);
        return inFlight;
      }
      const now = Date.now();
      // Just finished drawing and already switching tools? The encode would
      // land exactly on the next input — wait out the grace period.
      const sinceGesture = now - lastGestureEndMs();
      if (lastGestureEndMs() > 0 && sinceGesture < SAVE_POST_GESTURE_GRACE_MS) {
        if (!timer) timer = setTimeout(() => void save(), SAVE_POST_GESTURE_GRACE_MS - sinceGesture);
        return inFlight;
      }
      // Any interaction at all (tool switch, paste, zoom, select): the encode
      // is seconds of one pegged core on huge boards — keep it off the input.
      const sinceInteract = now - lastInteractAt;
      if (lastInteractAt > 0 && sinceInteract < SAVE_QUIET_MS) {
        if (!timer) timer = setTimeout(() => void save(), SAVE_QUIET_MS - sinceInteract);
        return inFlight;
      }
      if (typeof document !== 'undefined' && document.hidden) {
        if (!timer) timer = setTimeout(() => void save(), SAVE_HIDDEN_RETRY_MS);
        return inFlight;
      }
      const base = intervalFor(lastSavedBytes + pendingBytes);
      // A 2.5 s encode every 15 s is a 17% frozen app. Pace by measured
      // cost instead: at most ~5% of wall time spent encoding.
      const paced = Math.min(SAVE_MAX_INTERVAL_MS, Math.max(base, lastEncodeMs * 20));
      const wait = paced - (now - lastSavedAt);
      if (wait > 0) {
        if (!timer) timer = setTimeout(() => void save(), wait);
        return inFlight;
      }
    }
    dirty = false;
    pendingBytes = 0;
    const meta = getBoard(boardId) ?? null;
    const metaJson = JSON.stringify(meta);
    if (syncEncode) {
      // pagehide/close and worker outages: durability first, freeze accepted
      // (nothing left to disturb — the app is going away).
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const bytes = Y.encodeStateAsUpdate(doc);
      const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (t1 - t0 > 0) lastEncodeMs = t1 - t0;
      lastSavedAt = Date.now();
      lastSavedBytes = bytes.length;
      seedWorkerFromMain(bytes);
      inFlight = inFlight.then(() => saveBoardFile(boardId, metaJson, bytes));
      return inFlight;
    }
    inFlight = inFlight.then(() => writeSnapshot(metaJson));
    return inFlight;
  };

  /** Snapshot via the worker; falls back to a sync encode + reseed on failure. */
  async function writeSnapshot(metaJson: string): Promise<void> {
    try {
      const bytes = await requestWorkerSnapshot();
      if (!bytes.length) throw new Error('empty snapshot');
      // Encoded off-thread: don't pace future saves on main-thread cost.
      lastEncodeMs = 0;
      lastSavedAt = Date.now();
      lastSavedBytes = bytes.length;
      await saveBoardFile(boardId, metaJson, bytes);
      return;
    } catch {
      // Worker missing/failed/timed out: one sync encode now (durability),
      // and the worker is rebuilt from those bytes for next time.
    }
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const bytes = Y.encodeStateAsUpdate(doc);
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (t1 - t0 > 0) lastEncodeMs = t1 - t0;
    lastSavedAt = Date.now();
    lastSavedBytes = bytes.length;
    seedWorkerFromMain(bytes);
    await saveBoardFile(boardId, metaJson, bytes);
  }
  const flush = async (sync: boolean) => {
    if (timer) clearTimeout(timer);
    await save(true, sync);
  };
  const flushAll = () => flush(true);
  flushers.add(flushAll);
  const onUpdate = (update?: Uint8Array): void => {
    if (stopped) return;
    dirty = true;
    if (update && update.length) {
      pendingBytes += update.length;
      feedWorker(update);
    }
    if (!timer) timer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  };
  const onHide = () => {
    // Closing: sync encode, nothing left to disturb.
    void flush(true);
  };

  if (opts.load !== false) void loadBoardFile(boardId).then((bytes) => {
    if (stopped || !bytes || bytes.length === 0) return;
    try {
      Y.applyUpdate(doc, bytes, 'desktop-file');
    } catch (e) {
      try { console.warn('[review:desktop] board file unreadable', boardId, e); } catch { /* ignore */ }
    }
  });
  doc.on('update', onUpdate);
  window.addEventListener('pagehide', onHide);
  // Start the worker now so it converges from the first update; pass the
  // post-compact snapshot when the live doc already has content.
  if (opts.seed && opts.seed.length) {
    if (ensureWorker()) seedWorkerFromMain(opts.seed);
  } else {
    ensureWorker();
  }
  // First snapshot so a board that only lives in IndexedDB gets its file too.
  onUpdate();

  return () => {
    if (stopped) return;
    stopped = true;
    flushers.delete(flushAll);
    doc.off('update', onUpdate);
    window.removeEventListener('pagehide', onHide);
    // Board switch, not close: async worker write is fine, then terminate.
    const w = worker;
    worker = null;
    void inFlight
      .then(() => save(true, false))
      .catch(() => {})
      .then(() => {
        if (w) {
          try {
            w.terminate();
          } catch {
            /* ignore */
          }
        }
      });
  };
}
