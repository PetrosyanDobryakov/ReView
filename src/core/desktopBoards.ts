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
 */
export function attachDesktopMirror(doc: Y.Doc, boardId: string, opts: { load?: boolean } = {}): () => void {
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
  const save = (force = false): Promise<unknown> => {
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
    // The block: full encode on the main thread (seconds on 100 MB+ docs).
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const bytes = Y.encodeStateAsUpdate(doc);
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (t1 - t0 > 0) lastEncodeMs = t1 - t0;
    lastSavedAt = Date.now();
    lastSavedBytes = bytes.length;
    inFlight = inFlight.then(() => saveBoardFile(boardId, JSON.stringify(meta), bytes));
    return inFlight;
  };
  const flush = async () => {
    if (timer) clearTimeout(timer);
    await save(true);
  };
  flushers.add(flush);
  const onUpdate = (update?: Uint8Array, origin?: unknown): void => {
    if (stopped) return;
    // The disk-file merge below re-applies our own bytes: persisting them
    // back is a wasted full encode + write on every open.
    if (origin === 'desktop-file') return;
    dirty = true;
    if (update && update.length) pendingBytes += update.length;
    if (!timer) timer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  };
  const onHide = () => {
    void flush();
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

  return () => {
    if (stopped) return;
    stopped = true;
    flushers.delete(flush);
    doc.off('update', onUpdate);
    window.removeEventListener('pagehide', onHide);
    void flush();
  };
}
