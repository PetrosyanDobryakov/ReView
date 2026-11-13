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

/** Last user interaction (pointer/key/wheel), for keeping encodes off the input path. */
let lastInteractAt = 0;
if (typeof window !== 'undefined' && isDesktop()) {
  const noteInteract = () => {
    lastInteractAt = Date.now();
  };
  // pointermove included: a long pan/draw is one continuous interaction, and
  // the encode must not land mid-gesture just because the button stayed down.
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const) {
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
 * Returns a stop function that writes any pending change first.
 *
 * Full snapshots encode in a Web Worker (see desktopMirrorWorker.ts), so even
 * hundred-megabyte boards never block the main thread on save. The worker doc
 * is an exact mirror of the live doc — Yjs updates are commutative, and every
 * post-attach update is forwarded — which holds from an empty doc or from an
 * explicit `seed`. A board attached with pre-existing content and no seed
 * takes one sync encode first; that encode doubles as the seed.
 */
export function attachDesktopMirror(
  doc: Y.Doc,
  boardId: string,
  opts: { load?: boolean; seed?: Uint8Array; hasContent?: boolean; saveNow?: boolean } = {}
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
  /** Docs under this encode in milliseconds — skip the worker round-trip. */
  const SMALL_DOC_SYNC_BYTES = 2 * 1024 * 1024;
  /**
   * Docs over this never touch the worker: a second full copy of a huge
   * doc (Yjs heap overhead is several times the wire size) OOMs the
   * renderer — dark window, then close. They keep the old paced sync
   * path: brief freezes on save, but the board survives.
   */
  const WORKER_MAX_BYTES = 48 * 1024 * 1024;

  // ---- worker snapshot encoder (off main thread) -------------------------
  type WorkerOut =
    | { t: 'ready' }
    | { t: 'snapshot'; token: number; buf: ArrayBuffer }
    | { t: 'error'; token: number; message: string };
  let worker: Worker | null = null;
  let workerFailed = false;
  let snapToken = 0;
  const snapWaiters = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>();
  /**
   * The worker doc mirrors the live doc exactly (empty at attach, or seeded
   * below), so its snapshots are safe to write. No timeout: a slow worker
   * just finishes late off-thread; waiters reject only when it dies.
   */
  let workerSeeded = false;

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
        w8.reject(new Error('mirror worker gone'));
      } catch {
        /* ignore */
      }
    }
    snapWaiters.clear();
  }

  /** Forward every applied update (small); the worker doc converges exactly. */
  function feedWorker(update: Uint8Array): void {
    const w = worker;
    if (!w || workerFailed || stopped) return;
    // A doc that outgrew the worker never comes back: drop the worker (and
    // its partial prefix) instead of clone-flooding it — a 141 MB replay at
    // open would triple memory before the first save. Unseeding forces the
    // next eligible save to re-seed from a sync encode.
    if (lastSavedBytes + pendingBytes > WORKER_MAX_BYTES) {
      killWorker(false);
      workerSeeded = false;
      return;
    }
    try {
      // Structured clone (not transfer): the same buffer is still needed by
      // sync/persist handlers running after this one.
      w.postMessage({ t: 'update', buf: update.slice() });
    } catch {
      killWorker(true);
    }
  }

  function ensureWorker(): Worker | null {
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
        w8.resolve(new Uint8Array(m.buf));
        return;
      }
      if (m.t === 'error') {
        const w8 = snapWaiters.get(m.token);
        if (!w8) return;
        snapWaiters.delete(m.token);
        w8.reject(new Error(m.message || 'mirror worker failed'));
      }
    };
    w.onerror = () => {
      if (worker === w) killWorker(true);
    };
    worker = w;
    return w;
  }

  /** Seed from authoritative full bytes (post-compact hand-off, first save). */
  function seedWorker(full: Uint8Array): void {
    // Oversized docs never use the worker: don't even build it.
    if (full.length > WORKER_MAX_BYTES) return;
    const w = ensureWorker();
    if (!w) return;
    try {
      const copy = full.slice();
      w.postMessage({ t: 'seed', buf: copy.buffer }, [copy.buffer]);
      workerSeeded = true;
    } catch {
      killWorker(true);
    }
  }

  /** Snapshot via the worker; rejects when it has no content yet or died. */
  function requestWorkerSnapshot(): Promise<Uint8Array> {
    const w = ensureWorker();
    // Never snapshot an unseeded worker: it would return a valid-looking but
    // partial doc and the backup file would regress. The caller falls back
    // to a sync encode, which doubles as the seed.
    if (!w || !workerSeeded) return Promise.reject(new Error('mirror worker not seeded'));
    const token = (snapToken = (snapToken + 1) >>> 0);
    return new Promise<Uint8Array>((resolve, reject) => {
      snapWaiters.set(token, { resolve, reject });
      try {
        w.postMessage({ t: 'snapshot', token });
      } catch (err) {
        snapWaiters.delete(token);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  const intervalFor = (est: number): number =>
    est > SAVE_BIG_BYTES
      ? SAVE_MIN_INTERVAL_BIG_MS
      : est > SAVE_MID_BYTES
        ? SAVE_MIN_INTERVAL_MID_MS
        : SAVE_DEBOUNCE_MS;

  let inFlight: Promise<unknown> = Promise.resolve();
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
    const estBytes = lastSavedBytes + pendingBytes;
    dirty = false;
    pendingBytes = 0;
    const meta = getBoard(boardId) ?? null;
    const metaJson = JSON.stringify(meta);
    // Small docs encode in milliseconds — skip the worker round-trip. Huge
    // docs skip it too (a second copy OOMs — paced sync freezes instead).
    // Either encode is authoritative, so it doubles as the worker seed.
    if (syncEncode || estBytes < SMALL_DOC_SYNC_BYTES || estBytes > WORKER_MAX_BYTES) {
      // pagehide/close and tiny docs: durability first, freeze accepted
      // (nothing left to disturb — or nothing worth disturbing).
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const bytes = Y.encodeStateAsUpdate(doc);
      const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (t1 - t0 > 0) lastEncodeMs = t1 - t0;
      lastSavedAt = Date.now();
      lastSavedBytes = bytes.length;
      if (!syncEncode) seedWorker(bytes);
      inFlight = inFlight.then(() => saveBoardFile(boardId, metaJson, bytes));
      return inFlight;
    }
    if (!workerSeeded) {
      // Board attached with pre-existing content and no seed: one sync encode
      // now, which doubles as the seed — every later save goes off-thread.
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const bytes = Y.encodeStateAsUpdate(doc);
      const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (t1 - t0 > 0) lastEncodeMs = t1 - t0;
      lastSavedAt = Date.now();
      lastSavedBytes = bytes.length;
      seedWorker(bytes);
      inFlight = inFlight.then(() => saveBoardFile(boardId, metaJson, bytes));
      return inFlight;
    }
    inFlight = inFlight.then(() => writeSnapshot(metaJson));
    return inFlight;
  };
  const flush = async (sync = false) => {
    if (timer) clearTimeout(timer);
    await save(true, sync);
  };
  const flushAll = () => flush(false);
  flushers.add(flushAll);
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
      // Worker missing/unseeded/failed: one sync encode now (durability),
      // and the worker is rebuilt from those bytes for next time.
    }
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const bytes = Y.encodeStateAsUpdate(doc);
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (t1 - t0 > 0) lastEncodeMs = t1 - t0;
    lastSavedAt = Date.now();
    lastSavedBytes = bytes.length;
    seedWorker(bytes);
    await saveBoardFile(boardId, metaJson, bytes);
  }
  const onUpdate = (update?: Uint8Array, origin?: unknown): void => {
    if (stopped) return;
    // The disk-file merge below re-applies our own bytes: persisting them
    // back is a wasted full encode + write on every open.
    if (origin === 'desktop-file') return;
    dirty = true;
    if (update && update.length) {
      pendingBytes += update.length;
      feedWorker(update);
    }
    if (!timer) timer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  };
  const onHide = () => {
    // Closing: sync encode, nothing left to disturb. The shell waits for the
    // flush before it quits.
    void flush(true);
  };

  if (opts.load !== false) void loadBoardFile(boardId).then((bytes) => {
    if (stopped || !bytes || bytes.length === 0) {
      if (!stopped && (!bytes || bytes.length === 0)) {
        // No file yet: this board only lives in IndexedDB, so seed one save.
        // (Boards WITH a file must not pay a guaranteed full encode on open.)
        onUpdate();
      }
      return;
    }
    try {
      Y.applyUpdate(doc, bytes, 'desktop-file');
    } catch (e) {
      try { console.warn('[review:desktop] board file unreadable', boardId, e); } catch { /* ignore */ }
    }
  });
  doc.on('update', onUpdate);
  window.addEventListener('pagehide', onHide);
  // Worker mirror of the live doc. Exact from an empty doc (every update is
  // forwarded) or from the given seed (post-compact hand-off, same channel
  // so no snapshot can overtake it). Pre-existing content without a seed
  // takes one sync encode at first save, which doubles as the seed.
  if (opts.seed && opts.seed.length) {
    seedWorker(opts.seed);
  } else {
    workerSeeded = !opts.hasContent;
    ensureWorker();
  }
  // Compact hands a seeded worker and wants the shrunken file promptly —
  // the snapshot runs off-thread, so this costs the main thread nothing.
  if (opts.saveNow) onUpdate();

  return () => {
    if (stopped) return;
    stopped = true;
    flushers.delete(flushAll);
    doc.off('update', onUpdate);
    window.removeEventListener('pagehide', onHide);
    // Board switch, not close: let the worker (if seeded) finish the last
    // save off-thread, then terminate it. A leaked worker would pin a full
    // second copy of the doc per visited board.
    void flush(false)
      .catch(() => {})
      .then(() => killWorker(false));
  };
}
