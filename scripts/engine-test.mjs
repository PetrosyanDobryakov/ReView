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
globalThis.Path2D = class {
  constructor() {}
  addPath() {}
};
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

const { Engine, store, settings, displayInk, computeSnap, applyKeybinds, getColorBinds, tableGrid, normalizeTableSizes, shiftTableDivider, tableRiderIds, tableCarries } = await import('./engine-bundle.mjs');

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

// multi-select resizes via the group bbox only — invisible per-member
// handles must not hijack drags (camera: world = screen - (500, 350)).
const gShape = (x, y) =>
  store.addShape({ type: 'rect', x, y, w: 100, h: 100, fill: '#ffffff', stroke: '#7c8cff', strokeWidth: 2 });
const gA = gShape(5000, 5000);
const gB = gShape(5300, 5000);
const gC = gShape(5600, 5000);
engine.setSelection([gA, gB, gC]);
// B 'se' corner world (5400,5100) → screen (5900,5450); nearest group handle 50px away
assert.equal(engine.hitHandle(5900, 5450), null, 'no per-member handle in multi-select');
// group 'se' corner world (5700,5100) → screen (6200,5450)
assert.deepEqual(
  engine.hitHandle(6200, 5450),
  { shapeId: '__group__', handle: 'se' },
  'group handle still works'
);
// drag from the member handle moves the group instead of resizing one member
engine.onPointerDown({ clientX: 5900, clientY: 5450, button: 0, pointerId: 9, shiftKey: false });
engine.onPointerMove({ clientX: 5920, clientY: 5470, button: 0, pointerId: 9, shiftKey: false });
engine.onPointerUp({ clientX: 5920, clientY: 5470, button: 0, pointerId: 9, shiftKey: false });
const gv = store.readShape(store.board.get(gB));
assert.equal(gv.w, 100, 'member width untouched by group drag');
assert.equal(gv.h, 100, 'member height untouched by group drag');
// single select keeps per-member handles (recompute: the drag above moved B)
engine.setSelection([gB]);
const gb = engine.views.get(gB);
assert.deepEqual(
  engine.hitHandle(gb.x + gb.w + 500, gb.y + gb.h + 350),
  { shapeId: gB, handle: 'se' },
  'single-select handle works'
);

// replacing the open text editor requests a commit first (dblclick another sticky)
const stShape = (x) =>
  store.addShape({ type: 'sticky', x, y: 7000, w: 180, h: 120, fill: '#ffe57a', stroke: '#e0b93c', strokeWidth: 2, textColor: '#3a2f00' });
const stA = stShape(7000);
const stB = stShape(7300);
let lastEditTarget = null;
let commitRequests = 0;
const prevOnEditText = engine.events.onEditText;
engine.events.onEditText = (t) => {
  lastEditTarget = t;
};
engine.events.onRequestCommitText = () => {
  commitRequests += 1;
  // host (App) commits whatever is in the editor DOM
  engine.commitText(lastEditTarget.id, 'Сохранённый', lastEditTarget, undefined);
};
engine.openTextEditor(stA);
assert.equal(engine.editing, true, 'editor open on A');
engine.openTextEditor(stB);
assert.equal(commitRequests, 1, 'replacing editor requests a commit');
assert.equal(store.readShape(store.board.get(stA)).text, 'Сохранённый', 'A text survives editor switch');
assert.equal(engine.editId, stB, 'B becomes the edited shape');
engine.events.onEditText = prevOnEditText;
engine.events.onRequestCommitText = undefined;
engine.cancelTextEdit();
// commit persists the edited size onto shapes that predate fontSize
const stC = stShape(7600);
engine.commitText(
  stC,
  'Крупно',
  { id: stC, x: 7600, y: 7000, w: 180, h: 120, text: '', fontSize: 30, color: '#3a2f00', type: 'sticky', centered: false },
  undefined
);
assert.equal(store.readShape(store.board.get(stC)).fontSize, 30, 'commit stores overlay fontSize');

