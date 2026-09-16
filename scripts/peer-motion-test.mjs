/**
 * Peer cursor motion: age-based dead-reckon (no between-packet retract) +
 * frame-hold between awareness samples.
 */
import assert from 'node:assert/strict';
import {
  aimPeerMotion,
  initPeerMotion,
  peerMotionShouldAnimate,
  pushPeerSample,
  sampleDeltaSec,
  snapPeerMotionToSample,
  applyRealtimePeerPose,
  stepPeerMotion,
  PEER_MOTION_HOLD_SEC,
} from './core-bundle.mjs';

const OPTS = { leadSec: 0.04, maxLead: 20 };

// At sample time, aim sits on the sample (no instant jump-ahead pop).
{
  const s = initPeerMotion(0, 0, 0);
  pushPeerSample(s, 40, 0, 40); // ~1000 px/s with clamped dt
  const atSample = aimPeerMotion(s, 40, OPTS);
  assert.deepEqual([atSample.x, atSample.y], [s.tx, s.ty], 'aim on sample at t=sample');
}

// Age-based lead advances forward and is capped.
{
  const s = initPeerMotion(0, 0, 0);
  pushPeerSample(s, 40, 0, 40);
  const aim = aimPeerMotion(s, 80, OPTS); // 40ms later, capped by leadSec
  const hook = Math.hypot(aim.x - s.tx, aim.y - s.ty);
  assert.ok(hook <= 20 + 1e-9, `lead capped at maxLead (got ${hook})`);
  assert.ok(hook > 0, 'lead bridges packet gaps while moving');
  assert.ok(aim.x > s.tx, 'extrapolates forward along +x');
}

// Critical: aim must NOT retract toward the sample between packets.
// Old leadSec - age*0.5 caused periodic micromovement jerks at packet rate.
{
  const s = initPeerMotion(0, 0, 0);
  pushPeerSample(s, 100, 0, 50);
  const a0 = aimPeerMotion(s, 50, OPTS);
  const a1 = aimPeerMotion(s, 60, OPTS);
  const a2 = aimPeerMotion(s, 70, OPTS);
  assert.ok(a1.x >= a0.x - 1e-9, `no retract 0→10ms (a0=${a0.x}, a1=${a1.x})`);
  assert.ok(a2.x >= a1.x - 1e-9, `no retract 10→20ms (a1=${a1.x}, a2=${a2.x})`);
}

// slow drift: no extrapolation at all
{
  const s = initPeerMotion(0, 0, 0);
  pushPeerSample(s, 0.1, 0, 40);
  const slow = aimPeerMotion(s, 40, OPTS);
  assert.deepEqual([slow.x, slow.y], [s.tx, s.ty], 'slow samples aim at target');
}

// zigzag corner kills the slingshot velocity
{
  const s = initPeerMotion(0, 0, 0);
  pushPeerSample(s, 100, 0, 50); // fast +x
  s.vx = 900;
  s.vy = 0;
  pushPeerSample(s, 60, 0, 100); // sharp reversal
  assert.equal(s.vx, 0, 'reversal zeroes rendered velocity x');
  assert.equal(s.vy, 0, 'reversal zeroes rendered velocity y');
}

// steady motion keeps its velocity (no false reversal)
{
  const s = initPeerMotion(0, 0, 0);
  pushPeerSample(s, 100, 0, 50);
  s.vx = 900;
  pushPeerSample(s, 200, 0, 100);
  assert.equal(s.vx, 900, 'steady motion keeps velocity');
}

// pushPeerSample does not snap the rendered pose (no pop on packet).
{
  const s = initPeerMotion(0, 0, 0);
  pushPeerSample(s, 100, 0, 50);
  s.x = 90;
  s.y = 0;
  pushPeerSample(s, 120, 0, 70);
  assert.equal(s.x, 90, 'rendered x unchanged on sample');
  assert.equal(s.y, 0, 'rendered y unchanged on sample');
}

