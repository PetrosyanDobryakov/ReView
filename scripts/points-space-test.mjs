/**
 * Local-space polyline helpers + writeGate heavy coalescing.
 */
import assert from 'node:assert/strict';
import {
  downsamplePolyline,
  toLocalPoints,
  toWorldPoints,
  beginWriteGesture,
  configureWriteGate,
  endWriteGesture,
  enqueuePatches,
  flushNow,
  resetWriteGate,
} from './core-bundle.mjs';

const world = [100, 200, 150, 250, 180, 210];
const local = toLocalPoints(world, 100, 200);
assert.deepEqual(local, [0, 0, 50, 50, 80, 10], 'toLocalPoints');
assert.deepEqual(toWorldPoints(local, 100, 200), world, 'round-trip world');

const dense = [];
for (let i = 0; i < 200; i++) dense.push(i, i * 2);
const slim = downsamplePolyline(dense, 8);
assert.equal(slim.length, 16, 'downsample vertex cap');
assert.equal(slim[0], 0, 'keeps first');
assert.equal(slim[slim.length - 2], 199, 'keeps last x');

resetWriteGate();
let flushes = 0;
/** @type {import('./core-bundle.mjs').PatchBatch | null} */
let lastBatch = null;
configureWriteGate({
  flush: (batch) => {
    flushes += 1;
    lastBatch = batch;
  },
});

// Light patches flush immediately even during a gesture.
beginWriteGesture();
enqueuePatches([['a', { x: 1 }]]);
assert.equal(flushes, 1, 'light patch flushes immediately');
assert.deepEqual(lastBatch, [['a', { x: 1 }]]);

// Heavy patches coalesce.
flushes = 0;
enqueuePatches([['a', { x: 2, points: [0, 0, 1, 1] }]]);
enqueuePatches([['a', { x: 3, points: [0, 0, 2, 2] }]]);
assert.equal(flushes, 2, 'light halves flush each time');
assert.equal(
  lastBatch.some(([, p]) => p.points !== undefined),
  false,
  'points deferred while gesture open'
);
const heavyFlushesBefore = flushes;
endWriteGesture();
assert.ok(flushes > heavyFlushesBefore, 'endGesture flushes heavy');
assert.deepEqual(
  lastBatch.find(([id]) => id === 'a')[1].points,
  [0, 0, 2, 2],
  'later points win'
);
flushNow();
resetWriteGate();

console.log('points-space + writeGate: ok');