// tables: grid model round-trips through the doc, cell commit + row/col ops work
const tKey = store.addShape({
  type: 'table',
  x: 10,
  y: 20,
  w: 420,
  h: 224,
  fill: '#ffffff',
  stroke: '#6b6b66',
  strokeWidth: 2,
  cols: 3,
  rows: 4,
  cells: ['A1', 'B1'],
  header: true,
});
let tv = store.readShape(store.board.get(tKey));
assert.equal(tv.cols, 3, 'table cols persist');
assert.equal(tv.rows, 4, 'table rows persist');
assert.equal(tv.cells.length, 12, 'cells normalized to cols*rows');
assert.deepEqual(tv.cells.slice(0, 3), ['A1', 'B1', ''], 'cells keep values, pad empty');
assert.equal(tv.fontSize, 14, 'table font default is 14');

let cellTarget = null;
const prevOnEditTable = engine.events.onEditText;
engine.events.onEditText = (t) => {
  cellTarget = t;
};
engine.openTableCellEditor(tKey, 1, 2);
assert.deepEqual(cellTarget?.tableCell, { row: 1, col: 2 }, 'cell editor targets the cell');
assert.equal(cellTarget?.text, '', 'empty cell text');
assert.equal(cellTarget?.w, 140, 'cell rect width = w/cols');
assert.equal(cellTarget?.h, 56, 'cell rect height = h/rows');
engine.commitTableCell(tKey, 1, 2, 'hello');
tv = store.readShape(store.board.get(tKey));
assert.equal(tv.cells[5], 'hello', 'cell commit writes cells[]');
engine.tableInsertRow(tKey);
tv = store.readShape(store.board.get(tKey));
assert.equal(tv.rows, 5, 'row inserted');
assert.equal(tv.cells.length, 15, 'cells grow with rows');
assert.equal(tv.cells[5], 'hello', 'existing rows shift intact');
engine.tableInsertCol(tKey);
tv = store.readShape(store.board.get(tKey));
assert.equal(tv.cols, 4, 'column inserted');
assert.equal(tv.cells.length, 20, 'cells grow with cols');
engine.tableRemoveCol(tKey);
engine.tableRemoveRow(tKey);
tv = store.readShape(store.board.get(tKey));
assert.equal(tv.cols, 3, 'column removed');
assert.equal(tv.rows, 4, 'row removed');
assert.equal(tv.cells[5], 'hello', 'cell survives structural ops');
engine.tableToggleHeader(tKey);
assert.equal(store.readShape(store.board.get(tKey)).header, false, 'header toggles off');
engine.tableToggleHeader(tKey);
assert.notEqual(store.readShape(store.board.get(tKey)).header, false, 'header toggles on');
engine.advanceTableCell(tKey, 0, 2, 'right');
assert.deepEqual(cellTarget?.tableCell, { row: 1, col: 0 }, 'tab wraps to next row');
engine.advanceTableCell(tKey, 3, 0, 'down');
assert.deepEqual(cellTarget?.tableCell, { row: 0, col: 0 }, 'down wraps to first row');
engine.events.onEditText = prevOnEditTable;
engine.cancelTextEdit();

// table column/row fractions: persist, grow on insert, shrink on delete
const approxFracs = (a, b) =>
  a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
const fKey = store.addShape({
  type: 'table', x: 0, y: 0, w: 400, h: 200, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  cols: 2, rows: 2, cells: ['', '', '', ''], colW: [0.6, 0.4], rowH: [0.25, 0.75],
});
let fv = store.readShape(store.board.get(fKey));
assert.deepEqual(fv.colW, [0.6, 0.4], 'col fractions persist');
assert.deepEqual(fv.rowH, [0.25, 0.75], 'row fractions persist');
engine.tableInsertCol(fKey, 1);
fv = store.readShape(store.board.get(fKey));
assert.ok(approxFracs(fv.colW, [240 / 560, 160 / 560, 160 / 560]), 'inserted column grows the table');
assert.equal(fv.w, 560, 'table widens by the donor column');
engine.tableRemoveCol(fKey, 1);
fv = store.readShape(store.board.get(fKey));
assert.ok(approxFracs(fv.colW, [0.6, 0.4]), 'removed column shrinks back');
assert.equal(fv.w, 400, 'table width restored');
engine.tableInsertRow(fKey, 0);
fv = store.readShape(store.board.get(fKey));
assert.ok(approxFracs(fv.rowH, [50 / 250, 50 / 250, 150 / 250]), 'inserted row grows the table');
assert.equal(fv.h, 250, 'table height grows by the donor row');
engine.tableRemoveRow(fKey, 0);
fv = store.readShape(store.board.get(fKey));
assert.ok(approxFracs(fv.rowH, [0.25, 0.75]), 'removed row shrinks back');
assert.equal(fv.h, 200, 'table height restored');

