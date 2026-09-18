/**
 * AwarenessBatch: one setLocalState per frame for cursor+draft+erase,
 * with a multiplayer rate floor (~20 Hz) that flushNow bypasses.
 */
import assert from 'node:assert/strict';
import { AwarenessBatch, AWARENESS_MIN_FLUSH_MS } from '../src/net/awarenessBatch.ts';

assert.equal(AWARENESS_MIN_FLUSH_MS, 50, 'default floor is 50 ms (~20 Hz)');

const applied = [];
let flushFn = null;
const batch = new AwarenessBatch(
  (patch) => {
    applied.push({ ...patch });
  },
  (flush) => {
    flushFn = flush;
    return () => {
      flushFn = null;
    };
  },
  { minFlushMs: 0 } // existing coalesce tests: no rate floor
);

batch.queue({ cursor: { x: 1, y: 2 } });
batch.queue({ draft: { kind: 'pen', points: [0, 0, 1, 1], stroke: '#000', strokeWidth: 2 } });
assert.deepEqual(batch.pendingKeys().sort(), ['cursor', 'draft'], 'fields coalesce before flush');
assert.equal(applied.length, 0, 'no apply until scheduler runs');

flushFn();
assert.equal(applied.length, 1, 'one apply per frame');
assert.equal(applied[0].cursor.x, 1);
assert.equal(applied[0].draft.points.length, 4);

batch.queue({ cursor: { x: 3, y: 4 } });
batch.queue({ cursor: { x: 5, y: 6 } });
batch.flushNow();
assert.equal(applied.length, 2, 'flushNow applies immediately');
assert.deepEqual(applied[1].cursor, { x: 5, y: 6 }, 'latest cursor wins');

batch.queue({ erasePreview: null });
batch.clear();
assert.equal(batch.pendingKeys().length, 0, 'clear drops pending');
assert.equal(applied.length, 2, 'clear does not apply');

// --- Rate floor: second rAF tick within the window is deferred ---
let clock = 1_000;
const floorApplied = [];
let floorFlush = null;
const floorBatch = new AwarenessBatch(
  (patch) => {
    floorApplied.push({ t: clock, ...patch });
  },
  (flush) => {
    floorFlush = flush;
    return () => {
      floorFlush = null;
    };
  },
  { minFlushMs: 50, now: () => clock }
);

floorBatch.queue({ cursor: { x: 0, y: 0 } });
floorFlush();
assert.equal(floorApplied.length, 1, 'first flush always applies');
assert.equal(floorApplied[0].t, 1_000);

clock = 1_010; // 10 ms later — inside the 50 ms floor
floorBatch.queue({ cursor: { x: 1, y: 1 } });
floorFlush();
assert.equal(floorApplied.length, 1, 'second flush held by rate floor');
assert.deepEqual(floorBatch.pendingKeys(), ['cursor'], 'pending retained while deferred');

// Advance past the floor and let the deferred timer fire.
clock = 1_060;
await new Promise((r) => setTimeout(r, 55));
assert.equal(floorApplied.length, 2, 'deferred flush applies after min interval');
assert.equal(floorApplied[1].cursor.x, 1);
assert.equal(floorApplied[1].t, 1_060);

// flushNow bypasses the floor even inside the window.
clock = 1_070;
floorBatch.queue({ cursor: { x: 9, y: 9 } });
floorBatch.flushNow();
assert.equal(floorApplied.length, 3, 'flushNow bypasses rate floor');
assert.equal(floorApplied[2].cursor.x, 9);

console.log('awareness-batch: all checks passed');
