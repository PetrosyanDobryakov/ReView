import * as Y from 'yjs';
import assert from 'node:assert/strict';

const doc = new Y.Doc();
const board = doc.getMap('shapes');

let uid = 0;
function makeId() {
  uid += 1;
  return 'id-' + uid;
}

function createShapeYMap(v) {
  const m = new Y.Map();
  m.set('id', v.id);
  m.set('type', v.type);
  m.set('x', v.x);
  m.set('y', v.y);
  m.set('w', v.w);
  m.set('h', v.h);
  m.set('fill', v.fill);
  m.set('stroke', v.stroke);
  m.set('strokeWidth', v.strokeWidth);
  if (v.type === 'sticky' || v.type === 'text') {
    m.set('text', v.text ?? '');
    m.set('fontSize', v.fontSize);
  }
  if (v.points) {
    const arr = new Y.Array();
    arr.insert(0, v.points);
    m.set('points', arr);
  }
  if (v.alpha !== undefined) m.set('alpha', v.alpha);
  return m;
}

function addShape(v) {
  const id = v.id ?? makeId();
  const m = createShapeYMap({ ...v, id });
  doc.transact(() => {
    board.set(id, m);
  }, 'local');
  return id;
}

function readShape(m) {
  const type = m.get('type');
  const points = m.get('points');
  return {
    id: m.get('id'),
    type,
    x: m.get('x') ?? 0,
    y: m.get('y') ?? 0,
    w: m.get('w') ?? 0,
    h: m.get('h') ?? 0,
    fill: m.get('fill'),
    stroke: m.get('stroke'),
    strokeWidth: m.get('strokeWidth') ?? 2,
    text: m.get('text'),
    fontSize: m.get('fontSize'),
    textColor: m.get('textColor'),
    alpha: m.get('alpha'),
    points: points instanceof Y.Array ? points.toArray() : undefined,
  };
}

const pen = {
  type: 'pen',
  x: 10,
  y: 10,
  w: 100,
  h: 50,
  fill: 'transparent',
  stroke: '#f2f5ff',
  strokeWidth: 3,
  alpha: 0.3,
  points: [10, 10, 20, 20, 30, 15, 40, 40, 50, 60],
};

const pid = addShape(pen);
const v1 = readShape(board.get(pid));
assert.deepEqual(v1.points, pen.points, 'pen points survive add+read');
assert.equal(v1.alpha, 0.3, 'pen alpha survives add+read');

const clipboard = structuredClone(v1);
const off = 40;
const pasteId = addShape({
  ...clipboard,
  id: undefined,
  x: v1.x + off,
  y: v1.y + off,
  points: clipboard.points ? clipboard.points.map((p) => p + off) : undefined,
});
const v2 = readShape(board.get(pasteId));
assert.deepEqual(v2.points, pen.points.map((p) => p + off), 'pasted pen points shifted by offset');
assert.equal(v2.alpha, 0.3, 'pasted pen alpha survives');
assert.equal(v2.x, 50, 'pasted pen offset applied');

const stickyId = addShape({
  type: 'sticky',
  x: 0,
  y: 0,
  w: 180,
  h: 120,
  fill: '#ffe27a',
  stroke: '#d9b64d',
  strokeWidth: 2,
  text: '',
});
doc.transact(() => {
  board.get(stickyId).set('text', 'Привет!!!');
}, 'local');
const sv = readShape(board.get(stickyId));
assert.equal(sv.text, 'Привет!!!', 'sticky text patch works');

console.log('paste-test: all checks passed');
