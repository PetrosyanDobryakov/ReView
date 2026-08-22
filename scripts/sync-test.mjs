import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import assert from 'node:assert/strict';

const URL = 'ws://127.0.0.1:1234';
const ROOM = 'sync-test-' + Date.now();

const docA = new Y.Doc();
const docB = new Y.Doc();
const pa = new WebsocketProvider(URL, ROOM, docA);
const pb = new WebsocketProvider(URL, ROOM, docB);

function waitSync(provider) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('sync timeout — server not running?')), 5000);
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

await Promise.all([waitSync(pa), waitSync(pb)]);

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

await new Promise((r) => setTimeout(r, 800));

const boardB = docB.getMap('shapes');
assert.equal(boardB.has('sync1'), true, 'client B received shape from client A');
assert.equal(boardB.get('sync1').get('x'), 10, 'shape data intact');

docB.getMap('shapes').get('sync1').set('x', 777);
await new Promise((r) => setTimeout(r, 800));
assert.equal(boardA.get('sync1').get('x'), 777, 'client A received change from client B');

pa.destroy();
pb.destroy();
console.log('sync-test: both directions verified');
process.exit(0);
