/**
 * Shared media playback (audio/video "for everyone") and who may drive it.
 *
 * Transport state rides the shape as opaque JSON in `mediaState`
 * (`{ playing, pos, at, vol, by }`, same trick as `calcState`): no nested Y
 * types, last-writer-wins, written untracked so play/pause never pollute undo.
 * Followers seek to `pos + (now - at) / 1000` while playing; a few seconds of
 * clock skew hide inside the re-seek threshold.
 *
 * Rights: the board owner (`META_OWNER_ID`, claimed by the creator device) may
 * drive everyone and grant `editor` to user ids (`META_ROLES` JSON, single
 * writer — the owner). Everyone else gets local-only transport. Enforcement is
 * UI-level: P2P has no server, so a determined client could write state
 * anyway — same honesty as kick.
 *
 * NOTE: dependency-free on purpose (no store/user imports) so node unit tests
 * can import this module directly. Store-backed helpers
 * (boardRoles/iControlMedia/iOwnBoard/grantMediaRole) live in store.ts.
 */

export type MediaRole = 'editor';

export interface MediaState {
  playing: boolean;
  /** Seconds at `at`. */
  pos: number;
  /** Epoch ms when the writer set it. */
  at: number;
  /** Shared volume 0..1. */
  vol: number;
  /** Writer user id (echo guard). */
  by: string;
}

/** Re-seek only when further than this from the shared position (seconds). */
export const MEDIA_SYNC_SLOP_S = 1.5;
/** Countdown before a shared start: followers warn, then everyone starts at `at`. */
export const MEDIA_WARN_MS = 3000;
/** Below this the start is effectively now: apply immediately, no countdown. */
export const MEDIA_WARN_GRACE_MS = 400;

export function encodeMediaState(s: MediaState): string {
  return JSON.stringify({
    playing: s.playing === true,
    pos: clampPos(s.pos),
    at: Math.floor(s.at) || 0,
    vol: clampVol(s.vol),
    by: String(s.by ?? '').slice(0, 64),
  });
}

export function decodeMediaState(raw: unknown): MediaState | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<MediaState>;
    if (typeof v.playing !== 'boolean') return null;
    if (typeof v.pos !== 'number' || !Number.isFinite(v.pos)) return null;
    if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
    if (typeof v.vol !== 'number' || !Number.isFinite(v.vol)) return null;
    if (typeof v.by !== 'string' || !v.by) return null;
    return { playing: v.playing, pos: clampPos(v.pos), at: v.at, vol: clampVol(v.vol), by: v.by };
  } catch {
    return null;
  }
}

function clampPos(pos: number): number {
  if (!Number.isFinite(pos) || pos < 0) return 0;
  return Math.min(pos, 86400);
}

function clampVol(vol: number): number {
  if (!Number.isFinite(vol)) return 1;
  return Math.max(0, Math.min(1, vol));
}

/** Where a follower should be now (seconds), or null when state is unusable. */
export function seekTargetAt(state: MediaState, now: number): number | null {
  if (!state.playing) return clampPos(state.pos);
  const elapsed = (now - state.at) / 1000;
  if (!Number.isFinite(elapsed)) return null;
  return clampPos(state.pos + Math.max(0, elapsed));
}

/**
 * Apply only when newer than what we already follow (echo + reorder guard).
 * Returns the state to follow, or null to ignore.
 */
export function nextMediaState(prevAt: number | null, raw: unknown, selfId: string): MediaState | null {
  const st = decodeMediaState(raw);
  if (!st) return null;
  if (st.by === selfId) return null;
  if (prevAt !== null && st.at <= prevAt) return null;
  return st;
}

export function parseRoles(raw: unknown): Record<string, MediaRole> {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object') return {};
    const out: Record<string, MediaRole> = {};
    for (const [k, role] of Object.entries(v)) {
      if (k && role === 'editor') out[k] = 'editor';
    }
    return out;
  } catch {
    return {};
  }
}

/** True when this device's user may drive shared playback (owner or editor). */
export function canControlMedia(
  ownerId: string | null | undefined,
  roles: Record<string, MediaRole>,
  userId: string,
): boolean {
  if (!userId) return false;
  if (ownerId && ownerId === userId) return true;
  return roles[userId] === 'editor';
}

const FOLLOW_KEY = 'review-follow-media';
const LOCAL_VOL_KEY = 'review-media-volume';

export function followMediaEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem(FOLLOW_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setFollowMediaEnabled(on: boolean): void {
  try {
    localStorage.setItem(FOLLOW_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** This device's own volume multiplier 0..1 (times the shared volume). */
export function localMediaVolume(): number {
  try {
    if (typeof localStorage === 'undefined') return 1;
    const v = Number(localStorage.getItem(LOCAL_VOL_KEY));
    if (!Number.isFinite(v)) return 1;
    return Math.max(0, Math.min(1, v));
  } catch {
    return 1;
  }
}

export function setLocalMediaVolume(v: number): void {
  try {
    localStorage.setItem(LOCAL_VOL_KEY, String(Math.max(0, Math.min(1, v))));
  } catch {
    /* ignore */
  }
}
