import assert from 'node:assert/strict';
import {
  localToWorld,
  reanchorRotatedResize,
  resizeAnchorFractions,
  rotateShapeAround,
  shapeCenter,
  groupResizeMember,
  mapShapeThroughHostResize,
  mapShapeThroughLocalMap,
  rotatedAabb,
} from './core-bundle.mjs';

/** Mirror of shapes.mapAlongTableFractions for divider regression (avoid pulling shapes into core-bundle). */
function mapAlongTableFractions(from, to, t) {
  if (from.length !== to.length || from.length === 0) return t;
  const oldE = [0];
  const newE = [0];
  let os = 0;
  let ns = 0;
  for (let i = 0; i < from.length; i++) {
    os += from[i];
    ns += to[i];
    oldE.push(os);
    newE.push(ns);
  }
  oldE[oldE.length - 1] = 1;
  newE[newE.length - 1] = 1;
  const tt = Math.max(0, Math.min(1, t));
  let i = 0;
  for (; i < oldE.length - 2; i++) {
    if (tt <= oldE[i + 1] + 1e-12) break;
  }
  const a0 = oldE[i];
  const a1 = oldE[i + 1];
  const b0 = newE[i];
  const b1 = newE[i + 1];
  const span = a1 - a0;
  const u = span > 1e-12 ? (tt - a0) / span : 0;
  return b0 + u * (b1 - b0);
}

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

const rotated = { x: 0, y: 50, w: 100, h: 20, rotation: 90, type: 'rect' };
const origBox = rotatedAabb(rotated);
assert.ok(Math.abs(origBox.w - 20) < 1e-6, '90° AABB width is the unrotated height');
const nextBox = { x: origBox.x, y: origBox.y, w: origBox.w * 2, h: origBox.h };
const grown = groupResizeMember(rotated, origBox, nextBox, 1);
assert.ok(grown);
const grownAabb = rotatedAabb({ ...rotated, ...grown });
assert.ok(Math.abs(grownAabb.w - origBox.w * 2) < 1e-6, 'group-resize of a 90° rect grows visual width');
assert.ok(Math.abs(grownAabb.h - origBox.h) < 1e-6, 'group-resize of a 90° rect keeps visual height when sy=1');
assert.ok(Math.abs((grown.w ?? 0) - 100) < 1e-6, 'unrotated width stays put when scaling the visual short axis');
assert.ok(Math.abs((grown.h ?? 0) - 40) < 1e-6, 'unrotated height doubles so visual width doubles');

const sticky = { x: 10, y: 10, w: 80, h: 40, type: 'sticky' };
const group = { x: 0, y: 0, w: 200, h: 100 };
const spread = { x: 0, y: 0, w: 400, h: 100 };
const moved = groupResizeMember(sticky, group, spread, 1);
assert.ok(moved);
assert.equal(moved.w, undefined, 'sticky keeps its size');
const stickyCx = sticky.x + sticky.w / 2;
const newCx = moved.x + sticky.w / 2;
assert.ok(Math.abs(newCx - (spread.x + ((stickyCx - group.x) / group.w) * spread.w)) < 1e-6, 'sticky center tracks the group');

const pen = { x: 0, y: 0, w: 10, h: 0, type: 'pen', points: [0, 0, 10, 0], strokeWidth: 0 };
const penBox = { x: 0, y: 0, w: 10, h: 10 };
const penNext = { x: 0, y: 0, w: 20, h: 10 };
const ink = groupResizeMember(pen, penBox, penNext, 1);
assert.ok(ink?.points);
assert.deepEqual(ink.points, [0, 0, 20, 0], 'pen points follow the group affine');

const photo = { x: 0, y: 50, w: 100, h: 20, rotation: 90 };
const note = { x: 40, y: 50, w: 20, h: 20, type: 'sticky' };
const grownHost = { x: 0, y: 50, w: 160, h: 20, rotation: 90 };
const rode = mapShapeThroughHostResize(note, photo, grownHost, 1);
assert.ok(rode);
const noteC1 = { x: (rode.x ?? 0) + 10, y: (rode.y ?? 0) + 10 };
const expectC = localToWorld(grownHost, 80, 10);
assert.ok(
  Math.hypot(noteC1.x - expectC.x, noteC1.y - expectC.y) < 1e-6,
  'sticky glued to a 90° photo stays in local frame when the photo grows east'
);

