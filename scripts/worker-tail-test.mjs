/**
 * Worker tail-persist posture: message handlers must never await storage —
 * relay stays synchronous while durability trails via waitUntil + debounce.
 *
 * room.ts is bundled with esbuild (it is worker TS, parameter properties and
 * extensionless imports included) and driven with a fake DurableObjectState.
 *
 * Run: node --experimental-strip-types scripts/worker-tail-test.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { readBlob } from '../worker/src/persist.ts';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const outFile = path.join(os.tmpdir(), `boardroom-test-${Date.now()}.mjs`);
esbuild.buildSync({
  entryPoints: [fileURLToPath(new URL('../worker/src/room.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outfile: outFile,
  logLevel: 'silent',
});
const { BoardRoom } = await import(pathToFileURL(outFile).href);

function makeStorage() {
  const map = new Map();
  const ops = { puts: 0, gets: 0, deleteAlls: 0 };
  return {
    ops,
    map,
    async get(k) {
      ops.gets += 1;
      if (Array.isArray(k)) {
        const m = new Map();
        for (const key of k) if (map.has(key)) m.set(key, map.get(key));
        return m;
      }
      return map.get(k);
    },
    async put(k, v) {
      ops.puts += 1;
      if (typeof k === 'string') map.set(k, v);
      else for (const [key, val] of Object.entries(k)) map.set(key, val);
    },
    async delete(k) {
      const keys = Array.isArray(k) ? k : [k];
      let n = 0;
      for (const key of keys) if (map.delete(key)) n += 1;
      return n;
    },
    async deleteAll() {
      ops.deleteAlls += 1;
      map.clear();
    },
    async deleteAlarm() {},
    async setAlarm() {},
  };
}

function makeSocket() {
  return { sent: [], send(m) { this.sent.push(m); } };
}

/** Wrap a raw Yjs update in a y-protocols sync message (messageSync + update). */
function syncUpdateMessage(update) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 0);
  syncProtocol.writeUpdate(enc, update);
  return encoding.toUint8Array(enc);
}

/** Awareness update framed as messageAwareness. */
function awarenessMessage(awareness, clients) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 1);
  encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, clients));
  return encoding.toUint8Array(enc);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const storage = makeStorage();
const waited = [];
const sockets = [makeSocket(), makeSocket()];
const state = {
  storage,
  getWebSockets: () => sockets,
  blockConcurrencyWhile: async (fn) => {
    await fn();
  },
  waitUntil(p) {
    waited.push(p);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  },
};

const room = new BoardRoom(state, { REVIEW_COMPACT_TOKEN: 'test-token' });
for (let i = 0; i < 50 && !room.doc; i++) await sleep(10);
assert.ok(room.doc, 'room doc boots');
// Hibernation restore no longer fan-outs sync-step1 to all sockets (that
// doubled DO wakes). Accept path and mid-message load still sync the peer.
sockets[0].sent.length = 0;
sockets[1].sent.length = 0;

// Seed one key so the room doc is non-empty.
{
  const seed = new Y.Doc();
  seed.getMap('b').set('seed', 1);
  await room.webSocketMessage(sockets[0], syncUpdateMessage(Y.encodeStateAsUpdate(seed)));
}
await Promise.all(waited.splice(0));
assert.ok(sockets[1].sent.length > 0, 'update relays to the other socket');
assert.equal(sockets[0].sent.length, 0, 'origin socket is skipped');
sockets[1].sent.length = 0;

// Burst: 20 rapid moves. Relay must happen per message; storage must NOT
// grow per message (debounced tail + waitUntil, never awaited in handler).
const putsBefore = storage.ops.puts;
for (let i = 0; i < 20; i++) {
  const d = new Y.Doc();
  d.getMap('b').set(`m${i}`, i);
  await room.webSocketMessage(sockets[0], syncUpdateMessage(Y.encodeStateAsUpdate(d)));
}
assert.equal(sockets[1].sent.length, 20, 'every burst update relays immediately');
assert.ok(
  storage.ops.puts - putsBefore <= 6,
  `persist stays off the hot path (puts=${storage.ops.puts - putsBefore} for 20 messages)`,
);

// Durability trails: after the debounce window the tail/full blobs exist.
await sleep(600);
await Promise.all(waited.splice(0));
const doc = new Y.Doc();
const stored = await readBlob(storage, 'doc');
assert.ok(stored && stored.length > 0, 'full doc blob persisted');
Y.applyUpdate(doc, stored);
const tail = await readBlob(storage, 'tail');
if (tail && tail.length) Y.applyUpdate(doc, tail);
assert.equal(doc.getMap('b').get('seed'), 1, 'seed survives the round-trip');
assert.equal(doc.getMap('b').get('m19'), 19, 'burst tail survives the round-trip');

