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

console.log('lock-test: all checks passed');
process.exit(0);
