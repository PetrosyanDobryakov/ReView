/** Ephemeral confetti cannon burst published via awareness (not the Yjs doc). */

export type PeerConfettiBurst = {
  /** Board-space origin X. */
  x: number;
  /** Board-space origin Y. */
  y: number;
  /** PRNG seed so remotes replay the same particle layout. */
  seed: number;
  /** Monotonic id — remotes fire once per distinct id. */
  id: number;
  /** Wall-clock ms when published; remotes ignore stale bursts. */
  t: number;
  /**
   * Spam intensity 1..CONFETTI_MAX_POWER.
   * 1 = normal single cannon; higher = more particles / wider cone / multi-cannon.
   * Missing on wire → treat as 1 (compat with older peers).
   */
  power: number;
};

/** Ignore remote bursts older than this (late join / leftover awareness). */
export const CONFETTI_STALE_MS = 4000;

/** Gap longer than this resets local spam streak to power 1. */
export const CONFETTI_STREAK_WINDOW_MS = 1600;

/** Max escalation tier (fun over subtle). */
export const CONFETTI_MAX_POWER = 8;

/** Hard cap on live particles — recycle oldest so FPS survives a frenzy. */
export const CONFETTI_MAX_LIVE = 1400;
/**
 * Spam power (5th rapid triple-press in one streak) that unlocks the finale:
 * a continuous confetti eruption, or the Starship on the Orbit theme.
 */
export const CONFETTI_FRENZY_POWER = 5;
/** How long one frenzy spam keeps the eruption going (each spam extends it). */
export const CONFETTI_ERUPT_MS = 3200;

/** Clamp / default power from awareness or local streak. */
export function clampConfettiPower(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(CONFETTI_MAX_POWER, Math.round(raw)));
}

/**
 * Next local power after another triple-press.
 * Fresh / cooled-off → 1; rapid spam → climb toward CONFETTI_MAX_POWER.
 */
export function nextConfettiPower(prevPower: number, gapMs: number): number {
  if (!(gapMs >= 0) || gapMs > CONFETTI_STREAK_WINDOW_MS) return 1;
  return Math.min(CONFETTI_MAX_POWER, clampConfettiPower(prevPower) + 1);
}

export type ConfettiBurstParams = {
  /** Total paper bits for this invoke (split across cannons). */
  count: number;
  /** Radians half-angle around each cannon aim. */
  cone: number;
  /** Overlapping cannons (1 = single up-shot). */
  cannons: number;
  /** Extra aim jitter (radians) for chaos at high power. */
  scatter: number;
};

/** Particle/cone/cannon layout for a given power. Power 1 matches the classic feel. */
export function confettiBurstParams(power: number, reduceMotion: boolean): ConfettiBurstParams {
  const p = clampConfettiPower(power);
  const t = (p - 1) / (CONFETTI_MAX_POWER - 1);
  if (reduceMotion) {
    return {
      count: Math.round(18 + t * 36),
      cone: 0.55 + t * 0.35,
      cannons: 1,
      scatter: 0.35 + t * 0.2,
    };
  }
  // Power 1: 64 / 0.95 / 1 — identical to pre-frenzy single burst.
  return {
    count: Math.round(64 + t * 156), // 64 → 220
    cone: 0.95 + t * 0.75, // 0.95 → 1.70 (near hemisphere)
    cannons: p >= 7 ? 3 : p >= 4 ? 2 : 1,
    scatter: 0.35 + t * 0.55,
  };
}

/** Parse awareness `confetti` — null/invalid clears. */
export function parsePeerConfetti(raw: unknown): PeerConfettiBurst | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const x = o.x;
  const y = o.y;
  const seed = o.seed;
  const id = o.id;
  const t = o.t;
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return null;
  if (typeof id !== 'number' || !Number.isFinite(id)) return null;
  if (typeof t !== 'number' || !Number.isFinite(t)) return null;
  return {
    x,
    y,
    seed: seed >>> 0,
    id: id >>> 0,
    t,
    power: clampConfettiPower(o.power),
  };
}

/** Cheap equality for awareness / paint dirty checks. */
export function samePeerConfetti(
  a: PeerConfettiBurst | null | undefined,
  b: PeerConfettiBurst | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.id === b.id &&
    a.seed === b.seed &&
    a.x === b.x &&
    a.y === b.y &&
    a.t === b.t &&
    a.power === b.power
  );
}

/** Mulberry32 — deterministic 0..1 sequence from a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
