import { readPrefs } from '../core/prefs';

/** P2P sync on/off (Settings). Off = this tab works alone; the board still saves locally. */
export function isSyncEnabled(): boolean {
  return readPrefs().syncEnabled !== false;
}

/** Signaling room name for a board. Legacy fallback when no board is active. */
export function boardRoomName(boardId: string | null | undefined): string {
  return boardId ? `review-${boardId}` : 'review';
}
