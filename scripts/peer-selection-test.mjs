/**
 * Peer selection awareness helpers: parse / slim / equality.
 */
import assert from 'node:assert/strict';
import {
  parsePeerSelection,
  samePeerSelection,
  slimPeerSelection,
  SELECTION_MAX_IDS,
} from '../src/net/peerSelection.ts';

assert.equal(parsePeerSelection(null), null, 'null → null');
assert.equal(parsePeerSelection([]), null, 'empty → null');
assert.equal(parsePeerSelection('a'), null, 'non-array → null');
assert.deepEqual(parsePeerSelection([' a ', '', 'a', 'b']), ['a', 'b'], 'trim+dedupe');
assert.equal(slimPeerSelection([]), null, 'slim empty');
assert.deepEqual(slimPeerSelection(['x', 'x', 'y']), ['x', 'y'], 'slim dedupe');

const big = Array.from({ length: SELECTION_MAX_IDS + 10 }, (_, i) => `s${i}`);
assert.equal(parsePeerSelection(big)?.length, SELECTION_MAX_IDS, 'cap at max');

assert.equal(samePeerSelection(null, null), true);
assert.equal(samePeerSelection(null, []), false, 'null vs empty array');
assert.equal(samePeerSelection(['a'], ['a']), true);
assert.equal(samePeerSelection(['a'], ['b']), false);
assert.equal(samePeerSelection(['a', 'b'], ['a']), false);

console.log('peer-selection: all checks passed');
