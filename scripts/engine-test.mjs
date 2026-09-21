import assert from 'node:assert/strict';

const windowListeners = new Map();
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener(type, fn) {
    const list = windowListeners.get(type) ?? [];
    list.push(fn);
    windowListeners.set(type, list);
  },
  removeEventListener(type, fn) {
    const list = windowListeners.get(type);
    if (!list) return;
    windowListeners.set(type, list.filter((f) => f !== fn));
  },
  dispatchEvent(ev) {
    for (const fn of windowListeners.get(ev.type) ?? []) fn.call(globalThis.window, ev);
    return true;
  },
};
globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3, COMMENT_NODE: 8, DOCUMENT_NODE: 9 };
const documentListeners = new Map();
globalThis.document = {
  documentElement: { dataset: {} },
  createElement: () => ({ src: '', onload: null, onerror: null }),
  querySelector: () => null,
  head: { appendChild() {} },
  addEventListener(type, fn) {
    const list = documentListeners.get(type) ?? [];
    list.push(fn);
    documentListeners.set(type, list);
  },
  removeEventListener(type, fn) {
    const list = documentListeners.get(type);
    if (!list) return;
    documentListeners.set(type, list.filter((f) => f !== fn));
  },
  visibilityState: 'visible',
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

const { Engine, store, settings, displayInk, computeSnap, alignViews, visualBox, applyKeybinds, getColorBinds, getToolBinds, tableGrid, normalizeTableSizes, shiftTableDivider, tableRiderIds, tableCarries, splitStrokeByErasedIndices, shapesToSvg, jpegToPdf, defaultFontSizeFor, cropFractions, uncroppedBox, restoreUncroppedBox, describeArrow, renderFormula, isFormulaCached, shapesFromClipboardText, worldPortDir, connectedArrowGeometry, tableCellAt, containedInShape, hostRiderIds, stackOrderIndex, localToWorld, rotateShapeAround, arrowHeadLength, mapAlongTableFractions, tableAxisIndex, textOverlayPaddingCss, textOverlayWidthPx, textOverlayLineHeight, LABEL_LINE_HEIGHT, TEXT_LINE_HEIGHT, TABLE_CELL_PAD_X, STICKY_TEXT_PAD, shapeLabelInnerWidth, FRAME_LABEL_PAD_X, frameHeaderHeight, frameTitleLine, tableCellStyle, labelInk, overlayDisplayColor, SHAPE_FONT, TABLE_PILL_OUT, TABLE_PILL_R, TABLE_PILL_SPLIT, TEXT_TOOL_WRAP_W, reanchorCroppedBox, penStrokeWidthForSize, textOverlayAllowsRich, flushOpenTextEditor, persistOpenEditors, ORBIT_PAPER, isWriteGestureActive, closeWriteGate, exportDownloadEnabled, cssBackgroundIsHighlight, measureStyleFromSpans, htmlToSpans, spansToPlain, pointInShape, docPageIndex, docPageStep, graphBlurCancels, graphChromeKind, overlayKeepEdit, overlayCommitEdit, overlayFinishNow, require2dContext, zoomedPortalPosition, arrowBounds, arrowHitPolyline, arrowGeomCacheSizeForTest, clearArrowGeomCacheForTest, wrapText: wrapTextLines, wrapTextCacheSizeForTest, clearWrapTextCacheForTest, setPaintZoom } = await import('./engine-bundle.mjs');

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
assert.equal(tableAxisIndex([0.5, 0.5], 0.25), 0, 'left half is column 0');
assert.equal(tableAxisIndex([0.5, 0.5], 0.75), 1, 'right half is column 1');
assert.ok(Math.abs(mapAlongTableFractions([0.5, 0.5], [0.6, 0.4], 0.25) - 0.3) < 1e-9, 'divider maps inside the growing cell');
assert.ok(Math.abs(mapAlongTableFractions([0.5, 0.5], [0.6, 0.4], 0.75) - 0.8) < 1e-9, 'divider maps inside the shrinking cell');

// tray rule: center on the table + not bigger => rides, even hanging off the edge
const tray = { x: 0, y: 0, w: 300, h: 200 };
assert.equal(tableCarries(tray, { x: 10, y: 10, w: 40, h: 30 }), true, 'contained rides');
assert.equal(tableCarries(tray, { x: 250, y: 150, w: 100, h: 100 }), true, 'edge-hanger rides (center inside)');
assert.equal(tableCarries(tray, { x: 500, y: 500, w: 40, h: 30 }), false, 'outsider stays');
assert.equal(tableCarries(tray, { x: 100, y: 50, w: 400, h: 300 }), false, 'bigger-than-table stays');
assert.equal(tableCarries(tray, { x: 100, y: 50, w: 400, h: 300, type: 'pen' }), true, 'big pen mark still rides');
assert.equal(tableCarries(tray, { x: 100, y: 50, w: 400, h: 300, type: 'sticky' }), true, 'big note still rides');
assert.equal(tableCarries(tray, { x: 100, y: 50, w: 400, h: 300, type: 'rect' }), false, 'big sheet stays');
assert.equal(
  tableCarries(tray, { x: 10, y: 10, w: 80, h: 20, type: 'arrow' }),
  true,
  'free arrow rides the tray'
);
assert.equal(
  tableCarries(tray, { x: 10, y: 10, w: 80, h: 20, type: 'arrow', fromId: 'a', toId: 'b' }),
  false,
  'connected arrow does not ride the tray'
);
assert.equal(textOverlayPaddingCss({ type: 'sticky' }, 1), `${STICKY_TEXT_PAD}px`, 'sticky overlay pad matches canvas at zoom 1');
assert.equal(
  textOverlayPaddingCss({ type: 'sticky' }, 2),
  `${STICKY_TEXT_PAD * 2}px`,
  'sticky overlay pad scales with zoom'
);
assert.equal(
  textOverlayPaddingCss({ type: 'table' }, 1),
  `8px ${TABLE_CELL_PAD_X}px`,
  'table overlay pad matches canvas cell insets'
);
assert.equal(
  textOverlayPaddingCss({ type: 'table' }, 2),
  `16px ${TABLE_CELL_PAD_X * 2}px`,
  'table overlay pad scales with zoom'
);
assert.equal(textOverlayPaddingCss({ type: 'rect', centered: true }, 2), '0 16px', 'flowchart overlay side pad scales with zoom');
assert.equal(shapeLabelInnerWidth('diamond', 200), 110, 'diamond label wraps at 55% of width');
assert.equal(shapeLabelInnerWidth('triangle', 200), 120, 'triangle label wraps at 60% of width');
assert.equal(
  textOverlayPaddingCss({ type: 'diamond', centered: true, w: 200 }, 1),
  '0 45px',
  'diamond overlay inset matches canvas wrap width'
);
assert.equal(
  textOverlayPaddingCss({ type: 'diamond', centered: true, w: 200 }, 2),
  '0 90px',
  'diamond overlay inset scales with zoom'
);
assert.equal(
  textOverlayPaddingCss({ type: 'triangle', centered: true, w: 200 }, 1),
  '0 40px',
  'triangle overlay inset matches canvas wrap width'
);
assert.equal(
  textOverlayPaddingCss({ type: 'frame', centered: true, w: 200 }, 1),
  `0 ${FRAME_LABEL_PAD_X}px`,
  'frame overlay side pad matches the header title inset'
);
assert.equal(
  textOverlayPaddingCss({ type: 'frame', centered: true, w: 200 }, 2),
  `0 ${FRAME_LABEL_PAD_X * 2}px`,
  'frame overlay side pad scales with zoom'
);
assert.equal(frameHeaderHeight(200), 28, 'tall frames cap the title bar at 28px');
assert.equal(frameHeaderHeight(50), 11, 'short frames scale the title bar to 22% of height');
assert.equal(
  textOverlayPaddingCss({ type: 'text', highlight: true }, 2),
  '0',
  'highlighted text wraps at the canvas box; the marker is an outset, not overlay inset'
);
assert.equal(textOverlayWidthPx({ w: 80 }, 1), 80, 'text overlay width tracks the shape, not a 120px floor');
assert.equal(textOverlayWidthPx({ w: 80 }, 2), 160, 'text overlay width scales with zoom');
assert.equal(textOverlayWidthPx({ centered: true, w: 10 }, 1), 20, 'centered overlay keeps a 20px floor');
assert.equal(textOverlayLineHeight('sticky'), LABEL_LINE_HEIGHT, 'sticky overlay line box matches canvas');
assert.equal(textOverlayLineHeight('diamond'), LABEL_LINE_HEIGHT, 'flowchart overlay line box matches canvas');
assert.equal(textOverlayLineHeight('text'), TEXT_LINE_HEIGHT, 'free-text overlay line box matches canvas');
assert.equal(textOverlayLineHeight('table'), TEXT_LINE_HEIGHT, 'table overlay line box matches canvas');
assert.equal(frameTitleLine('Hello\nWorld'), 'Hello', 'frame titles keep the first line only');
assert.equal(defaultFontSizeFor('frame'), SHAPE_FONT, 'frame overlay uses the labelled-shape size');
assert.equal(tableCellStyle({ bold: false, italic: true, textAlign: 'center' }, 0, true).bold, true, 'header row is bold');
assert.equal(tableCellStyle({ bold: false, italic: true, textAlign: 'center' }, 0, true).italic, true, 'table italic reaches header cells');
assert.equal(tableCellStyle({ bold: false, italic: true, textAlign: 'center' }, 0, true).textAlign, 'center', 'table align reaches cell overlay');
assert.equal(tableCellStyle({ bold: false }, 1, true).bold, false, 'body cells are not forced bold');

let frameEdit = null;
const prevFrameEdit = engine.events.onEditText;
engine.events.onEditText = (t) => {
  frameEdit = t;
};
const frKey = store.addShape({
  type: 'frame',
  x: 140000,
  y: 140000,
  w: 240,
  h: 160,
  fill: 'rgba(255,255,255,0.06)',
  stroke: '#7c8cff',
  strokeWidth: 2,
  text: 'Title\nSecond',
});
engine.openTextEditor(frKey);
assert.equal(frameEdit?.fontSize, SHAPE_FONT, 'frame overlay font matches the canvas title');
assert.equal(frameEdit?.h, frameHeaderHeight(160), 'frame overlay covers the header bar, not the whole frame');
assert.equal(frameEdit?.text, 'Title', 'frame overlay does not show leftover newlines');
engine.commitText(frKey, 'One\nTwo', frameEdit);
assert.equal(store.readShape(store.board.get(frKey)).text, 'One', 'commit stores a single frame line');
const frSvg = shapesToSvg(
  [{ ...store.readShape(store.board.get(frKey)), id: frKey, type: 'frame' }],
  { background: '#242422' }
);
assert.equal((frSvg.svg.match(/font-size="16"/g) || []).length > 0, true, 'SVG frame title uses stored font size');
assert.equal(frSvg.svg.includes('Two'), false, 'SVG frame title drops extra lines');
assert.equal(frSvg.svg.includes('One'), true, 'SVG frame title keeps the first line');
engine.events.onEditText = prevFrameEdit;
engine.cancelTextEdit();

const hdrTbl = store.addShape({
  type: 'table',
  x: 141000,
  y: 141000,
  w: 280,
  h: 112,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  cols: 2,
  rows: 2,
  cells: ['Head', 'B', 'C', 'D'],
  header: true,
  italic: true,
  textAlign: 'center',
});
let hdrEdit = null;
engine.events.onEditText = (t) => {
  hdrEdit = t;
};
engine.openTableCellEditor(hdrTbl, 0, 0);
assert.equal(hdrEdit?.bold, true, 'header cell overlay starts bold like the canvas');
assert.equal(hdrEdit?.italic, true, 'header cell overlay keeps table italic');
assert.equal(hdrEdit?.textAlign, 'center', 'header cell overlay keeps table align');
engine.openTableCellEditor(hdrTbl, 1, 0);
assert.equal(hdrEdit?.bold, false, 'body cell overlay is not forced bold');
assert.equal(hdrEdit?.italic, true, 'body cell overlay keeps table italic');
engine.events.onEditText = prevFrameEdit;
engine.cancelTextEdit();

const darkRect = store.addShape({
  type: 'rect',
  x: 142000,
  y: 142000,
  w: 120,
  h: 80,
  fill: '#1c1c1a',
  stroke: '#7c8cff',
  strokeWidth: 2,
  textColor: '#1c1c1a',
  text: 'Hi',
});
const darkView = engine.views.get(darkRect);
assert.equal(
  overlayDisplayColor({ type: 'rect', color: '#1c1c1a' }, darkView, '#f4f4f5'),
  labelInk(darkView, '#1c1c1a', '#f4f4f5'),
  'flowchart overlay ink matches canvas on a dark fill'
);

engine.setTool('select');
engine.setSelection([hdrTbl]);
const plusV = engine.views.get(hdrTbl);
const pillS = 1 / engine.camera.zoom;
assert.ok(
  TABLE_PILL_SPLIT * 2 > TABLE_PILL_R * 2 + 8,
  'add and remove pills do not share a hit disk (slop is 4px each)'
);
const addWorld = localToWorld(plusV, plusV.w + TABLE_PILL_OUT * pillS, plusV.h / 2 - TABLE_PILL_SPLIT * pillS);
const delWorld = localToWorld(plusV, plusV.w + TABLE_PILL_OUT * pillS, plusV.h / 2 + TABLE_PILL_SPLIT * pillS);
assert.equal(engine.hitTablePlus(addWorld.x, addWorld.y)?.kind, 'col', 'upper-right pill is add-column');
assert.equal(engine.hitTablePlus(delWorld.x, delWorld.y)?.kind, 'delCol', 'lower-right pill is remove-column');
const eastPortWorld = { x: plusV.x + plusV.w + 18 * pillS, y: plusV.y + plusV.h / 2 };
assert.equal(
  engine.hitTablePlus(eastPortWorld.x, eastPortWorld.y),
  null,
  'east connect port is not a table pill'
);
assert.equal(
  engine.hitTablePlus(eastPortWorld.x, eastPortWorld.y + 4 * pillS),
  null,
  'a few px below the east port is not remove-column'
);
const plusScr = engine.worldToScreen(addWorld.x, addWorld.y);
engine.tool.onHover(engine, { screen: plusScr, world: addWorld, shift: false });
assert.equal(canvas.style.cursor, 'pointer', 'hover on [+] is pointer, not connect-port crosshair');
engine.onPointerDown({ clientX: plusScr.x, clientY: plusScr.y, button: 0, pointerId: 90, shiftKey: false, altKey: false });
assert.equal(engine.views.get(hdrTbl).cols, 3, 'table [+] adds a column on pointer down');
engine.onPointerMove({ clientX: plusScr.x + 400, clientY: plusScr.y + 300, button: 0, pointerId: 90, shiftKey: false, altKey: false });
engine.onPointerUp({ clientX: plusScr.x + 400, clientY: plusScr.y + 300, button: 0, pointerId: 90, shiftKey: false, altKey: false });
assert.equal(engine.selection.has(hdrTbl), true, 'table [+] click does not start a select gesture');
assert.equal(engine.views.get(hdrTbl).cols, 3, 'table [+] pointer-up does not insert a second column');
const plusVAfter = engine.views.get(hdrTbl);
const delWorldAfter = localToWorld(
  plusVAfter,
  plusVAfter.w + TABLE_PILL_OUT * pillS,
  plusVAfter.h / 2 + TABLE_PILL_SPLIT * pillS
);
assert.equal(engine.hitTablePlus(delWorldAfter.x, delWorldAfter.y)?.kind, 'delCol', 'remove-column pill follows the grown table');
const delScr = engine.worldToScreen(delWorldAfter.x, delWorldAfter.y);
engine.onPointerDown({ clientX: delScr.x, clientY: delScr.y, button: 0, pointerId: 91, shiftKey: false, altKey: false });
assert.equal(engine.views.get(hdrTbl).cols, 2, 'table [−] removes a column on pointer down');
engine.onPointerUp({ clientX: delScr.x, clientY: delScr.y, button: 0, pointerId: 91, shiftKey: false, altKey: false });
engine.setSelection([hdrTbl]);
engine.openTableCellEditor(hdrTbl, 0, 0);
const prevPillCommit = engine.events.onRequestCommitText;
engine.events.onRequestCommitText = () => engine.cancelTextEdit();
const editPlusV = engine.views.get(hdrTbl);
const editAdd = localToWorld(
  editPlusV,
  editPlusV.w + TABLE_PILL_OUT * pillS,
  editPlusV.h / 2 - TABLE_PILL_SPLIT * pillS
);
assert.equal(engine.hitTablePlus(editAdd.x, editAdd.y)?.kind, 'col', 'add-column pill still hits while a cell overlay is open');
const editAddScr = engine.worldToScreen(editAdd.x, editAdd.y);
engine.onPointerDown({ clientX: editAddScr.x, clientY: editAddScr.y, button: 0, pointerId: 92, shiftKey: false, altKey: false });
assert.equal(engine.views.get(hdrTbl).cols, 3, 'table [+] while a cell is open still adds a column');
assert.equal(engine.editing, false, 'table [+] commits the cell overlay');
engine.onPointerUp({ clientX: editAddScr.x, clientY: editAddScr.y, button: 0, pointerId: 92, shiftKey: false, altKey: false });
engine.events.onRequestCommitText = prevPillCommit;
engine.setSelection([]);
engine.cancelTextEdit();

const rotTable = { x: 0, y: 50, w: 100, h: 20, rotation: 90, type: 'table' };
assert.equal(
  tableCarries(rotTable, { x: 45, y: 55, w: 10, h: 10, type: 'rect' }),
  true,
  'shape whose center is on the rotated table still rides'
);
assert.equal(
  tableCarries(rotTable, { x: 80, y: 55, w: 10, h: 10, type: 'rect' }),
  false,
  'shape beside a 90° table does not ride the unrotated AABB'
);

const cellTable = { x: 0, y: 0, w: 200, h: 100, cols: 2, rows: 1, cells: ['a', 'b'], header: false };
assert.deepEqual(tableCellAt(cellTable, 50, 50), { row: 0, col: 0 });
assert.deepEqual(tableCellAt(cellTable, 150, 50), { row: 0, col: 1 });
const rotCells = { ...cellTable, x: 0, y: 50, w: 100, h: 20, rotation: 90, cols: 2, rows: 1 };
// world point that is local (75, 10) after 90° about center (50, 60):
// localToWorld(75, 10) ≈ (50, 85)
assert.equal(tableCellAt(rotCells, 50, 85).col, 1, 'rotated table cell hit uses local axes');

const east = worldPortDir('e', 0);
assert.deepEqual(east, { x: 1, y: 0 });
const east90 = worldPortDir('e', 90);
assert.ok(Math.abs(east90.x) < 1e-9 && Math.abs(east90.y - 1) < 1e-9, 'east port points world +y after 90°');

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

// outer table border drag resizes the edge row/column (dots keep whole-table resize)
const eKey = store.addShape({
  type: 'table', x: 5000, y: 5000, w: 400, h: 200, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  cols: 2, rows: 2, cells: [],
});
engine.setSelection([eKey]);
const edgeHit = engine.hitTableEdge(5398, 5050);
assert.deepEqual(
  edgeHit ? { edge: edgeHit.edge } : null,
  { edge: 'e' },
  'right border hits as edge'
);
assert.equal(engine.hitTableEdge(5200, 5100), null, 'table interior is not an edge');
assert.equal(engine.hitTablePlus(5398, 5050), null, 'border point is not a pill');
// grab off-center so the middle dot (whole-table resize) does not win
selectTool.onDown(engine, pinfo(5398, 5050));
selectTool.onMove(engine, pinfo(5458, 5050));
selectTool.onUp(engine, pinfo(5458, 5050));
const ev = store.readShape(store.board.get(eKey));
assert.equal(ev.x, 5000, 'edge drag does not move the table x');
assert.equal(ev.w, 460, 'right edge drag widens the table');
assert.ok(
  Math.abs(ev.colW[0] - 200 / 460) < 1e-9 && Math.abs(ev.colW[1] - 260 / 460) < 1e-9,
  'right edge drag grows only the last column'
);
assert.equal(ev.h, 200, 'right edge drag keeps height');
engine.setSelection([]);

// left border: table origin follows, first column absorbs
const wKey = store.addShape({
  type: 'table', x: 6000, y: 6000, w: 400, h: 200, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  cols: 2, rows: 2, cells: [],
});
engine.setSelection([wKey]);
assert.equal(engine.hitTableEdge(6002, 6050)?.edge, 'w', 'left border hits as edge');
selectTool.onDown(engine, pinfo(6002, 6050));
selectTool.onMove(engine, pinfo(6042, 6050));
selectTool.onUp(engine, pinfo(6042, 6050));
const wv = store.readShape(store.board.get(wKey));
assert.equal(wv.x, 6040, 'left edge drag moves the table origin');
assert.equal(wv.w, 360, 'left edge drag narrows the table');
assert.ok(
  Math.abs(wv.colW[0] - 160 / 360) < 1e-9 && Math.abs(wv.colW[1] - 200 / 360) < 1e-9,
  'left edge drag shrinks only the first column'
);
engine.setSelection([]);

// bottom / top borders resize rows
const sKey = store.addShape({
  type: 'table', x: 7000, y: 7000, w: 400, h: 200, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  cols: 2, rows: 2, cells: [],
});
engine.setSelection([sKey]);
assert.equal(engine.hitTableEdge(7100, 7198)?.edge, 's', 'bottom border hits as edge');
selectTool.onDown(engine, pinfo(7100, 7198));
selectTool.onMove(engine, pinfo(7100, 7228));
selectTool.onUp(engine, pinfo(7100, 7228));
const sv = store.readShape(store.board.get(sKey));
assert.equal(sv.h, 230, 'bottom edge drag grows the table');
assert.ok(
  Math.abs(sv.rowH[0] - 100 / 230) < 1e-9 && Math.abs(sv.rowH[1] - 130 / 230) < 1e-9,
  'bottom edge drag grows only the last row'
);
engine.setSelection([]);
const nKey = store.addShape({
  type: 'table', x: 8000, y: 8000, w: 400, h: 200, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  cols: 2, rows: 2, cells: [],
});
engine.setSelection([nKey]);
assert.equal(engine.hitTableEdge(8100, 8002)?.edge, 'n', 'top border hits as edge');
selectTool.onDown(engine, pinfo(8100, 8002));
selectTool.onMove(engine, pinfo(8100, 8032));
selectTool.onUp(engine, pinfo(8100, 8032));
const nv = store.readShape(store.board.get(nKey));
assert.equal(nv.y, 8030, 'top edge drag moves the table origin');
assert.equal(nv.h, 170, 'top edge drag shrinks the table');
assert.ok(
  Math.abs(nv.rowH[0] - 70 / 170) < 1e-9 && Math.abs(nv.rowH[1] - 100 / 170) < 1e-9,
  'top edge drag shrinks only the first row'
);
engine.setSelection([]);

// edge drag clamps at the 28px edge-cell floor and keeps riders glued
const cKey = store.addShape({
  type: 'table', x: 9000, y: 9000, w: 400, h: 200, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  cols: 2, rows: 2, cells: [],
});
const cRiderKey = store.addShape({ type: 'sticky', x: 9050, y: 9050, w: 60, h: 40, fill: '#ffe27a', stroke: '#d9b64d', strokeWidth: 2 });
engine.setSelection([cKey]);
selectTool.onDown(engine, pinfo(9398, 9050));
selectTool.onMove(engine, pinfo(9000, 9050));
selectTool.onUp(engine, pinfo(9000, 9050));
const cv = store.readShape(store.board.get(cKey));
assert.equal(cv.w, 228, 'edge drag clamps so the last column keeps 28px');
assert.ok(
  Math.abs(cv.colW[0] - 200 / 228) < 1e-9 && Math.abs(cv.colW[1] - 28 / 228) < 1e-9,
  'clamped drag keeps the fixed column absolute'
);
assert.equal(store.readShape(store.board.get(cRiderKey)).x, 9050, 'rider in the fixed column stays');
assert.equal(store.readShape(store.board.get(cRiderKey)).y, 9050, 'rider in the fixed column stays y');
engine.setSelection([]);

// whole-table handle resize moves glued riders without squeezing them
const hKey = store.addShape({
  type: 'table', x: 10000, y: 10000, w: 400, h: 200, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  cols: 2, rows: 2, cells: [],
});
const hStickyKey = store.addShape({ type: 'sticky', x: 10050, y: 10050, w: 60, h: 40, fill: '#ffe27a', stroke: '#d9b64d', strokeWidth: 2 });
const hRectKey = store.addShape({ type: 'rect', x: 10250, y: 10100, w: 80, h: 50, fill: '#ffffff', stroke: '#000000', strokeWidth: 2 });
const hPenPts = [10100, 10100, 10160, 10120, 10220, 10140];
const hPenKey = store.addShape({ type: 'pen', x: 10100, y: 10100, w: 120, h: 40, points: [...hPenPts], stroke: '#000000', strokeWidth: 3 });
engine.setSelection([hKey]);
const hSeScr = engine.worldToScreen(10400, 10200);
assert.equal(engine.hitHandle(hSeScr.x, hSeScr.y)?.handle, 'se', 'se dot hit');
const hDown = { screen: hSeScr, world: { x: 10400, y: 10200 }, shift: false, alt: false };
const hMove2 = engine.worldToScreen(10500, 10300);
const hMove = { screen: hMove2, world: { x: 10500, y: 10300 }, shift: false, alt: false };
selectTool.onDown(engine, hDown);
selectTool.onMove(engine, hMove);
selectTool.onUp(engine, hMove);
const hv = store.readShape(store.board.get(hKey));
assert.equal(hv.w, 500, 'whole-table resize widens');
assert.equal(hv.h, 300, 'whole-table resize grows height');
const hs = store.readShape(store.board.get(hStickyKey));
assert.equal(hs.w, 60, 'sticky keeps width on whole-table resize');
assert.equal(hs.h, 40, 'sticky keeps height on whole-table resize');
const hr = store.readShape(store.board.get(hRectKey));
assert.equal(hr.w, 80, 'rect keeps width on whole-table resize');
assert.equal(hr.h, 50, 'rect keeps height on whole-table resize');
const hp = store.readShape(store.board.get(hPenKey));
assert.equal(hp.w, 120, 'pen keeps width on whole-table resize');
assert.equal(hp.h, 40, 'pen keeps height on whole-table resize');
assert.ok(
  hp.points.every((v, i) => Math.abs(v - (i % 2 === 0 ? hp.x : hp.y) - (hPenPts[i] - 10100)) < 1e-9),
  'pen strokes translate rigidly on whole-table resize'
);
engine.setSelection([]);

// tray hosts: first press selects + starts marquee, moving needs it pre-selected
const pressTbl = store.addShape({
  type: 'table', x: 11000, y: 11000, w: 400, h: 200, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  cols: 2, rows: 2, cells: [],
});
const pressNote = store.addShape({ type: 'sticky', x: 11050, y: 11050, w: 60, h: 40, fill: '#ffe27a', stroke: '#d9b64d', strokeWidth: 2 });
engine.setSelection([]);
// tap on empty table area selects and keeps the selection (no instant move)
selectTool.onDown(engine, pinfo(11300, 11150));
assert.deepEqual([...engine.selection], [pressTbl], 'tap selects the unselected table');
selectTool.onUp(engine, pinfo(11300, 11150));
assert.deepEqual([...engine.selection], [pressTbl], 'tap does not clear the fresh table selection');
assert.equal(store.readShape(store.board.get(pressTbl)).x, 11000, 'tap does not move the table');
// drag from an unselected host marquees instead of moving it
engine.setSelection([]);
selectTool.onDown(engine, pinfo(11300, 11150));
selectTool.onMove(engine, pinfo(11020, 11020));
selectTool.onUp(engine, pinfo(11020, 11020));
assert.equal(store.readShape(store.board.get(pressTbl)).x, 11000, 'marquee drag does not move the table');
assert.equal(store.readShape(store.board.get(pressTbl)).y, 11000, 'marquee drag does not move the table y');
assert.ok(engine.selection.has(pressNote), 'marquee from a table grabs notes sitting on it');
// press on the pre-selected host moves it (riders follow)
engine.setSelection([pressTbl]);
selectTool.onDown(engine, pinfo(11300, 11150));
selectTool.onMove(engine, pinfo(11350, 11200));
selectTool.onUp(engine, pinfo(11350, 11200));
assert.equal(store.readShape(store.board.get(pressTbl)).x, 11050, 'pre-selected table moves');
assert.equal(store.readShape(store.board.get(pressTbl)).y, 11050, 'pre-selected table moves y');
assert.equal(store.readShape(store.board.get(pressNote)).x, 11100, 'table rider follows the move');
assert.equal(store.readShape(store.board.get(pressNote)).y, 11100, 'table rider follows the move y');
engine.setSelection([]);
// plain shapes still move on first drag (control)
const plainRect = store.addShape({ type: 'rect', x: 12000, y: 12000, w: 100, h: 80, fill: '#ffffff', stroke: '#000000', strokeWidth: 2 });
engine.setSelection([]);
selectTool.onDown(engine, pinfo(12010, 12010));
selectTool.onMove(engine, pinfo(12030, 12030));
selectTool.onUp(engine, pinfo(12030, 12030));
assert.equal(store.readShape(store.board.get(plainRect)).x, 12020, 'plain rect still moves on first drag');
assert.equal(store.readShape(store.board.get(plainRect)).y, 12020, 'plain rect still moves on first drag y');
engine.setSelection([]);
// photo host behaves the same on tap
const trayImg = store.addShape({ type: 'image', x: 13000, y: 13000, w: 200, h: 100, stroke: '#000000', strokeWidth: 2 });
engine.setSelection([]);
selectTool.onDown(engine, pinfo(13050, 13040));
selectTool.onUp(engine, pinfo(13050, 13040));
assert.deepEqual([...engine.selection], [trayImg], 'tap selects the unselected photo');
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
// tray hosts need a tap to select first; the second press drags them
mselect.onDown(engine, mpinfo(30050, 30150));
mselect.onUp(engine, mpinfo(30050, 30150));
mselect.onDown(engine, mpinfo(30050, 30150));
// ponytail: incremental moves like a real drag (a single jump would mask
// riders that only patch on the first move and freeze after)
mselect.onMove(engine, mpinfo(30060, 30160));
mselect.onMove(engine, mpinfo(30070, 30175));
mselect.onMove(engine, mpinfo(30080, 30190));
mselect.onUp(engine, mpinfo(30080, 30190));
assert.equal(store.readShape(store.board.get(mKey)).x, 30030, 'dragged table moves');
assert.equal(store.readShape(store.board.get(mKey)).y, 30040, 'dragged table moves y');
assert.equal(store.readShape(store.board.get(stRiderKey)).x, 30080, 'sticky rider follows drag exactly');
assert.equal(store.readShape(store.board.get(stRiderKey)).y, 30090, 'sticky rider follows drag exactly y');
assert.equal(store.readShape(store.board.get(rcRiderKey)).x, 30230, 'rect rider follows drag exactly');
engine.setSelection([]);

// annotations ride a dragged PDF like they ride a photo (pen + sticky fully on the page)
const docKey = store.addShape({
  type: 'doc', x: 50000, y: 50000, w: 240, h: 320, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  pages: ['data:image/jpeg;base64,x'],
});
const docPenKey = store.addShape({
  type: 'pen', x: 50060, y: 50080, w: 60, h: 40, fill: 'transparent', stroke: '#111111', strokeWidth: 3,
  points: [50065, 50085, 50090, 50100, 50115, 50095],
});
const docNoteKey = store.addShape({ type: 'sticky', x: 50100, y: 50150, w: 60, h: 40, fill: '#ffe27a', stroke: '#d9b64d', strokeWidth: 2 });
const docOutsiderKey = store.addShape({
  type: 'pen', x: 51000, y: 51000, w: 60, h: 40, fill: 'transparent', stroke: '#111111', strokeWidth: 3,
  points: [51005, 51005, 51030, 51020],
});
const docSelect = engine.tools.get('select');
const docPinfo = (x, y) => ({ screen: { x, y }, world: { x, y }, shift: false, alt: true });
// tray host: tap selects, second press drags
docSelect.onDown(engine, docPinfo(50010, 50010));
docSelect.onUp(engine, docPinfo(50010, 50010));
docSelect.onDown(engine, docPinfo(50010, 50010));
docSelect.onMove(engine, docPinfo(50020, 50020));
docSelect.onMove(engine, docPinfo(50030, 50035));
docSelect.onUp(engine, docPinfo(50030, 50035));
assert.equal(store.readShape(store.board.get(docKey)).x, 50020, 'dragged PDF moves');
assert.equal(store.readShape(store.board.get(docKey)).y, 50025, 'dragged PDF moves y');
assert.equal(store.readShape(store.board.get(docPenKey)).x, 50080, 'pen annotation follows the PDF');
assert.equal(store.readShape(store.board.get(docPenKey)).y, 50105, 'pen annotation follows the PDF y');
assert.equal(store.readShape(store.board.get(docNoteKey)).x, 50120, 'sticky note follows the PDF');
assert.equal(store.readShape(store.board.get(docOutsiderKey)).x, 51000, 'ink off the page stays');
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
// tray host: tap a free cell to select, second press drags +20/+20
dselect.onDown(engine, dpinfo(30250, 30180));
dselect.onUp(engine, dpinfo(30250, 30180));
dselect.onDown(engine, dpinfo(30250, 30180));
dselect.onMove(engine, dpinfo(30260, 30190));
dselect.onMove(engine, dpinfo(30270, 30200));
dselect.onUp(engine, dpinfo(30270, 30200));
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
// containers + flowchart nodes survive (whole mode): doc, graph, frame, all 8 scheme shapes
const eContainerKeys = [];
eContainerKeys.push([store.addShape({
  type: 'doc', x: 40600, y: 40000, w: 120, h: 160, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  pages: ['data:image/jpeg;base64,x'],
}), 40660, 40080, 'doc']);
eContainerKeys.push([store.addShape({
  type: 'graph', x: 40740, y: 40000, w: 120, h: 90, fill: '#ffffff', stroke: '#000000', strokeWidth: 2, expr: 'sin(x)',
}), 40800, 40045, 'graph']);
eContainerKeys.push([store.addShape({
  type: 'frame', x: 40880, y: 40000, w: 120, h: 90, fill: 'transparent', stroke: '#000000', strokeWidth: 2,
}), 40940, 40045, 'frame']);
const eSchemeTypes = ['diamond', 'triangle', 'parallelogram', 'hexagon', 'cylinder', 'terminator', 'subroutine', 'display'];
eSchemeTypes.forEach((type, i) => {
  eContainerKeys.push([store.addShape({
    type, x: 40000 + i * 140, y: 40600, w: 120, h: 90, fill: '#ffffff', stroke: '#000000', strokeWidth: 2,
  }), 40060 + i * 140, 40645, type]);
});
for (const [k, cx, cy, label] of eContainerKeys) {
  eraser.onDown(engine, epinfo(cx, cy));
  eraser.onUp(engine, epinfo(cx, cy));
  assert.equal(store.board.has(k), true, `${label} survives the eraser`);
}
// ink on top of a container still erases while the container lives
const eInkKey = store.addShape({
  type: 'pen', x: 40056, y: 40641, w: 8, h: 8, fill: 'transparent', stroke: '#111111', strokeWidth: 3,
  points: [40060, 40645],
});
eraser.onDown(engine, epinfo(40060, 40645));
eraser.onUp(engine, epinfo(40060, 40645));
assert.equal(store.board.has(eInkKey), false, 'ink on top of a scheme node erases');
assert.equal(store.board.has(eContainerKeys[3][0]), true, 'scheme node under erased ink survives');
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
for (const [k, cx, cy, label] of eContainerKeys) {
  eraser.onDown(engine, epinfo(cx, cy));
  eraser.onUp(engine, epinfo(cx, cy));
  assert.equal(store.board.has(k), true, `${label} survives the eraser in partial mode`);
}
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

// setTool drops selection for drawing tools, keeps it for navigate tools
const selKey = store.addShape({ type: 'rect', x: 60000, y: 60000, w: 50, h: 40, fill: '#ffffff', stroke: '#000000', strokeWidth: 2 });
engine.setSelection([selKey]);
assert.equal(engine.selection.size, 1, 'setup selected');
engine.setTool('pen');
assert.equal(engine.selection.size, 0, 'drawing tool clears selection');
engine.setSelection([selKey]);
engine.setTool('select');
assert.equal(engine.selection.size, 1, 'select keeps selection');
engine.setTool('pan');
assert.equal(engine.selection.size, 1, 'pan keeps selection');
engine.setSelection([selKey]);
engine.setTool('eraser');
assert.equal(engine.selection.size, 0, 'eraser clears selection');
engine.setTool('select');
engine.setSelection([]);

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
  focus: null,
  selection: null,
  confetti: null,
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

applyKeybinds({
  tools: { pan: 'KeyH', pen: 'KeyH' },
  colors: { '0': 'KeyH' },
});
assert.equal(getToolBinds().pan, '', 'profile restore cannot bind pan to KeyH');
assert.equal(getToolBinds().pen, '', 'profile restore cannot bind any tool to KeyH');
assert.equal(getColorBinds()['0'], undefined, 'profile restore cannot bind a color to KeyH');
applyKeybinds({ tools: {}, colors: {} });

const twoKeep = splitStrokeByErasedIndices(
  [0, 0, 10, 0, 20, 0, 30, 0, 40, 0],
  [0.1, 0.2, 0.3, 0.4, 0.5],
  new Set([2])
);
assert.equal(twoKeep.length, 2, 'partial erase splits around the hit vertex');
assert.deepEqual(twoKeep[0].points, [0, 0, 10, 0]);
assert.deepEqual(twoKeep[0].pressures, [0.1, 0.2]);
assert.deepEqual(twoKeep[1].points, [30, 0, 40, 0]);
assert.deepEqual(twoKeep[1].pressures, [0.4, 0.5]);
const leftoverDot = splitStrokeByErasedIndices([0, 0, 10, 0, 20, 0], undefined, new Set([0, 2]));
assert.equal(leftoverDot.length, 1, 'a leftover vertex remains as an ink dot');
assert.deepEqual(leftoverDot[0].points, [10, 0]);

assert.equal(defaultFontSizeFor('diamond'), 16, 'flowchart nodes default to SHAPE_FONT');
assert.equal(defaultFontSizeFor('rect'), 16);
assert.equal(defaultFontSizeFor('text'), 18);
assert.equal(defaultFontSizeFor('table'), 14);

const svgDoc = shapesToSvg(
  [
    {
      id: 'd1',
      type: 'doc',
      x: 0,
      y: 0,
      w: 100,
      h: 80,
      fill: '#fff',
      stroke: '#000',
      strokeWidth: 1,
      pages: ['data:image/png;base64,AAA'],
      page: 0,
    },
    {
      id: 'dia',
      type: 'diamond',
      x: 120,
      y: 0,
      w: 40,
      h: 40,
      fill: '#fff',
      stroke: '#000',
      strokeWidth: 1,
      text: 'if',
    },
  ],
  { background: null }
).svg;
assert.ok(svgDoc.includes('<image href="data:image/png;base64,AAA"'), 'PDF/doc pages export as images, not empty rects');
assert.ok(svgDoc.includes('<polygon'), 'diamond exports as a polygon, not a rectangle');

const zeroCrop = cropFractions({ cropW: 0, cropH: 0, cropX: 0, cropY: 0 });
assert.equal(zeroCrop.w, 1);
assert.equal(zeroCrop.h, 1);
const restored = uncroppedBox({ x: 10, y: 20, w: 100, h: 80, cropW: 0, cropH: 0 });
assert.equal(Number.isFinite(restored.w), true, 'reset crop with cropW=0 stays finite');
assert.equal(Number.isFinite(restored.h), true);
assert.equal(restored.w, 100);
assert.equal(restored.h, 80);
const half = uncroppedBox({ x: 50, y: 50, w: 50, h: 50, cropX: 0.25, cropY: 0.25, cropW: 0.5, cropH: 0.5 });
assert.equal(half.x, 25);
assert.equal(half.y, 25);
assert.equal(half.w, 100);
assert.equal(half.h, 100);

const svgCrop = shapesToSvg(
  [
    {
      id: 'im',
      type: 'image',
      x: 50,
      y: 50,
      w: 50,
      h: 50,
      fill: '#fff',
      stroke: '#000',
      strokeWidth: 0,
      src: 'data:image/png;base64,AAA',
      cropX: 0.25,
      cropY: 0.25,
      cropW: 0.5,
      cropH: 0.5,
    },
  ],
  { background: null }
).svg;
assert.ok(svgCrop.includes('clip-path') || svgCrop.includes('clipPath'), 'cropped images export with a clip');
assert.ok(svgCrop.includes('width="100"'), 'export places the full bitmap behind the crop box');

const svgArrow = shapesToSvg(
  [
    {
      id: 'arr',
      type: 'arrow',
      x: 0,
      y: 0,
      w: 100,
      h: 10,
      fill: 'transparent',
      stroke: '#111111',
      strokeWidth: 2,
      points: [0, 0, 100, 0],
    },
  ],
  { background: null }
).svg;
assert.ok(svgArrow.includes('<polygon'), 'arrow export includes the head');
assert.ok(svgArrow.includes('<path'), 'arrow export draws the shaft as a path');
const described = describeArrow({
  id: 'arr',
  type: 'arrow',
  x: 0,
  y: 0,
  w: 100,
  h: 10,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [0, 0, 100, 0],
});
assert.ok(described, 'describeArrow returns geometry');
assert.equal(described.head[0] > 90, true, 'arrow head sits at the tip');

const jpeg = new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0x03, 0xd9]);
const pdf = jpegToPdf(jpeg, 4, 4);
const latin = new TextDecoder('latin1').decode(pdf);
const imgLen = /\/Subtype \/Image[\s\S]*?\/Length (\d+) >>\nstream\n/.exec(latin);
assert.ok(imgLen, 'PDF image object has a Length');
assert.equal(Number(imgLen[1]), jpeg.length, 'JPEG stream /Length matches the bytes');
const streamAt = latin.indexOf('stream\n', latin.indexOf('/Subtype /Image')) + 'stream\n'.length;
const after = latin.slice(streamAt + jpeg.length, streamAt + jpeg.length + 9);
assert.equal(after.startsWith('endstream'), true, 'endstream follows JPEG bytes with no extra newline');

