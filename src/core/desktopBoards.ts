/**
 * Desktop app only: every saved board is mirrored to a plain file in the
 * app's data folder (`boards/<id>.review` = Yjs snapshot, `<id>.json` = name
 * and team). The files are the durable copy: if the webview's IndexedDB is
 * lost (new profile, changed port/origin), boards come back from disk.
 */

import * as Y from 'yjs';
import { getBoard, importBoardMeta, type BoardMeta } from './boards';
import { isDesktop, listBoardFiles, loadBoardFile, saveBoardFile } from '../net/p2p/desktop';

const SAVE_DEBOUNCE_MS = 1_500;

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

  let inFlight: Promise<unknown> = Promise.resolve();
  const save = (): Promise<unknown> => {
    timer = null;
    if (!dirty) return inFlight;
    dirty = false;
    const meta = getBoard(boardId) ?? null;
    const bytes = Y.encodeStateAsUpdate(doc);
    inFlight = inFlight.then(() => saveBoardFile(boardId, JSON.stringify(meta), bytes));
    return inFlight;
  };
  const flush = async () => {
    if (timer) clearTimeout(timer);
    await save();
  };
  flushers.add(flush);
  const onUpdate = () => {
    if (stopped) return;
    dirty = true;
    if (!timer) timer = setTimeout(save, SAVE_DEBOUNCE_MS);
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
