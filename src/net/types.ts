import type { UserInfo } from '../core/user';

export type SyncStatus = {
  online: boolean;
  /** Awareness client count when online (includes self). */
  users: number;
  /** Prefs: syncAllowed. Offline can still be “enabled”. */
  enabled: boolean;
};

/** Ephemeral in-progress stroke shown to peers before CRDT commit. */
export type PeerDraft = {
  kind: 'pen';
  points: number[];
  stroke: string;
  strokeWidth: number;
  alpha?: number;
};

/** Live eraser hover preview (awareness only). */
export type PeerErasePreview = {
  x: number;
  y: number;
  r: number;
  mode: 'whole' | 'partial';
  /** Shape ids marked for whole-object erase. */
  whole: string[];
  /** Pen vertex indices marked for partial erase. */
  partial?: Record<string, number[]>;
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
  /** False when the user left the board view but is still on the site. */
  viewing: boolean;
  x: number | null;
  y: number | null;
  /** Active board tool when published. */
  tool: string | null;
  /** Active sub-page id when published (`main`, `p…`). */
  page: string | null;
  /** Live stroke preview (awareness only). */
  draft: PeerDraft | null;
  /** Shapes highlighted while erasing (awareness only). */
  erasePreview: PeerErasePreview | null;
};

export type CursorPos = { x: number; y: number };

export type AwarenessUser = UserInfo;
