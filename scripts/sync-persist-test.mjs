import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  asUint8,
  createAsyncGate,
  deleteBlob,
  joinChunks,
  mergeTails,
  readBlob,
  shouldFullPersist,
  splitChunks,
  STORAGE_CHUNK,
  storageCount,
  writeBlob,
  canDropPersistedTail,
  canGcEmptyRoom,
} from '../worker/src/persist.ts';
import { canClearRoom, isRoomDeleteAuthorized, tokensMatch } from '../worker/src/auth.ts';

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  async get(key) {
    if (Array.isArray(key)) {
      const out = new Map();
      for (const k of key) {
        if (this.map.has(k)) out.set(k, this.map.get(k));
      }
      return out;
    }
    return this.map.get(key);
  }
  async put(key, value) {
    if (key && typeof key === 'object' && !Array.isArray(key)) {
      for (const [k, v] of Object.entries(key)) this.map.set(k, v);
      return;
    }
    this.map.set(key, value);
  }
  async delete(key) {
    const keys = Array.isArray(key) ? key : [key];
    let n = 0;
    for (const k of keys) {
      if (this.map.delete(k)) n += 1;
    }
    return n;
  }
}

assert.equal(tokensMatch('abc', 'abc'), true);
assert.equal(tokensMatch('abc', 'abd'), false);
assert.equal(tokensMatch('', 'abc'), false);

const env = { REVIEW_COMPACT_TOKEN: 's3cret' };
assert.equal(
  isRoomDeleteAuthorized(
    new Request('https://example/room/x', { method: 'DELETE', headers: { 'X-Review-Compact-Token': 's3cret' } }),
    env,
  ),
  true,
);
assert.equal(
  isRoomDeleteAuthorized(new Request('https://example/room/x', { method: 'DELETE' }), env),
  false,
);
assert.equal(
  isRoomDeleteAuthorized(
    new Request('https://example/room/x', { method: 'DELETE', headers: { 'X-Review-Compact-Token': 's3cret' } }),
    {},
  ),
  false,
  'fail closed without secret',
);

assert.equal(canClearRoom(true, 4), true);
assert.equal(canClearRoom(false, 1), false);
assert.equal(canClearRoom(false, 0), true);

assert.equal(shouldFullPersist(0, 1000), true);
assert.equal(shouldFullPersist(500, 1000), false);
assert.equal(shouldFullPersist(0, 999), false);

const raw = new Uint8Array([1, 2, 3, 4, 5]);
assert.deepEqual([...joinChunks(splitChunks(raw, 2))], [1, 2, 3, 4, 5]);
assert.equal(splitChunks(new Uint8Array(STORAGE_CHUNK + 10)).length, 2);

const docA = new Y.Doc();
const docB = new Y.Doc();
docA.getMap('m').set('k', 'v1');
const u1 = Y.encodeStateAsUpdate(docA);
docA.getMap('m').set('k', 'v2');
const u2 = Y.encodeStateAsUpdate(docA);
const merged = mergeTails(null, [u1, u2]);
assert.ok(merged && merged.length > 0);
Y.applyUpdate(docB, merged);
assert.equal(docB.getMap('m').get('k'), 'v2');

const store = new MemoryStorage();
const blob = new Uint8Array(STORAGE_CHUNK * 2 + 17);
blob[0] = 9;
blob[blob.length - 1] = 7;
await writeBlob(store, 'doc', blob);
assert.equal(store.map.has('doc'), false, 'legacy key removed');
assert.equal(store.map.get('doc:gen'), 1, 'generation pointer committed');
assert.equal(store.map.get('doc:1:n'), 3);
const back = await readBlob(store, 'doc');
assert.ok(back);
assert.equal(back.length, blob.length);
assert.equal(back[0], 9);
assert.equal(back[back.length - 1], 7);

await store.put({ 'doc:2:0': new Uint8Array([9, 9, 9]), 'doc:2:n': 1 });
const stillOld = await readBlob(store, 'doc');
assert.equal(stillOld.length, blob.length, 'uncommitted next generation is ignored');

await writeBlob(store, 'doc', new Uint8Array([1, 2, 3]));
const small = await readBlob(store, 'doc');
assert.deepEqual([...small], [1, 2, 3]);
assert.equal(store.map.get('doc:gen'), 2);
assert.equal(store.map.has('doc:1:0'), false, 'previous generation deleted');
assert.equal(store.map.has('doc:1:2'), false, 'stale chunks deleted');

class OrderStorage extends MemoryStorage {
  constructor() {
    super();
    this.log = [];
  }
  async put(key, value) {
    if (key && typeof key === 'object' && !Array.isArray(key)) {
      this.log.push(...Object.keys(key));
    } else {
      this.log.push(key);
    }
    return super.put(key, value);
  }
}
const ordered = new OrderStorage();
const twoChunks = new Uint8Array(STORAGE_CHUNK + 4);
await writeBlob(ordered, 'p', twoChunks);
const genAt = ordered.log.lastIndexOf('p:gen');
const nAt = ordered.log.indexOf('p:1:n');
assert.ok(nAt >= 0 && genAt > nAt, 'generation pointer flips only after chunks exist');

await deleteBlob(store, 'doc');
assert.equal(await readBlob(store, 'doc'), null);

const legacy = new MemoryStorage();
await legacy.put('tail', new Uint8Array([4, 5, 6]));
const fromLegacy = await readBlob(legacy, 'tail');
assert.deepEqual([...fromLegacy], [4, 5, 6]);

const strN = new MemoryStorage();
await strN.put('s:n', '2');
await strN.put('s:0', new Uint8Array([1]));
await strN.put('s:1', new Uint8Array([2, 3]));
const fromStrN = await readBlob(strN, 's');
assert.deepEqual([...fromStrN], [1, 2, 3], 'legacy n stored as string still reads');
assert.equal(storageCount('3'), 3);
assert.equal(storageCount(2), 2);
assert.equal(storageCount(undefined), 0);

assert.ok(asUint8(new Uint8Array([1])));
assert.equal(asUint8(null), null);

const gate = createAsyncGate();
const order = [];
await Promise.all([
  gate(async () => {
    await new Promise((r) => setTimeout(r, 20));
    order.push(1);
  }),
  gate(async () => {
    order.push(2);
  }),
]);
assert.deepEqual(order, [1, 2], 'persist writes run one at a time in enqueue order');

assert.equal(canDropPersistedTail(3, 3, 0), true, 'drop tail when encode matches live doc');
assert.equal(canDropPersistedTail(3, 4, 0), false, 'keep tail when the doc mutated during write');
assert.equal(canDropPersistedTail(3, 3, 1), false, 'keep tail when pending updates remain');
assert.equal(
  canDropPersistedTail(5, 6, 1),
  false,
  'after deleting the tail blob, pending updates must be rewritten (encode gen moved)'
);

assert.equal(canGcEmptyRoom(0, false, 0), true, 'empty idle room can GC');
assert.equal(canGcEmptyRoom(1, false, 0), false, 'live sockets block empty-room GC');
assert.equal(canGcEmptyRoom(0, true, 0), false, 'dirty persist blocks empty-room GC');
assert.equal(canGcEmptyRoom(0, false, 2), false, 'pending updates block empty-room GC');

console.log('sync-persist-test: all checks passed');