// Awareness floods must not arm full-doc persist. Mid-flood encode freezes the
// isolate and bursts every queued cursor/stroke — the residual stutter after
// the 0.14.25 trailing-tail fix.
{
  const waitedBefore = waited.length;
  const putsBeforeAware = storage.ops.puts;
  const local = new Y.Doc();
  const aw = new awarenessProtocol.Awareness(local);
  aw.setLocalStateField('cursor', { x: 1, y: 2 });
  for (let i = 0; i < 30; i++) {
    aw.setLocalStateField('cursor', { x: i, y: i });
    await room.webSocketMessage(
      sockets[0],
      awarenessMessage(aw, [local.clientID]),
    );
  }
  assert.equal(
    waited.length,
    waitedBefore,
    'awareness-only traffic does not schedule waitUntil persist',
  );
  assert.equal(
    storage.ops.puts,
    putsBeforeAware,
    'awareness-only traffic does not touch storage',
  );
  try {
    clearInterval(aw._checkInterval);
  } catch {}
  local.destroy();
}

// Upgrade during an in-flight wipe must 503 — clearing the latch mid-deleteAll
// would let resetRoom run under a newly accepted socket.
{
  let releaseDelete;
  const held = new Promise((r) => {
    releaseDelete = r;
  });
  const origDeleteAll = storage.deleteAll.bind(storage);
  storage.deleteAll = async () => {
    storage.ops.deleteAlls += 1;
    await held;
    storage.map.clear();
  };
  const wipeP = room.fetch(
    new Request('https://review-sync.test/room/wipe-accept', {
      method: 'DELETE',
      headers: { 'X-Review-Compact-Token': 'test-token' },
    }),
  );
  for (let i = 0; i < 50 && !room.wipeInFlight; i++) await sleep(10);
  assert.equal(room.wipeInFlight, true, 'wipe is in flight while deleteAll is held');
  const up = await room.fetch(
    new Request('https://review-sync.test/room/wipe-accept', {
      headers: { Upgrade: 'websocket' },
    }),
  );
  assert.equal(up.status, 503, 'Upgrade during wipe returns 503');
  assert.equal(room.wipeInFlight, true, 'wipe still in flight after rejected Upgrade');
  releaseDelete();
  const wiped = await wipeP;
  assert.equal(wiped.status, 200, 'held DELETE still clears the room');
  assert.equal(room.wipeInFlight, false, 'wipeInFlight clears after wipe');
  assert.equal(room.suppressPersist, true, 'post-wipe latch stays until accept');
  storage.deleteAll = origDeleteAll;
}

// DELETE must cancel the debounced tail and ignore late close handlers —
// otherwise waitUntil / webSocketClose rewrite blobs after deleteAll and
// compact/GC resurrect the room.
{
  // Seed again on the post-wipe empty room (accept clears the latch).
  const seed2 = new Y.Doc();
  seed2.getMap('b').set('reseed', 1);
  // Accept path needs a WebSocketPair — polyfill for the Node test harness.
  if (typeof globalThis.WebSocketPair !== 'function') {
    globalThis.WebSocketPair = class WebSocketPair {
      constructor() {
        this[0] = makeSocket();
        this[1] = makeSocket();
      }
    };
  }
  // undici Response rejects status 101; Cloudflare Upgrade responses use it.
  const OrigResponse = globalThis.Response;
  globalThis.Response = function Response(body, init) {
    if (init && init.status === 101) {
      return { status: 101, ok: true, webSocket: init.webSocket ?? null };
    }
    return new OrigResponse(body, init);
  };
  Object.setPrototypeOf(globalThis.Response, OrigResponse);
  globalThis.Response.prototype = OrigResponse.prototype;

  const live = [];
  state.acceptWebSocket = (ws) => {
    live.push(ws);
  };
  state.getWebSockets = () => (live.length ? live : sockets);
  const join = await room.fetch(
    new Request('https://review-sync.test/room/wipe-accept', {
      headers: { Upgrade: 'websocket' },
    }),
  );
  assert.equal(join.status, 101, 'Upgrade after wipe accepts');
  assert.equal(room.suppressPersist, false, 'accept clears post-wipe latch');
  globalThis.Response = OrigResponse;
  const d = new Y.Doc();
  d.getMap('b').set('after', 1);
  await room.webSocketMessage(sockets[0], syncUpdateMessage(Y.encodeStateAsUpdate(d)));
  // Timer is armed (~150ms). Wipe immediately, before it fires.
  const del = await room.fetch(
    new Request('https://review-sync.test/room/wipe-race', {
      method: 'DELETE',
      headers: { 'X-Review-Compact-Token': 'test-token' },
    }),
  );
  assert.equal(del.status, 200, 'authorized DELETE clears an occupied room');
  assert.equal(storage.ops.deleteAlls > 0, true, 'DELETE wiped storage');
  // Simulate hibernation close handlers that arrive after fetch returns.
  await room.webSocketClose(sockets[0], 1000, 'room cleared', true);
  await room.webSocketClose(sockets[1], 1000, 'room cleared', true);
  await sleep(400);
  await Promise.all(waited.splice(0));
  assert.equal(storage.map.size, 0, 'no doc/tail resurrection after DELETE + close race');
  assert.equal(await readBlob(storage, 'doc'), null, 'doc blob stays gone');
  assert.equal(await readBlob(storage, 'tail'), null, 'tail blob stays gone');
}

// Awareness runs a 15s housekeeping interval — clear it so the process exits.
try {
  clearInterval(room.awareness._checkInterval);
} catch {}
try {
  room.doc.destroy();
} catch {}

console.log('worker-tail: ok');
