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
  closeWriteGate,
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

// Heavy patches coalesce, but their light half still flushes immediately.
flushes = 0;
enqueuePatches([['a', { x: 2, points: [0, 0, 1, 1] }]]);
enqueuePatches([['a', { x: 3, points: [0, 0, 2, 2] }]]);
assert.equal(flushes, 2, 'bounds ride along immediately, points stay pending');
assert.deepEqual(lastBatch, [['a', { x: 3 }]], 'peer sees the latest origin at once');
const heavyFlushesBefore = flushes;
endWriteGesture();
assert.ok(flushes > heavyFlushesBefore, 'endGesture flushes heavy');
const heavy = lastBatch.find(([id]) => id === 'a')[1];
assert.deepEqual(heavy.points, [0, 0, 2, 2], 'later points win');
assert.equal(heavy.x, 3, 'bounds flush with the points, not ahead of them');
flushNow();
resetWriteGate();

// Pure-light moves keep flushing immediately even while heavy is pending
// for the same shape — peers see drags at pointer rate, not 30 Hz teleports.
beginWriteGesture();
enqueuePatches([['b', { points: [0, 0, 1, 1] }]]);
flushes = 0;
enqueuePatches([['b', { x: 9 }]]);
assert.equal(flushes, 1, 'light move flushes immediately despite pending heavy');
assert.deepEqual(lastBatch, [['b', { x: 9 }]]);
endWriteGesture();
resetWriteGate();

// Compact must flush pending heavy patches before snapshotting the doc.
// Light fields already flushed; points stay gated — a mid-gesture compact
// that copies maps without closeWriteGate() would drop the new polyline.
{
  /** @type {Record<string, unknown>} */
  const fakeDoc = { x: 0, points: [0, 0] };
  configureWriteGate({
    flush: (batch) => {
      for (const [, patch] of batch) Object.assign(fakeDoc, patch);
    },
  });
  beginWriteGesture();
  enqueuePatches([['pen', { x: 9, points: [0, 0, 4, 4] }]]);
  assert.equal(fakeDoc.x, 9, 'light geometry already in the doc');
  assert.deepEqual(fakeDoc.points, [0, 0], 'heavy points still pending');
  // closeWriteGate is what compactBoard must call before copying maps.
  closeWriteGate();
  assert.deepEqual(fakeDoc.points, [0, 0, 4, 4], 'flush before compact keeps stroke points');
  resetWriteGate();

  const storeSrc = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/core/store.ts', import.meta.url), 'utf8'),
  );
  const start = storeSrc.indexOf('export async function compactBoard');
  const end = storeSrc.indexOf('\nfunction fileLogFallback', start);
  const body = storeSrc.slice(start, end === -1 ? undefined : end);
  const flushAt = body.indexOf('closeWriteGate()');
  const snapAt = body.indexOf('const compact = new Y.Doc');
  assert.ok(flushAt >= 0, 'compactBoard calls closeWriteGate');
  assert.ok(snapAt > flushAt, 'closeWriteGate runs before the compact snapshot');
}

console.log('points-space + writeGate: ok');
