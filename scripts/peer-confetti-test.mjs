/**
 * Peer confetti awareness helpers: parse / equality / seeded PRNG / spam escalation.
 */
import assert from 'node:assert/strict';
import {
  CONFETTI_MAX_LIVE,
  CONFETTI_MAX_POWER,
  CONFETTI_STALE_MS,
  CONFETTI_STREAK_WINDOW_MS,
  clampConfettiPower,
  confettiBurstParams,
  mulberry32,
  nextConfettiPower,
  parsePeerConfetti,
  samePeerConfetti,
} from '../src/net/peerConfetti.ts';

assert.equal(parsePeerConfetti(null), null, 'null → null');
assert.equal(parsePeerConfetti(undefined), null, 'undefined → null');
assert.equal(parsePeerConfetti('x'), null, 'non-object → null');
assert.equal(parsePeerConfetti({ x: 1, y: 2 }), null, 'incomplete → null');

const ok = parsePeerConfetti({ x: 10.5, y: -3, seed: 42, id: 7, t: 1_700_000_000_000 });
assert.deepEqual(ok, { x: 10.5, y: -3, seed: 42, id: 7, t: 1_700_000_000_000, power: 1 });

const powered = parsePeerConfetti({
  x: 1,
  y: 2,
  seed: 3,
  id: 4,
  t: 5,
  power: 6,
});
assert.equal(powered?.power, 6, 'power parsed');

assert.equal(samePeerConfetti(null, null), true);
assert.equal(samePeerConfetti(null, ok), false);
assert.equal(samePeerConfetti(ok, ok), true);
assert.equal(
  samePeerConfetti(ok, { ...ok, id: 8 }),
  false,
  'different id'
);
assert.equal(
  samePeerConfetti(ok, { ...ok, power: 3 }),
  false,
  'different power'
);

const a = mulberry32(12345);
const b = mulberry32(12345);
assert.equal(a(), b(), 'same seed → same first draw');
assert.equal(a(), b(), 'same seed → same second draw');
assert.notEqual(mulberry32(1)(), mulberry32(2)(), 'different seeds diverge');

assert.ok(CONFETTI_STALE_MS >= 2000, 'stale window covers typical WS delay');
assert.ok(CONFETTI_STREAK_WINDOW_MS >= 1000, 'streak window allows rapid spam');
assert.equal(CONFETTI_MAX_POWER, 8);
assert.ok(CONFETTI_MAX_LIVE >= 600, 'live cap still feels huge');

assert.equal(clampConfettiPower(undefined), 1);
assert.equal(clampConfettiPower(0), 1);
assert.equal(clampConfettiPower(99), CONFETTI_MAX_POWER);
assert.equal(clampConfettiPower(3.7), 4);

assert.equal(nextConfettiPower(1, Number.POSITIVE_INFINITY), 1, 'cold start → 1');
assert.equal(nextConfettiPower(3, CONFETTI_STREAK_WINDOW_MS + 1), 1, 'cooled off → reset');
assert.equal(nextConfettiPower(1, 200), 2, 'spam climbs');
assert.equal(nextConfettiPower(7, 100), 8, 'near max');
assert.equal(nextConfettiPower(8, 50), 8, 'caps at max');

const p1 = confettiBurstParams(1, false);
assert.equal(p1.count, 64, 'power 1 count matches classic');
assert.equal(p1.cone, 0.95, 'power 1 cone matches classic');
assert.equal(p1.cannons, 1, 'power 1 single cannon');

const p8 = confettiBurstParams(8, false);
assert.ok(p8.count > p1.count, 'max power more particles');
assert.ok(p8.cone > p1.cone, 'max power wider cone');
assert.equal(p8.cannons, 3, 'max power triple cannons');

const quiet = confettiBurstParams(8, true);
assert.ok(quiet.count < p8.count, 'reduce-motion caps frenzy size');
assert.equal(quiet.cannons, 1, 'reduce-motion stays single cannon');

console.log('peer-confetti: all checks passed');
