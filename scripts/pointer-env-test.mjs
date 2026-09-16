/**
 * Unit checks for phone/tablet pointer helpers (no DOM canvas).
 * Run: node --experimental-strip-types scripts/pointer-env-test.mjs
 */
import assert from 'node:assert/strict';
import {
  __setCoarsePointerForTests,
  clampToVisualViewport,
  dragThresholdPx,
  handleDrawRadiusScale,
  handleHitRadius,
  isCoarsePointer,
  portHitRadius,
  rotateHitRadius,
} from '../src/core/pointerEnv.ts';

__setCoarsePointerForTests(false);
assert.equal(isCoarsePointer(), false);
assert.equal(handleHitRadius(), 9);
assert.equal(rotateHitRadius(), 14);
assert.equal(portHitRadius(), 16);
assert.equal(dragThresholdPx(), 3);
assert.equal(handleDrawRadiusScale(), 4.25);

__setCoarsePointerForTests(true);
assert.equal(isCoarsePointer(), true);
assert.equal(handleHitRadius(), 24);
assert.equal(rotateHitRadius(), 28);
assert.equal(portHitRadius(), 24);
assert.equal(dragThresholdPx(), 10);
assert.equal(handleDrawRadiusScale(), 6.5);

__setCoarsePointerForTests(null);

const clamped = clampToVisualViewport(900, 700, 300, 200, 8);
assert.ok(clamped.left >= 0);
assert.ok(clamped.top >= 0);

console.log('pointer-env-test: ok');
