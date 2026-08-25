import assert from 'node:assert/strict';
import {
  localToWorld,
  reanchorRotatedResize,
  resizeAnchorFractions,
  shapeCenter,
} from './core-bundle.mjs';

const orig = { x: 100, y: 100, w: 200, h: 100, rotation: 90 };
const handle = 'e';
const { fx, fy } = resizeAnchorFractions(handle);
assert.equal(fx, 0);
assert.equal(fy, 0.5);

const fixedBefore = localToWorld(orig, fx * orig.w, fy * orig.h);

// Drag local +east by 50 (world depends on rotation; edges are in unrotated frame).
const left = orig.x;
const right = orig.x + orig.w + 50;
const top = orig.y;
const bottom = orig.y + orig.h;
const next = {
  x: Math.min(left, right),
  y: Math.min(top, bottom),
  w: Math.abs(right - left),
  h: Math.abs(bottom - top),
};

const broken = { ...next }; // without reanchor, center drifts
const brokenFixed = localToWorld(
  { ...broken, rotation: 90 },
  fx * broken.w,
  fy * broken.h
);
assert.ok(
  Math.hypot(brokenFixed.x - fixedBefore.x, brokenFixed.y - fixedBefore.y) > 1,
  'unanchored resize must move the fixed edge in world space'
);

const anchored = reanchorRotatedResize(orig, next, handle, { left, right, top, bottom });
const fixedAfter = localToWorld(
  { ...anchored, rotation: 90 },
  fx * anchored.w,
  fy * anchored.h
);
assert.ok(
  Math.hypot(fixedAfter.x - fixedBefore.x, fixedAfter.y - fixedBefore.y) < 1e-6,
  'reanchor keeps the opposite edge fixed in world space'
);
assert.equal(anchored.w, 250);
assert.equal(anchored.h, 100);

// Center should move only along the handle axis in local space (east), i.e. local +x after 90° rot = world +y.
const c0 = shapeCenter(orig);
const c1 = shapeCenter(anchored);
assert.ok(Math.abs(c1.x - c0.x) < 1e-6, '90° east resize should not shift world x of center');
assert.ok(c1.y > c0.y, '90° east resize grows along world +y');

console.log('transform-test: ok');
