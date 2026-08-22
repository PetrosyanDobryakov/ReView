import * as Y from 'yjs';
import assert from 'node:assert/strict';

const ORIGIN = 'local';
const doc = new Y.Doc();
const board = doc.getMap('shapes');
const undo = new Y.UndoManager([board], { trackedOrigins: new Set([ORIGIN]) });

const events = [];
board.observe((ev) => {
  ev.changes.keys.forEach((change, key) => {
    events.push([key, change.action]);
  });
});

const m = new Y.Map();
m.set('id', 'a');
m.set('type', 'rect');
m.set('x', 10);
doc.transact(() => board.set('a', m), ORIGIN);

assert.deepEqual(events[0], ['a', 'add'], 'observer fires add');
assert.equal(board.get('a').get('x'), 10, 'shape readable');

await new Promise((r) => setTimeout(r, 600));
doc.transact(() => board.get('a').set('x', 50), ORIGIN);
assert.equal(board.get('a').get('x'), 50, 'patch applied');

undo.undo();
assert.equal(board.get('a').get('x'), 10, 'undo reverts last step (patch only, shape stays)');

undo.redo();
assert.equal(board.get('a').get('x'), 50, 'redo re-applies patch');
assert.equal(board.has('a'), true, 'redo keeps shape');

await new Promise((r) => setTimeout(r, 600));
doc.transact(() => board.delete('a'), ORIGIN);
assert.equal(board.has('a'), false, 'delete works');
undo.undo();
assert.equal(board.get('a').get('x'), 50, 'undo restores deleted shape');

const pen = new Y.Map();
pen.set('id', 'p');
pen.set('type', 'pen');
const pts = new Y.Array();
pts.insert(0, [1, 2, 3, 4]);
pen.set('points', pts);
doc.transact(() => board.set('p', pen), ORIGIN);
assert.deepEqual(board.get('p').get('points').toArray(), [1, 2, 3, 4], 'Y.Array points readable');

console.log('yjs store: all checks passed');