// divider math: neighbor compensates, min fraction holds
assert.ok(approxFracs(shiftTableDivider([0.5, 0.5], 1, 0.1, 0.05), [0.6, 0.4]), 'divider shifts');
assert.ok(approxFracs(shiftTableDivider([0.5, 0.5], 1, 10, 0.1), [0.9, 0.1]), 'divider clamps at min');
assert.ok(approxFracs(shiftTableDivider([0.5, 0.5], 1, -10, 0.1), [0.1, 0.9]), 'divider clamps other way');
assert.deepEqual(shiftTableDivider([0.5, 0.5], 0, 0.1, 0.05), [0.5, 0.5], 'edge index ignored');
assert.deepEqual(normalizeTableSizes(2, [2, 1]), [2 / 3, 1 / 3], 'sizes normalize to sum 1');
assert.deepEqual(normalizeTableSizes(2, [0.5]), [0.5, 0.5], 'bad sizes fall back to uniform');
assert.deepEqual(tableGrid({ cols: 2, rows: 1 }).colW, [0.5, 0.5], 'missing sizes default uniform');

// tray rule: center on the table + not bigger => rides, even hanging off the edge
const tray = { x: 0, y: 0, w: 300, h: 200 };
assert.equal(tableCarries(tray, { x: 10, y: 10, w: 40, h: 30 }), true, 'contained rides');
assert.equal(tableCarries(tray, { x: 250, y: 150, w: 100, h: 100 }), true, 'edge-hanger rides (center inside)');
assert.equal(tableCarries(tray, { x: 500, y: 500, w: 40, h: 30 }), false, 'outsider stays');
assert.equal(tableCarries(tray, { x: 100, y: 50, w: 400, h: 300 }), false, 'bigger-than-table stays');
assert.equal(tableCarries(tray, { x: 100, y: 50, w: 400, h: 300, type: 'pen' }), true, 'big pen mark still rides');
assert.equal(tableCarries(tray, { x: 100, y: 50, w: 400, h: 300, type: 'sticky' }), true, 'big note still rides');
assert.equal(tableCarries(tray, { x: 100, y: 50, w: 400, h: 300, type: 'rect' }), false, 'big sheet stays');

// riders: objects on a table move with it (nested tables cascade)
const hostKey = store.addShape({
  type: 'table', x: 1000, y: 1000, w: 300, h: 200, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  cols: 2, rows: 2, cells: [],
});
const riderKey = store.addShape({ type: 'rect', x: 1050, y: 1050, w: 40, h: 30, fill: '#ffffff', stroke: '#000000', strokeWidth: 2 });
const innerTableKey = store.addShape({
  type: 'table', x: 1200, y: 1100, w: 60, h: 60, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  cols: 1, rows: 1, cells: [],
});
const innerRiderKey = store.addShape({ type: 'ellipse', x: 1210, y: 1110, w: 20, h: 20, fill: '#ffffff', stroke: '#000000', strokeWidth: 2 });
const outsiderKey = store.addShape({ type: 'rect', x: 2000, y: 2000, w: 40, h: 30, fill: '#ffffff', stroke: '#000000', strokeWidth: 2 });
const hostId = hostKey;
const views = [hostKey, riderKey, innerTableKey, innerRiderKey, outsiderKey].map((k) => ({ ...store.readShape(store.board.get(k)), id: k }));
assert.deepEqual(
  tableRiderIds(views, [hostId]).sort(),
  [riderKey, innerTableKey, innerRiderKey].sort(),
  'riders include nested tables and their riders, not outsiders'
);
engine.setSelection([hostKey]);
engine.translateSelection(10, 5);
store.flushPendingPatches();
assert.equal(store.readShape(store.board.get(riderKey)).x, 1060, 'rider follows table (keyboard nudge)');
assert.equal(store.readShape(store.board.get(innerRiderKey)).y, 1115, 'nested rider follows too');
assert.equal(store.readShape(store.board.get(outsiderKey)).x, 2000, 'outsider stays');
assert.equal(store.readShape(store.board.get(hostKey)).x, 1010, 'table itself moves');
engine.setSelection([]);

