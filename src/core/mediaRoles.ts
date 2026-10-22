/**
 * Shared media playback (audio/video "for everyone") and who may drive it.
 *
 * Transport state rides the shape as opaque JSON in `mediaState`
 * (`{ playing, pos, at, vol, by }`, same trick as `calcState`): no nested Y
 * types, last-writer-wins, written untracked so play/pause never pollute undo.
 * Followers seek to `pos + (now - at) / 1000` while playing; a few seconds of
 * clock skew hide inside the re-seek threshold.
 *
 * Volume tweaks and scrub commits ride as `quiet` states: followers apply
 * them with no notice. Starts/stops always announce.
 *
 * Rights: the board owner (`META_OWNER_ID`, claimed by the creator device) may
 * drive everyone and grant `editor` to user ids (`META_ROLES` JSON, single
 * writer — the owner). Everyone else gets local-only transport. Enforcement is
 * UI-level: P2P has no server, so a determined client could write state
 * anyway — same honesty as kick.
 *
 * Roles are the shared foundation for future permissions (object locking,
 * …): resolve one `roleOf(...)` per user, then ask a pure predicate per
 * feature. Store-backed helpers (boardRoles/iControlMedia/iOwnBoard/
 * grantMediaRole) live in store.ts.
 *
 * NOTE: dependency-free on purpose (no store/user imports) so node unit tests
 * can import this module directly.
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
  /** Volume/scrub tweaks apply with no notice when true. Absent = announce. */
  quiet?: boolean;
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
    // Written only when true so old states round-trip byte-identically.
    ...(s.quiet === true ? { quiet: true } : null),
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
    return {
      playing: v.playing,
      pos: clampPos(v.pos),
      at: v.at,
      vol: clampVol(v.vol),
      by: v.by,
      // Survives only when explicitly written; absent stays absent.
      ...(typeof v.quiet === 'boolean' ? { quiet: v.quiet } : null),
    };
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
 * Am I currently in step with the shared session? Drives the follow button:
 * lit = following and converged, unlit = opted out or diverged (local pause
 * / scrub / resume-from-behind while the session runs). Pure so the overlay
 * can derive it every frame and node tests can pin it.
 *
 * - Not following, no state, or no element yet: nothing to diverge from.
 * - Countdown pending for me: converges at fire, counts as in sync.
 * - Playing: element must play within slop of the shared target (an ended
 *   element at a fully-played target counts as synced).
 * - Paused: element must rest at the shared pos.
 */
export function isMediaInSync(
  el: { paused: boolean; ended: boolean; currentTime: number; duration: number } | null,
  st: MediaState | null,
  followOn: boolean,
  pending: boolean,
): boolean {
  if (!followOn || !st) return true;
  if (pending) return true;
  if (st.playing) {
    if (!el) return true;
    const target = seekTargetAt(st, Date.now());
    if (target === null || !Number.isFinite(el.currentTime)) return true;
    if (el.ended && Number.isFinite(el.duration) && target >= el.duration - 0.5) return true;
    if (el.paused) return false;
    return Math.abs(el.currentTime - target) <= MEDIA_SYNC_SLOP_S;
  }
  if (!el) return true;
  if (!el.paused) return false;
  if (!Number.isFinite(el.currentTime) || !Number.isFinite(st.pos)) return true;
  return Math.abs(el.currentTime - st.pos) <= 0.6;
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

/**
 * Board roles as one resolved value — the foundation for every future
 * permission (media driving today, object locking tomorrow). Owner is the
 * board creator (META_OWNER_ID); editors are granted by the owner
 * (META_ROLES); everyone else is a viewer. No id = viewer.
 */
export type BoardRole = 'owner' | 'editor' | 'viewer';

export function roleOf(
  ownerId: string | null | undefined,
  roles: Record<string, MediaRole>,
  userId: string,
): BoardRole {
  if (!userId) return 'viewer';
  if (ownerId && ownerId === userId) return 'owner';
  return roles[userId] === 'editor' ? 'editor' : 'viewer';
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
