/**
 * Peer cursor motion: critically-damped follow + age-based dead-reckoning,
 * or optional snap-to-sample for realtime display (default in the engine).
 * Pure math (no DOM/canvas) so the motion contract is unit-testable.
 *
 * Aim must advance with sample age (classic dead-reckon), never retract
 * toward the last sample between packets. The old `leadSec - age*0.5`
 * formula jumped ahead on each awareness packet then pulled back until the
 * next one — periodic micromovement jerks that felt like stutter, not lag.
 *
 * Cap the extrapolated offset so a sudden stop (pen-up after a fast flick)
 * cannot hook more than maxLead past the final point. Kill rendered velocity
 * on direction reversal to stop zigzag slingshots on short choppy strokes.
 *
 * Callers must step once per frame when smooth mode is on. Stepping from
 * both the on-canvas glyph and the off-screen pill doubles the spring rate
 * and looks like stutter.
 *
 * Keep the paint loop alive between samples (`peerMotionShouldAnimate`):
 * if the spring settles and `peersAnimating` clears, rAF skips render until
 * the next awareness packet — the cursor freezes at packet rate (stutter)
 * even when the network is fine. Realtime mode still holds frames, but
 * advances the glyph with short dead-reckon (`applyRealtimePeerPose`) instead
 * of a spring trail — bridges WS gaps without smooth-delay lag.
 *
 * Idle → first move: awareness stops while the cursor is still (sameCursor
 * dedupe). The next sample after a long gap hard-snaps display pose to the
 * wire sample and clears velocity — no coast across the discontinuity.
 * Brief stalls during continuous motion stay under the resume gap so
 * dead-reckon continuity is preserved (0.14.39's 0.2s stale reset caused
 * mid-move jaggers and is rejected).
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
 * Inter-sample dt for velocity. Floor burst arrivals (same-tick / 1 ms) so
 * speed cannot explode. Do NOT ceiling long gaps: a 0.12s cap was inventing
 * huge (delta / 0.12) speeds across idle and mid-move stalls.
 */
export function sampleDeltaSec(prevAt: number, now: number): number {
  return Math.max(1 / 60, (now - prevAt) / 1000);
}

/** Raw seconds since `prevAt` (no clamp) — used to detect idle gaps. */
export function peerSampleGapSec(prevAt: number, now: number): number {
  return Math.max(0, (now - prevAt) / 1000);
}

/**
 * Gap above this = peer was idle / awareness stopped (sameCursor dedupe).
 * Must sit well above hold + typical WS/main-thread stalls (~50–200 ms) so
 * continuous motion keeps velocity; 0.14.39 used 0.2s and caused mid-move
 * jaggers. Idle parks are multi-second.
 */
export const PEER_MOTION_RESUME_GAP_SEC = 1;

/**
 * @deprecated 0.14.39 name — alias of `PEER_MOTION_RESUME_GAP_SEC`. Do not use
 * the old 0.2s stale reset; that regression is user-rejected.
 */
export const PEER_MOTION_STALE_SEC = PEER_MOTION_RESUME_GAP_SEC;

/**
 * Fold a fresh sample in. When the new sample velocity opposes the previous
 * one (zigzag corner), drop the rendered velocity so the spring doesn't
 * slingshot past the corner.
 *
 * After a long idle gap, hard-snap the display pose to the wire sample and
 * clear dead-reckon / spring velocity so nothing coasts across the gap.
 * Frequent samples (continuous motion) keep normal velocity continuity.
 *
 * Non-resume samples do not snap the rendered pose — spring/lerp absorbs the
 * correction so each awareness packet does not pop the glyph. Callers that
 * want realtime display should follow with `snapPeerMotionToSample`.
 */
export function pushPeerSample(s: PeerMotionState, x: number, y: number, now: number): void {
  const gap = peerSampleGapSec(s.sampleAt, now);
  if (gap > PEER_MOTION_RESUME_GAP_SEC) {
    // Idle → first move: discontinuity — hard-snap to wire, no coast.
    s.prevTx = x;
    s.prevTy = y;
    s.prevSampleAt = now;
    s.tx = x;
    s.ty = y;
    s.sampleAt = now;
    s.svx = 0;
    s.svy = 0;
    snapPeerMotionToSample(s);
    return;
  }
  const dt = sampleDeltaSec(s.sampleAt, now);
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

/** Display pose = latest sample (no spring trail). Used on new samples + reduced-motion. */
export function snapPeerMotionToSample(s: PeerMotionState): void {
  s.x = s.tx;
  s.y = s.ty;
  s.vx = 0;
  s.vy = 0;
}

/**
 * Realtime display between samples: sample + short dead-reckon, no spring.
 * Bridges brief awareness/WS gaps without the laggy smooth-follow trail.
 * Past leadSec, sit on the last sample so a stop does not leave a permanent lead.
 */
export function applyRealtimePeerPose(
  s: PeerMotionState,
  now: number,
  opts: PeerAimOptions
): void {
  const age = Math.max(0, (now - s.sampleAt) / 1000);
  if (age > opts.leadSec) {
    snapPeerMotionToSample(s);
    return;
  }
  const aim = aimPeerMotion(s, now, opts);
  s.x = aim.x;
  s.y = aim.y;
  s.vx = 0;
  s.vy = 0;
}

export interface PeerAimOptions {
  /**
   * Max age (seconds) to dead-reckon past the last sample.
   * Matches ~one awareness interval so we bridge the gap without racing ahead.
   */
  leadSec: number;
  /** Hard cap on the lead offset, world units (pass screen-bound × 1/zoom). */
  maxLead: number;
  /** Below this sample speed there is nothing to extrapolate. */
  minSpeed?: number;
}

/**
 * Where the spring should aim: last sample + velocity × age (capped).
 * Aim advances with time between packets and never retracts toward (tx, ty).
 */
export function aimPeerMotion(
  s: PeerMotionState,
  now: number,
  opts: PeerAimOptions
): { x: number; y: number } {
  const minSpeed = opts.minSpeed ?? 8;
  const sampleDt = sampleDeltaSec(s.prevSampleAt, s.sampleAt);
  const svx = (s.tx - s.prevTx) / sampleDt;
  const svy = (s.ty - s.prevTy) / sampleDt;
  const age = Math.max(0, (now - s.sampleAt) / 1000);
  // Extrapolate forward with age — do NOT shrink lead back toward the sample.
  const lead = Math.min(opts.leadSec, age);
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

/** How long after a sample we keep painting so dead-reckon can bridge the gap. */
export const PEER_MOTION_HOLD_SEC = 0.14;

/**
 * Realtime dead-reckon window (seconds). Longer than one rAF tick so brief
 * main-thread / WS stalls (~50–80 ms) still coast; still far below spring trail.
 */
export const REALTIME_LEAD_SEC = 0.08;

/**
 * True while the cursor still needs frames: either visually moving, or within
 * the hold window after the last sample (expecting the next awareness packet).
 */
export function peerMotionShouldAnimate(
  s: PeerMotionState,
  now: number,
  holdSec = PEER_MOTION_HOLD_SEC
): boolean {
  const age = Math.max(0, (now - s.sampleAt) / 1000);
  if (age < holdSec) return true;
  if (Math.hypot(s.tx - s.x, s.ty - s.y) > 0.5) return true;
  if (Math.hypot(s.vx, s.vy) > 2) return true;
  return false;
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
  // Settle only after the hold window — brief network gaps must stay in spring
  // mode so dead-reckon can keep the glyph moving between packets.
  if (age > PEER_MOTION_HOLD_SEC + 0.08) {
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
