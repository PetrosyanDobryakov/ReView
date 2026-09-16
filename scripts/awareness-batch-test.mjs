/**
 * AwarenessBatch: one setLocalState per frame for cursor+draft+erase.
 */
import assert from 'node:assert/strict';
import { AwarenessBatch } from '../src/net/awarenessBatch.ts';

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
  }
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

console.log('awareness-batch: all checks passed');
