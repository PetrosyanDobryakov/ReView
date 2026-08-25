import type { UserInfo } from '../core/user';

export type SyncStatus = {
  online: boolean;
  /** Awareness client count when online (includes self). */
  users: number;
  /** Prefs: syncAllowed. Offline can still be “enabled”. */
  enabled: boolean;
};

export type PeerCursor = {
  /** Ephemeral Yjs awareness client id. */
  id: number;
  /** Stable published user id when present. */
  userId: string;
  name: string;
  color: string;
  publishedName: string;
  publishedColor: string;
  overridden: boolean;
  x: number | null;
  y: number | null;
  /** Active board tool when published. */
  tool: string | null;
  /** Active sub-page id when published (`main`, `p…`). */
  page: string | null;
};

export type CursorPos = { x: number; y: number };

export type AwarenessUser = UserInfo;
