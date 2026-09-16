/**
 * Peer cursor motion: critically-damped follow + bounded dead-reckoning.
 * Pure math (no DOM/canvas) so the motion contract is unit-testable.
 *
 * Why the caps exist: dead-reckoning aims past the last sample by
 * velocity × lead. On an abrupt stop (pen-up after a fast flick) the aim
 * whips ahead and glides back — a visible hook. Capping the lead offset
 * bounds that hook; killing velocity on direction reversal stops zigzag
 * slingshots on short choppy strokes.
 *
 * Callers must step once per frame. Stepping from both the on-canvas glyph
 * and the off-screen pill doubles the spring rate and looks like stutter.
 */

/** Game-style SmoothDamp — frame-rate independent, no overshoot. */
export function smoothDamp(
  current: number,
  target: number,
  currentVelocity: number,
  smoothTime: number,
  dt: number,
  maxSpeed = Infinity
): { value: number; velocity: number } {
  const st = Math.max(0.0001, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let change = current - target;
  const maxChange = maxSpeed * st;
  change = Math.max(-maxChange, Math.min(maxChange, change));
  const temp = (currentVelocity + omega * change) * dt;
  const velocity = (currentVelocity - omega * temp) * exp;
  let value = target + (change + temp) * exp;
  // Prevent overshoot when crossing the target.
  if (target - current > 0 === value > target) {
    value = target;
    return { value, velocity: 0 };
  }
  return { value, velocity };
}

export interface PeerMotionState {
  /** Rendered pose + velocity. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Latest / previous sample targets. */
  tx: number;
  ty: number;
  prevTx: number;
  prevTy: number;
  /** Last sample velocity (world/s) for reversal detection. */
  svx: number;
  svy: number;
  sampleAt: number;
  prevSampleAt: number;
}

export function initPeerMotion(x: number, y: number, now: number): PeerMotionState {
  return {
    x, y, vx: 0, vy: 0,
    tx: x, ty: y, prevTx: x, prevTy: y,
    svx: 0, svy: 0,
    sampleAt: now, prevSampleAt: now,
  };
}

/**
 * Fold a fresh sample in. When the new sample velocity opposes the previous
 * one (zigzag corner), drop the rendered velocity so the spring doesn't
 * slingshot past the corner.
 */
export function pushPeerSample(s: PeerMotionState, x: number, y: number, now: number): void {
  const dt = Math.max(0.001, (now - s.sampleAt) / 1000);
  const nvx = (x - s.tx) / dt;
  const nvy = (y - s.ty) / dt;
  if (nvx * s.svx + nvy * s.svy < 0 && Math.hypot(s.svx, s.svy) > 8) {
    s.vx = 0;
    s.vy = 0;
  }
  s.prevTx = s.tx;
  s.prevTy = s.ty;
  s.prevSampleAt = s.sampleAt;
  s.tx = x;
  s.ty = y;
  s.sampleAt = now;
  s.svx = nvx;
  s.svy = nvy;
}

export interface PeerAimOptions {
  /** Dead-reckoning horizon, seconds (matches the ~25 Hz sample rate). */
  leadSec: number;
  /** Hard cap on the lead offset, world units (pass screen-bound × 1/zoom). */
  maxLead: number;
  /** Below this sample speed there is nothing to extrapolate. */
  minSpeed?: number;
}

/**
 * Where the spring should aim: last target + capped velocity lead.
 * The returned offset from (tx, ty) never exceeds maxLead, so a sudden stop
 * can hook at most maxLead past the final point.
 */
export function aimPeerMotion(
  s: PeerMotionState,
  now: number,
  opts: PeerAimOptions
): { x: number; y: number } {
  const minSpeed = opts.minSpeed ?? 8;
  const sampleDt = Math.max(0.001, (s.sampleAt - s.prevSampleAt) / 1000);
  const svx = (s.tx - s.prevTx) / sampleDt;
  const svy = (s.ty - s.prevTy) / sampleDt;
  const age = Math.max(0, (now - s.sampleAt) / 1000);
  const lead = Math.min(opts.leadSec, Math.max(0, opts.leadSec - age * 0.5));
  if (Math.hypot(svx, svy) <= minSpeed || lead <= 0) return { x: s.tx, y: s.ty };
  let ox = svx * lead;
  let oy = svy * lead;
  const len = Math.hypot(ox, oy);
  if (len > opts.maxLead && len > 0) {
    const k = opts.maxLead / len;
    ox *= k;
    oy *= k;
  }
  return { x: s.tx + ox, y: s.ty + oy };
}

/**
 * One spring step toward the aim. When samples stop arriving (pen-up), pull
 * straight at the final target so the cursor settles instead of drifting.
 * Returns true when visually at rest (caller can sleep the frame loop).
 */
export function stepPeerMotion(
  s: PeerMotionState,
  aimX: number,
  aimY: number,
  now: number,
  dt: number,
  smoothTime: number
): boolean {
  const age = Math.max(0, (now - s.sampleAt) / 1000);
  if (age > 0.15) {
    const k = Math.min(1, dt * 16);
    s.x += (s.tx - s.x) * k;
    s.y += (s.ty - s.y) * k;
    s.vx = 0;
    s.vy = 0;
    return Math.hypot(s.tx - s.x, s.ty - s.y) <= 0.5;
  }
  const dx = smoothDamp(s.x, aimX, s.vx, smoothTime, dt);
  const dy = smoothDamp(s.y, aimY, s.vy, smoothTime, dt);
  s.x = dx.value;
  s.vx = dx.velocity;
  s.y = dy.value;
  s.vy = dy.velocity;
  return Math.hypot(aimX - s.x, aimY - s.y) <= 0.15 && Math.hypot(s.vx, s.vy) <= 2;
}