// pen-up settle: straight pull to the final target, reports rest
{
  const s = initPeerMotion(0, 0, 1000);
  pushPeerSample(s, 500, 0, 1040);
  s.x = 480;
  s.y = 0;
  s.vx = 800;
  let rest = false;
  for (let t = 1200; t < 2000; t += 16) {
    rest = stepPeerMotion(s, s.tx, s.ty, t, 1 / 60, 0.1);
  }
  assert.ok(Math.hypot(s.tx - s.x, s.ty - s.y) <= 0.5, 'settles onto the final target');
  assert.ok(rest, 'reports rest when settled');
}

// Contract: one spring step per frame. Two steps with the same dt (glyph +
// pill) catch up ~2× as fast — that is the stutter bug drawPeerMirrors had.
{
  const once = initPeerMotion(0, 0, 0);
  pushPeerSample(once, 100, 0, 40);
  const twice = initPeerMotion(0, 0, 0);
  pushPeerSample(twice, 100, 0, 40);
  const aimOnce = aimPeerMotion(once, 40, OPTS);
  const aimTwice = aimPeerMotion(twice, 40, OPTS);
  stepPeerMotion(once, aimOnce.x, aimOnce.y, 40, 1 / 60, 0.1);
  stepPeerMotion(twice, aimTwice.x, aimTwice.y, 40, 1 / 60, 0.1);
  stepPeerMotion(twice, aimTwice.x, aimTwice.y, 40, 1 / 60, 0.1);
  assert.ok(
    twice.x > once.x + 0.5,
    `double-step advances further than single-step (once=${once.x}, twice=${twice.x})`,
  );
}

// Burst arrivals must not explode velocity (dt clamped to >= 1/60).
{
  const burst = initPeerMotion(0, 0, 0);
  pushPeerSample(burst, 10, 0, 1); // 1 ms later
  assert.ok(sampleDeltaSec(0, 1) >= 1 / 60 - 1e-9, 'sampleDeltaSec floors short gaps');
  assert.ok(Math.hypot(burst.svx, burst.svy) < 10 / (1 / 60) + 1, 'burst velocity stays bounded');
}

// Hold window: after a sample, keep animating even if visually at rest —
// otherwise the engine sleeps until the next awareness packet (stutter).
{
  const hold = initPeerMotion(0, 0, 1000);
  pushPeerSample(hold, 50, 0, 1040);
  hold.x = hold.tx;
  hold.y = hold.ty;
  hold.vx = 0;
  hold.vy = 0;
  assert.equal(
    peerMotionShouldAnimate(hold, 1040 + (PEER_MOTION_HOLD_SEC * 1000) / 2),
    true,
    'holds frames between expected packets',
  );
  assert.equal(
    peerMotionShouldAnimate(hold, 1040 + PEER_MOTION_HOLD_SEC * 1000 + 50),
    false,
    'releases hold after the window when at rest',
  );
}

// Realtime path: snap display pose to the latest sample (no spring trail).
{
  const s = initPeerMotion(0, 0, 0);
  pushPeerSample(s, 100, 0, 50);
  s.x = 10;
  s.y = 20;
  s.vx = 400;
  s.vy = -50;
  snapPeerMotionToSample(s);
  assert.equal(s.x, s.tx, 'snap x to sample');
  assert.equal(s.y, s.ty, 'snap y to sample');
  assert.equal(s.vx, 0, 'snap clears vx');
  assert.equal(s.vy, 0, 'snap clears vy');
}

// Realtime between packets: dead-reckon forward without spring lag.
{
  const s = initPeerMotion(0, 0, 0);
  pushPeerSample(s, 100, 0, 50);
  snapPeerMotionToSample(s);
  applyRealtimePeerPose(s, 70, OPTS); // 20ms later (< leadSec)
  assert.ok(s.x > s.tx, 'realtime pose advances past sample between packets');
  assert.equal(s.vx, 0, 'realtime pose clears spring velocity');
  assert.equal(s.vy, 0, 'realtime pose clears spring velocity y');
  const mid = s.x;
  applyRealtimePeerPose(s, 80, OPTS);
  assert.ok(s.x >= mid - 1e-9, 'realtime pose does not retract between packets');
  applyRealtimePeerPose(s, 50 + OPTS.leadSec * 1000 + 5, OPTS);
  assert.equal(s.x, s.tx, 'past leadSec realtime sits on sample');
  assert.equal(s.y, s.ty, 'past leadSec realtime sits on sample y');
}

console.log('peer-motion: all checks passed');