// divider drag through the real SelectTool pipeline (down/move/up with PointerInfo)
const dKey = store.addShape({
  type: 'table', x: 3000, y: 3000, w: 400, h: 200, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  cols: 2, rows: 2, cells: [],
});
engine.setSelection([dKey]);
const divHit = engine.hitTableDivider(3200, 3100);
assert.deepEqual(
  divHit ? { kind: divHit.kind, index: divHit.index } : null,
  { kind: 'col', index: 1 },
  'divider hit between columns'
);
const selectTool = engine.tools.get('select');
const pinfo = (x, y) => ({ screen: { x, y }, world: { x, y }, shift: false, alt: false });
selectTool.onDown(engine, pinfo(3200, 3100));
selectTool.onMove(engine, pinfo(3260, 3100));
selectTool.onUp(engine, pinfo(3260, 3100));
const dv = store.readShape(store.board.get(dKey));
assert.ok(
  Math.abs(dv.colW[0] - 0.65) < 1e-9 && Math.abs(dv.colW[1] - 0.35) < 1e-9,
  'divider drag resizes columns'
);
assert.equal(dv.x, 3000, 'divider drag does not move the table');
engine.setSelection([]);

// mouse-drag carries riders exactly (sticky + rect on a table)
const mKey = store.addShape({
  type: 'table', x: 30000, y: 30000, w: 300, h: 200, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  cols: 2, rows: 2, cells: [],
});
const stRiderKey = store.addShape({ type: 'sticky', x: 30050, y: 30050, w: 60, h: 40, fill: '#ffe27a', stroke: '#d9b64d', strokeWidth: 2 });
const rcRiderKey = store.addShape({ type: 'rect', x: 30200, y: 30100, w: 50, h: 30, fill: '#ffffff', stroke: '#000000', strokeWidth: 2 });
const mselect = engine.tools.get('select');
// alt = no snapping (snap is orthogonal, riders need exact deltas)
const mpinfo = (x, y) => ({ screen: { x, y }, world: { x, y }, shift: false, alt: true });
mselect.onDown(engine, mpinfo(30150, 30150));
// ponytail: incremental moves like a real drag (a single jump would mask
// riders that only patch on the first move and freeze after)
mselect.onMove(engine, mpinfo(30160, 30160));
mselect.onMove(engine, mpinfo(30170, 30175));
mselect.onMove(engine, mpinfo(30180, 30190));
mselect.onUp(engine, mpinfo(30180, 30190));
assert.equal(store.readShape(store.board.get(mKey)).x, 30030, 'dragged table moves');
assert.equal(store.readShape(store.board.get(mKey)).y, 30040, 'dragged table moves y');
assert.equal(store.readShape(store.board.get(stRiderKey)).x, 30080, 'sticky rider follows drag exactly');
assert.equal(store.readShape(store.board.get(stRiderKey)).y, 30090, 'sticky rider follows drag exactly y');
assert.equal(store.readShape(store.board.get(rcRiderKey)).x, 30230, 'rect rider follows drag exactly');
engine.setSelection([]);

