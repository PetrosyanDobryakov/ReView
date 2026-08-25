import assert from 'node:assert/strict';

globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
const fakeReq = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: null, error: null, addEventListener() {} };
globalThis.indexedDB = { open: () => fakeReq };

const ctxProxy = new Proxy({}, { get: (_t, p) => (p === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true });
const canvas = {
  style: {}, width: 0, height: 0,
  addEventListener() {}, removeEventListener() {}, setPointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
  getContext: () => ctxProxy,
};

const { Engine, store } = await import('./engine-bundle.mjs');
const engine = new Engine(canvas);

const id = store.addShape({ type: 'rect', x: 100, y: 100, w: 50, h: 50, fill: '#ffffff', stroke: '#000000', strokeWidth: 2 });

engine.setSelection([id]);
assert.ok(engine.views.get(id), 'view exists');
assert.ok(!engine.views.get(id).locked, 'initially unlocked');

engine.toggleLockSelection();
assert.equal(engine.views.get(id).locked === true, true, 'locked after toggleLockSelection, got: ' + engine.views.get(id).locked);

engine.toggleLockSelection();
assert.ok(!engine.views.get(id).locked, 'unlocked after second toggle');

// simulate what the ctx menu does: patchShapes directly
store.patchShapes([[id, { locked: true }]]);
assert.equal(engine.views.get(id).locked === true, true, 'locked via patchShapes, got: ' + engine.views.get(id).locked);

// doc shape: pages array + page round-trip
const docId = store.addShape({
  type: 'doc', x: 0, y: 0, w: 300, h: 424, fill: 'transparent', stroke: 'transparent', strokeWidth: 0,
  pages: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'], page: 1,
});
const docView = engine.views.get(docId);
assert.equal(docView?.pages?.length, 2, 'doc pages stored, got: ' + JSON.stringify(docView?.pages));
assert.equal(docView?.page, 1, 'doc page stored');
store.patchShape(docId, { page: 0 });
assert.equal(engine.views.get(docId)?.page, 0, 'doc page patched');

console.log('lock-test: all checks passed');
process.exit(0);
