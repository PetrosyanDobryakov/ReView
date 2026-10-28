import type { UserInfo } from '../core/user';
import type { PeerConfettiBurst } from './peerConfetti';

export type { PeerConfettiBurst };

export type SyncStatus = {
  online: boolean;
  /** Awareness client count when online (includes self). */
  users: number;
  /** Prefs: syncAllowed. Offline can still be “enabled”. */
  enabled: boolean;
  /** Last p2p/transport setup error (e.g. chunk load or missing export). */
  error?: string | null;
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
  /** Shape id currently focused for on-object edit (e.g. calculator keypad). */
  focus: string | null;
  /** Shape ids currently selected with the Select tool (awareness only). */
  selection: string[] | null;
  /** Latest confetti cannon burst (awareness only; one-shot by id; power = spam intensity). */
  confetti: PeerConfettiBurst | null;
  /** Latest bring-to-me summon (awareness only; applied once by `at`). */
  summon: PeerSummon | null;
};

export type CursorPos = { x: number; y: number };

/**
 * Bring-to-me summon (host → everyone or one peer). Broadcast; recipients
 * filter by `to` ('*' or their user id) and apply once by `at`. Same-page
 * only — cross-page summons are ignored, never auto-switch.
 */
export type PeerSummon = {
  to: string;
  x: number;
  y: number;
  zoom: number;
  at: number;
  by: string;
};

export function parseSummon(raw: unknown): PeerSummon | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.to !== 'string' || !s.to) return null;
  const { x, y, zoom, at } = s;
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  if (typeof zoom !== 'number' || !Number.isFinite(zoom)) return null;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  return { to: s.to, x, y, zoom: Math.min(4, Math.max(0.1, zoom)), at, by: typeof s.by === 'string' ? s.by : '' };
}

export type AwarenessUser = UserInfo;