renderFormula('x^2');
assert.equal(isFormulaCached('x^2'), false, 'MathJax not-ready miss is not cached');
renderFormula('x^2');
assert.equal(isFormulaCached('x^2'), false, 'a second pre-ready render still has no cached miss');

assert.equal(shapesFromClipboardText('{"__reviewShapes":[{"id":"p1"}]}')?.length, 1);

const stickySvg = shapesToSvg(
  [
    {
      id: 'st',
      type: 'sticky',
      x: 0,
      y: 0,
      w: 120,
      h: 80,
      fill: '#ffe27a',
      stroke: '#000',
      strokeWidth: 1,
      text: 'hello\nworld',
      fontSize: 16,
      textColor: '#1c1c1a',
    },
  ],
  { background: null }
).svg;
assert.ok(stickySvg.includes('hello') && stickySvg.includes('world'), 'multiline sticky export keeps line breaks');
assert.ok((stickySvg.match(/<text /g) || []).length >= 2, 'each sticky line is its own text run');

const stickyDefaultInk = shapesToSvg(
  [
    {
      id: 'st2',
      type: 'sticky',
      x: 0,
      y: 0,
      w: 120,
      h: 80,
      fill: '#ffe27a',
      stroke: '#000',
      strokeWidth: 1,
      text: 'note',
      fontSize: 16,
    },
  ],
  { background: null }
).svg;
assert.ok(stickyDefaultInk.includes('#3a2f00'), 'legacy sticky without textColor uses canvas ink, not near-white');

const boldSvg = shapesToSvg(
  [
    {
      id: 'tb',
      type: 'text',
      x: 0,
      y: 0,
      w: 200,
      h: 40,
      fill: 'none',
      stroke: 'none',
      strokeWidth: 0,
      text: 'Bold',
      fontSize: 18,
      bold: true,
      italic: true,
      underline: true,
      textColor: '#111111',
    },
  ],
  { background: null }
).svg;
assert.ok(boldSvg.includes('font-weight="700"'), 'SVG text keeps bold');
assert.ok(boldSvg.includes('font-style="italic"'), 'SVG text keeps italic');
assert.ok(boldSvg.includes('underline'), 'SVG text keeps underline');

const wrapSvg = shapesToSvg(
  [
    {
      id: 'tw',
      type: 'text',
      x: 0,
      y: 0,
      w: 40,
      h: 200,
      fill: 'none',
      stroke: 'none',
      strokeWidth: 0,
      text: 'abcdefghijklmnopqrstuvwxyz',
      fontSize: 16,
      textColor: '#111111',
    },
  ],
  { background: null }
).svg;
assert.ok((wrapSvg.match(/<text /g) || []).length >= 2, 'SVG text wraps to the box instead of one overflowing line');

const formulaSvg = shapesToSvg(
  [
    {
      id: 'tf',
      type: 'text',
      x: 0,
      y: 0,
      w: 200,
      h: 40,
      fill: 'none',
      stroke: 'none',
      strokeWidth: 0,
      text: 'see $x^2$',
      fontSize: 18,
      textColor: '#111111',
    },
  ],
  { background: null }
).svg;
assert.ok(formulaSvg.includes('$x^2$') || formulaSvg.includes('<image'), 'formulas export as MathJax SVG or raw delimiters');

const diamondSvg = shapesToSvg(
  [
    {
      id: 'dia2',
      type: 'diamond',
      x: 0,
      y: 0,
      w: 200,
      h: 120,
      fill: '#fff',
      stroke: '#000',
      strokeWidth: 1,
      text: 'hello\nworld',
      fontSize: 16,
    },
  ],
  { background: null }
).svg;
assert.ok(diamondSvg.includes('hello') && diamondSvg.includes('world'), 'flowchart labels keep wrapped lines');

const tableSvg = shapesToSvg(
  [
    {
      id: 'tbl',
      type: 'table',
      x: 0,
      y: 0,
      w: 240,
      h: 120,
      fill: '#fff',
      stroke: '#000',
      strokeWidth: 1,
      cols: 1,
      rows: 1,
      cells: ['alpha\nbeta'],
      header: false,
      fontSize: 14,
    },
  ],
  { background: null }
).svg;
assert.ok(tableSvg.includes('alpha') && tableSvg.includes('beta'), 'table cells export wrapped lines, not only the first');

const penDotSvg = shapesToSvg(
  [
    {
      id: 'dot',
      type: 'pen',
      x: 10,
      y: 10,
      w: 4,
      h: 4,
      fill: 'none',
      stroke: '#ff00aa',
      strokeWidth: 4,
      points: [12, 14],
    },
  ],
  { background: null }
).svg;
assert.ok(penDotSvg.includes('<circle'), 'a one-vertex pen exports as a filled dot');
assert.ok(penDotSvg.includes('#ff00aa'));
assert.ok(penDotSvg.includes('r="2"'), 'dot radius is half the stroke width');

const graphSvg = shapesToSvg(
  [
    {
      id: 'g1',
      type: 'graph',
      x: 0,
      y: 0,
      w: 240,
      h: 180,
      fill: '#ffffff',
      stroke: '#7c8cff',
      strokeWidth: 2,
      expr: 'x^2',
    },
  ],
  { background: null }
).svg;
assert.ok(graphSvg.includes('<path d="M'), 'graph export draws the sampled curve, not just a labeled box');

