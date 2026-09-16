/**
 * Peer cursor motion: bounded lead (no post-stop hook) + reversal damping +
 * frame-hold between awareness samples.
 */
import assert from 'node:assert/strict';
import {
  aimPeerMotion,
  initPeerMotion,
  peerMotionShouldAnimate,
  pushPeerSample,
  sampleDeltaSec,
  stepPeerMotion,
  PEER_MOTION_HOLD_SEC,
} from './core-bundle.mjs';

const OPTS = { leadSec: 0.035, maxLead: 20 };

// fast flick, then samples stop: the aim must never hook past maxLead
let s = initPeerMotion(0, 0, 0);
pushPeerSample(s, 40, 0, 40); // ~1000 px/s with clamped dt
const aim = aimPeerMotion(s, 40, OPTS);
const hook = Math.hypot(aim.x - s.tx, aim.y - s.ty);
assert.ok(hook <= 20 + 1e-9, `lead capped at maxLead (got ${hook})`);
assert.ok(hook > 0, 'lead still bridges packet gaps while moving');

// slow drift: no extrapolation at all
s = initPeerMotion(0, 0, 0);
pushPeerSample(s, 0.1, 0, 40);
const slow = aimPeerMotion(s, 40, OPTS);
assert.deepEqual([slow.x, slow.y], [s.tx, s.ty], 'slow samples aim at target');

// zigzag corner kills the slingshot velocity
s = initPeerMotion(0, 0, 0);
pushPeerSample(s, 100, 0, 50); // fast +x
s.vx = 900;
s.vy = 0;
pushPeerSample(s, 60, 0, 100); // sharp reversal
assert.equal(s.vx, 0, 'reversal zeroes rendered velocity x');
assert.equal(s.vy, 0, 'reversal zeroes rendered velocity y');

// steady motion keeps its velocity (no false reversal)
s = initPeerMotion(0, 0, 0);
pushPeerSample(s, 100, 0, 50);
s.vx = 900;
pushPeerSample(s, 200, 0, 100);
assert.equal(s.vx, 900, 'steady motion keeps velocity');

// pen-up settle: straight pull to the final target, reports rest
s = initPeerMotion(0, 0, 1000);
pushPeerSample(s, 500, 0, 1040);
s.x = 480;
s.y = 0;
s.vx = 800;
let rest = false;
for (let t = 1200; t < 2000; t += 16) {
  rest = stepPeerMotion(s, s.tx, s.ty, t, 1 / 60, 0.07);
}
assert.ok(Math.hypot(s.tx - s.x, s.ty - s.y) <= 0.5, 'settles onto the final target');
assert.ok(rest, 'reports rest when settled');

// Contract: one spring step per frame. Two steps with the same dt (glyph +
// pill) catch up ~2× as fast — that is the stutter bug drawPeerMirrors had.
{
  const once = initPeerMotion(0, 0, 0);
  pushPeerSample(once, 100, 0, 40);
  const twice = initPeerMotion(0, 0, 0);
  pushPeerSample(twice, 100, 0, 40);
  const aimOnce = aimPeerMotion(once, 40, OPTS);
  const aimTwice = aimPeerMotion(twice, 40, OPTS);
  stepPeerMotion(once, aimOnce.x, aimOnce.y, 40, 1 / 60, 0.07);
  stepPeerMotion(twice, aimTwice.x, aimTwice.y, 40, 1 / 60, 0.07);
  stepPeerMotion(twice, aimTwice.x, aimTwice.y, 40, 1 / 60, 0.07);
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

console.log('peer-motion: all checks passed');
