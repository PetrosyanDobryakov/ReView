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

await waitAware(
  pa,
  () => {
    for (const [id, state] of pa.awareness.getStates()) {
      if (id === pa.awareness.clientID) continue;
      const user = state.user;
      const cur = state.cursor;
      if (user?.id === 'user-b' && user?.name === 'Bob' && cur?.x === 7 && cur?.y === 8) {
        return true;
      }
    }
    return false;
  },
  'A sees Bob cursor'
);

pa.destroy();
pb.destroy();
console.log('sync-test: shapes + awareness verified');
process.exit(0);
