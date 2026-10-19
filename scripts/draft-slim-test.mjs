/**
 * Draft slimming for the wire (F5): a long live stroke must not backlog a thin
 * link. Run: node --experimental-strip-types scripts/draft-slim-test.mjs
 */
import assert from 'node:assert/strict';
import { downsamplePolyline } from '../src/core/pointsSpace.ts';

const DRAFT_MAX_VERTICES = 96;

// Long stroke: 2000 vertices.
const pts = [];
for (let i = 0; i < 2000; i++) pts.push(i, Math.sin(i / 10) * 50);
const slim = downsamplePolyline(pts, DRAFT_MAX_VERTICES);
assert.ok(slim.length / 2 <= DRAFT_MAX_VERTICES);
// Tip intact (last 24 vertices exact) — the end of the stroke never degrades.
assert.deepEqual(slim.slice(-48), pts.slice(-48));
// Start kept.
assert.equal(slim[0], pts[0]);
assert.equal(slim[1], pts[1]);

// Short stroke passes through untouched (same reference, no copy).
const short = [0, 0, 1, 1, 2, 2];
assert.equal(downsamplePolyline(short, DRAFT_MAX_VERTICES), short);

// Boundary: exactly at cap stays whole.
const exact = Array.from({ length: DRAFT_MAX_VERTICES * 2 }, (_, i) => i);
assert.equal(downsamplePolyline(exact, DRAFT_MAX_VERTICES).length, exact.length);

console.log('draft-slim-test: ok');
