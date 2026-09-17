/**
 * Peer confetti awareness helpers: parse / equality / seeded PRNG.
 */
import assert from 'node:assert/strict';
import {
  CONFETTI_STALE_MS,
  mulberry32,
  parsePeerConfetti,
  samePeerConfetti,
} from '../src/net/peerConfetti.ts';

assert.equal(parsePeerConfetti(null), null, 'null → null');
assert.equal(parsePeerConfetti(undefined), null, 'undefined → null');
assert.equal(parsePeerConfetti('x'), null, 'non-object → null');
assert.equal(parsePeerConfetti({ x: 1, y: 2 }), null, 'incomplete → null');

const ok = parsePeerConfetti({ x: 10.5, y: -3, seed: 42, id: 7, t: 1_700_000_000_000 });
assert.deepEqual(ok, { x: 10.5, y: -3, seed: 42, id: 7, t: 1_700_000_000_000 });

assert.equal(samePeerConfetti(null, null), true);
assert.equal(samePeerConfetti(null, ok), false);
assert.equal(samePeerConfetti(ok, ok), true);
assert.equal(
  samePeerConfetti(ok, { ...ok, id: 8 }),
  false,
  'different id'
);

const a = mulberry32(12345);
const b = mulberry32(12345);
assert.equal(a(), b(), 'same seed → same first draw');
assert.equal(a(), b(), 'same seed → same second draw');
assert.notEqual(mulberry32(1)(), mulberry32(2)(), 'different seeds diverge');

assert.ok(CONFETTI_STALE_MS >= 2000, 'stale window covers typical WS delay');

console.log('peer-confetti: all checks passed');
