/**
 * Peer cursor motion: bounded lead (no post-stop hook) + reversal damping.
 */
import assert from 'node:assert/strict';
import {
  aimPeerMotion,
  initPeerMotion,
  pushPeerSample,
  stepPeerMotion,
} from './core-bundle.mjs';

const OPTS = { leadSec: 0.045, maxLead: 20 };

// fast flick, then samples stop: the aim must never hook past maxLead
let s = initPeerMotion(0, 0, 0);
pushPeerSample(s, 40, 0, 40); // 1000 px/s
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
  rest = stepPeerMotion(s, s.tx, s.ty, t, 1 / 60, 0.055);
}
assert.ok(Math.hypot(s.tx - s.x, s.ty - s.y) <= 0.5, 'settles onto the final target');
assert.ok(rest, 'reports rest when settled');

console.log('peer-motion: all checks passed');
