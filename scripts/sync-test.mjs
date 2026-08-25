/**
 * Live websocket sync + awareness smoke test.
 * Requires: npm run server (or npm run dev) on :1234
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import assert from 'node:assert/strict';

const URL = process.env.REVIEW_SYNC_URL || 'ws://127.0.0.1:1234';
const ROOM = 'sync-test-' + Date.now();

const docA = new Y.Doc();
const docB = new Y.Doc();
const pa = new WebsocketProvider(URL, ROOM, docA);
const pb = new WebsocketProvider(URL, ROOM, docB);

function waitSync(provider) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('sync timeout — server not running?')), 8000);
    if (provider.synced) {
      clearTimeout(t);
      return resolve();
    }
    provider.once('sync', (synced) => {
      if (synced) {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

function waitAware(provider, pred, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`awareness timeout: ${label}`)), 5000);
    const check = () => {
      if (pred()) {
        clearTimeout(t);
        provider.awareness.off('change', check);
        resolve();
      }
    };
    provider.awareness.on('change', check);
    check();
  });
}

await Promise.all([waitSync(pa), waitSync(pb)]);

// --- shapes CRDT ---
const boardA = docA.getMap('shapes');
const m = new Y.Map();
m.set('id', 'sync1');
m.set('type', 'rect');
m.set('x', 10);
m.set('y', 20);
m.set('w', 100);
m.set('h', 50);
m.set('fill', '#ffffff');
m.set('stroke', '#7c8cff');
m.set('strokeWidth', 2);
boardA.set('sync1', m);

await new Promise((r) => setTimeout(r, 600));

const boardB = docB.getMap('shapes');
assert.equal(boardB.has('sync1'), true, 'client B received shape from client A');
assert.equal(boardB.get('sync1').get('x'), 10, 'shape data intact');

docB.getMap('shapes').get('sync1').set('x', 777);
await new Promise((r) => setTimeout(r, 600));
assert.equal(boardA.get('sync1').get('x'), 777, 'client A received change from client B');

// --- synced board title in meta ---
const metaA = docA.getMap('meta');
metaA.set('ownerId', 'user-a');
metaA.set('title', 'Alpha board');
await new Promise((r) => setTimeout(r, 600));
const metaB = docB.getMap('meta');
assert.equal(metaB.get('title'), 'Alpha board', 'client B received synced board title');
metaA.set('title', 'Renamed live');
await new Promise((r) => setTimeout(r, 600));
assert.equal(metaB.get('title'), 'Renamed live', 'title rename propagates');

// --- awareness user + cursor ---
pa.awareness.setLocalStateField('user', {
  id: 'user-a',
  name: 'Alice',
  color: '#ff6b6b',
});
pa.awareness.setLocalStateField('cursor', { x: 42, y: 99 });

await waitAware(
  pb,
  () => {
    for (const [id, state] of pb.awareness.getStates()) {
      if (id === pb.awareness.clientID) continue;
      const user = state.user;
      const cur = state.cursor;
      if (user?.id === 'user-a' && user?.name === 'Alice' && cur?.x === 42 && cur?.y === 99) {
        return true;
      }
    }
    return false;
  },
  'B sees Alice cursor'
);

pb.awareness.setLocalStateField('user', {
  id: 'user-b',
  name: 'Bob',
  color: '#4cd964',
});
pb.awareness.setLocalStateField('cursor', { x: 7, y: 8 });
pb.awareness.setLocalStateField('draft', {
  kind: 'pen',
  points: [1, 2, 3, 4, 5, 6],
  stroke: '#4cd964',
  strokeWidth: 3,
});
pb.awareness.setLocalStateField('erasePreview', {
  x: 50,
  y: 60,
  r: 32,
  mode: 'whole',
  whole: ['sync1'],
});

await waitAware(
  pa,
  () => {
    for (const [id, state] of pa.awareness.getStates()) {
      if (id === pa.awareness.clientID) continue;
      const user = state.user;
      const cur = state.cursor;
      const draft = state.draft;
      const erasePreview = state.erasePreview;
      if (
        user?.id === 'user-b' &&
        user?.name === 'Bob' &&
        cur?.x === 7 &&
        cur?.y === 8 &&
        draft?.kind === 'pen' &&
        Array.isArray(draft.points) &&
        draft.points.length === 6 &&
        erasePreview?.mode === 'whole' &&
        Array.isArray(erasePreview.whole) &&
        erasePreview.whole.includes('sync1')
      ) {
        return true;
      }
    }
    return false;
  },
  'A sees Bob cursor + draft + erase preview'
);

// --- pages list sync (count only; no shape wipe) ---
const pagesA = docA.getArray('pages');
pagesA.push(['main']);
const pid = 'p' + Date.now().toString(36);
pagesA.push([pid]);
await new Promise((r) => setTimeout(r, 600));
const pagesB = docB.getArray('pages');
assert.equal(pagesB.length, 2, 'client B received page list');
assert.equal(pagesB.get(1), pid, 'new page id synced');
assert.equal(boardB.has('sync1'), true, 'existing shapes intact after page add');

// --- away presence keeps cursor ---
pa.awareness.setLocalStateField('viewing', false);
pa.awareness.setLocalStateField('cursor', { x: 100, y: 200 });
await waitAware(
  pb,
  () => {
    for (const [id, state] of pb.awareness.getStates()) {
      if (id === pb.awareness.clientID) continue;
      if (state.viewing === false && state.cursor?.x === 100 && state.cursor?.y === 200) {
        return true;
      }
    }
    return false;
  },
  'B sees away Alice cursor frozen'
);

pa.destroy();
pb.destroy();
console.log('sync-test: shapes + awareness + pages + away presence verified');
process.exit(0);
