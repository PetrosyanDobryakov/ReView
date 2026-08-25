/**
 * Synced board title (Yjs meta) + rename permissions.
 *
 * - Owner rename → meta.title (live for all session clients).
 * - Saved local copy → local name only (BoardMeta.name).
 * - Remote session guest → read-only synced title.
 */

import { getBoard, renameBoard, type BoardMeta } from './boards';
import { loadUser } from './user';
import { metaOwnerId, metaTitle, seedBoardMeta, setSyncedBoardTitle } from './store';

export type BoardRenameMode = 'sync' | 'local' | false;

const TITLE_MAX = 40;

export function normalizeBoardTitle(raw: string, fallback = 'ReView'): string {
  const v = raw.trim().slice(0, TITLE_MAX);
  return v || fallback;
}

/** Saved local copy uses device name; everyone else follows synced meta.title. */
export function usesLocalBoardName(meta: BoardMeta | undefined): boolean {
  return meta?.savedLocally === true;
}

export function isBoardOwner(ownerId: string | null | undefined, userId = loadUser().id): boolean {
  return Boolean(ownerId && ownerId === userId);
}

/** How this client may rename the board (header / home). */
export function boardRenameMode(
  meta: BoardMeta | undefined,
  ownerId: string | null | undefined,
  userId = loadUser().id
): BoardRenameMode {
  if (!meta) return false;
  if (usesLocalBoardName(meta)) return 'local';
  if (isBoardOwner(ownerId, userId)) return 'sync';
  // Creator device before ownerId lands in meta (legacy / first paint).
  if (meta.status === 'local' && !ownerId) return 'sync';
  return false;
}

/** Title shown in the board header. */
export function displayBoardTitle(
  meta: BoardMeta | undefined,
  syncedTitle: string | null | undefined,
  fallback = 'ReView'
): string {
  if (!meta) return fallback;
  if (usesLocalBoardName(meta)) return normalizeBoardTitle(meta.name, fallback);
  if (syncedTitle) return normalizeBoardTitle(syncedTitle, fallback);
  return normalizeBoardTitle(meta.name, fallback);
}

/** Home list rename — local copies + boards created on this device only. */
export function canRenameBoardOnHome(meta: BoardMeta | undefined): boolean {
  if (!meta) return false;
  return meta.status !== 'remote' || usesLocalBoardName(meta);
}

/** Apply synced title from Yjs to local metadata (session clients). */
export function mirrorSyncedTitle(boardId: string, syncedTitle: string): void {
  const meta = getBoard(boardId);
  if (!meta || usesLocalBoardName(meta)) return;
  const next = normalizeBoardTitle(syncedTitle);
  if (meta.name === next) return;
  renameBoard(boardId, next);
}

/** Seed ownership + reconcile title when a board session opens. Returns display title. */
export function reconcileBoardTitleOnOpen(boardId: string, fallback = 'ReView'): string {
  const local = getBoard(boardId);
  if (!local) return fallback;

  seedBoardMeta(local);

  const ownerId = metaOwnerId();
  const synced = metaTitle();
  const mode = boardRenameMode(local, ownerId);

  if (mode === 'local') {
    return displayBoardTitle(local, synced, fallback);
  }

  if (synced) {
    mirrorSyncedTitle(boardId, synced);
    return normalizeBoardTitle(synced, fallback);
  }

  if (mode === 'sync') {
    const pushed = normalizeBoardTitle(local.name, fallback);
    setSyncedBoardTitle(pushed);
    return pushed;
  }

  return displayBoardTitle(local, synced, fallback);
}

/** Commit a rename from the board header. */
export function commitBoardRename(
  boardId: string,
  raw: string,
  ownerId: string | null | undefined,
  fallback = 'ReView'
): string {
  const local = getBoard(boardId);
  const mode = boardRenameMode(local, ownerId);
  const title = normalizeBoardTitle(raw, fallback);
  if (!mode) return displayBoardTitle(local, metaTitle(), fallback);

  if (mode === 'sync') {
    setSyncedBoardTitle(title);
    renameBoard(boardId, title);
    return title;
  }

  renameBoard(boardId, title);
  return title;
}
