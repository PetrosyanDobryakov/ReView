import { readPrefs } from '../core/prefs';

const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
const host = typeof location !== 'undefined' ? location.hostname : 'localhost';
const syncPort =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SYNC_PORT) || '1234';

const BUILTIN_SYNC_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SYNC_URL) ||
  `${proto}://${host}:${syncPort}`;

/** Default websocket URL for this origin (or `VITE_SYNC_URL`). */
export function defaultSyncUrl(): string {
  return BUILTIN_SYNC_URL;
}

/** Pref override when set, otherwise built-in. */
export function effectiveSyncUrl(): string {
  return readPrefs().syncUrl || BUILTIN_SYNC_URL;
}

export function isSyncEnabled(): boolean {
  return readPrefs().syncEnabled !== false;
}

/** Yjs room name for a board. Legacy fallback when no board is active. */
export function boardRoomName(boardId: string | null | undefined): string {
  return boardId ? `review-${boardId}` : 'review';
}