const orbited = rotateShapeAround(
  { x: 0, y: 0, w: 20, h: 20, type: 'sticky', rotation: 0 },
  0,
  0,
  90
);
assert.ok(Math.abs(orbited.x - -20) < 1e-6 && Math.abs(orbited.y - 0) < 1e-6, 'box center orbits the pivot');
assert.ok(Math.abs((orbited.rotation ?? 0) - 90) < 1e-6, 'box rotation accumulates the same delta');

const tbl = { x: 0, y: 0, w: 200, h: 100, rotation: 90 };
const grownTbl = { ...tbl, h: 150 };
const cellC = localToWorld(tbl, 100, 75);
const cellNote = { x: cellC.x - 10, y: cellC.y - 10, w: 20, h: 20, type: 'sticky' };
const shifted = mapShapeThroughLocalMap(
  cellNote,
  tbl,
  grownTbl,
  (lx, ly) => ({ x: lx, y: ly >= 50 ? ly + 50 : ly }),
  1
);
assert.ok(shifted);
const shiftedC = { x: (shifted.x ?? 0) + 10, y: (shifted.y ?? 0) + 10 };
const expectShift = localToWorld(grownTbl, 100, 125);
assert.ok(
  Math.hypot(shiftedC.x - expectShift.x, shiftedC.y - expectShift.y) < 1e-6,
  'table insert remaps a 90° cell sticky in the host local frame'
);

const hostFlat = { x: 0, y: 0, w: 200, h: 100 };
const rider90 = { x: 80, y: 10, w: 40, h: 80, rotation: 90, type: 'rect' };
const grownFlat = { x: 0, y: 0, w: 400, h: 100 };
const aabb0 = rotatedAabb(rider90);
const rode90 = mapShapeThroughHostResize(rider90, hostFlat, grownFlat, 1);
assert.ok(rode90);
const aabb1 = rotatedAabb({ ...rider90, ...rode90 });
assert.ok(Math.abs(aabb1.w - aabb0.w * 2) < 1e-6, '90° rider AABB width follows host X');
assert.ok(Math.abs(aabb1.h - aabb0.h) < 1e-6, '90° rider AABB height stays when host height is unchanged');
const grouped90 = groupResizeMember(rider90, hostFlat, grownFlat, 1);
assert.ok(grouped90);
assert.ok(Math.abs((rode90.w ?? 0) - (grouped90.w ?? 0)) < 1e-6, 'host-resize of a 90° rider matches group-resize size');

// Cell-divider warp must not stretch ink or photos glued to the table.
{
  const host = { x: 0, y: 0, w: 200, h: 100 };
  const from = [0.5, 0.5];
  const to = [0.7, 0.3];
  const mapLocal = (lx, ly) => {
    const fx = host.w ? lx / host.w : 0;
    return { x: mapAlongTableFractions(from, to, fx) * host.w, y: ly };
  };
  const photo = { x: 10, y: 20, w: 60, h: 40, type: 'image' };
  const photoNext = mapShapeThroughLocalMap(photo, host, host, mapLocal, 1);
  assert.ok(photoNext);
  assert.equal(photoNext.w, undefined, 'divider remaps photo by center only');
  assert.ok(Math.abs((photoNext.x ?? 0) + photo.w / 2 - mapLocal(40, 40).x) < 1e-6, 'photo center tracks the growing cell');
  assert.ok(Math.abs((photoNext.y ?? 0) - photo.y) < 1e-6, 'photo y stays put on a column divider');

  const ink = {
    x: 20,
    y: 40,
    w: 60,
    h: 0,
    type: 'pen',
    points: [20, 40, 80, 40],
    strokeWidth: 0,
  };
  const inkLen0 = Math.hypot(ink.points[2] - ink.points[0], ink.points[3] - ink.points[1]);
  const inkNext = mapShapeThroughLocalMap(ink, host, host, mapLocal, 1);
  assert.ok(inkNext?.points);
  const inkLen1 = Math.hypot(
    inkNext.points[2] - inkNext.points[0],
    inkNext.points[3] - inkNext.points[1]
  );
  assert.ok(Math.abs(inkLen1 - inkLen0) < 1e-6, 'divider must not stretch pen stroke length');
  assert.ok(Math.abs((inkNext.w ?? 0) - ink.w) < 1e-6, 'divider keeps pen bbox width');
  const inkCx0 = ink.x + ink.w / 2;
  const inkCx1 = (inkNext.x ?? 0) + (inkNext.w ?? ink.w) / 2;
  assert.ok(Math.abs(inkCx1 - mapLocal(inkCx0, 40).x) < 1e-6, 'pen center tracks the growing cell');
}

console.log('transform-test: ok');
