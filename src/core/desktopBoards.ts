/**
 * Desktop app only: every saved board is mirrored to a plain file in the
 * app's data folder (`boards/<id>.review` = Yjs snapshot, `<id>.json` = name
 * and team). The files are the durable copy: if the webview's IndexedDB is
 * lost (new profile, changed port/origin), boards come back from disk.
 */

import * as Y from 'yjs';
import { getBoard, importBoardMeta, type BoardMeta } from './boards';
import { isWriteGestureActive } from './writeGate';
import { isDesktop, listBoardFiles, loadBoardFile, saveBoardFile } from '../net/p2p/desktop';

const SAVE_DEBOUNCE_MS = 1_500;
/** Full-doc encodes block the thread for seconds on huge boards — back off. */
const SAVE_MIN_INTERVAL_BIG_MS = 60_000;
const SAVE_MIN_INTERVAL_MID_MS = 15_000;
const SAVE_BIG_BYTES = 50_000_000;
const SAVE_MID_BYTES = 10_000_000;
/** While a stroke/drag is open, defer (input blackouts are the worst kind). */
const SAVE_GESTURE_RETRY_MS = 2_000;

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
      const wait = intervalFor(lastSavedBytes + pendingBytes) - (now - lastSavedAt);
      if (wait > 0) {
        if (!timer) timer = setTimeout(() => void save(), wait);
        return inFlight;
      }
    }
    dirty = false;
    pendingBytes = 0;
    const meta = getBoard(boardId) ?? null;
    // The block: full encode on the main thread (seconds on 100 MB+ docs).
    const bytes = Y.encodeStateAsUpdate(doc);
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
  const onUpdate = (update?: Uint8Array): void => {
    if (stopped) return;
    dirty = true;
    if (update && update.length) pendingBytes += update.length;
    if (!timer) timer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  };
  const onHide = () => {
    void flush();
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
  // First snapshot so a board that only lives in IndexedDB gets its file too.
  onUpdate();

  return () => {
    if (stopped) return;
    stopped = true;
    flushers.delete(flush);
    doc.off('update', onUpdate);
    window.removeEventListener('pagehide', onHide);
    void flush();
  };
}
