import assert from 'node:assert/strict';

globalThis.window = {
  devicePixelRatio: 1,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
const fakeReq = {
  onupgradeneeded: null,
  onsuccess: null,
  onerror: null,
  onblocked: null,
  result: null,
  error: null,
  addEventListener() {},
};
globalThis.indexedDB = { open: () => fakeReq };

const ctxProxy = new Proxy(
  {},
  {
    get: (_t, p) => {
      if (p === 'measureText') return () => ({ width: 10 });
      return () => undefined;
    },
    set: () => true,
  }
);

const canvas = {
  style: {},
  width: 0,
  height: 0,
  addEventListener() {},
  removeEventListener() {},
  setPointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
  getContext: () => ctxProxy,
};

const { Engine, store, settings, displayInk, computeSnap, applyKeybinds, getColorBinds } = await import('./engine-bundle.mjs');

const engine = new Engine(canvas);
assert.equal(engine.tool.id, 'select', 'default tool is select');

const id = store.addShape({
  type: 'rect',
  x: 100,
  y: 100,
  w: 120,
  h: 80,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});

const down = { clientX: 650, clientY: 490, button: 0, pointerId: 1, shiftKey: false };
const move = { clientX: 700, clientY: 530, button: 0, pointerId: 1, shiftKey: false };
const up = { ...move };

engine.onPointerDown(down);
assert.equal(engine.selection.has(id), true, 'click selects the shape');
assert.equal(engine.tool.id, 'select', 'select tool active');

engine.onPointerMove(move);
const v1 = store.readShape(store.board.get(id));
assert.equal(v1.x, 150, 'shape x moved from 100 to 150');
assert.equal(v1.y, 140, 'shape y moved from 100 to 140');
assert.equal(engine.views.get(id).x, 150, 'engine views updated by observer');
assert.equal(engine.views.get(id).y, 140, 'engine views y updated');
assert.equal(engine.grid.query({ x: 150, y: 140, w: 10, h: 10 }).has(id), true, 'grid has shape at new position');

engine.onPointerUp(up);
const v2 = store.readShape(store.board.get(id));
assert.equal(v2.x, 150, 'shape stays after release');
assert.equal(v2.y, 140, 'shape stays after release');

const penId = store.addShape({
  type: 'pen',
  x: 0,
  y: 0,
  w: 50,
  h: 50,
  fill: 'transparent',
  stroke: '#f2f5ff',
  strokeWidth: 3,
  points: [10, 10, 30, 40, 50, 10],
});

store.patchShape(id, { x: 999 });
store.flushPendingPatches();
assert.equal(engine.views.get(id).x, 999, 'views updated after direct patch');
engine.onPointerDown({ clientX: 510, clientY: 360, button: 0, pointerId: 2, shiftKey: false });
assert.equal(engine.selection.has(penId), true, 'pen line hit by its stroke');
engine.onPointerMove({ clientX: 560, clientY: 410, button: 0, pointerId: 2, shiftKey: false });
engine.onPointerUp({ clientX: 560, clientY: 410, button: 0, pointerId: 2, shiftKey: false });
const pv = store.readShape(store.board.get(penId));
assert.equal(pv.x, 50, 'pen moved x');
assert.equal(pv.points[0], 60, 'pen points moved x');
assert.equal(pv.points[1], 60, 'pen points moved y');
const rawPenPts = store.board.get(penId).get('points').toArray();
assert.deepEqual(rawPenPts, [10, 10, 30, 40, 50, 10], 'stored points stay local after translate');

engine.setTool('eraser');
assert.equal(engine.tool.id, 'eraser', 'eraser tool active');
const e1 = store.addShape({
  type: 'rect',
  x: 200,
  y: 200,
  w: 80,
  h: 60,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const e2 = store.addShape({
  type: 'rect',
  x: 400,
  y: 200,
  w: 80,
  h: 60,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
engine.onPointerDown({ clientX: 720, clientY: 570, button: 0, pointerId: 9, shiftKey: false });
engine.onPointerMove({ clientX: 725, clientY: 575, button: 0, pointerId: 9, shiftKey: false });
engine.onPointerUp({ clientX: 725, clientY: 575, button: 0, pointerId: 9, shiftKey: false });
assert.equal(store.board.has(e1), false, 'eraser removes touched shape');
assert.equal(store.board.has(e2), true, 'eraser keeps untouched shape');
assert.equal(engine.erasing.size, 0, 'erasing set cleared after commit');

settings.eraser.mode = 'partial';
const pensBefore = [...store.board].filter(([, m]) => m.get('type') === 'pen').length;
const p1 = store.addShape({
  type: 'pen',
  x: 280,
  y: 280,
  w: 120,
  h: 40,
  fill: 'transparent',
  stroke: '#f2f5ff',
  strokeWidth: 3,
  points: [300, 300, 310, 300, 320, 300, 340, 300, 360, 300, 370, 300, 380, 300],
});
settings.eraser.size = 16;
engine.onPointerDown({ clientX: 840, clientY: 650, button: 0, pointerId: 10, shiftKey: false });
engine.onPointerMove({ clientX: 842, clientY: 652, button: 0, pointerId: 10, shiftKey: false });
engine.onPointerUp({ clientX: 842, clientY: 652, button: 0, pointerId: 10, shiftKey: false });
const p1after = store.readShape(store.board.get(p1));
assert.ok(p1after, 'partial erase keeps original shape');
assert.equal(p1after.points.length, 4, 'original stroke cut to 2 points');
let penCount = 0;
for (const [, m] of store.board) {
  if (m.get('type') === 'pen') penCount++;
}
assert.equal(penCount, pensBefore + 2, 'stroke split into two pen shapes');
assert.equal(engine.partialErase.size, 0, 'partial preview cleared after commit');
settings.eraser.mode = 'whole';
settings.eraser.size = 32;

engine.setTool('select');
store.patchShape(e2, { locked: true });
engine.setSelection([e2]);
engine.onPointerDown({ clientX: 940, clientY: 580, button: 0, pointerId: 11, shiftKey: false });
engine.onPointerMove({ clientX: 960, clientY: 600, button: 0, pointerId: 11, shiftKey: false });
engine.onPointerUp({ clientX: 960, clientY: 600, button: 0, pointerId: 11, shiftKey: false });
assert.equal(store.readShape(store.board.get(e2)).x, 400, 'locked shape does not move');

store.patchShape(e2, { locked: false });
engine.setSelection([e2]);
engine.onPointerDown({ clientX: 940, clientY: 580, button: 0, pointerId: 12, shiftKey: false });
engine.onPointerMove({ clientX: 960, clientY: 600, button: 0, pointerId: 12, shiftKey: false });
engine.onPointerUp({ clientX: 960, clientY: 600, button: 0, pointerId: 12, shiftKey: false });
assert.equal(store.readShape(store.board.get(e2)).x, 420, 'unlocked shape moves');

const zA = store.addShape({
  type: 'rect',
  x: 500,
  y: 500,
  w: 60,
  h: 40,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const zB = store.addShape({
  type: 'rect',
  x: 600,
  y: 500,
  w: 60,
  h: 40,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
engine.setSelection([zA]);
engine.bringFront();
assert.equal(store.order.get(store.order.length - 1), zA, 'bringFront moves shape to top');
engine.setSelection([zB]);
engine.sendBack();
assert.equal(store.order.get(0), zB, 'sendBack moves shape to bottom');

// real pen stroke via tool (zigzag so shape recognition does not snap it)
engine.setTool('pen');
const pensBeforeDraw = [...store.board].filter(([, m]) => m.get('type') === 'pen').length;
engine.onPointerDown({ clientX: 600, clientY: 400, button: 0, pointerId: 20, shiftKey: false });
engine.onPointerMove({ clientX: 620, clientY: 450, button: 0, pointerId: 20, shiftKey: false });
engine.onPointerMove({ clientX: 640, clientY: 390, button: 0, pointerId: 20, shiftKey: false });
engine.onPointerMove({ clientX: 660, clientY: 460, button: 0, pointerId: 20, shiftKey: false });
engine.onPointerUp({ clientX: 660, clientY: 460, button: 0, pointerId: 20, shiftKey: false });
const pensAfterDraw = [...store.board].filter(([, m]) => m.get('type') === 'pen');
assert.equal(pensAfterDraw.length, pensBeforeDraw + 1, 'pen tool creates a stroke');
const newPen = pensAfterDraw[pensAfterDraw.length - 1][1];
const pts = newPen.get('points').toArray();
assert.equal(pts.length, 8, 'stroke keeps multiple points');
assert.equal(newPen.get('strokeWidth'), 3, 'stroke uses pen width');
const penWorld = store.readShape(newPen);
assert.ok(penWorld.points && penWorld.points.length === 8, 'readShape expands local→world');

// shift straight line
const penCountBeforeShift = [...store.board].filter(([, m]) => m.get('type') === 'pen').length;
engine.onPointerDown({ clientX: 600, clientY: 500, button: 0, pointerId: 21, shiftKey: true });
engine.onPointerMove({ clientX: 700, clientY: 500, button: 0, pointerId: 21, shiftKey: true });
engine.onPointerUp({ clientX: 700, clientY: 500, button: 0, pointerId: 21, shiftKey: true });
const pensAfterShift = [...store.board].filter(([, m]) => m.get('type') === 'pen');
assert.equal(pensAfterShift.length, penCountBeforeShift + 1, 'shift stroke created');
const shiftPen = pensAfterShift[pensAfterShift.length - 1][1];
const shiftWorld = store.readShape(shiftPen);
assert.equal(shiftWorld.points?.length, 4, 'shift stroke is a 2-point straight line');
assert.equal(shiftWorld.points?.[2], 200, 'shift stroke ends at release point');

engine.setTool('select');
const addA = store.addShape({
  type: 'rect',
  x: -200,
  y: -200,
  w: 40,
  h: 40,
  fill: '#ffffff',
  stroke: '#6b6b66',
  strokeWidth: 2,
});
const addB = store.addShape({
  type: 'rect',
  x: -100,
  y: -200,
  w: 40,
  h: 40,
  fill: '#ffffff',
  stroke: '#6b6b66',
  strokeWidth: 2,
});
engine.setSelection([addA]);
engine.onPointerDown({ clientX: 420, clientY: 170, button: 0, pointerId: 40, shiftKey: true });
engine.onPointerUp({ clientX: 420, clientY: 170, button: 0, pointerId: 40, shiftKey: true });
assert.equal(engine.selection.has(addA), true, 'shift-click keeps first shape');
assert.equal(engine.selection.has(addB), true, 'shift-click adds second shape');

const lockedDel = store.addShape({
  type: 'rect',
  x: 800,
  y: 800,
  w: 40,
  h: 40,
  fill: '#ffffff',
  stroke: '#6b6b66',
  strokeWidth: 2,
});
store.patchShape(lockedDel, { locked: true });
engine.setSelection([lockedDel]);
engine.deleteSelection();
assert.equal(store.board.has(lockedDel), true, 'locked shape is not deleted');

engine.setTool('rect');
const stayId = store.addShape({
  type: 'rect',
  x: 50,
  y: 50,
  w: 80,
  h: 60,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const nBeforeRect = store.board.size;
engine.onPointerDown({ clientX: 590, clientY: 430, button: 0, pointerId: 50, shiftKey: false });
engine.onPointerMove({ clientX: 640, clientY: 480, button: 0, pointerId: 50, shiftKey: false });
engine.onPointerUp({ clientX: 640, clientY: 480, button: 0, pointerId: 50, shiftKey: false });
assert.equal(store.readShape(store.board.get(stayId)).x, 50, 'rect tool does not drag existing shape');
assert.equal(store.board.size, nBeforeRect + 1, 'rect tool creates a new shape instead of selecting');
engine.setTool('select');

engine.camera.tx = 50000;
engine.camera.ty = 50000;
engine.camera.tz = 1;
engine.camera.clampCenter({ x: 0, y: 0, w: 200, h: 200 }, 1000, 700);
assert.ok(engine.camera.tx <= 800, 'tight camera clamp stays near records (x)');
assert.ok(engine.camera.ty <= 800, 'tight camera clamp stays near records (y)');

assert.equal(displayInk('#1c1c1a', '#1c1c1a'), '#eceae4', 'adapt black ink on dark paper');
assert.equal(displayInk('#e03131', '#1c1c1a'), '#e03131', 'adapt leaves colored ink on dark paper');
assert.equal(displayInk('#ffffff', '#f4f4f5'), '#1c1c1a', 'adapt white ink on light paper');
assert.equal(displayInk('#e03131', '#f4f4f5'), '#e03131', 'adapt leaves colored ink on light paper');

const snap = computeSnap(
  { x: 10, y: 100, w: 50, h: 20 },
  [{ x: 100, y: 100, w: 50, h: 20 }],
  8
);
const hGuide = snap.guides.find((g) => g.orientation === 'h');
assert.ok(hGuide, 'horizontal snap guide exists');
assert.equal(hGuide.pos, 100, 'h guide pos is the shared y');
assert.ok(hGuide.a0 < 50, 'h guide a0 is x extent, not y (was drawing a broken top line)');

applyKeybinds({
  tools: {},
  colors: { '#ff6b6b': 'Digit3', '0': 'Digit9' },
});
const colorBinds = getColorBinds();
assert.equal(colorBinds['0'], 'Digit1', 'legacy hex color binds reset to slot defaults');
assert.equal(colorBinds['#ff6b6b'], undefined, 'legacy hex color bind keys are dropped');

console.log('engine-move-test: all checks passed');
process.exit(0);