const fromId = store.addShape({
  type: 'rect',
  x: 400,
  y: 200,
  w: 80,
  h: 80,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const toId = store.addShape({
  type: 'rect',
  x: 600,
  y: 200,
  w: 80,
  h: 80,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const arrowId = store.addShape({
  type: 'arrow',
  x: 480,
  y: 230,
  w: 120,
  h: 20,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [480, 240, 600, 240],
  fromId,
  toId,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([fromId]));
const arrowBefore = (engine.views.get(arrowId).points || []).slice();
engine.setSelection([fromId]);
engine.setTool('select');
const rv = engine.views.get(fromId);
const rotScr = engine.worldToScreen(rv.x - 44, rv.y + rv.h + 44);
assert.equal(engine.hitRotateHandle(rotScr.x, rotScr.y), fromId, 'rotate handle is hittable');
engine.onPointerDown({ clientX: rotScr.x, clientY: rotScr.y, button: 0, pointerId: 9, shiftKey: true, altKey: false });
const mid = engine.worldToScreen(rv.x + rv.w / 2, rv.y + rv.h / 2);
engine.onPointerMove({ clientX: mid.x + 90, clientY: mid.y - 50, button: 0, pointerId: 9, shiftKey: true, altKey: false });
engine.onPointerUp({ clientX: mid.x + 90, clientY: mid.y - 50, button: 0, pointerId: 9, shiftKey: true, altKey: false });
const arrowAfter = engine.views.get(arrowId).points || [];
assert.ok(
  arrowAfter[0] !== arrowBefore[0] || arrowAfter[1] !== arrowBefore[1],
  'rotating a connected shape reattaches the arrow to the new port'
);
assert.equal(arrowAfter.length, 8, 'connected arrows store cubic controls so rotation can bend the curve');

const fromR = { id: 'f', type: 'rect', x: 0, y: 0, w: 80, h: 80, rotation: 90, fill: '#fff', stroke: '#000', strokeWidth: 1 };
const toR = { id: 't', type: 'rect', x: 200, y: 0, w: 80, h: 80, fill: '#fff', stroke: '#000', strokeWidth: 1 };
const geom = connectedArrowGeometry(fromR, toR, 'e', 'w');
assert.equal(geom.points.length, 8);
assert.ok(geom.points[3] > geom.points[1], 'control leaves the rotated east port along world +y');

const lightText = shapesToSvg(
  [
    {
      id: 'lt',
      type: 'text',
      x: 0,
      y: 0,
      w: 120,
      h: 40,
      fill: 'none',
      stroke: 'none',
      strokeWidth: 0,
      text: 'hi',
      fontSize: 18,
    },
  ],
  { background: '#f4f1ea' }
).svg;
assert.ok(lightText.includes('#1c1c1a'), 'text without textColor on light paper uses dark ink');

const gid = store.addShape({
  type: 'graph',
  x: 50,
  y: 50,
  w: 240,
  h: 180,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
  expr: 'sin(x)',
});
engine.openGraphEditor(gid);
engine.commitGraphPreview(gid, 'x^2');
assert.equal(engine.views.get(gid).expr, 'x^2');
engine.cancelGraphEditor();
assert.equal(engine.views.get(gid).expr, 'sin(x)', 'cancelling the graph editor restores the original expression');
engine.commitGraphPreview(gid, 'x^2');
engine.commitGraph(gid, 'x^2');
assert.equal(engine.views.get(gid).expr, 'sin(x)', 'stale graph commits after cancel do not stick');

assert.equal(store.preferredListedPageId(['a', 'b'], 'b', () => false), 'b', 'listed preferred page wins even if empty');
assert.equal(
  store.preferredListedPageId(['a', 'b'], 'missing', (id) => id === 'b'),
  'b',
  'unlisted active page heals onto the first page that still has shapes'
);
assert.equal(
  store.preferredListedPageId(['a', 'b'], 'missing', () => false),
  'a',
  'empty board falls back to list[0]'
);

const rotOuter = { x: 0, y: 50, w: 100, h: 20, rotation: 90 };
assert.equal(
  containedInShape({ x: 45, y: 90, w: 10, h: 10 }, rotOuter),
  true,
  'rotated host contains a box on its visual body'
);
assert.equal(
  containedInShape({ x: 80, y: 55, w: 10, h: 10 }, rotOuter),
  false,
  'rotated host does not contain a box that only sits in the unrotated AABB'
);

const darkFlow = shapesToSvg(
  [
    {
      id: 'dia-dark',
      type: 'diamond',
      x: 0,
      y: 0,
      w: 120,
      h: 80,
      fill: '#fff',
      stroke: '#000',
      strokeWidth: 1,
      text: 'Go',
      fontSize: 16,
    },
  ],
  { background: '#1c1c1a' }
).svg;
assert.ok(darkFlow.includes('#eceae4'), 'flowchart SVG labels adapt ink on dark paper');

const rotDivKey = store.addShape({
  type: 'table',
  x: 70000,
  y: 70000,
  w: 200,
  h: 100,
  rotation: 90,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  cols: 2,
  rows: 2,
  cells: [],
});
engine.setSelection([rotDivKey]);
const rotDivHit = engine.hitTableDivider(70100, 70050);
assert.deepEqual(
  rotDivHit ? { kind: rotDivHit.kind, index: rotDivHit.index } : null,
  { kind: 'col', index: 1 },
  'rotated table divider hit uses local axes'
);
const rotDivView = engine.views.get(rotDivKey);
const sZoom = 1 / engine.camera.zoom;
const pillLocal = { lx: rotDivView.w + 16 * sZoom, ly: rotDivView.h / 2 - 14 * sZoom };
const pillWorld = localToWorld(rotDivView, pillLocal.lx, pillLocal.ly);
const pillScr = engine.worldToScreen(pillWorld.x, pillWorld.y);
engine.onPointerDown({ clientX: pillScr.x, clientY: pillScr.y, button: 0, pointerId: 21, shiftKey: false, altKey: false });
engine.onPointerUp({ clientX: pillScr.x, clientY: pillScr.y, button: 0, pointerId: 21, shiftKey: false, altKey: false });
assert.equal(store.readShape(store.board.get(rotDivKey)).cols, 3, 'rotated table plus-pill hit uses world localToWorld');
engine.setSelection([]);

const imgHost = store.addShape({
  type: 'image',
  x: 90000,
  y: 90000,
  w: 200,
  h: 150,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  src: 'data:image/png;base64,x',
});
const imgNote = store.addShape({
  type: 'sticky',
  x: 90040,
  y: 90040,
  w: 40,
  h: 40,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
const imgPen = store.addShape({
  type: 'pen',
  x: 90060,
  y: 90070,
  w: 40,
  h: 20,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 3,
  points: [90065, 90075, 90090, 90085],
});
assert.deepEqual(
  hostRiderIds(
    [imgHost, imgNote, imgPen].map((k) => ({ ...store.readShape(store.board.get(k)), id: k })),
    [imgHost]
  ).sort(),
  [imgNote, imgPen].sort(),
  'photo riders include the sticky and pen glued to it'
);
assert.deepEqual(
  hostRiderIds(
    [
      { id: 'n', type: 'sticky', x: 10, y: 10, w: 20, h: 20 },
      { id: 'p', type: 'image', x: 0, y: 0, w: 100, h: 80 },
    ],
    ['p']
  ),
  [],
  'sticky under a photo (lower z) does not magnetize'
);
assert.deepEqual(
  hostRiderIds(
    [
      { id: 'p', type: 'image', x: 0, y: 0, w: 100, h: 80 },
      { id: 'n', type: 'sticky', x: 10, y: 10, w: 20, h: 20 },
    ],
    ['p']
  ),
  ['n'],
  'sticky on top of a photo magnetizes'
);
engine.setSelection([imgHost]);
engine.translateSelection(15, 10);
store.flushPendingPatches();
assert.equal(store.readShape(store.board.get(imgNote)).x, 90055, 'sticky follows a keyboard-nudged photo');
assert.equal(store.readShape(store.board.get(imgPen)).x, 90075, 'pen follows a keyboard-nudged photo');
engine.setSelection([]);

const underNote = store.addShape({
  type: 'sticky',
  x: 93040,
  y: 93040,
  w: 40,
  h: 40,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
const underHost = store.addShape({
  type: 'image',
  x: 93000,
  y: 93000,
  w: 200,
  h: 150,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  src: 'data:image/png;base64,x',
});
// Photo added after sticky → photo is on top; sticky must not ride.
assert.ok(
  !hostRiderIds(
    [underNote, underHost].map((k) => ({ ...store.readShape(store.board.get(k)), id: k })),
    [underHost],
    stackOrderIndex(store.order.toArray())
  ).includes(underNote),
  'board-order sticky under photo is not a rider'
);
const underX0 = store.readShape(store.board.get(underNote)).x;
engine.setSelection([underHost]);
engine.translateSelection(20, 0);
store.flushPendingPatches();
assert.equal(
  store.readShape(store.board.get(underNote)).x,
  underX0,
  'nudging a photo does not drag a sticky that sits under it'
);
assert.equal(store.readShape(store.board.get(underHost)).x, 93020, 'photo itself still nudges');
engine.setSelection([]);
store.moveOrderToFront([underNote]);
assert.ok(
  hostRiderIds(
    [underNote, underHost].map((k) => ({ ...store.readShape(store.board.get(k)), id: k })),
    [underHost],
    stackOrderIndex(store.order.toArray())
  ).includes(underNote),
  'bringing the sticky above the photo restores magnetize'
);
engine.setSelection([underHost]);
engine.translateSelection(10, 0);
store.flushPendingPatches();
assert.equal(
  store.readShape(store.board.get(underNote)).x,
  underX0 + 10,
  'sticky on top of photo follows a nudge'
);
engine.setSelection([]);

const rotImg = store.addShape({
  type: 'image',
  x: 91000,
  y: 91000,
  w: 200,
  h: 150,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  src: 'data:image/png;base64,x',
});
const rotNote = store.addShape({
  type: 'sticky',
  x: 91040,
  y: 91040,
  w: 40,
  h: 40,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
const noteBefore = { ...store.readShape(store.board.get(rotNote)), id: rotNote };
engine.setSelection([rotImg]);
engine.setTool('select');
const imgV0 = engine.views.get(rotImg);
const imgRotScr = engine.worldToScreen(imgV0.x - 44, imgV0.y + imgV0.h + 44);
assert.equal(engine.hitRotateHandle(imgRotScr.x, imgRotScr.y), rotImg, 'image rotate handle is hittable');
engine.onPointerDown({ clientX: imgRotScr.x, clientY: imgRotScr.y, button: 0, pointerId: 22, shiftKey: true, altKey: false });
const imgMid = engine.worldToScreen(imgV0.x + imgV0.w / 2, imgV0.y + imgV0.h / 2);
engine.onPointerMove({ clientX: imgMid.x + 90, clientY: imgMid.y - 50, button: 0, pointerId: 22, shiftKey: true, altKey: false });
engine.onPointerUp({ clientX: imgMid.x + 90, clientY: imgMid.y - 50, button: 0, pointerId: 22, shiftKey: true, altKey: false });
const imgAfter = engine.views.get(rotImg);
const expectedNote = rotateShapeAround(
  noteBefore,
  imgV0.x + imgV0.w / 2,
  imgV0.y + imgV0.h / 2,
  imgAfter.rotation ?? 0
);
const noteAfter = store.readShape(store.board.get(rotNote));
assert.ok(
  Math.hypot(noteAfter.x - expectedNote.x, noteAfter.y - expectedNote.y) < 1e-6,
  'rotating a photo orbits glued stickies around the photo center'
);
assert.ok(Math.abs((noteAfter.rotation ?? 0) - (expectedNote.rotation ?? 0)) < 1e-6, 'glued sticky rotates with the photo');
engine.setSelection([]);

const legacyFrom = store.addShape({
  type: 'rect',
  x: 92000,
  y: 92000,
  w: 80,
  h: 80,
  rotation: 90,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const legacyTo = store.addShape({
  type: 'rect',
  x: 92200,
  y: 92000,
  w: 80,
  h: 80,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const legacyArrow = store.addShape({
  type: 'arrow',
  x: 92080,
  y: 92030,
  w: 120,
  h: 20,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [92080, 92040, 92200, 92040],
  fromId: legacyFrom,
  toId: legacyTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.resetToPage();
const upgraded = engine.views.get(legacyArrow)?.points ?? [];
assert.equal(upgraded.length, 8, 'loading a page rebakes legacy 4-point connected arrows to cubics');

const vis = visualBox({
  id: 'vr',
  type: 'rect',
  x: 0,
  y: 50,
  w: 100,
  h: 20,
  rotation: 90,
  fill: '#fff',
  stroke: '#000',
  strokeWidth: 1,
});
assert.ok(Math.abs(vis.w - 20) < 1e-6 && Math.abs(vis.h - 100) < 1e-6, 'visualBox of a 90° rect is the rotated AABB');

const alignA = {
  id: 'aa',
  type: 'rect',
  x: 100,
  y: 0,
  w: 20,
  h: 20,
  fill: '#fff',
  stroke: '#000',
  strokeWidth: 1,
};
const alignB = {
  id: 'ab',
  type: 'rect',
  x: 0,
  y: 50,
  w: 100,
  h: 20,
  rotation: 90,
  fill: '#fff',
  stroke: '#000',
  strokeWidth: 1,
};
const aligned = Object.fromEntries(alignViews([alignA, alignB], [], 'left'));
assert.ok(Math.abs((aligned.aa.x ?? 0) - 40) < 1e-6, 'left-align moves the upright rect to the visual left of the rotated one');
assert.ok(Math.abs((aligned.ab.x ?? alignB.x) - alignB.x) < 1e-6, 'already-leftmost rotated rect stays put');

const alignImg = store.addShape({
  type: 'image',
  x: 96000,
  y: 96000,
  w: 200,
  h: 150,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  src: 'data:image/png;base64,x',
});
const alignNote = store.addShape({
  type: 'sticky',
  x: 96040,
  y: 96040,
  w: 40,
  h: 40,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
engine.setSelection([alignImg]);
const imgX0 = store.readShape(store.board.get(alignImg)).x;
engine.alignSelection('left');
store.flushPendingPatches();
const imgDx = store.readShape(store.board.get(alignImg)).x - imgX0;
assert.equal(
  store.readShape(store.board.get(alignNote)).x,
  96040 + imgDx,
  'aligning a photo carries glued stickies'
);
engine.setSelection([]);

const darkPen = shapesToSvg(
  [
    {
      id: 'dp',
      type: 'pen',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      fill: 'transparent',
      stroke: '#1c1c1a',
      strokeWidth: 4,
      points: [0, 0, 10, 10],
    },
  ],
  { background: '#1c1c1a' }
).svg;
assert.ok(darkPen.includes('#eceae4'), 'SVG pen strokes adapt ink on dark paper');

const cropImg = store.addShape({
  type: 'image',
  x: 97000,
  y: 97000,
  w: 100,
  h: 20,
  rotation: 90,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  src: 'data:image/png;base64,x',
  cropX: 0.25,
  cropY: 0,
  cropW: 0.5,
  cropH: 1,
});
engine.setSelection([cropImg]);
engine.startCropSelected();
const cropV = engine.views.get(cropImg);
const cropEast = localToWorld(cropV, cropV.w, cropV.h / 2);
const cropEastScr = engine.worldToScreen(cropEast.x, cropEast.y);
engine.onPointerDown({ clientX: cropEastScr.x, clientY: cropEastScr.y, button: 0, pointerId: 23, shiftKey: false, altKey: false });
const cropEastDrag = engine.worldToScreen(cropEast.x, cropEast.y + 30);
engine.onPointerMove({ clientX: cropEastDrag.x, clientY: cropEastDrag.y, button: 0, pointerId: 23, shiftKey: false, altKey: false });
engine.onPointerUp({ clientX: cropEastDrag.x, clientY: cropEastDrag.y, button: 0, pointerId: 23, shiftKey: false, altKey: false });
engine.applyCrop();
store.flushPendingPatches();
assert.ok(store.readShape(store.board.get(cropImg)).w > 100, 'cropping a 90° image grows along the visual east handle');
engine.setSelection([]);

const snapHost = store.addShape({
  type: 'image',
  x: 100000,
  y: 100000,
  w: 200,
  h: 200,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  src: 'data:image/png;base64,x',
});
store.addShape({
  type: 'sticky',
  x: 100002,
  y: 100002,
  w: 20,
  h: 20,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
const snapOrig = engine.views.get(snapHost);
const snapRes = engine.computeSnapForMove(new Map([[snapHost, snapOrig]]), 0, 0);
assert.equal(snapRes.dx, 0, 'snap does not lock a photo to its own glued sticky (x)');
assert.equal(snapRes.dy, 0, 'snap does not lock a photo to its own glued sticky (y)');

// Snap / single-select align guides only target media containers — not pen ink.
const alignTargetPage = store.currentPageId();
store.addPage();
const inkOnlyPen = store.addShape({
  type: 'pen',
  x: 100,
  y: 100,
  w: 50,
  h: 50,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [100, 100, 150, 150],
});
const inkOnlySticky = store.addShape({
  type: 'sticky',
  x: 300,
  y: 102,
  w: 40,
  h: 40,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
const inkOnlySnap = engine.computeSnapForMove(
  new Map([[inkOnlySticky, engine.views.get(inkOnlySticky)]]),
  -198,
  0
);
assert.equal(inkOnlySnap.dx, -198, 'snap ignores pen drawings as targets');
assert.equal(inkOnlySnap.guides.length, 0, 'no snap guides against pen ink');
engine.setSelection([inkOnlySticky]);
const stickyXBefore = engine.views.get(inkOnlySticky).x;
engine.alignSelection('left');
store.flushPendingPatches();
assert.equal(
  engine.views.get(inkOnlySticky).x,
  stickyXBefore,
  'single-select align ignores pen drawings as targets'
);
engine.setSelection([]);
store.removeShapes([inkOnlyPen, inkOnlySticky]);
store.flushPendingPatches();

const inkMedia = store.addShape({
  type: 'image',
  x: 100,
  y: 100,
  w: 100,
  h: 80,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  src: 'data:image/png;base64,x',
});
const inkMediaSticky = store.addShape({
  type: 'sticky',
  x: 102,
  y: 300,
  w: 40,
  h: 40,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
const inkMediaSnap = engine.computeSnapForMove(
  new Map([[inkMediaSticky, engine.views.get(inkMediaSticky)]]),
  0,
  0
);
assert.ok(Math.abs(inkMediaSnap.dx + 2) < 1e-6, 'snap still locks to media container edges');
engine.setSelection([inkMediaSticky]);
engine.alignSelection('left');
store.flushPendingPatches();
assert.ok(
  Math.abs(engine.views.get(inkMediaSticky).x - engine.views.get(inkMedia).x) < 1e-6,
  'single-select align still targets media containers'
);
engine.setSelection([]);
store.setCurrentPage(alignTargetPage);
store.flushPendingPatches();

const darkArrow = shapesToSvg(
  [
    {
      id: 'da',
      type: 'arrow',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      fill: 'transparent',
      stroke: '#1c1c1a',
      strokeWidth: 3,
      points: [0, 0, 10, 0],
    },
  ],
  { background: '#1c1c1a' }
).svg;
assert.ok(darkArrow.includes('#eceae4'), 'SVG arrow strokes adapt ink on dark paper');

const pdfDoc = store.addShape({
  type: 'doc',
  x: 99000,
  y: 99000,
  w: 200,
  h: 280,
  rotation: 90,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  pages: ['data:image/png;base64,a', 'data:image/png;base64,b'],
  page: 0,
});
engine.setSelection([pdfDoc]);
const pdfV = engine.views.get(pdfDoc);
const pdfNext = localToWorld(pdfV, pdfV.w + 26, pdfV.h / 2);
const pdfNextScr = engine.worldToScreen(pdfNext.x, pdfNext.y);
engine.onPointerDown({ clientX: pdfNextScr.x, clientY: pdfNextScr.y, button: 0, pointerId: 24, shiftKey: false, altKey: false });
engine.onPointerUp({ clientX: pdfNextScr.x, clientY: pdfNextScr.y, button: 0, pointerId: 24, shiftKey: false, altKey: false });
store.flushPendingPatches();
assert.equal(store.readShape(store.board.get(pdfDoc)).page, 1, 'page-flip arrows follow a rotated PDF');
engine.setSelection([]);

const rsImg = store.addShape({
  type: 'image',
  x: 101000,
  y: 101000,
  w: 200,
  h: 150,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  src: 'data:image/png;base64,x',
});
const rsNote = store.addShape({
  type: 'sticky',
  x: 101040,
  y: 101040,
  w: 40,
  h: 40,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
engine.setSelection([rsImg]);
engine.setTool('select');
const rsV = engine.views.get(rsImg);
const rsEast = localToWorld(rsV, rsV.w, rsV.h / 2);
const rsEastScr = engine.worldToScreen(rsEast.x, rsEast.y);
engine.onPointerDown({ clientX: rsEastScr.x, clientY: rsEastScr.y, button: 0, pointerId: 25, shiftKey: false, altKey: false });
const rsDrag = engine.worldToScreen(rsEast.x + 50, rsEast.y);
engine.onPointerMove({ clientX: rsDrag.x, clientY: rsDrag.y, button: 0, pointerId: 25, shiftKey: false, altKey: false });
engine.onPointerUp({ clientX: rsDrag.x, clientY: rsDrag.y, button: 0, pointerId: 25, shiftKey: false, altKey: false });
store.flushPendingPatches();
assert.ok(
  store.readShape(store.board.get(rsNote)).x > 101040,
  'resizing a photo carries glued stickies in the host local frame'
);
engine.setSelection([]);

const alFrom = store.addShape({
  type: 'rect',
  x: 103000,
  y: 103000,
  w: 80,
  h: 80,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const alTo = store.addShape({
  type: 'rect',
  x: 103220,
  y: 103040,
  w: 80,
  h: 80,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const alArr = store.addShape({
  type: 'arrow',
  x: 103080,
  y: 103030,
  w: 140,
  h: 30,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [103080, 103040, 103220, 103080],
  fromId: alFrom,
  toId: alTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([alFrom, alTo]));
const alPts0 = (engine.views.get(alArr).points || []).slice();
engine.setSelection([alFrom, alTo]);
engine.alignSelection('top');
store.flushPendingPatches();
const alPts1 = engine.views.get(alArr).points || [];
assert.ok(
  alPts1.some((n, i) => n !== alPts0[i]),
  'aligning connected shapes rebakes the connector'
);
engine.setSelection([]);

const raImg = store.addShape({
  type: 'image',
  x: 104000,
  y: 104000,
  w: 200,
  h: 150,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  src: 'data:image/png;base64,x',
});
const raNote = store.addShape({
  type: 'sticky',
  x: 104040,
  y: 104040,
  w: 40,
  h: 40,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
const raRect = store.addShape({
  type: 'rect',
  x: 104400,
  y: 104040,
  w: 80,
  h: 80,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const raArr = store.addShape({
  type: 'arrow',
  x: 104080,
  y: 104050,
  w: 320,
  h: 40,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [104080, 104060, 104400, 104080],
  fromId: raNote,
  toId: raRect,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([raNote, raRect]));
const raPts0 = (engine.views.get(raArr).points || []).slice();
engine.setSelection([raImg]);
engine.setTool('select');
const raV = engine.views.get(raImg);
const raEast = localToWorld(raV, raV.w, raV.h / 2);
const raEastScr = engine.worldToScreen(raEast.x, raEast.y);
engine.onPointerDown({ clientX: raEastScr.x, clientY: raEastScr.y, button: 0, pointerId: 26, shiftKey: false, altKey: false });
const raDrag = engine.worldToScreen(raEast.x + 50, raEast.y);
engine.onPointerMove({ clientX: raDrag.x, clientY: raDrag.y, button: 0, pointerId: 26, shiftKey: false, altKey: false });
engine.onPointerUp({ clientX: raDrag.x, clientY: raDrag.y, button: 0, pointerId: 26, shiftKey: false, altKey: false });
store.flushPendingPatches();
const raPts1 = engine.views.get(raArr).points || [];
assert.ok(
  raPts1[0] !== raPts0[0] || raPts1[1] !== raPts0[1],
  'resizing a photo rebakes arrows glued to its stickies'
);
engine.setSelection([]);

const tblHost = store.addShape({
  type: 'table',
  x: 105000,
  y: 105000,
  w: 200,
  h: 100,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  cols: 2,
  rows: 2,
  cells: [],
});
const tblTo = store.addShape({
  type: 'rect',
  x: 105300,
  y: 105020,
  w: 80,
  h: 80,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const tblArr = store.addShape({
  type: 'arrow',
  x: 105200,
  y: 105040,
  w: 100,
  h: 20,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [105200, 105050, 105300, 105060],
  fromId: tblHost,
  toId: tblTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([tblHost, tblTo]));
const tblPts0 = (engine.views.get(tblArr).points || []).slice();
engine.tableInsertRow(tblHost);
store.flushPendingPatches();
const tblPts1 = engine.views.get(tblArr).points || [];
assert.ok(
  tblPts1.some((n, i) => n !== tblPts0[i]),
  'inserting a table row rebakes connectors on the table'
);

assert.equal(arrowHeadLength({ arrowHead: 0, strokeWidth: 4 }), 0, 'arrowHead 0 is headless');
const headlessSvg = shapesToSvg(
  [
    {
      id: 'hl',
      type: 'arrow',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      fill: 'transparent',
      stroke: '#111111',
      strokeWidth: 2,
      arrowHead: 0,
      points: [0, 0, 10, 0],
    },
  ],
  { background: '#ffffff' }
).svg;
assert.equal(headlessSvg.includes('<polygon'), false, 'recognized lines export without an arrow head');

const wrapText = store.addShape({
  type: 'text',
  x: 106000,
  y: 106000,
  w: 80,
  h: 16,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  text: 'Hi',
  fontSize: 12,
});
engine.commitText(
  wrapText,
  'Hi',
  {
    id: wrapText,
    x: 106000,
    y: 106000,
    w: 80,
    h: 16,
    text: 'Hi',
    fontSize: 48,
    color: '#1c1c1a',
    type: 'text',
    centered: false,
  },
  undefined
);
store.flushPendingPatches();
assert.ok(
  store.readShape(store.board.get(wrapText)).h > 40,
  'text commit measures height with the overlay fontSize'
);

let pageCommit = 0;
const pageSticky = store.addShape({
  type: 'sticky',
  x: 110000,
  y: 110000,
  w: 180,
  h: 120,
  fill: '#ffe57a',
  stroke: '#e0b93c',
  strokeWidth: 2,
  textColor: '#3a2f00',
});
engine.events.onRequestCommitText = () => {
  pageCommit += 1;
  const v = engine.views.get(pageSticky);
  engine.commitText(
    pageSticky,
    'page-saved',
    {
      id: pageSticky,
      x: v.x,
      y: v.y,
      w: v.w,
      h: v.h,
      text: '',
      fontSize: 18,
      color: '#3a2f00',
      type: 'sticky',
      centered: false,
    },
    undefined
  );
};
engine.openTextEditor(pageSticky);
engine.resetToPage();
assert.ok(pageCommit >= 1, 'switching pages commits the open text overlay');
assert.equal(store.readShape(store.board.get(pageSticky)).text, 'page-saved', 'page switch keeps the committed sticky text');
engine.events.onRequestCommitText = undefined;

const graphKeep = store.addShape({
  type: 'graph',
  x: 108000,
  y: 108000,
  w: 240,
  h: 160,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
  expr: 'sin(x)',
});
engine.openGraphEditor(graphKeep);
engine.commitGraphPreview(graphKeep, 'x^2');
store.flushPendingPatches();
engine.resetToPage();
store.flushPendingPatches();
assert.equal(engine.views.get(graphKeep).expr, 'sin(x)', 'switching pages restores the graph expression');

const beforePen = store.order.length;
engine.setTool('pen');
engine.onPointerDown({ clientX: 80, clientY: 80, button: 0, pointerId: 40, shiftKey: false, altKey: false });
engine.onPointerMove({ clientX: 140, clientY: 130, button: 0, pointerId: 40, shiftKey: false, altKey: false });
engine.onKeyDown({ key: 'Escape', preventDefault() {}, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Escape' });
engine.onPointerUp({ clientX: 140, clientY: 130, button: 0, pointerId: 40, shiftKey: false, altKey: false });
assert.equal(store.order.length, beforePen, 'Escape cancels an in-progress pen stroke');
engine.setTool('select');

const rotSticky = store.addShape({
  type: 'sticky',
  x: 107000,
  y: 107050,
  w: 100,
  h: 20,
  rotation: 90,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
engine.setTool('eraser');
const miss = engine.worldToScreen(107120, 107040);
engine.onPointerDown({ clientX: miss.x, clientY: miss.y, button: 0, pointerId: 41, shiftKey: false, altKey: false });
engine.onPointerUp({ clientX: miss.x, clientY: miss.y, button: 0, pointerId: 41, shiftKey: false, altKey: false });
store.flushPendingPatches();
assert.ok(store.board.get(rotSticky), 'eraser uses the rotated sticky, not its unrotated AABB');
engine.setTool('select');

const prevEraseMode = settings.eraser.mode;
const prevEraseSize = settings.eraser.size;
settings.eraser.mode = 'partial';
settings.eraser.size = 12;
const splitPen = store.addShape({
  type: 'pen',
  x: 109000,
  y: 109000,
  w: 100,
  h: 4,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [109000, 109000, 109100, 109000],
});
engine.setTool('eraser');
const brushScr = engine.worldToScreen(109010, 109000);
engine.onPointerDown({ clientX: brushScr.x, clientY: brushScr.y, button: 0, pointerId: 42, shiftKey: false, altKey: false });
engine.onPointerUp({ clientX: brushScr.x, clientY: brushScr.y, button: 0, pointerId: 42, shiftKey: false, altKey: false });
store.flushPendingPatches();
const splitPts = engine.views.get(splitPen)?.points ?? [];
assert.ok(splitPts[2] < 109025, '2-point erase opens a gap at the brush, not the midpoint');
settings.eraser.mode = prevEraseMode;
settings.eraser.size = prevEraseSize;
engine.setTool('select');

assert.ok(Math.abs(mapAlongTableFractions([0.5, 0.5], [0.6, 0.4], 0.5) - 0.6) < 1e-9, 'divider keeps the split on the divider');

const insTbl = store.addShape({
  type: 'table',
  x: 114000,
  y: 114000,
  w: 200,
  h: 100,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  cols: 2,
  rows: 2,
  cells: [],
});
const topNote = store.addShape({
  type: 'sticky',
  x: 114020,
  y: 114010,
  w: 40,
  h: 30,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
const botNote = store.addShape({
  type: 'sticky',
  x: 114020,
  y: 114060,
  w: 40,
  h: 30,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
engine.tableInsertRow(insTbl, 1);
store.flushPendingPatches();
assert.equal(store.readShape(store.board.get(topNote)).y, 114010, 'notes above an inserted row stay put');
assert.equal(store.readShape(store.board.get(botNote)).y, 114110, 'notes below an inserted row follow the cell');
engine.tableRemoveRow(insTbl, 1);
store.flushPendingPatches();
assert.equal(store.readShape(store.board.get(botNote)).y, 114060, 'removing the row restores the note');
engine.tableInsertCol(insTbl, 0);
store.flushPendingPatches();
assert.equal(store.readShape(store.board.get(topNote)).x, 114120, 'inserting a column to the left pushes notes');
engine.tableRemoveCol(insTbl, 0);
store.flushPendingPatches();
assert.equal(store.readShape(store.board.get(topNote)).x, 114020, 'removing the column restores the note');

engine.setSelection([insTbl]);
engine.duplicateSelection();
store.flushPendingPatches();
const dupNotes = [...engine.views.values()].filter(
  (v) => v.type === 'sticky' && Math.abs(v.x - (114020 + 40 / engine.camera.zoom)) < 0.5
);
assert.ok(dupNotes.length >= 1, 'duplicating a table copies glued notes');
engine.setSelection([]);

const clipTbl = store.addShape({
  type: 'table',
  x: 131000,
  y: 131000,
  w: 400,
  h: 200,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  cols: 2,
  rows: 2,
  cells: [],
});
const clipA = store.addShape({
  type: 'sticky',
  x: 131040,
  y: 131040,
  w: 40,
  h: 40,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
const clipB = store.addShape({
  type: 'sticky',
  x: 131220,
  y: 131040,
  w: 40,
  h: 40,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
const clipArr = store.addShape({
  type: 'arrow',
  x: 131080,
  y: 131050,
  w: 140,
  h: 20,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [131080, 131060, 131220, 131060],
  fromId: clipA,
  toId: clipB,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([clipA, clipB]));
engine.setSelection([clipTbl]);
engine.duplicateSelection();
store.flushPendingPatches();
const clipDupIds = [...engine.selection];
const clipDupArr = clipDupIds.map((id) => engine.views.get(id)).find((v) => v && v.type === 'arrow');
assert.ok(clipDupArr, 'duplicating a table copies connectors that join glued notes');
assert.ok(clipDupArr.fromId && clipDupArr.toId, 'copied connector keeps both ends');
assert.ok(clipDupIds.includes(clipDupArr.fromId) && clipDupIds.includes(clipDupArr.toId), 'copied connector joins the copied notes');
assert.ok(clipDupArr.fromId !== clipA && clipDupArr.toId !== clipB, 'copied connector does not point at the originals');
void clipArr;
engine.setSelection([]);

const spinTbl = store.addShape({
  type: 'table',
  x: 115000,
  y: 115000,
  w: 200,
  h: 100,
  rotation: 90,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  cols: 2,
  rows: 2,
  cells: [],
});
const spinHost = engine.views.get(spinTbl);
const spinCenter = localToWorld(spinHost, 100, 75);
const spinNote = store.addShape({
  type: 'sticky',
  x: spinCenter.x - 10,
  y: spinCenter.y - 10,
  w: 20,
  h: 20,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
engine.tableInsertRow(spinTbl, 1);
store.flushPendingPatches();
const spinAfter = engine.views.get(spinTbl);
const spinExpect = localToWorld(spinAfter, 100, 125);
const spinGot = store.readShape(store.board.get(spinNote));
assert.ok(
  Math.hypot(spinGot.x + 10 - spinExpect.x, spinGot.y + 10 - spinExpect.y) < 1e-6,
  'inserting a row on a 90° table keeps notes in local cells'
);

const divTbl = store.addShape({
  type: 'table',
  x: 116000,
  y: 116000,
  w: 400,
  h: 200,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  cols: 2,
  rows: 2,
  cells: [],
});
const divNote = store.addShape({
  type: 'sticky',
  x: 116250,
  y: 116020,
  w: 40,
  h: 40,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
engine.setTool('select');
engine.setSelection([divTbl]);
const divWorld = localToWorld(engine.views.get(divTbl), 200, 100);
const divScr = engine.worldToScreen(divWorld.x, divWorld.y);
engine.onPointerDown({ clientX: divScr.x, clientY: divScr.y, button: 0, pointerId: 50, shiftKey: false, altKey: false });
const divScr2 = engine.worldToScreen(divWorld.x + 40, divWorld.y);
engine.onPointerMove({ clientX: divScr2.x, clientY: divScr2.y, button: 0, pointerId: 50, shiftKey: false, altKey: false });
engine.onPointerUp({ clientX: divScr2.x, clientY: divScr2.y, button: 0, pointerId: 50, shiftKey: false, altKey: false });
store.flushPendingPatches();
assert.ok(store.readShape(store.board.get(divNote)).x > 116250, 'dragging a column divider moves notes in the cell');
engine.setSelection([]);

// Cell-divider must not stretch ink / photos glued to the table.
const stretchTbl = store.addShape({
  type: 'table',
  x: 130000,
  y: 116000,
  w: 400,
  h: 200,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  cols: 2,
  rows: 2,
  cells: [],
});
const stretchPen = store.addShape({
  type: 'pen',
  x: 130020,
  y: 116040,
  w: 60,
  h: 0,
  stroke: '#111111',
  strokeWidth: 2,
  points: [130020, 116040, 130080, 116040],
});
const stretchImg = store.addShape({
  type: 'image',
  x: 130010,
  y: 116020,
  w: 60,
  h: 40,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
});
const stretchPen0 = store.readShape(store.board.get(stretchPen));
const stretchImg0 = store.readShape(store.board.get(stretchImg));
const stretchLen0 = Math.hypot(
  stretchPen0.points[2] - stretchPen0.points[0],
  stretchPen0.points[3] - stretchPen0.points[1]
);
engine.setTool('select');
engine.setSelection([stretchTbl]);
const stretchDivWorld = localToWorld(engine.views.get(stretchTbl), 200, 100);
const stretchDivScr = engine.worldToScreen(stretchDivWorld.x, stretchDivWorld.y);
engine.onPointerDown({
  clientX: stretchDivScr.x,
  clientY: stretchDivScr.y,
  button: 0,
  pointerId: 150,
  shiftKey: false,
  altKey: false,
});
const stretchDivScr2 = engine.worldToScreen(stretchDivWorld.x + 60, stretchDivWorld.y);
engine.onPointerMove({
  clientX: stretchDivScr2.x,
  clientY: stretchDivScr2.y,
  button: 0,
  pointerId: 150,
  shiftKey: false,
  altKey: false,
});
engine.onPointerUp({
  clientX: stretchDivScr2.x,
  clientY: stretchDivScr2.y,
  button: 0,
  pointerId: 150,
  shiftKey: false,
  altKey: false,
});
store.flushPendingPatches();
const stretchPen1 = store.readShape(store.board.get(stretchPen));
const stretchImg1 = store.readShape(store.board.get(stretchImg));
const stretchLen1 = Math.hypot(
  stretchPen1.points[2] - stretchPen1.points[0],
  stretchPen1.points[3] - stretchPen1.points[1]
);
assert.ok(Math.abs(stretchLen1 - stretchLen0) < 1e-6, 'column divider does not stretch glued pen length');
assert.equal(stretchImg1.w, stretchImg0.w, 'column divider does not stretch glued image width');
assert.equal(stretchImg1.h, stretchImg0.h, 'column divider does not stretch glued image height');
assert.ok(stretchImg1.x > stretchImg0.x, 'column divider still moves the image with the cell');
engine.setSelection([]);

const beforePagePen = store.order.length;
engine.setTool('pen');
engine.onPointerDown({ clientX: 90, clientY: 90, button: 0, pointerId: 51, shiftKey: false, altKey: false });
engine.onPointerMove({ clientX: 130, clientY: 120, button: 0, pointerId: 51, shiftKey: false, altKey: false });
engine.resetToPage();
engine.onPointerUp({ clientX: 130, clientY: 120, button: 0, pointerId: 51, shiftKey: false, altKey: false });
assert.equal(store.order.length, beforePagePen, 'switching pages cancels an in-progress pen');
engine.setTool('select');

let exportCalls = 0;
engine.events.onExportRegion = () => {
  exportCalls += 1;
};
engine.setSelection([id]);
engine.beginExportPick();
engine.onPointerDown({ clientX: 200, clientY: 200, button: 0, pointerId: 61, shiftKey: false, altKey: false });
engine.onPointerMove({ clientX: 260, clientY: 250, button: 0, pointerId: 61, shiftKey: false, altKey: false });
engine.onKeyDown({ key: 'Escape', preventDefault() {}, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Escape' });
assert.equal(engine.selection.size, 1, 'canceling export pick keeps the selection');
engine.onPointerUp({ clientX: 260, clientY: 250, button: 0, pointerId: 61, shiftKey: false, altKey: false });
assert.equal(exportCalls, 0, 'Escape cancels export-region pick');
engine.events.onExportRegion = undefined;

engine.setSelection([id]);
const exportPickCount = store.board.size;
engine.beginExportPick();
engine.onKeyDown({ key: 'Delete', preventDefault() {}, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Delete' });
store.flushPendingPatches();
assert.equal(store.board.size, exportPickCount, 'Delete during export pick does not remove shapes');
assert.equal(engine.selection.has(id), true, 'Delete during export pick keeps the selection');
engine.onKeyDown({ key: 'Escape', preventDefault() {}, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Escape' });

const connFrom = store.addShape({
  type: 'rect',
  x: 117000,
  y: 117000,
  w: 80,
  h: 80,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const connTo = store.addShape({
  type: 'rect',
  x: 117200,
  y: 117000,
  w: 80,
  h: 80,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
engine.setSelection([connFrom]);
const connPort = engine.getPortWorldPos(connFrom, 'e');
assert.ok(connPort, 'east port exists');
const connScr = engine.worldToScreen(connPort.x, connPort.y);
const beforeConn = store.order.length;
engine.onPointerDown({ clientX: connScr.x, clientY: connScr.y, button: 0, pointerId: 62, shiftKey: false, altKey: false });
assert.equal(canvas.style.cursor, 'crosshair', 'port down starts a connector');
const connToScr = engine.worldToScreen(117240, 117040);
engine.onPointerMove({ clientX: connToScr.x, clientY: connToScr.y, button: 0, pointerId: 62, shiftKey: false, altKey: false });
engine.onKeyDown({ key: 'Escape', preventDefault() {}, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Escape' });
engine.onPointerUp({ clientX: connToScr.x, clientY: connToScr.y, button: 0, pointerId: 62, shiftKey: false, altKey: false });
assert.equal(store.order.length, beforeConn, 'Escape cancels an in-progress connector');
void connTo;
engine.setTool('select');

const lifeImg = store.addShape({
  type: 'image',
  x: 120000,
  y: 120000,
  w: 200,
  h: 150,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
});
const lifeNote = store.addShape({
  type: 'sticky',
  x: 120020,
  y: 120020,
  w: 40,
  h: 30,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
const lifeCover = store.addShape({
  type: 'rect',
  x: 121000,
  y: 121000,
  w: 20,
  h: 20,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
engine.setSelection([lifeImg]);
engine.bringFront();
assert.equal(store.order.get(store.order.length - 1), lifeNote, 'bringFront of a photo keeps glued notes on top');
assert.equal(store.order.get(store.order.length - 2), lifeImg, 'bringFront parks the photo just under its notes');
engine.sendBack();
assert.equal(store.order.get(0), lifeImg, 'sendBack of a photo sends the host first');
assert.equal(store.order.get(1), lifeNote, 'sendBack keeps glued notes above the photo');
void lifeCover;

const nLife = store.board.size;
engine.setSelection([lifeImg]);
engine.cutSelection();
assert.equal(store.board.has(lifeImg), false, 'cut removes the photo');
assert.equal(store.board.has(lifeNote), false, 'cut removes glued notes with the photo');
assert.equal(store.board.size, nLife - 2, 'cut does not leave rider orphans');
engine.pasteSelection();
assert.equal(store.board.size, nLife, 'paste restores the photo and its notes');

const delFrame = store.addShape({
  type: 'frame',
  x: 122000,
  y: 122000,
  w: 240,
  h: 180,
  fill: 'rgba(255,255,255,0.06)',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const delInner = store.addShape({
  type: 'rect',
  x: 122040,
  y: 122040,
  w: 60,
  h: 40,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
engine.setSelection([delFrame]);
engine.deleteSelection();
assert.equal(store.board.has(delFrame), false, 'deleting a frame removes the frame');
assert.equal(store.board.has(delInner), false, 'deleting a frame removes nested shapes');

const expTbl = store.addShape({
  type: 'table',
  x: 123000,
  y: 123000,
  w: 200,
  h: 100,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  cols: 2,
  rows: 2,
  cells: [],
});
const expNote = store.addShape({
  type: 'sticky',
  x: 123160,
  y: 123060,
  w: 80,
  h: 80,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
engine.setSelection([expTbl]);
const hostBox = engine.selectionBounds();
const exportBox = engine.selectionExportBounds();
assert.ok(hostBox, 'selected table has bounds');
assert.ok(exportBox, 'export bounds include glued notes');
assert.ok(exportBox.w > hostBox.w + 20, 'export bounds grow for a note that hangs off the table');
assert.ok(exportBox.x + exportBox.w >= 123240 - 1, 'export bounds cover the hanging note');
void expNote;
engine.setSelection([]);

const expSel = store.addShape({
  type: 'rect',
  x: 201000,
  y: 201000,
  w: 80,
  h: 80,
  fill: '#12ab34',
  stroke: '#0a7a22',
  strokeWidth: 2,
});
const expNeighbor = store.addShape({
  type: 'rect',
  x: 201040,
  y: 201010,
  w: 80,
  h: 80,
  fill: '#ab3412',
  stroke: '#7a220a',
  strokeWidth: 2,
});
engine.setSelection([expSel]);
const selExportBox = engine.selectionExportBounds();
const selSvg = engine.exportSvg(selExportBox, { background: '#ffffff', ids: engine.selectionExportIds() });
assert.ok(selSvg, 'selection SVG export returns a blob');
const selSvgText = await selSvg.blob.text();
assert.ok(selSvgText.includes('#12ab34'), 'selection export includes the selected fill');
assert.equal(selSvgText.includes('#ab3412'), false, 'selection export omits a neighbor that only overlaps the AABB');
const boardSvg = engine.exportSvg(engine.contentBox(), { background: '#ffffff' });
const boardSvgText = await boardSvg.blob.text();
assert.ok(boardSvgText.includes('#ab3412'), 'full-board export still includes the neighbor');
void expNeighbor;
engine.setSelection([]);

const flatCrop = reanchorCroppedBox({ x: 0, y: 0, w: 200, h: 100 }, { x: 50, y: 20, w: 80, h: 40 });
assert.equal(flatCrop.x, 50, 'unrotated crop keeps AABB x');
assert.equal(flatCrop.y, 20, 'unrotated crop keeps AABB y');
const rotOrig = { x: 0, y: 0, w: 200, h: 100, rotation: 90 };
const rotCropBox = { x: 50, y: 20, w: 80, h: 40 };
const rotPlaced = reanchorCroppedBox(rotOrig, rotCropBox);
const cropTL = localToWorld(rotOrig, rotCropBox.x - rotOrig.x, rotCropBox.y - rotOrig.y);
const placedTL = localToWorld({ ...rotPlaced, rotation: 90 }, 0, 0);
assert.ok(Math.hypot(cropTL.x - placedTL.x, cropTL.y - placedTL.y) < 1e-6, 'rotated crop keeps the window top-left in world space');
const cropJumpImg = store.addShape({
  type: 'image',
  x: 202000,
  y: 202000,
  w: 200,
  h: 100,
  rotation: 90,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
});
engine.setSelection([cropJumpImg]);
engine.startCropSelected();
assert.ok(engine.crop, 'crop overlay starts on a rotated image');
engine.crop.box = { x: 202050, y: 202020, w: 80, h: 40 };
const cropJumpBefore = engine.views.get(cropJumpImg);
const cropJumpWant = localToWorld(cropJumpBefore, 50, 20);
engine.applyCrop();
const cropJumpAfter = engine.views.get(cropJumpImg);
const cropJumpGot = localToWorld(cropJumpAfter, 0, 0);
assert.ok(Math.hypot(cropJumpWant.x - cropJumpGot.x, cropJumpWant.y - cropJumpGot.y) < 1e-6, 'applyCrop reanchors a rotated crop window');
assert.equal(cropJumpAfter.w, 80);
assert.equal(cropJumpAfter.h, 40);
engine.resetCropSelected();
const cropJumpReset = engine.views.get(cropJumpImg);
assert.equal(cropJumpReset.x, 202000, 'reset crop restores the original AABB x');
assert.equal(cropJumpReset.y, 202000, 'reset crop restores the original AABB y');
assert.equal(cropJumpReset.w, 200);
assert.equal(cropJumpReset.h, 100);
const flatRestored = restoreUncroppedBox({ x: 50, y: 20, w: 80, h: 40, cropX: 0.25, cropY: 0.2, cropW: 0.4, cropH: 0.4 });
assert.equal(flatRestored.x, 0);
assert.equal(flatRestored.y, 0);
engine.setSelection([]);

let wrapMax = null;
const origWrapped = engine.measureTextWrapped.bind(engine);
engine.measureTextWrapped = (text, fontSize, maxW, fmt) => {
  wrapMax = maxW;
  return origWrapped(text, fontSize, maxW, fmt);
};
engine.openTextEditorAt(203000, 203000, 16, '#1c1c1a');
engine.commitText(null, 'A long line of click-to-type copy that must wrap like the overlay', {
  id: null,
  x: 203000,
  y: 203000,
  w: TEXT_TOOL_WRAP_W,
  h: 30,
  text: '',
  fontSize: 16,
  color: '#1c1c1a',
  type: 'text',
  centered: false,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  textAlign: 'left',
  highlight: false,
});
engine.measureTextWrapped = origWrapped;
assert.equal(wrapMax, TEXT_TOOL_WRAP_W, 'new text commits wrap to the overlay width');
engine.cancelTextEdit();

let pasteWrap = null;
const origPasteWrap = engine.measureTextWrapped.bind(engine);
engine.measureTextWrapped = (text, fontSize, maxW, fmt) => {
  pasteWrap = maxW;
  return origPasteWrap(text, fontSize, maxW, fmt);
};
engine.insertPlainText('pasted line that should wrap like the text tool');
engine.measureTextWrapped = origPasteWrap;
assert.equal(pasteWrap, TEXT_TOOL_WRAP_W, 'plain-text paste wraps at the text-tool width');

const pageA = store.currentPageId();
const prevPageCommit = engine.events.onRequestCommitText;
engine.events.onRequestCommitText = () => {
  engine.commitText(null, 'typed-on-page-a', {
    id: null,
    x: 204000,
    y: 204000,
    w: TEXT_TOOL_WRAP_W,
    h: 30,
    text: '',
    fontSize: 16,
    color: '#1c1c1a',
    type: 'text',
    centered: false,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    textAlign: 'left',
    highlight: false,
  });
};
engine.openTextEditorAt(204000, 204000, 16, '#1c1c1a');
store.addPage();
store.flushPendingPatches();
let typedKey = null;
for (const key of store.board.keys()) {
  const v = store.readShape(store.board.get(key));
  if (v?.text === 'typed-on-page-a') typedKey = key;
}
assert.ok(typedKey, 'page switch still commits click-to-type text');
assert.equal(
  typedKey.includes(':'),
  pageA !== 'main',
  'new text stays on the page where typing started'
);
if (pageA === 'main') {
  assert.equal(typedKey.includes(':'), false, 'text started on main has no page prefix');
} else {
  assert.ok(typedKey.startsWith(pageA + ':'), 'text key uses the origin page prefix');
}
assert.equal(store.isOnActivePage(typedKey), false, 'committed text is not on the destination page');
store.setCurrentPage(pageA);
engine.resetToPage();
engine.events.onRequestCommitText = prevPageCommit;
engine.cancelTextEdit();

const escFrom = store.addShape({
  type: 'rect',
  x: 125000,
  y: 125000,
  w: 80,
  h: 80,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const escTo = store.addShape({
  type: 'rect',
  x: 125220,
  y: 125000,
  w: 80,
  h: 80,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const escArr = store.addShape({
  type: 'arrow',
  x: 125080,
  y: 125030,
  w: 140,
  h: 20,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [125080, 125040, 125220, 125040],
  fromId: escFrom,
  toId: escTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([escFrom, escTo]));
const escPts0 = (engine.views.get(escArr).points || []).slice();
engine.setTool('select');
engine.setSelection([escFrom]);
const escV = engine.views.get(escFrom);
const escEast = localToWorld(escV, escV.w, escV.h / 2);
const escEastScr = engine.worldToScreen(escEast.x, escEast.y);
engine.onPointerDown({ clientX: escEastScr.x, clientY: escEastScr.y, button: 0, pointerId: 71, shiftKey: false, altKey: false });
const escDrag = engine.worldToScreen(escEast.x + 60, escEast.y);
engine.onPointerMove({ clientX: escDrag.x, clientY: escDrag.y, button: 0, pointerId: 71, shiftKey: false, altKey: false });
store.flushPendingPatches();
const escPtsLive = engine.views.get(escArr).points || [];
assert.ok(
  escPtsLive[0] !== escPts0[0] || escPtsLive[2] !== escPts0[2],
  'live resize rebakes the connector'
);
engine.onKeyDown({ key: 'Escape', preventDefault() {}, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Escape' });
store.flushPendingPatches();
const escPts1 = engine.views.get(escArr).points || [];
assert.ok(
  escPts1.every((n, i) => Math.abs(n - escPts0[i]) < 1e-6),
  'Escape during resize restores connected arrows'
);
assert.equal(store.readShape(store.board.get(escFrom)).w, 80, 'Escape during resize restores the host size');
// ponytail: no pointerup — Escape must drop the cancelled pointer or the next
// down (new pointerId) is treated as a two-finger pinch and swallowed.

const divArrTbl = store.addShape({
  type: 'table',
  x: 126000,
  y: 126000,
  w: 400,
  h: 200,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  cols: 2,
  rows: 2,
  cells: [],
});
const divArrNote = store.addShape({
  type: 'sticky',
  x: 126250,
  y: 126020,
  w: 40,
  h: 40,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
const divArrTo = store.addShape({
  type: 'rect',
  x: 126500,
  y: 126020,
  w: 80,
  h: 80,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const divArr = store.addShape({
  type: 'arrow',
  x: 126290,
  y: 126030,
  w: 210,
  h: 20,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [126290, 126040, 126500, 126060],
  fromId: divArrNote,
  toId: divArrTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([divArrNote, divArrTo]));
const divArrPts0 = (engine.views.get(divArr).points || []).slice();
engine.setTool('select');
engine.setSelection([divArrTbl]);
const divArrWorld = localToWorld(engine.views.get(divArrTbl), 200, 100);
const divArrScr = engine.worldToScreen(divArrWorld.x, divArrWorld.y);
engine.onPointerDown({ clientX: divArrScr.x, clientY: divArrScr.y, button: 0, pointerId: 72, shiftKey: false, altKey: false });
const divArrScr2 = engine.worldToScreen(divArrWorld.x + 40, divArrWorld.y);
engine.onPointerMove({ clientX: divArrScr2.x, clientY: divArrScr2.y, button: 0, pointerId: 72, shiftKey: false, altKey: false });
engine.onPointerUp({ clientX: divArrScr2.x, clientY: divArrScr2.y, button: 0, pointerId: 72, shiftKey: false, altKey: false });
store.flushPendingPatches();
const divArrPts1 = engine.views.get(divArr).points || [];
const divArrExpect = connectedArrowGeometry(engine.views.get(divArrNote), engine.views.get(divArrTo), 'e', 'w');
assert.ok(
  divArrPts1[0] !== divArrPts0[0] || divArrPts1[1] !== divArrPts0[1],
  'dragging a table divider rebakes arrows on moved notes'
);
assert.ok(
  divArrExpect.points.every((n, i) => Math.abs(n - divArrPts1[i]) < 1e-6),
  'divider-moved notes keep connectors on their ports'
);

const escDivTbl = store.addShape({
  type: 'table',
  x: 128000,
  y: 128000,
  w: 400,
  h: 200,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  cols: 2,
  rows: 2,
  cells: [],
});
const escDivNote = store.addShape({
  type: 'sticky',
  x: 128250,
  y: 128020,
  w: 40,
  h: 40,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
const escDivTo = store.addShape({
  type: 'rect',
  x: 128500,
  y: 128020,
  w: 80,
  h: 80,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const escDivArr = store.addShape({
  type: 'arrow',
  x: 128290,
  y: 128030,
  w: 210,
  h: 20,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [128290, 128040, 128500, 128060],
  fromId: escDivNote,
  toId: escDivTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([escDivNote, escDivTo]));
const escDivPts0 = (engine.views.get(escDivArr).points || []).slice();
const escDivCol0 = [...tableGrid(engine.views.get(escDivTbl)).colW];
engine.setTool('select');
engine.setSelection([escDivTbl]);
const escDivWorld = localToWorld(engine.views.get(escDivTbl), 200, 100);
const escDivScr = engine.worldToScreen(escDivWorld.x, escDivWorld.y);
engine.onPointerDown({ clientX: escDivScr.x, clientY: escDivScr.y, button: 0, pointerId: 73, shiftKey: false, altKey: false });
const escDivScr2 = engine.worldToScreen(escDivWorld.x + 40, escDivWorld.y);
engine.onPointerMove({ clientX: escDivScr2.x, clientY: escDivScr2.y, button: 0, pointerId: 73, shiftKey: false, altKey: false });
store.flushPendingPatches();
assert.ok(
  (engine.views.get(escDivArr).points || [])[0] !== escDivPts0[0] ||
    (engine.views.get(escDivArr).points || [])[1] !== escDivPts0[1],
  'live divider drag rebakes the connector'
);
engine.onKeyDown({ key: 'Escape', preventDefault() {}, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Escape' });
store.flushPendingPatches();
const escDivPts1 = engine.views.get(escDivArr).points || [];
assert.ok(
  escDivPts1.every((n, i) => Math.abs(n - escDivPts0[i]) < 1e-6),
  'Escape during divider drag restores connected arrows'
);
assert.equal(store.readShape(store.board.get(escDivNote)).x, 128250, 'Escape during divider drag restores the note');
assert.ok(
  tableGrid(engine.views.get(escDivTbl)).colW.every((f, i) => Math.abs(f - escDivCol0[i]) < 1e-6),
  'Escape during divider drag restores column fractions'
);

const rideTbl = store.addShape({
  type: 'table',
  x: 129000,
  y: 129000,
  w: 400,
  h: 200,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  cols: 2,
  rows: 2,
  cells: [],
});
const rideNote = store.addShape({
  type: 'sticky',
  x: 129040,
  y: 129040,
  w: 40,
  h: 40,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
const rideTo = store.addShape({
  type: 'rect',
  x: 129500,
  y: 129040,
  w: 80,
  h: 80,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const rideArr = store.addShape({
  type: 'arrow',
  x: 129080,
  y: 129050,
  w: 420,
  h: 20,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [129080, 129060, 129500, 129080],
  fromId: rideNote,
  toId: rideTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([rideNote, rideTo]));
const rideViews = [rideTbl, rideNote, rideTo, rideArr].map((k) => ({
  ...store.readShape(store.board.get(k)),
  id: k,
}));
assert.ok(!hostRiderIds(rideViews, [rideTbl]).includes(rideArr), 'connected arrows are not table riders');
engine.setSelection([rideTbl]);
engine.translateSelection(40, 0);
store.flushPendingPatches();
assert.equal(store.readShape(store.board.get(rideNote)).x, 129080, 'table nudge carries the glued note');
assert.equal(store.readShape(store.board.get(rideTo)).x, 129500, 'off-table connector target stays put');
const rideExpect = connectedArrowGeometry(engine.views.get(rideNote), engine.views.get(rideTo), 'e', 'w');
assert.ok(
  rideExpect.points.every((n, i) => Math.abs(n - (engine.views.get(rideArr).points || [])[i]) < 1e-6),
  'moving a table rebakes connectors instead of translating them'
);
engine.setSelection([]);

const diamondBefore = new Set([...store.board.keys()]);
const prevFilled = settings.shape.filled;
const prevStrokeW = settings.shape.strokeWidth;
try {
  settings.shape.filled = false;
  settings.shape.strokeWidth = 5;
  const diamondTool = engine.tools.get('diamond');
  const dinfo = (x, y, shift = false) => ({ screen: { x, y }, world: { x, y }, shift, alt: false });
  diamondTool.onDown(engine, dinfo(80000, 80000));
  diamondTool.onMove(engine, dinfo(80120, 80040, true));
  diamondTool.onUp(engine, dinfo(80120, 80040, true));
  const diamondCreated = [...store.board.keys()].filter((k) => !diamondBefore.has(k));
  assert.equal(diamondCreated.length, 1, 'diamond tool created one shape');
  const diamondView = store.readShape(store.board.get(diamondCreated[0]));
  assert.equal(diamondView.w, diamondView.h, 'Shift draw squares a diamond');
  assert.equal(diamondView.fill, 'transparent', 'unfilled setting stores a transparent diamond');
  assert.equal(diamondView.strokeWidth, 5, 'diamond stroke uses the shape stroke width');
  assert.equal(engine.editId, diamondCreated[0], 'diamond opens the text editor');

  const termBefore = new Set([...store.board.keys()]);
  const termTool = engine.tools.get('terminator');
  termTool.onDown(engine, dinfo(82000, 82000));
  termTool.onMove(engine, dinfo(82100, 82040, true));
  termTool.onUp(engine, dinfo(82100, 82040, true));
  const termCreated = [...store.board.keys()].filter((k) => !termBefore.has(k));
  assert.equal(termCreated.length, 1, 'terminator tool created one shape');
  const termView = store.readShape(store.board.get(termCreated[0]));
  assert.equal(termView.w, termView.h, 'Shift draw squares a terminator');
  assert.equal(termView.fill, 'transparent', 'unfilled setting stores a transparent terminator');
  assert.equal(termView.strokeWidth, 5, 'terminator stroke uses the shape stroke width');
  assert.equal(engine.active, 'select', 'terminator drops back to select');
} finally {
  settings.shape.filled = prevFilled;
  settings.shape.strokeWidth = prevStrokeW;
  engine.editing = false;
  engine.editId = null;
}

engine.setTool('select');
engine.onKeyDown({ key: ' ', preventDefault() {}, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Space' });
assert.equal(engine.tool.id, 'pan', 'holding Space temporarily pans');
window.dispatchEvent({ type: 'blur' });
assert.equal(engine.tool.id, 'select', 'window blur drops Space-to-pan');
engine.onKeyDown({ key: ' ', preventDefault() {}, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Space' });
assert.equal(engine.tool.id, 'pan', 'Space pans again after blur');
document.visibilityState = 'hidden';
for (const fn of documentListeners.get('visibilitychange') ?? []) fn();
assert.equal(engine.tool.id, 'select', 'hiding the tab drops Space-to-pan');
document.visibilityState = 'visible';

// Regression: first Space after a tool pick must pan even when focus is still on
// the toolbar button (browser leaves focus there after click).
if (typeof globalThis.HTMLElement === 'undefined') {
  globalThis.HTMLElement = class HTMLElement {};
}
const toolBtn = {
  tagName: 'BUTTON',
  isContentEditable: false,
  closest(sel) {
    return String(sel).includes('button') ? toolBtn : null;
  },
};
Object.setPrototypeOf(toolBtn, globalThis.HTMLElement.prototype);
engine.setTool('pen');
assert.equal(engine.tool.id, 'pen', 'setup: pen active before Space');
let spacePrevented = false;
engine.onKeyDown({
  key: ' ',
  code: 'Space',
  target: toolBtn,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  preventDefault() {
    spacePrevented = true;
  },
});
assert.equal(spacePrevented, true, 'Space on focused tool button still preventDefaults');
assert.equal(engine.tool.id, 'pan', 'first Space after tool pick pans (button focus)');
assert.equal(engine.active, 'pen', 'active tool stays pen under Space override');
engine.setTool('eraser');
assert.equal(engine.tool.id, 'pan', 'tool swap while Space held keeps temp pan');
assert.equal(engine.active, 'eraser', 'active tool updates under held Space');
engine.onKeyUp({ key: ' ' });
assert.equal(engine.tool.id, 'eraser', 'Space up restores the tool chosen while held');
engine.onKeyDown({
  key: ' ',
  code: 'Space',
  target: toolBtn,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  preventDefault() {},
});
assert.equal(engine.tool.id, 'pan', 'second Space hold still pans');
engine.onKeyUp({ key: ' ' });
assert.equal(engine.tool.id, 'eraser', 'Space up restores eraser again');

assert.equal(penStrokeWidthForSize({ alpha: 0.3 }, 5), 20, 'highlighter brush size is 4× the slider');
assert.equal(penStrokeWidthForSize({ alpha: 1 }, 5), 5, 'marker brush size matches the slider');
assert.equal(penStrokeWidthForSize({}, 5), 5, 'missing alpha is treated as a marker');

const halfFrom = store.addShape({
  type: 'rect',
  x: 207000,
  y: 207000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const halfTo = store.addShape({
  type: 'rect',
  x: 207200,
  y: 207000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const halfArr = store.addShape({
  type: 'arrow',
  x: 207080,
  y: 207020,
  w: 120,
  h: 10,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [207080, 207025, 207200, 207025],
  fromId: halfFrom,
  toId: halfTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([halfFrom, halfTo]));
engine.setSelection([halfFrom, halfArr]);
engine.duplicateSelection();
store.flushPendingPatches();
const halfDupArr = [...engine.selection].map((id) => engine.views.get(id)).find((v) => v && v.type === 'arrow');
assert.ok(halfDupArr, 'duplicating one endpoint plus the arrow copies the arrow');
assert.equal(halfDupArr.fromId, undefined, 'half-copied arrow does not keep one glued end');
assert.equal(halfDupArr.toId, undefined, 'half-copied arrow stays a free connector');
engine.setSelection([]);

engine.setSelection([halfFrom, halfTo]);
engine.duplicateSelection();
store.flushPendingPatches();
const bothDupArr = [...engine.selection].map((id) => engine.views.get(id)).find((v) => v && v.type === 'arrow');
assert.ok(bothDupArr && bothDupArr.fromId && bothDupArr.toId, 'duplicating both endpoints remaps the connector');
assert.ok(
  [...engine.selection].includes(bothDupArr.fromId) && [...engine.selection].includes(bothDupArr.toId),
  'remapped connector joins the copied nodes'
);
assert.ok(bothDupArr.fromId !== halfFrom && bothDupArr.toId !== halfTo, 'remapped connector does not point at the originals');
void halfArr;
engine.setSelection([]);

const uPen = store.addShape({
  type: 'pen',
  x: 206000,
  y: 206000,
  w: 80,
  h: 100,
  fill: 'transparent',
  stroke: '#eceae4',
  strokeWidth: 4,
  points: [206000, 206000, 206000, 206100, 206080, 206100, 206080, 206000],
});
const uHole = [
  { x: 206020, y: 206010 },
  { x: 206060, y: 206010 },
  { x: 206060, y: 206070 },
  { x: 206020, y: 206070 },
];
assert.ok(
  !engine.selectByPolygon(uHole).includes(uPen),
  'lasso in the hollow of a U-stroke does not select by bbox center'
);
const uArm = [
  { x: 205990, y: 206020 },
  { x: 206010, y: 206020 },
  { x: 206010, y: 206080 },
  { x: 205990, y: 206080 },
];
assert.ok(engine.selectByPolygon(uArm).includes(uPen), 'lasso on a U-stroke arm selects the pen');

const cornerBox = store.addShape({
  type: 'rect',
  x: 208000,
  y: 208000,
  w: 100,
  h: 40,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const cornerLasso = [
  { x: 207990, y: 207990 },
  { x: 208020, y: 207990 },
  { x: 208020, y: 208020 },
  { x: 207990, y: 208020 },
];
assert.ok(
  engine.selectByPolygon(cornerLasso).includes(cornerBox),
  'lasso on a box corner selects even when the center is outside'
);
engine.setSelection([]);

const toolTbl = store.addShape({
  type: 'table',
  x: 210000,
  y: 210000,
  w: 200,
  h: 100,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  cols: 2,
  rows: 2,
  cells: ['a', 'b', 'c', 'd'],
});
engine.commitText(toolTbl, 'hello', {
  id: toolTbl,
  x: 210000,
  y: 210000,
  w: 100,
  h: 50,
  text: 'hello',
  fontSize: 14,
  color: '#111111',
  type: 'table',
  centered: false,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  textAlign: 'left',
  highlight: false,
  tableCell: { row: 0, col: 1 },
});
store.flushPendingPatches();
const toolGrid = tableGrid(engine.views.get(toolTbl));
assert.equal(toolGrid.cells[1], 'hello', 'commitText with tableCell writes the cell');
assert.notEqual(engine.views.get(toolTbl).text, 'hello', 'cell commit does not overwrite the table title');

const bowArr = store.addShape({
  type: 'arrow',
  x: 209000 - 6,
  y: 209000 - 6,
  w: 212,
  h: 12,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  arrowHead: 48,
  points: [209000, 209000, 209200, 209000],
});
const bowLasso = [
  { x: 209090, y: 209006 },
  { x: 209110, y: 209006 },
  { x: 209110, y: 209016 },
  { x: 209090, y: 209016 },
];
assert.ok(
  engine.selectByPolygon(bowLasso).includes(bowArr),
  'lasso on an arrow bow selects the painted curve, not only the chord'
);
const bowView = engine.views.get(bowArr);
const bowVisual = visualBox(bowView);
assert.ok(bowVisual.y + bowVisual.h > bowView.y + bowView.h + 0.5, 'arrow visual bounds include the bow beyond the stored box');
const headGeom = describeArrow(bowView);
assert.ok(headGeom, 'quadratic arrow has a head');
const [hx, hy, wx, wy] = headGeom.head;
const wing = { x: (hx + wx * 2) / 3, y: (hy + wy * 2) / 3 };
assert.equal(engine.hitTest(wing.x, wing.y), bowArr, 'clicking an arrowhead wing selects the arrow');

// Arrow geom cache: repeated bounds/hit lookups reuse tessellation; mid-bow still hits.
clearArrowGeomCacheForTest();
const cacheWarm = engine.views.get(bowArr);
const b0 = arrowBounds(cacheWarm);
const poly0 = arrowHitPolyline(cacheWarm);
assert.equal(arrowGeomCacheSizeForTest(), 1, 'arrow bounds warms the geom cache');
const b1 = arrowBounds(cacheWarm);
const poly1 = arrowHitPolyline(cacheWarm);
assert.equal(arrowGeomCacheSizeForTest(), 1, 'repeat arrow lookups reuse the same cache entry');
assert.deepEqual(b0, b1, 'cached arrow bounds stay stable');
assert.strictEqual(poly0, poly1, 'cached hit polyline is the same array reference');
assert.equal(pointInShape(cacheWarm, 209100, 209009), true, 'cached arrow hit-test still follows the painted bow');
assert.equal(pointInShape(cacheWarm, 209100, 209080), false, 'cached arrow misses far from the shaft');

// Wrap-text cache: identical font+width+text reuses lines; miss outside pen AABB is cheap.
clearWrapTextCacheForTest();
ctxProxy.font = '16px sans-serif';
const wrapA = wrapTextLines(ctxProxy, 'hello many shapes wrap cache', 80);
const wrapB = wrapTextLines(ctxProxy, 'hello many shapes wrap cache', 80);
assert.equal(wrapTextCacheSizeForTest(), 1, 'wrapText warms a single cache entry');
assert.strictEqual(wrapA, wrapB, 'wrapText returns the same cached lines array');
const densePen = {
  id: 'pen-aabb',
  type: 'pen',
  x: 300000,
  y: 300000,
  w: 40,
  h: 10,
  fill: 'transparent',
  stroke: '#fff',
  strokeWidth: 2,
  points: [300000, 300005, 300040, 300005],
};
assert.equal(pointInShape(densePen, 300020, 300005), true, 'pen hit on shaft');
assert.equal(pointInShape(densePen, 300020, 300080), false, 'pen AABB rejects far miss');
setPaintZoom(1);

engine.setSelection([]);
engine.setTool('select');
const marqueeTool = engine.tools.get('select');
const marqueeInfo = (x, y) => ({ screen: { x: 0, y: 0 }, world: { x, y }, shift: false, alt: false });
marqueeTool.onDown(engine, marqueeInfo(209090, 209030));
marqueeTool.onMove(engine, marqueeInfo(209110, 209007));
marqueeTool.onUp(engine, marqueeInfo(209110, 209007));
assert.ok(engine.selection.has(bowArr), 'marquee that covers only the bow selects the arrow');
engine.setSelection([]);

const cropRideImg = store.addShape({
  type: 'image',
  x: 211000,
  y: 211000,
  w: 200,
  h: 150,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  src: 'data:image/png;base64,x',
});
const cropRideNote = store.addShape({
  type: 'sticky',
  x: 211040,
  y: 211040,
  w: 40,
  h: 40,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
});
engine.setSelection([cropRideImg]);
engine.startCropSelected();
engine.crop.box = { x: 211100, y: 211000, w: 100, h: 150 };
engine.applyCrop();
store.flushPendingPatches();
const cropRideAfter = store.readShape(store.board.get(cropRideNote));
assert.ok(cropRideAfter.x > 211090, 'cropping a photo carries glued stickies with the remaining window');
engine.setSelection([cropRideImg]);
engine.resetCropSelected();
store.flushPendingPatches();
assert.ok(Math.abs(store.readShape(store.board.get(cropRideNote)).x - 211040) < 1, 'reset crop restores glued stickies');
engine.setSelection([]);

const lockCut = store.addShape({
  type: 'rect',
  x: 212000,
  y: 212000,
  w: 40,
  h: 40,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const clipProbe = store.addShape({
  type: 'rect',
  x: 212500,
  y: 212500,
  w: 30,
  h: 30,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
engine.setSelection([clipProbe]);
engine.copySelection();
engine.setSelection([lockCut]);
engine.toggleLockSelection();
engine.cutSelection();
store.flushPendingPatches();
assert.ok(engine.views.get(lockCut).locked, 'cut leaves a locked shape in place');
assert.equal(engine.clipboard.length, 1, 'cut of a locked shape does not replace the clipboard');
assert.equal(engine.clipboard[0].x, 212500, 'clipboard still holds the last real copy');
engine.setSelection([]);

const pasteProbe = store.addShape({
  type: 'rect',
  x: 213400,
  y: 213400,
  w: 40,
  h: 20,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
engine.setSelection([pasteProbe]);
engine.copySelection();
engine.setPasteAnchor({ x: 213000, y: 213000 });
engine.pasteSelection();
store.flushPendingPatches();
const pasted = engine.views.get([...engine.selection][0]);
assert.ok(Math.abs(pasted.x + pasted.w / 2 - 213000) < 1, 'context paste centers on the right-click');
assert.ok(Math.abs(pasted.y + pasted.h / 2 - 213000) < 1, 'context paste centers on the right-click y');
engine.setSelection([]);

const glueFrom = store.addShape({
  type: 'rect',
  x: 214000,
  y: 214000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const glueTo = store.addShape({
  type: 'rect',
  x: 214200,
  y: 214000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const glueArr = store.addShape({
  type: 'arrow',
  x: 214080,
  y: 214020,
  w: 120,
  h: 10,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [214080, 214025, 214200, 214025],
  fromId: glueFrom,
  toId: glueTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([glueFrom, glueTo]));
engine.setSelection([glueArr]);
engine.translateSelection(25, 0);
store.flushPendingPatches();
const soloMoved = engine.views.get(glueArr);
assert.equal(soloMoved.fromId, undefined, 'nudging only a connected arrow unglues it');
assert.equal(soloMoved.toId, undefined, 'nudging only a connected arrow clears the far end');

const glueFrom2 = store.addShape({
  type: 'rect',
  x: 215000,
  y: 215000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const glueTo2 = store.addShape({
  type: 'rect',
  x: 215200,
  y: 215000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const glueArr2 = store.addShape({
  type: 'arrow',
  x: 215080,
  y: 215020,
  w: 120,
  h: 10,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [215080, 215025, 215200, 215025],
  fromId: glueFrom2,
  toId: glueTo2,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([glueFrom2, glueTo2]));
const gluedPts = (engine.views.get(glueArr2).points || []).slice();
engine.setSelection([glueFrom2, glueTo2]);
engine.translateSelection(40, 0);
store.flushPendingPatches();
const stillGlued = engine.views.get(glueArr2);
assert.equal(stillGlued.fromId, glueFrom2, 'moving both nodes keeps the connector glued');
assert.ok(
  (stillGlued.points || []).some((n, i) => n !== gluedPts[i]),
  'moving both nodes rebakes the connector'
);
engine.setSelection([]);

engine.camera.instant = true;
engine.camera.zoom = 1;
engine.camera.tz = 1;
engine.camera.x = 0;
engine.camera.y = 0;
engine.camera.tx = 0;
engine.camera.ty = 0;
engine.camera.zoomAt(500, 350, 500, 350, 2);
assert.equal(engine.camera.zoom, 2, 'instant zoomAt applies display zoom immediately');
engine.camera.instant = false;
engine.setSelection([]);

const freeArrTool = engine.tools.get('arrow');
const arrInfo = (x, y) => ({ screen: { x: 0, y: 0 }, world: { x, y }, shift: false, alt: false });
const beforeArr = new Set([...store.board.keys()]);
freeArrTool.onDown(engine, arrInfo(216000, 216000));
freeArrTool.onMove(engine, arrInfo(216200, 216000));
freeArrTool.onUp(engine, arrInfo(216200, 216000));
const madeArr = [...store.board.keys()].filter((k) => !beforeArr.has(k));
assert.equal(madeArr.length, 1, 'arrow tool created one arrow');
const madeView = engine.views.get(madeArr[0]);
const madeVisual = visualBox(madeView);
assert.ok(Math.abs(madeView.w - madeVisual.w) < 1e-6, 'new arrows store visual width including bow and head');
assert.ok(madeView.h > 12, 'new arrows store visual height including the bow');
engine.setSelection([]);

assert.equal(textOverlayAllowsRich({ type: 'text' }), true, 'plain text overlay keeps rich shortcuts');
assert.equal(textOverlayAllowsRich({ type: 'sticky' }), true, 'sticky overlay keeps rich shortcuts');
assert.equal(
  textOverlayAllowsRich({ type: 'table', tableCell: { row: 0, col: 0 } }),
  false,
  'table cells do not accept rich overlay markup'
);
assert.equal(textOverlayAllowsRich({ type: 'frame' }), false, 'frame titles do not accept rich overlay markup');

engine.camera.instant = true;
engine.camera.zoom = 1;
engine.camera.tz = 1;
engine.camera.x = 0;
engine.camera.y = 0;
engine.camera.tx = 0;
engine.camera.ty = 0;

engine.setPasteAnchor({ x: 222000, y: 222000 });
engine.insertPlainText('anchor paste');
store.flushPendingPatches();
const anchoredText = engine.views.get([...engine.selection][0]);
assert.ok(Math.abs(anchoredText.x + anchoredText.w / 2 - 222000) < 1, 'plain-text context paste uses pasteAt');
assert.ok(Math.abs(anchoredText.y + anchoredText.h / 2 - 222000) < 1, 'plain-text context paste uses pasteAt y');

engine.setPasteAnchor({ x: 223000, y: 223000 });
engine.setPasteAnchor(null);
engine.insertPlainText('camera paste');
store.flushPendingPatches();
const cameraText = engine.views.get([...engine.selection][0]);
assert.ok(Math.abs(cameraText.x + cameraText.w / 2 - 0) < 1, 'cleared pasteAt places text at the camera');

const lockGraph = store.addShape({
  type: 'graph',
  x: 224000,
  y: 224000,
  w: 240,
  h: 160,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
  expr: 'sin(x)',
});
engine.setSelection([lockGraph]);
engine.toggleLockSelection();
let graphOpened = false;
let textOpened = false;
engine.events.onEditGraph = () => {
  graphOpened = true;
};
engine.events.onEditText = () => {
  textOpened = true;
};
engine.openGraphEditor(lockGraph);
assert.equal(engine.editing, false, 'locked graph does not open the formula editor');
assert.equal(graphOpened, false, 'locked graph does not fire onEditGraph');
engine.toggleLockSelection();
engine.onKeyDown({
  key: 'Enter',
  preventDefault() {},
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  code: 'Enter',
});
assert.equal(graphOpened, true, 'Enter on a graph opens the formula editor');
assert.equal(textOpened, false, 'Enter on a graph does not open the text overlay');
engine.cancelGraphEditor();

let cropOn = false;
engine.events.onCrop = (active) => {
  cropOn = active;
};
const enterImg = store.addShape({
  type: 'image',
  x: 225000,
  y: 225000,
  w: 80,
  h: 60,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  src: 'data:image/png;base64,xx',
});
engine.setSelection([enterImg]);
textOpened = false;
engine.onKeyDown({
  key: 'Enter',
  preventDefault() {},
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  code: 'Enter',
});
assert.equal(textOpened, false, 'Enter on an image does not open the text overlay');
assert.equal(cropOn, true, 'Enter on an image starts crop');
engine.cancelCrop();

const enterDoc = store.addShape({
  type: 'doc',
  x: 226000,
  y: 226000,
  w: 80,
  h: 100,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  pages: ['data:image/png;base64,xx'],
  page: 0,
});
engine.setSelection([enterDoc]);
textOpened = false;
engine.onKeyDown({
  key: 'Enter',
  preventDefault() {},
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  code: 'Enter',
});
assert.equal(textOpened, false, 'Enter on a document does not open a dead-end text overlay');
engine.setSelection([]);

const rotGlueFrom = store.addShape({
  type: 'rect',
  x: 227000,
  y: 227000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const rotGlueTo = store.addShape({
  type: 'rect',
  x: 227200,
  y: 227000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const rotGlueArr = store.addShape({
  type: 'arrow',
  x: 227080,
  y: 227020,
  w: 120,
  h: 10,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [227080, 227025, 227200, 227025],
  fromId: rotGlueFrom,
  toId: rotGlueTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([rotGlueFrom, rotGlueTo]));
engine.setTool('select');
engine.setSelection([rotGlueArr]);
const rotArrV = engine.views.get(rotGlueArr);
const rotArrScr = engine.worldToScreen(rotArrV.x - 44, rotArrV.y + rotArrV.h + 44);
assert.equal(engine.hitRotateHandle(rotArrScr.x, rotArrScr.y), rotGlueArr, 'connected arrow rotate handle is hittable');
engine.onPointerDown({
  clientX: rotArrScr.x,
  clientY: rotArrScr.y,
  button: 0,
  pointerId: 91,
  shiftKey: true,
  altKey: false,
});
const rotArrMid = engine.worldToScreen(rotArrV.x + rotArrV.w / 2, rotArrV.y + rotArrV.h / 2);
engine.onPointerMove({
  clientX: rotArrMid.x + 80,
  clientY: rotArrMid.y - 40,
  button: 0,
  pointerId: 91,
  shiftKey: true,
  altKey: false,
});
engine.onPointerUp({
  clientX: rotArrMid.x + 80,
  clientY: rotArrMid.y - 40,
  button: 0,
  pointerId: 91,
  shiftKey: true,
  altKey: false,
});
store.flushPendingPatches();
const rotatedSolo = engine.views.get(rotGlueArr);
assert.equal(rotatedSolo.fromId, undefined, 'rotating only a connected arrow unglues it');
assert.equal(rotatedSolo.toId, undefined, 'rotating only a connected arrow clears the far end');
engine.setSelection([]);

const staleMem = store.addShape({
  type: 'rect',
  x: 228000,
  y: 228000,
  w: 40,
  h: 20,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
engine.setSelection([staleMem]);
engine.copySelection();
const foreign = {
  id: 'foreign-shape',
  type: 'rect',
  x: 10,
  y: 10,
  w: 18,
  h: 22,
  fill: '#abcdef',
  stroke: '#000000',
  strokeWidth: 1,
};
const marker = JSON.stringify({ __reviewShapes: [foreign] });
const clipboardStub = {
  read: async () => [
    {
      types: ['text/plain'],
      getType: async () => new Blob([marker], { type: 'text/plain' }),
    },
  ],
  readText: async () => marker,
  writeText: async () => {},
};
const nav = globalThis.navigator;
const prevClip = nav ? Object.getOwnPropertyDescriptor(nav, 'clipboard') : undefined;
Object.defineProperty(nav, 'clipboard', { configurable: true, value: clipboardStub });
engine.setPasteAnchor({ x: 229000, y: 229000 });
await engine.pasteFromClipboard();
store.flushPendingPatches();
const sysPasted = engine.views.get([...engine.selection][0]);
assert.equal(sysPasted.w, 18, 'toolbar paste prefers the system shape marker over a stale memory clipboard');
assert.ok(Math.abs(sysPasted.x + sysPasted.w / 2 - 229000) < 1, 'system-marker paste still uses pasteAt');
if (prevClip) Object.defineProperty(nav, 'clipboard', prevClip);

const readers = [];
globalThis.FileReader = class {
  result = 'data:image/png;base64,aaa';
  onload = null;
  onerror = null;
  readAsDataURL() {
    readers.push(this);
  }
};
globalThis.Image = class {
  onload = null;
  onerror = null;
  naturalWidth = 100;
  naturalHeight = 50;
  set src(_v) {
    this.onload && this.onload();
  }
};
const origCreate = document.createElement;
document.createElement = (tag) => {
  if (tag === 'canvas') {
    return {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => 'data:image/png;base64,xx',
    };
  }
  return origCreate(tag);
};
const originPage = store.currentPageId();
engine.setPasteAnchor({ x: 230000, y: 230000 });
engine.insertImageFile(new File([new Uint8Array([1, 2, 3, 4])], 'x.png', { type: 'image/png' }));
store.addPage();
store.flushPendingPatches();
assert.notEqual(store.currentPageId(), originPage, 'page switch happens before the image decodes');
assert.equal(readers.length, 1, 'image paste starts a FileReader');
readers[0].onload();
store.flushPendingPatches();
let imgKey = null;
for (const key of store.board.keys()) {
  const v = store.readShape(store.board.get(key));
  if (v?.type === 'image' && Math.abs(v.x + v.w / 2 - 230000) < 2) imgKey = key;
}
assert.ok(imgKey, 'decoded image is stored at the captured paste point');
if (originPage === 'main') {
  assert.equal(imgKey.includes(':'), false, 'image stays on the page where paste started');
} else {
  assert.ok(imgKey.startsWith(originPage + ':'), 'image key uses the origin page prefix');
}
document.createElement = origCreate;

const boundFrom = store.addShape({
  type: 'rect',
  x: 231000,
  y: 231000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const boundTo = store.addShape({
  type: 'rect',
  x: 231200,
  y: 231000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const boundArr = store.addShape({
  type: 'arrow',
  x: 231080,
  y: 231020,
  w: 120,
  h: 10,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [231080, 231025, 231200, 231025],
  fromId: boundFrom,
  toId: boundTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([boundFrom, boundTo]));
store.flushPendingPatches();
const rebakedGlue = engine.views.get(boundArr);
const rebakedVisual = visualBox(rebakedGlue);
assert.ok(
  Math.abs(rebakedGlue.w - rebakedVisual.w) < 1e-6 && Math.abs(rebakedGlue.h - rebakedVisual.h) < 1e-6,
  'rebaked connected arrows store visual bounds including the head'
);
const freeCubic = {
  id: 'free-cubic',
  type: 'arrow',
  points: (rebakedGlue.points || []).slice(),
  x: rebakedGlue.x,
  y: rebakedGlue.y,
  w: rebakedGlue.w,
  h: rebakedGlue.h,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
};
assert.ok(
  Math.abs(visualBox(freeCubic).w - rebakedVisual.w) < 1e-6,
  'unglued 8-point cubics keep the same visual width as the glued curve'
);

const lockAlignA = store.addShape({
  type: 'rect',
  x: 232000,
  y: 232000,
  w: 40,
  h: 40,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const lockAlignB = store.addShape({
  type: 'rect',
  x: 232200,
  y: 232040,
  w: 40,
  h: 40,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
engine.setSelection([lockAlignA]);
engine.toggleLockSelection();
store.flushPendingPatches();
engine.setSelection([lockAlignA, lockAlignB]);
engine.alignSelection('left');
store.flushPendingPatches();
assert.equal(engine.views.get(lockAlignA).x, 232000, 'locked align member stays put');
assert.ok(Math.abs(engine.views.get(lockAlignB).x - 232000) < 1e-6, 'unlocked shape aligns to the locked left edge');
engine.setSelection([lockAlignA]);
engine.toggleLockSelection();
engine.setSelection([]);

const grFrom = store.addShape({
  type: 'rect',
  x: 233000,
  y: 233000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const grTo = store.addShape({
  type: 'rect',
  x: 233200,
  y: 233000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const grArr = store.addShape({
  type: 'arrow',
  x: 233080,
  y: 233020,
  w: 120,
  h: 10,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [233080, 233025, 233200, 233025],
  fromId: grFrom,
  toId: grTo,
  fromPort: 'e',
  toPort: 'w',
});
const grExtra = store.addShape({
  type: 'rect',
  x: 233400,
  y: 233000,
  w: 40,
  h: 40,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
engine.updateConnectedArrows(new Set([grFrom, grTo]));
engine.setTool('select');
engine.setSelection([grArr, grExtra]);
const grBox = engine.selectionBounds();
const grSe = engine.worldToScreen(grBox.x + grBox.w, grBox.y + grBox.h);
assert.deepEqual(engine.hitHandle(grSe.x, grSe.y), { shapeId: '__group__', handle: 'se' }, 'group resize handle hits');
engine.onPointerDown({
  clientX: grSe.x,
  clientY: grSe.y,
  button: 0,
  pointerId: 92,
  shiftKey: false,
  altKey: false,
});
engine.onPointerMove({
  clientX: grSe.x + 40,
  clientY: grSe.y + 20,
  button: 0,
  pointerId: 92,
  shiftKey: false,
  altKey: false,
});
engine.onPointerUp({
  clientX: grSe.x + 40,
  clientY: grSe.y + 20,
  button: 0,
  pointerId: 92,
  shiftKey: false,
  altKey: false,
});
store.flushPendingPatches();
const grAfter = engine.views.get(grArr);
assert.equal(grAfter.fromId, undefined, 'group-resizing a connected arrow without its nodes unglues it');
assert.equal(grAfter.toId, undefined, 'group-resizing a connected arrow without its nodes clears the far end');
engine.setSelection([]);

const clickFrom = store.addShape({
  type: 'rect',
  x: 236000,
  y: 236000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const clickTo = store.addShape({
  type: 'rect',
  x: 236200,
  y: 236000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const clickArr = store.addShape({
  type: 'arrow',
  x: 236080,
  y: 236020,
  w: 120,
  h: 10,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [236080, 236025, 236200, 236025],
  fromId: clickFrom,
  toId: clickTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([clickFrom, clickTo]));
store.flushPendingPatches();
engine.setTool('select');
engine.setSelection([clickArr]);
const clickV = engine.views.get(clickArr);
const clickSe = engine.worldToScreen(clickV.x + clickV.w, clickV.y + clickV.h);
assert.deepEqual(engine.hitHandle(clickSe.x, clickSe.y), { shapeId: clickArr, handle: 'se' }, 'connected arrow SE handle hits');
engine.onPointerDown({
  clientX: clickSe.x,
  clientY: clickSe.y,
  button: 0,
  pointerId: 93,
  shiftKey: false,
  altKey: false,
});
store.flushPendingPatches();
assert.equal(engine.views.get(clickArr).fromId, clickFrom, 'resize handle down does not unglue a connected arrow');
engine.onPointerUp({
  clientX: clickSe.x,
  clientY: clickSe.y,
  button: 0,
  pointerId: 93,
  shiftKey: false,
  altKey: false,
});
store.flushPendingPatches();
assert.equal(engine.views.get(clickArr).fromId, clickFrom, 'clicking a resize handle without a drag leaves the arrow glued');
engine.setSelection([]);

const escGlueFrom = store.addShape({
  type: 'rect',
  x: 237000,
  y: 237000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const escGlueTo = store.addShape({
  type: 'rect',
  x: 237200,
  y: 237000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const escGlueArr = store.addShape({
  type: 'arrow',
  x: 237080,
  y: 237020,
  w: 120,
  h: 10,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [237080, 237025, 237200, 237025],
  fromId: escGlueFrom,
  toId: escGlueTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([escGlueFrom, escGlueTo]));
store.flushPendingPatches();
engine.setSelection([escGlueArr]);
const escGlueV = engine.views.get(escGlueArr);
const escGlueSe = engine.worldToScreen(escGlueV.x + escGlueV.w, escGlueV.y + escGlueV.h);
engine.onPointerDown({
  clientX: escGlueSe.x,
  clientY: escGlueSe.y,
  button: 0,
  pointerId: 94,
  shiftKey: false,
  altKey: false,
});
engine.onPointerMove({
  clientX: escGlueSe.x + 50,
  clientY: escGlueSe.y + 30,
  button: 0,
  pointerId: 94,
  shiftKey: false,
  altKey: false,
});
store.flushPendingPatches();
assert.equal(engine.views.get(escGlueArr).fromId, undefined, 'resizing a connected arrow unglues it on the first move');
engine.onKeyDown({ key: 'Escape', preventDefault() {}, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Escape' });
store.flushPendingPatches();
assert.equal(engine.views.get(escGlueArr).fromId, escGlueFrom, 'Escape after resize unglue restores fromId');
assert.equal(engine.views.get(escGlueArr).toId, escGlueTo, 'Escape after resize unglue restores toId');
engine.setSelection([]);

const freeBake = store.addShape({
  type: 'arrow',
  x: 238000,
  y: 238000,
  w: 120,
  h: 24,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [238010, 238012, 238110, 238012],
});
const freeBaked0 = visualBox(engine.views.get(freeBake));
store.patchShape(freeBake, { x: freeBaked0.x, y: freeBaked0.y, w: freeBaked0.w, h: freeBaked0.h });
store.flushPendingPatches();
engine.setSelection([freeBake]);
const freeV = engine.views.get(freeBake);
const freeSe = engine.worldToScreen(freeV.x + freeV.w, freeV.y + freeV.h);
engine.onPointerDown({
  clientX: freeSe.x,
  clientY: freeSe.y,
  button: 0,
  pointerId: 95,
  shiftKey: false,
  altKey: false,
});
engine.onPointerMove({
  clientX: freeSe.x + 80,
  clientY: freeSe.y + 40,
  button: 0,
  pointerId: 95,
  shiftKey: false,
  altKey: false,
});
engine.onPointerUp({
  clientX: freeSe.x + 80,
  clientY: freeSe.y + 40,
  button: 0,
  pointerId: 95,
  shiftKey: false,
  altKey: false,
});
store.flushPendingPatches();
const freeAfter = engine.views.get(freeBake);
const freeVisual = visualBox(freeAfter);
assert.ok(
  Math.abs(freeAfter.w - freeVisual.w) < 1e-6 && Math.abs(freeAfter.h - freeVisual.h) < 1e-6,
  'resized free arrows store visual bounds including the head'
);
engine.setSelection([]);

const docOrigin = store.currentPageId();
store.addPage();
store.flushPendingPatches();
const destPage = store.currentPageId();
assert.notEqual(destPage, docOrigin, 'page switch happens before the document lands');
const docId = engine.addDocument(['data:image/png;base64,xx'], 0.707, { x: 239000, y: 239000 }, docOrigin);
store.flushPendingPatches();
assert.ok(docId, 'addDocument returns an id');
if (docOrigin === 'main') {
  assert.equal(docId.includes(':'), false, 'document stays on the page where import started');
} else {
  assert.ok(docId.startsWith(docOrigin + ':'), 'document key uses the origin page prefix');
}
assert.equal(store.isOnActivePage(docId), false, 'pinned document is not on the destination page');
const docShape = store.readShape(store.board.get(docId));
assert.ok(Math.abs(docShape.x + docShape.w / 2 - 239000) < 1, 'document lands at the captured drop point');
store.setCurrentPage(docOrigin);
engine.resetToPage();
engine.setSelection([]);

const textOrigin = store.currentPageId();
store.addPage();
store.flushPendingPatches();
engine.insertPlainText('pinned-text', { x: 240000, y: 240000 }, textOrigin);
store.flushPendingPatches();
let pinnedText = null;
for (const key of store.board.keys()) {
  const v = store.readShape(store.board.get(key));
  if (v?.type === 'text' && v.text === 'pinned-text') pinnedText = key;
}
assert.ok(pinnedText, 'plain-text paste is stored');
if (textOrigin === 'main') {
  assert.equal(pinnedText.includes(':'), false, 'plain text stays on the page where paste started');
} else {
  assert.ok(pinnedText.startsWith(textOrigin + ':'), 'plain-text key uses the origin page prefix');
}
store.setCurrentPage(textOrigin);
engine.resetToPage();
engine.setSelection([]);

const alignGlueFrom = store.addShape({
  type: 'rect',
  x: 242000,
  y: 242000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const alignGlueTo = store.addShape({
  type: 'rect',
  x: 242200,
  y: 242000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const alignGlueArr = store.addShape({
  type: 'arrow',
  x: 242080,
  y: 242020,
  w: 120,
  h: 10,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [242080, 242025, 242200, 242025],
  fromId: alignGlueFrom,
  toId: alignGlueTo,
  fromPort: 'e',
  toPort: 'w',
});
const alignGlueExtra = store.addShape({
  type: 'rect',
  x: 242400,
  y: 242040,
  w: 40,
  h: 40,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
engine.updateConnectedArrows(new Set([alignGlueFrom, alignGlueTo]));
store.flushPendingPatches();
engine.setSelection([alignGlueArr, alignGlueExtra]);
engine.alignSelection('left');
store.flushPendingPatches();
assert.equal(engine.views.get(alignGlueArr).fromId, undefined, 'aligning only a connected arrow unglues it');
assert.equal(engine.views.get(alignGlueArr).toId, undefined, 'aligning only a connected arrow clears the far end');

const keepFrom = store.addShape({
  type: 'rect',
  x: 243000,
  y: 243000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const keepTo = store.addShape({
  type: 'rect',
  x: 243200,
  y: 243080,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const keepArr = store.addShape({
  type: 'arrow',
  x: 243080,
  y: 243020,
  w: 120,
  h: 10,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [243080, 243025, 243200, 243105],
  fromId: keepFrom,
  toId: keepTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([keepFrom, keepTo]));
store.flushPendingPatches();
engine.setSelection([keepFrom, keepTo, keepArr]);
engine.alignSelection('top');
store.flushPendingPatches();
assert.equal(engine.views.get(keepArr).fromId, keepFrom, 'aligning both nodes keeps the connector glued');
assert.equal(engine.views.get(keepTo).y, 243000, 'far node moves to the top edge');
const keepPts = engine.views.get(keepArr).points || [];
assert.ok(Math.abs(keepPts[keepPts.length - 1] - 243025) < 2, 'rebaked connector follows the aligned node');
engine.setSelection([]);

store.addPage();
const killPage = store.currentPageId();
store.addPage();
store.flushPendingPatches();
store.setCurrentPage(killPage);
engine.resetToPage();
const prevDelCommit = engine.events.onRequestCommitText;
engine.events.onRequestCommitText = () => {
  engine.commitText(null, 'survived-page-delete', {
    id: null,
    x: 244000,
    y: 244000,
    w: TEXT_TOOL_WRAP_W,
    h: 30,
    text: '',
    fontSize: 16,
    color: '#1c1c1a',
    type: 'text',
    centered: false,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    textAlign: 'left',
    highlight: false,
  });
};
engine.openTextEditorAt(244000, 244000, 16, '#1c1c1a');
store.deletePage(killPage);
store.flushPendingPatches();
let survivedDelete = null;
for (const key of store.board.keys()) {
  const v = store.readShape(store.board.get(key));
  if (v?.text === 'survived-page-delete') survivedDelete = key;
}
assert.ok(survivedDelete, 'click-to-type commit after deleting its page still stores the text');
assert.equal(store.isOnActivePage(survivedDelete), true, 'the text lands on a live page instead of a deleted prefix');
engine.events.onRequestCommitText = prevDelCommit;
engine.cancelTextEdit();
engine.setSelection([]);

const rotEsc = store.addShape({
  type: 'rect',
  x: 245000,
  y: 245000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
engine.setTool('select');
engine.setSelection([rotEsc]);
const rotEscV = engine.views.get(rotEsc);
assert.equal(rotEscV.rotation, undefined, 'new rect has no rotation key');
const rotEscScr = engine.worldToScreen(rotEscV.x - 44, rotEscV.y + rotEscV.h + 44);
assert.equal(engine.hitRotateHandle(rotEscScr.x, rotEscScr.y), rotEsc, 'upright rect rotate handle is hittable');
engine.onPointerDown({
  clientX: rotEscScr.x,
  clientY: rotEscScr.y,
  button: 0,
  pointerId: 101,
  shiftKey: true,
  altKey: false,
});
const rotEscMid = engine.worldToScreen(rotEscV.x + rotEscV.w / 2, rotEscV.y + rotEscV.h / 2);
engine.onPointerMove({
  clientX: rotEscMid.x + 90,
  clientY: rotEscMid.y - 50,
  button: 0,
  pointerId: 101,
  shiftKey: true,
  altKey: false,
});
store.flushPendingPatches();
assert.ok((engine.views.get(rotEsc).rotation ?? 0) !== 0, 'rotate gesture writes a non-zero angle');
engine.onKeyDown({ key: 'Escape', preventDefault() {}, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Escape' });
store.flushPendingPatches();
assert.ok(!(engine.views.get(rotEsc).rotation), 'Escape after rotate restores an upright pose');
assert.equal(store.board.get(rotEsc).has('rotation'), false, 'Y map has no leftover rotation after Escape');
engine.setSelection([]);

const dragImg = store.addShape({
  type: 'image',
  x: 246000,
  y: 246000,
  w: 80,
  h: 60,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  src: 'data:image/png;base64,AAA',
});
engine.setTool('select');
const dragScr = engine.worldToScreen(246040, 246030);
// tray host: first press selects, second press drags
engine.onPointerDown({
  clientX: dragScr.x,
  clientY: dragScr.y,
  button: 0,
  pointerId: 102,
  shiftKey: false,
  altKey: false,
});
engine.onPointerUp({
  clientX: dragScr.x,
  clientY: dragScr.y,
  button: 0,
  pointerId: 102,
  shiftKey: false,
  altKey: false,
});
engine.onPointerDown({
  clientX: dragScr.x,
  clientY: dragScr.y,
  button: 0,
  pointerId: 102,
  shiftKey: false,
  altKey: false,
});
engine.onPointerMove({
  clientX: dragScr.x + 40,
  clientY: dragScr.y + 20,
  button: 0,
  pointerId: 102,
  shiftKey: false,
  altKey: false,
});
store.flushPendingPatches();
assert.ok(!('mediaProxy' in engine), 'no placeholders — dragged bitmaps paint full');
assert.notEqual(engine.views.get(dragImg).x, 246000, 'image has moved before the tool switch');
assert.equal(isWriteGestureActive(), true, 'select-drag holds the write gate open');
engine.setTool('pen');
store.flushPendingPatches();
assert.equal(engine.views.get(dragImg).x, 246000, 'setTool mid-drag restores the image origin');
assert.equal(engine.views.get(dragImg).y, 246000, 'setTool mid-drag restores the image y');
assert.equal(isWriteGestureActive(), false, 'setTool mid-drag closes the write gate');
assert.equal(engine.tool.id, 'pen', 'tool switch still lands on pen');
engine.setTool('select');
engine.setSelection([]);

const prevPaper = store.viewPaperBg();
store.setMeta({ bg: ORBIT_PAPER });
const exportFills = [];
const prevCreate = document.createElement;
document.createElement = (tag) => {
  if (tag !== 'canvas') return { src: '', onload: null, onerror: null };
  const state = { fillStyle: '' };
  return {
    width: 0,
    height: 0,
    getContext: () =>
      new Proxy(state, {
        get(t, p) {
          if (p === 'fillStyle') return t.fillStyle;
          if (p === 'measureText') return () => ({ width: 10 });
          if (p === 'fillRect') {
            return () => {
              exportFills.push(t.fillStyle);
            };
          }
          return () => undefined;
        },
        set(t, p, v) {
          t[p] = v;
          return true;
        },
      }),
  };
};
try {
  const emptyBox = { x: 245500, y: 245500, w: 20, h: 20 };
  engine.exportCanvas(emptyBox, { scale: 1, format: 'png', background: null });
  assert.ok(
    !exportFills.includes(ORBIT_PAPER),
    'transparent PNG on Orbit paper does not fill the Orbit void'
  );
  exportFills.length = 0;
  engine.exportCanvas(emptyBox, { scale: 1, format: 'png', background: undefined });
  assert.ok(exportFills.includes(ORBIT_PAPER), 'omitting background still fills Orbit paper');
} finally {
  document.createElement = prevCreate;
  store.setMeta({ bg: prevPaper });
}

const diamondLasso = store.addShape({
  type: 'diamond',
  x: 247000,
  y: 247000,
  w: 100,
  h: 100,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const diamondEmptyCorner = [
  { x: 246990, y: 246990 },
  { x: 247015, y: 246990 },
  { x: 247015, y: 247015 },
  { x: 246990, y: 247015 },
];
assert.ok(
  !engine.selectByPolygon(diamondEmptyCorner).includes(diamondLasso),
  'lasso around a diamond AABB corner does not select empty space'
);
const diamondTip = [
  { x: 247040, y: 246990 },
  { x: 247060, y: 246990 },
  { x: 247060, y: 247015 },
  { x: 247040, y: 247015 },
];
assert.ok(
  engine.selectByPolygon(diamondTip).includes(diamondLasso),
  'lasso around a diamond vertex selects the diamond'
);
engine.setSelection([]);

const stickyDefaultBorder = shapesToSvg(
  [
    {
      id: 'st-border',
      type: 'sticky',
      x: 0,
      y: 0,
      w: 120,
      h: 80,
      fill: '#ffe27a',
      stroke: '#d9b64d',
      strokeWidth: 2,
      text: 'note',
      fontSize: 16,
    },
  ],
  { background: null }
).svg;
assert.ok(!/stroke="#d9b64d"/.test(stickyDefaultBorder), 'SVG stickies omit the default yellow border');

const darkGraph = shapesToSvg(
  [
    {
      id: 'dg',
      type: 'graph',
      x: 0,
      y: 0,
      w: 240,
      h: 180,
      fill: '#1c1c1a',
      stroke: '#1c1c1a',
      strokeWidth: 2,
      expr: 'x',
    },
  ],
  { background: '#1c1c1a' }
).svg;
assert.ok(darkGraph.includes('#eceae4'), 'SVG graph curves adapt ink on dark paper');

assert.equal(exportDownloadEnabled('blob:1', 'png', 'svg'), false, 'stale PNG blob cannot download as SVG');
assert.equal(exportDownloadEnabled('blob:1', 'svg', 'svg'), true, 'matching format can download');
assert.equal(exportDownloadEnabled(null, 'svg', 'svg'), false, 'download stays off until a blob exists');

assert.equal(cssBackgroundIsHighlight(''), false);
assert.equal(cssBackgroundIsHighlight('transparent'), false);
assert.equal(cssBackgroundIsHighlight('rgba(0, 0, 0, 0)'), false);
assert.equal(cssBackgroundIsHighlight('#ffffff'), false, 'Word white cell chrome is not a highlight');
assert.equal(cssBackgroundIsHighlight('#ffe27a'), true, 'sticky-yellow marker is a highlight');
assert.deepEqual(
  measureStyleFromSpans([{ text: 'a', bold: true }, { text: 'b' }], { bold: false, italic: false }),
  { bold: true, italic: false },
  'commit wrap sees bold from rich spans when EditTarget.bold is still false'
);

const frameHost = store.addShape({
  type: 'frame',
  x: 248000,
  y: 248000,
  w: 500,
  h: 200,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const frameFrom = store.addShape({
  type: 'rect',
  x: 248040,
  y: 248040,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
  locked: true,
});
const frameTo = store.addShape({
  type: 'rect',
  x: 248220,
  y: 248040,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
  locked: true,
});
const frameArr = store.addShape({
  type: 'arrow',
  x: 248120,
  y: 248060,
  w: 100,
  h: 10,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [248120, 248065, 248220, 248065],
  fromId: frameFrom,
  toId: frameTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([frameFrom, frameTo]));
store.flushPendingPatches();
assert.ok(
  hostRiderIds([...engine.views.values()], [frameHost]).includes(frameArr),
  'an unlocked connector inside a frame rides the frame'
);
engine.setTool('select');
engine.setSelection([frameHost]);
const frameScr = engine.worldToScreen(248010, 248010);
engine.onPointerDown({
  clientX: frameScr.x,
  clientY: frameScr.y,
  button: 0,
  pointerId: 103,
  shiftKey: false,
  altKey: false,
});
engine.onPointerMove({
  clientX: frameScr.x + 30,
  clientY: frameScr.y + 20,
  button: 0,
  pointerId: 103,
  shiftKey: false,
  altKey: false,
});
store.flushPendingPatches();
assert.equal(engine.views.get(frameArr).fromId, undefined, 'moving the frame unglues a rider whose nodes stayed put');
engine.onKeyDown({ key: 'Escape', preventDefault() {}, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Escape' });
store.flushPendingPatches();
assert.equal(engine.views.get(frameArr).fromId, frameFrom, 'Escape restores glue on a stuck rider connector');
assert.equal(engine.views.get(frameArr).toId, frameTo, 'Escape restores the far end of a stuck rider connector');
engine.setSelection([]);

const liveFrom = store.addShape({
  type: 'rect',
  x: 249000,
  y: 249000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const liveTo = store.addShape({
  type: 'rect',
  x: 249200,
  y: 249000,
  w: 80,
  h: 50,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
const liveArr = store.addShape({
  type: 'arrow',
  x: 249080,
  y: 249020,
  w: 120,
  h: 10,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  points: [249080, 249025, 249200, 249025],
  fromId: liveFrom,
  toId: liveTo,
  fromPort: 'e',
  toPort: 'w',
});
engine.updateConnectedArrows(new Set([liveFrom, liveTo]));
store.flushPendingPatches();
const liveBefore = (engine.views.get(liveArr).points || []).slice();
engine.setTool('select');
engine.setSelection([liveArr]);
const liveRot = engine.views.get(liveArr);
const liveRotScr = engine.worldToScreen(liveRot.x - 44, liveRot.y + liveRot.h + 44);
assert.equal(engine.hitRotateHandle(liveRotScr.x, liveRotScr.y), liveArr, 'solo connector rotate handle is hittable');
engine.onPointerDown({
  clientX: liveRotScr.x,
  clientY: liveRotScr.y,
  button: 0,
  pointerId: 104,
  shiftKey: true,
  altKey: false,
});
const liveMid = engine.worldToScreen(liveRot.x + liveRot.w / 2, liveRot.y + liveRot.h / 2);
engine.onPointerMove({
  clientX: liveMid.x + 80,
  clientY: liveMid.y - 40,
  button: 0,
  pointerId: 104,
  shiftKey: true,
  altKey: false,
});
const liveMidPts = engine.views.get(liveArr).points || [];
assert.ok(
  liveMidPts[0] !== liveBefore[0] || liveMidPts[1] !== liveBefore[1],
  'rotate-unglue keeps live points instead of snapping to the last flushed doc pose'
);
engine.onPointerUp({
  clientX: liveMid.x + 80,
  clientY: liveMid.y - 40,
  button: 0,
  pointerId: 104,
  shiftKey: true,
  altKey: false,
});
store.flushPendingPatches();
engine.setSelection([]);

const undoGraph = store.addShape({
  type: 'graph',
  x: 250000,
  y: 250000,
  w: 240,
  h: 160,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
  expr: 'sin(x)',
});
store.flushPendingPatches();
store.undoManager.clear();
engine.openGraphEditor(undoGraph);
engine.commitGraphPreview(undoGraph, 'x^2');
assert.equal(engine.views.get(undoGraph).expr, 'x^2', 'graph preview still paints locally');
assert.equal(store.readShape(store.board.get(undoGraph)).expr, 'sin(x)', 'graph preview does not write the doc');
engine.cancelGraphEditor();
store.flushPendingPatches();
assert.equal(store.readShape(store.board.get(undoGraph)).expr, 'sin(x)', 'cancelling a graph preview leaves the stored formula');
store.undoManager.undo();
store.flushPendingPatches();
assert.ok(store.board.has(undoGraph), 'graph cancel does not push an undo item');
assert.equal(
  store.readShape(store.board.get(undoGraph)).expr,
  'sin(x)',
  'Escape after a graph preview does not leave an undo step that restores the cancelled formula'
);
engine.setSelection([]);

const webpCalls = [];
const webpReaders = [];
const prevFileReader = globalThis.FileReader;
const prevImage = globalThis.Image;
const prevCreateEl = document.createElement;
globalThis.FileReader = class {
  result = 'data:image/webp;base64,aaa';
  onload = null;
  readAsDataURL() {
    webpReaders.push(this);
  }
};
globalThis.Image = class {
  onload = null;
  naturalWidth = 40;
  naturalHeight = 20;
  set src(_v) {
    this.onload && this.onload();
  }
};
document.createElement = (tag) => {
  if (tag !== 'canvas') return { src: '', onload: null, onerror: null };
  return {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() {} }),
    toDataURL: (mime) => {
      webpCalls.push(mime);
      return 'data:image/png;base64,xx';
    },
  };
};
engine.insertImageFile(new File([new Uint8Array([1, 2, 3, 4])], 'a.webp', { type: 'image/webp' }));
webpReaders[0].onload();
assert.ok(webpCalls.includes('image/png'), 'WebP import encodes as PNG so alpha is kept');
assert.ok(!webpCalls.includes('image/jpeg'), 'WebP import does not go through JPEG');
document.createElement = prevCreateEl;
globalThis.FileReader = prevFileReader;
globalThis.Image = prevImage;

// GIF import keeps original bytes (no canvas freeze-to-PNG).
const gifReaders = [];
const gifPrevFR = globalThis.FileReader;
const gifPrevImg = globalThis.Image;
const gifPrevCE = document.createElement;
const gifDataUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
let gifCanvasEncode = 0;
globalThis.FileReader = class {
  result = gifDataUrl;
  onload = null;
  readAsDataURL() {
    gifReaders.push(this);
  }
};
globalThis.Image = class {
  onload = null;
  naturalWidth = 80;
  naturalHeight = 40;
  set src(_v) {
    this.onload && this.onload();
  }
};
document.createElement = (tag) => {
  if (tag === 'canvas') {
    return {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => {
        gifCanvasEncode += 1;
        return 'data:image/png;base64,should-not';
      },
    };
  }
  return gifPrevCE(tag);
};
const gifBefore = store.board.size;
engine.insertImageFile(new File([new Uint8Array([1, 2, 3])], 'a.gif', { type: 'image/gif' }));
gifReaders[0].onload();
assert.equal(store.board.size, gifBefore + 1, 'GIF import inserts an image shape');
{
  let gifId = null;
  for (const [id, m] of store.board.entries()) {
    const v = store.readShape(m);
    if (v.type === 'image' && v.src && v.src.startsWith('data:image/gif')) gifId = id;
  }
  assert.ok(gifId, 'GIF shape stores data:image/gif src');
  assert.equal(gifCanvasEncode, 0, 'GIF import skips canvas re-encode');
  const gv = store.readShape(store.board.get(gifId));
  assert.ok(gv.w <= 600 && gv.h <= 600, 'GIF display size is capped');
  store.removeShapes([gifId]);
  store.flushPendingPatches();
}
document.createElement = gifPrevCE;
globalThis.FileReader = gifPrevFR;
globalThis.Image = gifPrevImg;

// Video import creates type:video with data:video src.
const vidReaders = [];
const vidPrevFR = globalThis.FileReader;
const vidPrevCE = document.createElement;
const vidDataUrl = 'data:video/mp4;base64,AAAA';
globalThis.FileReader = class {
  result = vidDataUrl;
  onload = null;
  readAsDataURL() {
    vidReaders.push(this);
  }
};
document.createElement = (tag) => {
  if (tag === 'video') {
    const el = {
      muted: false,
      preload: '',
      videoWidth: 320,
      videoHeight: 180,
      onerror: null,
      onloadedmetadata: null,
      addEventListener() {},
      setAttribute() {},
      pause() {},
      play() { return Promise.resolve(); },
      load() {},
      removeAttribute() {},
      readyState: 0,
      paused: true,
      ended: false,
      set src(_v) {
        queueMicrotask(() => this.onloadedmetadata && this.onloadedmetadata());
      },
    };
    return el;
  }
  return vidPrevCE(tag);
};
const vidBefore = store.board.size;
engine.insertVideoFile(new File([new Uint8Array([1, 2, 3, 4])], 'clip.mp4', { type: 'video/mp4' }));
vidReaders[0].onload();
// onloadedmetadata is queued microtask
await Promise.resolve();
await Promise.resolve();
assert.equal(store.board.size, vidBefore + 1, 'video import inserts a shape');
{
  let vidId = null;
  for (const [id, m] of store.board.entries()) {
    const v = store.readShape(m);
    if (v.type === 'video') vidId = id;
  }
  assert.ok(vidId, 'inserted shape has type video');
  const vv = store.readShape(store.board.get(vidId));
  assert.ok(vv.src && vv.src.startsWith('data:video/mp4'), 'video stores data:video src');
  assert.ok(
    hostRiderIds(
      [
        { id: 'v', type: 'video', x: 0, y: 0, w: 100, h: 80 },
        { id: 'n', type: 'sticky', x: 10, y: 10, w: 20, h: 20 },
      ],
      ['v']
    ).includes('n'),
    'sticky above a video magnetizes'
  );
  const svgVid = shapesToSvg(
    [
      {
        id: 'vx',
        type: 'video',
        x: 0,
        y: 0,
        w: 100,
        h: 60,
        fill: 'transparent',
        stroke: 'transparent',
        strokeWidth: 0,
        src: vidDataUrl,
      },
    ],
    { background: '#ffffff' }
  );
  assert.ok(svgVid.svg.includes('video'), 'SVG export placeholders video shapes');
  store.removeShapes([vidId]);
  store.flushPendingPatches();
}
document.createElement = vidPrevCE;
globalThis.FileReader = vidPrevFR;

// Oversize media rejected.
{
  let overErr = null;
  const prevErr = engine.events.onError;
  engine.events.onError = (m) => {
    overErr = m;
  };
  const big = new Uint8Array(8 * 1024 * 1024 + 1);
  engine.insertImageFile(new File([big], 'big.gif', { type: 'image/gif' }));
  assert.ok(overErr, 'GIF over 8MB is rejected');
  overErr = null;
  engine.insertVideoFile(new File([big], 'big.mp4', { type: 'video/mp4' }));
  assert.ok(overErr, 'video over 8MB is rejected');
  engine.events.onError = prevErr;
}

const ctxFailReaders = [];
const ctxFailPrevFR = globalThis.FileReader;
const ctxFailPrevImg = globalThis.Image;
const ctxFailPrevCE = document.createElement;
let ctxFailErr = null;
const ctxFailPrevErr = engine.events.onError;
engine.events.onError = (m) => {
  ctxFailErr = m;
};
globalThis.FileReader = class {
  result = 'data:image/png;base64,aaa';
  onload = null;
  readAsDataURL() {
    ctxFailReaders.push(this);
  }
};
globalThis.Image = class {
  onload = null;
  naturalWidth = 10;
  naturalHeight = 10;
  set src(_v) {
    this.onload && this.onload();
  }
};
document.createElement = (tag) => {
  if (tag === 'canvas') return { width: 0, height: 0, getContext: () => null, toDataURL: () => '' };
  return ctxFailPrevCE(tag);
};
const ctxFailBefore = store.board.size;
engine.insertImageFile(new File([new Uint8Array([1])], 'fail.png', { type: 'image/png' }));
ctxFailReaders[0].onload();
assert.ok(ctxFailErr, 'missing 2d context surfaces an image error');
assert.equal(store.board.size, ctxFailBefore, 'missing 2d context does not insert an image');
document.createElement = ctxFailPrevCE;
globalThis.FileReader = ctxFailPrevFR;
globalThis.Image = ctxFailPrevImg;
engine.events.onError = ctxFailPrevErr;

const tallTerm = {
  id: 'tt',
  type: 'terminator',
  x: 251000,
  y: 251000,
  w: 40,
  h: 100,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
};
assert.equal(pointInShape(tallTerm, 251020, 251002), true, 'click on the top cap of a tall terminator hits');
assert.equal(pointInShape(tallTerm, 251020, 251050), true, 'click in the body of a tall terminator hits');
assert.equal(pointInShape(tallTerm, 251045, 251050), false, 'click beside the waist of a tall terminator misses');
const wideTerm = { ...tallTerm, w: 140, h: 60 };
assert.equal(pointInShape(wideTerm, 251002, 251030), true, 'click on the left cap of a wide terminator hits');
const termSvg = shapesToSvg([tallTerm], { background: null }).svg;
assert.ok(termSvg.includes('rx="20"'), 'SVG tall terminator uses min(w,h)/2 for the capsule radius');

assert.equal(docPageIndex(99, 2), 1, 'out-of-range doc page clamps to last');
assert.equal(docPageIndex(-3, 2), 0, 'negative doc page clamps to first');
assert.equal(docPageIndex(0, 0), 0, 'empty doc page list clamps to 0');
assert.equal(docPageStep(99, 2, -1), 0, 'prev from an out-of-range last page goes to the first page');
assert.equal(docPageStep(99, 2, 1), 1, 'next from an out-of-range last page heals onto the last page');
assert.equal(docPageStep(0, 2, -1), 0, 'prev on the first page stays');
assert.equal(docPageStep(0, 2, 1), 1, 'next on the first page advances');
const svgDocPage = shapesToSvg(
  [
    {
      id: 'doc-oob',
      type: 'doc',
      x: 252000,
      y: 252000,
      w: 80,
      h: 60,
      fill: '#fff',
      stroke: '#000',
      strokeWidth: 1,
      pages: ['data:image/png;base64,PAGE0', 'data:image/png;base64,PAGE1'],
      page: 99,
    },
  ],
  { background: null }
).svg;
assert.ok(svgDocPage.includes('PAGE1'), 'SVG out-of-range doc page exports the last page, matching canvas');
assert.ok(!svgDocPage.includes('PAGE0'), 'SVG out-of-range doc page does not fall back to page 0');

const oobDoc = store.addShape({
  type: 'doc',
  x: 256000,
  y: 256000,
  w: 80,
  h: 60,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 1,
  pages: ['p0', 'p1'],
  page: 99,
});
store.flushPendingPatches();
assert.equal(store.readShape(store.board.get(oobDoc)).page, 1, 'addShape clamps an out-of-range doc page');
store.patchShape(oobDoc, { page: 99 });
store.flushPendingPatches();
assert.equal(store.readShape(store.board.get(oobDoc)).page, 1, 'patchShape clamps an out-of-range doc page');

const darkPaper = '#121110';
const rawPen = '#1c1c1a';
const adaptedPen = displayInk(rawPen, darkPaper);
const svgInkPaper = shapesToSvg(
  [
    {
      id: 'pen-ink-adapt',
      type: 'pen',
      x: 256200,
      y: 256200,
      w: 20,
      h: 20,
      fill: 'none',
      stroke: rawPen,
      strokeWidth: 2,
      points: [256200, 256200, 256220, 256220],
    },
  ],
  { background: null, inkPaper: darkPaper }
).svg;
assert.ok(svgInkPaper.toLowerCase().includes(adaptedPen.toLowerCase()), 'transparent SVG adapts pen ink to board paper');
assert.equal(
  svgInkPaper.toLowerCase().includes(rawPen.toLowerCase()),
  false,
  'transparent SVG does not keep near-black ink on a dark board'
);

const leaveBoardCropImg = store.addShape({
  type: 'image',
  x: 256400,
  y: 256400,
  w: 80,
  h: 60,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 0,
  src: 'data:image/png;base64,xx',
});
store.flushPendingPatches();

const flushCalls = [];
const flushEngine = {
  commitTableCell(id, row, col, text) {
    flushCalls.push(['cell', id, row, col, text]);
  },
  commitText(id, text, target, html) {
    flushCalls.push(['text', id, text, target, html]);
  },
  cancelTextEdit() {
    flushCalls.push(['cancel']);
  },
};
assert.equal(flushOpenTextEditor(null, { id: 'x', text: 'a' }, { innerText: 'b', innerHTML: '<p>b</p>' }), false);
assert.equal(flushCalls.length, 0, 'flush with no engine is a no-op');
assert.equal(flushOpenTextEditor(flushEngine, null, { innerText: 'b', innerHTML: '' }), false);
assert.equal(flushCalls.length, 0, 'flush with no target is a no-op');
assert.equal(
  flushOpenTextEditor(
    flushEngine,
    { id: 't1', text: 'old', richHtml: '<b>old</b>' },
    { innerText: 'hello', innerHTML: '<div>hello</div>' }
  ),
  true
);
assert.equal(flushCalls[0][0], 'text');
assert.equal(flushCalls[0][1], 't1');
assert.equal(flushCalls[0][2], 'hello', 'flush commits overlay innerText');
assert.equal(flushCalls[0][4], '<div>hello</div>', 'flush commits overlay innerHTML');
assert.equal(flushCalls[1][0], 'cancel');
flushCalls.length = 0;
assert.equal(
  flushOpenTextEditor(
    flushEngine,
    { id: 'tbl', text: 'x', tableCell: { row: 1, col: 2 } },
    { innerText: 'cell', innerHTML: '<b>cell</b>' }
  ),
  true
);
assert.deepEqual(flushCalls[0], ['cell', 'tbl', 1, 2, 'cell']);
assert.equal(flushCalls[1][0], 'cancel');
flushCalls.length = 0;
assert.equal(flushOpenTextEditor(flushEngine, { id: null, text: 'typed' }, null), true);
assert.equal(flushCalls[0][0], 'text');
assert.equal(flushCalls[0][1], null);
assert.equal(flushCalls[0][2], 'typed', 'flush falls back to target.text when the overlay is gone');
flushCalls.length = 0;
assert.equal(
  flushOpenTextEditor(
    { ...flushEngine, editing: false },
    { id: null, text: 'again' },
    { innerText: 'again', innerHTML: 'again' }
  ),
  false
);
assert.deepEqual(flushCalls, [['cancel']], 'flush after an earlier commit does not addShape again');

flushCalls.length = 0;
const persistFlush = {
  ...flushEngine,
  commitOpenGraphEditor() {
    flushCalls.push(['graph']);
    return true;
  },
};
assert.deepEqual(
  persistOpenEditors(
    persistFlush,
    { id: 't1', text: 'old' },
    { innerText: 'hello', innerHTML: '<div>hello</div>' }
  ),
  { text: true, graph: true },
  'tab-close persist writes the text overlay and the graph preview'
);
assert.equal(flushCalls[0][0], 'text');
assert.equal(flushCalls.at(-1)[0], 'graph');
assert.deepEqual(persistOpenEditors(null, { id: 'x', text: 'a' }, { innerText: 'b', innerHTML: 'b' }), {
  text: false,
  graph: false,
});

assert.equal(
  measureStyleFromSpans([{ bold: true, italic: false }], { bold: false, italic: false }).bold,
  true,
  'remeasure wrap flags follow rich spans, not only the shape bold bit'
);

store.beginGesture();
store.beginGesture();
assert.equal(isWriteGestureActive(), true, 'unpaired beginGesture leaves the write gate open');
store.pauseBoardView();
assert.equal(isWriteGestureActive(), false, 'pauseBoardView flushes and zeros leaked write-gate depth');
closeWriteGate();
assert.equal(isWriteGestureActive(), false, 'closeWriteGate is idempotent');

assert.equal(graphBlurCancels(null, false), false, 'graph blur with no related target commits (deferred)');
assert.equal(graphBlurCancels({ closest: () => ({}) }, true), false, 'graph blur inside the editor stays open');
assert.equal(
  graphBlurCancels({ closest: (sel) => (String(sel).includes('.tool-btn') ? {} : null) }, false),
  true,
  'graph blur onto a tool button cancels instead of committing'
);
assert.equal(
  graphBlurCancels({ closest: (sel) => (String(sel).includes('data-dismiss-edit') ? {} : null) }, false),
  true,
  'graph blur onto Home / leave-board chrome cancels'
);
assert.equal(
  overlayKeepEdit({ closest: (sel) => (String(sel).includes('data-keep-edit') ? {} : null) }),
  true,
  'undo/redo keep-edit chrome is detected'
);
assert.equal(overlayKeepEdit({ closest: () => null }), false);

const cropAtom = store.addShape({
  type: 'image',
  x: 253000,
  y: 253000,
  w: 80,
  h: 40,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  src: 'data:image/png;base64,xx',
  cropX: 0.25,
  cropY: 0.25,
  cropW: 0.5,
  cropH: 0.5,
});
store.flushPendingPatches();
const cropAtomMap = store.board.get(cropAtom);
let cropInconsistent = 0;
cropAtomMap.observe(() => {
  const v = store.readShape(cropAtomMap);
  if (v.w > 80 && cropAtomMap.has('cropW')) cropInconsistent += 1;
});
engine.setSelection([cropAtom]);
engine.resetCropSelected();
store.flushPendingPatches();
assert.equal(cropInconsistent, 0, 'reset crop never exposes full geometry with crop keys still set');
assert.equal(store.board.get(cropAtom).has('cropW'), false, 'reset crop deletes cropW');
assert.equal(engine.views.get(cropAtom).w, 160, 'reset crop restores uncropped width');
engine.setSelection([]);

const pinchHost = store.addShape({
  type: 'rect',
  x: 254000,
  y: 254000,
  w: 80,
  h: 60,
  fill: '#ffffff',
  stroke: '#7c8cff',
  strokeWidth: 2,
});
store.flushPendingPatches();
engine.setSelection([pinchHost]);
engine.connecting = { fromId: pinchHost, fromPort: 'e', cur: { x: 254120, y: 254030 } };
engine.pointers.set(801, { x: 100, y: 100 });
const arrowsBeforePinch = [...store.board.values()].filter((m) => store.readShape(m).type === 'arrow').length;
engine.onPointerDown({
  clientX: 140,
  clientY: 140,
  button: 0,
  pointerId: 802,
  shiftKey: false,
  altKey: false,
});
assert.equal(engine.connecting, null, 'second finger aborts an in-progress connector');
engine.onPointerUp({
  clientX: 100,
  clientY: 100,
  button: 0,
  pointerId: 801,
  shiftKey: false,
  altKey: false,
});
store.flushPendingPatches();
const arrowsAfterPinch = [...store.board.values()].filter((m) => store.readShape(m).type === 'arrow').length;
assert.equal(arrowsAfterPinch, arrowsBeforePinch, 'pinch-zoom does not commit the aborted connector');
engine.pointers.clear();

engine.connecting = { fromId: pinchHost, fromPort: 'e', cur: { x: 254140, y: 254030 } };
const arrowsBeforeCancel = [...store.board.values()].filter((m) => store.readShape(m).type === 'arrow').length;
engine.onPointerCancel({
  clientX: 200,
  clientY: 200,
  button: 0,
  pointerId: 803,
  shiftKey: false,
  altKey: false,
});
store.flushPendingPatches();
assert.equal(engine.connecting, null, 'pointercancel aborts the connector');
const arrowsAfterCancel = [...store.board.values()].filter((m) => store.readShape(m).type === 'arrow').length;
assert.equal(arrowsAfterCancel, arrowsBeforeCancel, 'pointercancel does not drop a connector');
engine.setSelection([]);

assert.equal(
  overlayCommitEdit({ closest: (sel) => (String(sel).includes('data-commit-edit') ? {} : null) }),
  true,
  'copy/export chrome is commit-edit'
);
assert.equal(
  graphBlurCancels({ closest: (sel) => (String(sel).includes('.tool-btn') ? {} : null) }, false) &&
    !overlayCommitEdit({ closest: (sel) => (String(sel).includes('.tool-btn') ? {} : null) }),
  true,
  'plain tool buttons still cancel a graph editor'
);
const commitToolBtn = {
  closest: (sel) => {
    const s = String(sel);
    if (s.includes('data-commit-edit') || s.includes('.tool-btn')) return {};
    return null;
  },
};
assert.equal(overlayCommitEdit(commitToolBtn), true, 'toolbar copy/delete is commit-edit');
assert.equal(graphChromeKind(commitToolBtn), 'commit', 'copy inside the toolbelt is commit chrome');
assert.equal(
  graphBlurCancels(commitToolBtn, false),
  false,
  'commit-edit tool buttons do not cancel a graph editor'
);
assert.equal(
  graphChromeKind({
    closest: (sel) => {
      const s = String(sel);
      if (s.includes('data-commit-edit') || s.includes('.toolbelt') || s.includes('.tool-btn')) return {};
      return null;
    },
  }),
  'commit',
  'copy icon under .toolbelt is still commit, not a tool-switch cancel'
);
assert.equal(
  graphChromeKind({ closest: (sel) => (String(sel).includes('.toolbelt') ? {} : null) }),
  'cancel',
  'bare toolbelt padding still cancels a graph editor'
);
assert.equal(
  overlayFinishNow(commitToolBtn),
  true,
  'text overlay finishes immediately on commit-edit chrome'
);
assert.equal(
  overlayFinishNow({ closest: (sel) => (String(sel).includes('data-commit-edit') ? {} : null) }),
  true,
  'file-bar download (icon-btn + commit-edit) finishes the text overlay immediately'
);
assert.equal(overlayFinishNow(null), false, 'no related target defers text overlay finish');
assert.equal(
  graphBlurCancels(
    {
      closest: (sel) => {
        const s = String(sel);
        if (s.includes('data-keep-edit') || s.includes('.tool-btn')) return {};
        return null;
      },
    },
    false
  ),
  false,
  'keep-edit chrome does not cancel a graph editor'
);

assert.throws(
  () => require2dContext({ getContext: () => null }),
  /canvas context/,
  'PDF/TXT import fails closed without a 2d context'
);
const fake2d = { kind: '2d' };
assert.equal(require2dContext({ getContext: () => fake2d }), fake2d, 'require2dContext returns the live context');

const htmlPrevCE = document.createElement;
document.createElement = () => {
  const emptyStyle = () => ({ fontWeight: '', fontStyle: '', textDecoration: '', backgroundColor: '', color: '' });
  const textNode = (t) => ({ nodeType: 3, textContent: t });
  const elem = (tag, kids) => ({
    nodeType: 1,
    tagName: tag,
    childNodes: kids,
    style: emptyStyle(),
    getAttribute() {
      return null;
    },
  });
  const root = elem('DIV', []);
  Object.defineProperty(root, 'innerHTML', {
    set(html) {
      if (html === 'a<div>b</div>') root.childNodes = [textNode('a'), elem('DIV', [textNode('b')])];
      else if (html === '<div>a</div><div>b</div>') root.childNodes = [elem('DIV', [textNode('a')]), elem('DIV', [textNode('b')])];
      else if (html === 'a<br>b') root.childNodes = [textNode('a'), elem('BR', []), textNode('b')];
      else root.childNodes = html ? [textNode(String(html))] : [];
    },
  });
  return root;
};
assert.equal(spansToPlain(htmlToSpans('a<div>b</div>')), 'a\nb', 'text then block keeps the contentEditable line break');
assert.equal(spansToPlain(htmlToSpans('<div>a</div><div>b</div>')), 'a\nb', 'stacked divs still wrap as two lines');
assert.equal(spansToPlain(htmlToSpans('a<br>b')), 'a\nb', 'br still becomes a newline');
document.createElement = htmlPrevCE;

const graphSnap = store.addShape({
  type: 'graph',
  x: 255000,
  y: 255000,
  w: 120,
  h: 80,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 1,
  expr: 'sin(x)',
});
store.flushPendingPatches();
engine.openGraphEditor(graphSnap);
engine.commitGraphPreview(graphSnap, 'x^2');
store.flushPendingPatches();
assert.equal(store.readShape(store.board.get(graphSnap)).expr, 'sin(x)', 'graph preview stays out of the doc');
assert.equal(engine.commitOpenGraphEditor(), true, 'export/clone commits the previewed formula');
store.flushPendingPatches();
assert.equal(store.readShape(store.board.get(graphSnap)).expr, 'x^2', 'commitOpenGraphEditor writes the preview into the doc');
engine.setSelection([]);

const graphHide = store.addShape({
  type: 'graph',
  x: 260000,
  y: 260000,
  w: 120,
  h: 80,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 1,
  expr: 'sin(x)',
});
store.flushPendingPatches();
engine.openGraphEditor(graphHide);
engine.commitGraphPreview(graphHide, 'cos(x)');
store.flushPendingPatches();
assert.equal(store.readShape(store.board.get(graphHide)).expr, 'sin(x)', 'hide persist preview stays out of the doc');
assert.deepEqual(
  persistOpenEditors(engine, null, null),
  { text: false, graph: true },
  'pagehide persist commits the graph preview without a text overlay'
);
store.flushPendingPatches();
assert.equal(store.readShape(store.board.get(graphHide)).expr, 'cos(x)', 'pagehide persist writes the preview into the doc');
engine.setSelection([]);

const cancelMeasure = store.addShape({
  type: 'text',
  x: 258000,
  y: 258000,
  w: 40,
  h: 20,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  text: 'Hi',
  fontSize: 16,
});
store.flushPendingPatches();
engine.openTextEditor(cancelMeasure);
store.patchShape(cancelMeasure, { fontSize: 64 });
store.flushPendingPatches();
engine.cancelTextEdit();
store.flushPendingPatches();
assert.ok(
  store.readShape(store.board.get(cancelMeasure)).h > 20,
  'Escape after a live font-size change remasures the text box'
);
engine.setSelection([]);

const portalAtScale = zoomedPortalPosition(
  { left: 100, right: 140, top: 10, bottom: 40 },
  { width: 240, estimatedHeight: 280, align: 'left', scale: 2, viewport: { width: 1000, height: 800 } }
);
assert.equal(portalAtScale.left, 50, 'page menu portal left is visual/scale so CSS zoom lands on the trigger');
assert.equal(
  zoomedPortalPosition(
    { left: 10, right: 50, top: 10, bottom: 40 },
    { width: 240, estimatedHeight: 280, align: 'left', scale: 1, viewport: { width: 1000, height: 800 } }
  ).left,
  10,
  'page menu portal at scale 1 keeps the trigger left'
);

const historyText = store.addShape({
  type: 'text',
  x: 259000,
  y: 259000,
  w: 40,
  h: 20,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  text: 'Hi',
  fontSize: 16,
});
store.flushPendingPatches();
store.beginGesture();
store.patchShape(historyText, { fontSize: 64 });
store.flushPendingPatches();
store.endGesture();
engine.openTextEditor(historyText);
engine.commitText(
  historyText,
  'Hi',
  {
    id: historyText,
    x: 259000,
    y: 259000,
    w: 40,
    h: 20,
    text: 'Hi',
    fontSize: 64,
    color: '#111111',
    type: 'text',
    centered: false,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    textAlign: 'left',
    highlight: false,
  }
);
store.flushPendingPatches();
const hCommitted = store.readShape(store.board.get(historyText)).h;
assert.ok(hCommitted > 20, 'commit remasures after a live font-size change');
store.undoManager.undo();
store.flushPendingPatches();
engine.remeasureAfterHistory();
store.flushPendingPatches();
const afterUndo = store.readShape(store.board.get(historyText));
assert.equal(afterUndo.fontSize, 64, 'one undo keeps the live StyleBar font size');
assert.ok(afterUndo.h > 20, 'undo of commit remasures the box to the remaining font size');
engine.setSelection([]);

// --- Graphical tablet / stylus: palm reject + eraser tip + pressure ---
{
  const pensBefore = [...store.board].filter(([, m]) => m.get('type') === 'pen').length;
  engine.setTool('pen');
  engine.onPointerDown({
    clientX: 200,
    clientY: 200,
    button: 0,
    pointerId: 701,
    pointerType: 'pen',
    pressure: 0.2,
    shiftKey: false,
    altKey: false,
    preventDefault() {},
  });
  engine.onPointerMove({
    clientX: 230,
    clientY: 240,
    button: 0,
    pointerId: 701,
    pointerType: 'pen',
    pressure: 0.85,
    shiftKey: false,
    altKey: false,
    getCoalescedEvents() {
      return [
        {
          clientX: 210,
          clientY: 210,
          button: 0,
          pointerId: 701,
          pointerType: 'pen',
          pressure: 0.4,
          shiftKey: false,
          altKey: false,
        },
        {
          clientX: 220,
          clientY: 225,
          button: 0,
          pointerId: 701,
          pointerType: 'pen',
          pressure: 0.6,
          shiftKey: false,
          altKey: false,
        },
        {
          clientX: 230,
          clientY: 240,
          button: 0,
          pointerId: 701,
          pointerType: 'pen',
          pressure: 0.85,
          shiftKey: false,
          altKey: false,
        },
      ];
    },
  });
  // Palm/touch while pen is down must NOT cancel the stroke into pinch-pan.
  engine.onPointerDown({
    clientX: 400,
    clientY: 400,
    button: 0,
    pointerId: 702,
    pointerType: 'touch',
    pressure: 0.5,
    shiftKey: false,
    altKey: false,
    preventDefault() {},
  });
  engine.onPointerMove({
    clientX: 260,
    clientY: 270,
    button: 0,
    pointerId: 701,
    pointerType: 'pen',
    pressure: 0.55,
    shiftKey: false,
    altKey: false,
  });
  engine.onPointerUp({
    clientX: 260,
    clientY: 270,
    button: 0,
    pointerId: 701,
    pointerType: 'pen',
    pressure: 0.55,
    shiftKey: false,
    altKey: false,
  });
  const pensAfterPalm = [...store.board].filter(([, m]) => m.get('type') === 'pen');
  assert.equal(pensAfterPalm.length, pensBefore + 1, 'pen+palm: stroke still commits');
  const palmStroke = store.readShape(pensAfterPalm[pensAfterPalm.length - 1][1]);
  assert.ok((palmStroke.points?.length ?? 0) >= 6, 'pen+palm: stroke kept multiple points');
  assert.ok(
    palmStroke.pressures && palmStroke.pressures.length >= 2,
    'stylus pressure persisted on committed stroke'
  );
  assert.ok(
    Math.max(...palmStroke.pressures) - Math.min(...palmStroke.pressures) > 0.08,
    'coalesced/stylus pressures actually vary'
  );
  store.undoManager.undo();
  assert.equal(
    [...store.board].filter(([, m]) => m.get('type') === 'pen').length,
    pensBefore,
    'stylus stroke undoes as one gesture'
  );

  // Eraser tip (button 5) temporarily erases without leaving Pen as the toolbar tool.
  const victim = store.addShape({
    type: 'pen',
    x: 800,
    y: 800,
    w: 40,
    h: 40,
    fill: 'transparent',
    stroke: '#111111',
    strokeWidth: 3,
    points: [810, 810, 830, 830],
  });
  engine.setTool('pen');
  assert.equal(engine.active, 'pen', 'toolbar still Pen before eraser tip');
  const eraseScr = engine.worldToScreen(820, 820);
  engine.onPointerDown({
    clientX: eraseScr.x,
    clientY: eraseScr.y,
    button: 5,
    pointerId: 703,
    pointerType: 'pen',
    pressure: 0.5,
    shiftKey: false,
    altKey: false,
    preventDefault() {},
  });
  engine.onPointerMove({
    clientX: eraseScr.x + 2,
    clientY: eraseScr.y + 2,
    button: 5,
    pointerId: 703,
    pointerType: 'pen',
    pressure: 0.5,
    shiftKey: false,
    altKey: false,
  });
  engine.onPointerUp({
    clientX: eraseScr.x + 2,
    clientY: eraseScr.y + 2,
    button: 5,
    pointerId: 703,
    pointerType: 'pen',
    pressure: 0.5,
    shiftKey: false,
    altKey: false,
  });
  assert.equal(store.board.has(victim), false, 'eraser tip removes ink under the tip');
  assert.equal(engine.active, 'pen', 'eraser tip restores Pen as the active tool');
}

const staleDropBefore = store.board.size;
const staleReaders = [];
const stalePrevFR = globalThis.FileReader;
const stalePrevImg = globalThis.Image;
globalThis.FileReader = class {
  result = 'data:image/png;base64,aaa';
  onload = null;
  readAsDataURL() {
    staleReaders.push(this);
  }
};
globalThis.Image = class {
  onload = null;
  naturalWidth = 10;
  naturalHeight = 10;
  set src(_v) {
    this.onload && this.onload();
  }
};
engine.insertImageFile(new File([new Uint8Array([1])], 'late.png', { type: 'image/png' }));
let cropAtDestroy = null;
engine.events.onCrop = (active) => {
  cropAtDestroy = active;
};
engine.setSelection([leaveBoardCropImg]);
engine.startCropSelected();
assert.equal(cropAtDestroy, true, 'crop UI turns on');
engine.destroy();
assert.equal(cropAtDestroy, false, 'destroy cancels crop so a board switch cannot leave Apply armed');
assert.equal(engine.alive, false, 'destroy marks the engine dead');
staleReaders[0].onload();
assert.equal(store.board.size, staleDropBefore, 'image decode after destroy does not write into the next board');
globalThis.FileReader = stalePrevFR;
globalThis.Image = stalePrevImg;

console.log('engine-move-test: all checks passed');
process.exit(0);