// creating a table drops back to select: no auto-edit, no selection
const tableTool = engine.tools.get('table');
const tpinfo = (x, y) => ({ screen: { x, y }, world: { x, y }, shift: false, alt: true });
const shapeCountBefore = [...store.board.keys()].length;
tableTool.onDown(engine, tpinfo(60000, 60000));
tableTool.onUp(engine, tpinfo(60000, 60000));
assert.equal([...store.board.keys()].length, shapeCountBefore + 1, 'table created on click');
assert.equal(engine.active, 'select', 'back to select after creating a table');
assert.equal(engine.editing, false, 'no cell editor auto-opens');
assert.equal(engine.selection.size, 0, 'new table is not selected');
engine.setSelection([]);

// drawn objects ride too (pen stroke + free arrow fully on the table)
// table is now at (30030,30040); press a free cell, drag +20/+20
const dPenKey = store.addShape({
  type: 'pen', x: 30060, y: 30080, w: 60, h: 40, fill: 'transparent', stroke: '#111111', strokeWidth: 3,
  points: [30065, 30085, 30090, 30100, 30115, 30095],
});
const dArrKey = store.addShape({
  type: 'arrow', x: 30150, y: 30120, w: 80, h: 20, fill: 'transparent', stroke: '#111111', strokeWidth: 3,
  points: [30150, 30130, 30230, 30130],
});
const dselect = engine.tools.get('select');
const dpinfo = (x, y) => ({ screen: { x, y }, world: { x, y }, shift: false, alt: true });
dselect.onDown(engine, dpinfo(30180, 30100));
dselect.onMove(engine, dpinfo(30190, 30110));
dselect.onMove(engine, dpinfo(30200, 30120));
dselect.onUp(engine, dpinfo(30200, 30120));
assert.equal(store.readShape(store.board.get(mKey)).x, 30050, 'table moves under pen riders');
const penView = store.readShape(store.board.get(dPenKey));
assert.equal(penView.x, 30080, 'pen rider follows');
assert.equal(penView.points[0], 30085, 'pen world points shift with the ride');
const arrView = store.readShape(store.board.get(dArrKey));
assert.equal(arrView.x, 30170, 'free arrow rider follows');
engine.setSelection([]);

// eraser: tables + photos survive, single-tap dots die (whole mode)
const eTableKey = store.addShape({
  type: 'table', x: 40000, y: 40000, w: 300, h: 200, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  cols: 2, rows: 2, cells: [],
});
const eImgKey = store.addShape({
  type: 'image', x: 40400, y: 40000, w: 120, h: 90, fill: 'transparent', stroke: 'transparent', strokeWidth: 0,
  src: 'data:image/png;base64,x',
});
const eDotKey = store.addShape({
  type: 'pen', x: 40200, y: 40200, w: 8, h: 8, fill: 'transparent', stroke: '#111111', strokeWidth: 3,
  points: [40204, 40204],
});
const eraser = engine.tools.get('eraser');
const epinfo = (x, y) => ({ screen: { x, y }, world: { x, y }, shift: false, alt: true });
const prevEraserSize = settings.eraser.size;
settings.eraser.size = 32;
eraser.onDown(engine, epinfo(40204, 40204));
eraser.onUp(engine, epinfo(40204, 40204));
assert.equal(store.board.has(eDotKey), false, 'single-tap dot erased in whole mode');
// brush radius counts, not stroke-width precision: 20px away still erases…
const eDot3Key = store.addShape({
  type: 'pen', x: 40300, y: 40300, w: 8, h: 8, fill: 'transparent', stroke: '#111111', strokeWidth: 3,
  points: [40304, 40304],
});
eraser.onDown(engine, epinfo(40324, 40304));
eraser.onUp(engine, epinfo(40324, 40304));
assert.equal(store.board.has(eDot3Key), false, 'dot erased by nearby brush pass');
// …but far passes spare it
const eDot4Key = store.addShape({
  type: 'pen', x: 40400, y: 40400, w: 8, h: 8, fill: 'transparent', stroke: '#111111', strokeWidth: 3,
  points: [40404, 40404],
});
eraser.onDown(engine, epinfo(40500, 40404));
eraser.onUp(engine, epinfo(40500, 40404));
assert.equal(store.board.has(eDot4Key), true, 'dot survives a far brush pass');
store.removeShapes([eDot4Key]);
settings.eraser.size = prevEraserSize;
eraser.onDown(engine, epinfo(40100, 40100));
eraser.onUp(engine, epinfo(40100, 40100));
assert.equal(store.board.has(eTableKey), true, 'table survives the eraser');
eraser.onDown(engine, epinfo(40460, 40045));
eraser.onUp(engine, epinfo(40460, 40045));
assert.equal(store.board.has(eImgKey), true, 'photo survives the eraser');
// same protection in partial mode (+ dots still die there)
const prevEraserMode = settings.eraser.mode;
settings.eraser.mode = 'partial';
const eDot2Key = store.addShape({
  type: 'pen', x: 40250, y: 40250, w: 8, h: 8, fill: 'transparent', stroke: '#111111', strokeWidth: 3,
  points: [40254, 40254],
});
eraser.onDown(engine, epinfo(40254, 40254));
eraser.onUp(engine, epinfo(40254, 40254));
assert.equal(store.board.has(eDot2Key), false, 'dot erased in partial mode');
eraser.onDown(engine, epinfo(40100, 40100));
eraser.onUp(engine, epinfo(40100, 40100));
assert.equal(store.board.has(eTableKey), true, 'table survives the eraser in partial mode');
eraser.onDown(engine, epinfo(40460, 40045));
eraser.onUp(engine, epinfo(40460, 40045));
assert.equal(store.board.has(eImgKey), true, 'photo survives the eraser in partial mode');
settings.eraser.mode = prevEraserMode;

