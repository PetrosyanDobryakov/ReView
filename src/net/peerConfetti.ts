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
};

/** Ignore remote bursts older than this (late join / leftover awareness). */
export const CONFETTI_STALE_MS = 4000;

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
  return { x, y, seed: seed >>> 0, id: id >>> 0, t };
}

/** Cheap equality for awareness / paint dirty checks. */
export function samePeerConfetti(
  a: PeerConfettiBurst | null | undefined,
  b: PeerConfettiBurst | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.id === b.id && a.seed === b.seed && a.x === b.x && a.y === b.y && a.t === b.t;
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