// tiny brush (6px) opens a precise gap in partial mode
const prevSize = settings.eraser.size;
settings.eraser.size = 6;
settings.eraser.mode = 'partial';
const eStrokeKey = store.addShape({
  type: 'pen', x: 51000, y: 51000, w: 120, h: 4, fill: 'transparent', stroke: '#111111', strokeWidth: 3,
  points: [51000, 51000, 51060, 51000, 51120, 51000],
});
eraser.onDown(engine, epinfo(51030, 51000));
eraser.onUp(engine, epinfo(51030, 51000));
const cut = store.readShape(store.board.get(eStrokeKey));
assert.deepEqual(cut.points, [51120, 51000], '6px brush removes only the touched segment');
eraser.onDown(engine, epinfo(51120, 51000));
eraser.onUp(engine, epinfo(51120, 51000));
assert.equal(store.board.has(eStrokeKey), false, 'last vertex cleaned up by the tiny brush');
settings.eraser.size = prevSize;
settings.eraser.mode = prevEraserMode;

// away peers (viewing=false: alt-tab, home, minimized) must not paint a frozen cursor
const peerBase = (id, userId, name, x, viewing) => ({
  id,
  userId,
  name,
  color: '#ff0000',
  publishedName: name,
  publishedColor: '#ff0000',
  overridden: false,
  x,
  y: 150,
  tool: 'select',
  page: null,
  viewing,
  draft: null,
  erasePreview: null,
});
engine.setPeers([
  peerBase(101, 'u-view', 'Viewer', 200, true),
  peerBase(102, 'u-away', 'Away', 300, false),
  peerBase(103, 'u-legacy', 'Legacy', 400, undefined),
]);
const paintedLabels = [];
const recCtx = new Proxy(
  {},
  {
    get: (_t, p) => {
      if (p === 'fillText') return (text) => { paintedLabels.push(String(text)); };
      if (p === 'measureText') return () => ({ width: 10 });
      return () => undefined;
    },
    set: () => true,
  }
);
engine.drawPeers(recCtx);
assert.deepEqual(
  paintedLabels.sort(),
  ['Legacy', 'Viewer'],
  'only viewing peers paint cursors (away hidden, legacy shown)'
);

console.log('engine-move-test: all checks passed');
process.exit(0);
