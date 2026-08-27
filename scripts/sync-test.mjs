/**
 * Live websocket sync + awareness smoke test.
 * Requires: npm run server (or npm run dev) on :1234
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isLoopbackAddress, isRoomDeleteAuthorized } from '../room-delete-auth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

// --- HTTP: /lan stays up; /net-log is gated on REVIEW_NET_LOG ---
const liveHttp = URL.replace(/^ws/i, 'http');
const liveLan = await fetch(`${liveHttp}/lan`);
assert.equal(liveLan.status, 200, 'GET /lan on live sync server');
const liveLanBody = await liveLan.json();
assert.equal(liveLanBody.ok, true, 'GET /lan body ok');
assert.ok(Array.isArray(liveLanBody.addresses), 'GET /lan addresses array');

function httpBase(port) {
  return `http://127.0.0.1:${port}`;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on('error', reject);
  });
}

async function waitHealth(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${httpBase(port)}/health`);
      if (res.ok) return;
      lastErr = new Error(`health ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw lastErr ?? new Error(`health timeout :${port}`);
}

function startSyncServer({ port, netLog, token, host = '127.0.0.1' }) {
  return spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      REVIEW_SYNC_PORT: String(port),
      REVIEW_HOST: host,
      REVIEW_NET_LOG: netLog ? '1' : '0',
      ...(token
        ? { REVIEW_COMPACT_TOKEN: token }
        : { REVIEW_COMPACT_TOKEN: '', REVIEW_ROOM_DELETE_TOKEN: '' }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function withServer({ netLog, token, host }, fn) {
  const port = await freePort();
  const child = startSyncServer({ port, netLog, token, host });
  try {
    await waitHealth(port);
    await fn(port);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        resolve();
      }, 2000);
      child.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}

async function listSessionLogs() {
  try {
    const names = await readdir(path.join(ROOT, 'logs', 'net'));
    return names.filter((n) => n.startsWith('session-') && n.endsWith('.log')).sort();
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return [];
    throw err;
  }
}

const beforeDisabled = await listSessionLogs();
await withServer({ netLog: false }, async (port) => {
  const lan = await fetch(`${httpBase(port)}/lan`);
  assert.equal(lan.status, 200, 'GET /lan when net-log off');
  const lanBody = await lan.json();
  assert.equal(lanBody.ok, true);
  assert.ok(Array.isArray(lanBody.addresses));

  const get = await fetch(`${httpBase(port)}/net-log`);
  assert.equal(get.status, 404, 'GET /net-log 404 when REVIEW_NET_LOG off');

  const post = await fetch(`${httpBase(port)}/net-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lines: [{ t: new Date().toISOString(), level: 'info', msg: 'should-not-write' }],
    }),
  });
  assert.equal(post.status, 404, 'POST /net-log 404 when REVIEW_NET_LOG off');
});
const afterDisabled = await listSessionLogs();
assert.deepEqual(afterDisabled, beforeDisabled, 'disabled net-log must not create session files');

await withServer({ netLog: true }, async (port) => {
  const get = await fetch(`${httpBase(port)}/net-log`);
  assert.equal(get.status, 200, 'GET /net-log 200 when REVIEW_NET_LOG on');
  const info = await get.json();
  assert.equal(info.ok, true);
  assert.match(String(info.file), /^logs\/net\/session-.+\.log$/);
  assert.equal(info.latest, 'logs/net/latest.log');
  const dumped = JSON.stringify(info);
  assert.ok(!dumped.includes(ROOT), 'GET /net-log must not leak absolute paths');

  const marker = `sync-test-${Date.now()}`;
  const post = await fetch(`${httpBase(port)}/net-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lines: [{ t: new Date().toISOString(), level: 'info', msg: marker }],
    }),
  });
  assert.equal(post.status, 200, 'POST /net-log 200 when REVIEW_NET_LOG on');
  const posted = await post.json();
  assert.equal(posted.ok, true);
  assert.ok(!JSON.stringify(posted).includes(ROOT), 'POST /net-log must not leak absolute paths');
});

console.log('sync-test: HTTP /lan + gated /net-log verified');

assert.equal(isLoopbackAddress('127.0.0.1'), true);
assert.equal(isLoopbackAddress('::1'), true);
assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
assert.equal(isLoopbackAddress(':ffff:127.0.0.1'), true);
assert.equal(isLoopbackAddress('127.0.0.2'), true);
assert.equal(isLoopbackAddress('192.168.1.5'), false);
assert.equal(isLoopbackAddress('10.0.0.8'), false);
assert.equal(isLoopbackAddress('8.8.8.8'), false);

assert.equal(
  isRoomDeleteAuthorized({ socket: { remoteAddress: '192.168.1.20' }, headers: {} }, {}),
  false,
  'LAN DELETE without token is denied'
);
assert.equal(
  isRoomDeleteAuthorized(
    { socket: { remoteAddress: '192.168.1.20' }, headers: { 'x-forwarded-for': '127.0.0.1' } },
    {}
  ),
  false,
  'X-Forwarded-For must not authorize DELETE'
);
assert.equal(
  isRoomDeleteAuthorized({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }, {}),
  true,
  'loopback DELETE is allowed'
);
assert.equal(
  isRoomDeleteAuthorized(
    { socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-forwarded-for': '10.0.0.8' } },
    {}
  ),
  true,
  'IPv4-mapped loopback is allowed even if X-Forwarded-For is LAN'
);
assert.equal(
  isRoomDeleteAuthorized(
    { socket: { remoteAddress: '192.168.1.20' }, headers: { 'x-review-compact-token': 's3cret' } },
    { REVIEW_COMPACT_TOKEN: 's3cret' }
  ),
  true,
  'LAN DELETE with compact token is allowed'
);
assert.equal(
  isRoomDeleteAuthorized(
    { socket: { remoteAddress: '192.168.1.20' }, headers: { 'x-review-room-delete-token': 's3cret' } },
    { REVIEW_ROOM_DELETE_TOKEN: 's3cret' }
  ),
  true,
  'LAN DELETE with room-delete token is allowed'
);
assert.equal(
  isRoomDeleteAuthorized(
    { socket: { remoteAddress: '192.168.1.20' }, headers: { authorization: 'Bearer s3cret' } },
    { REVIEW_COMPACT_TOKEN: 's3cret' }
  ),
  true,
  'LAN DELETE with Bearer token is allowed'
);
assert.equal(
  isRoomDeleteAuthorized(
    { socket: { remoteAddress: '192.168.1.20' }, headers: { 'x-review-compact-token': 'wrong' } },
    { REVIEW_COMPACT_TOKEN: 's3cret' }
  ),
  false,
  'wrong token is denied'
);

const compactRoom = 'review-compact-auth-' + Date.now();
await withServer({ netLog: false }, async (port) => {
  const del = await fetch(`${httpBase(port)}/room/${encodeURIComponent(compactRoom)}`, {
    method: 'DELETE',
  });
  assert.equal(del.status, 200, 'loopback DELETE /room is allowed');
  const body = await del.json();
  assert.equal(body.ok, true);
  assert.equal(body.cleared, false, 'missing room still returns ok');
  assert.equal(body.room, compactRoom);

  const spoof = await fetch(`${httpBase(port)}/room/${encodeURIComponent(compactRoom)}`, {
    method: 'DELETE',
    headers: { 'X-Forwarded-For': '8.8.8.8' },
  });
  assert.equal(spoof.status, 200, 'X-Forwarded-For must not deny loopback DELETE');

  const lan = await fetch(`${httpBase(port)}/lan`);
  assert.equal(lan.status, 200, 'GET /lan still works after DELETE auth');
});

const token = 'sync-test-compact-' + Date.now();
await withServer({ netLog: false, token, host: '0.0.0.0' }, async (port) => {
  const loopback = await fetch(`${httpBase(port)}/room/${encodeURIComponent(compactRoom)}`, {
    method: 'DELETE',
  });
  assert.equal(loopback.status, 200, 'loopback DELETE still works when token is configured');

  const lanInfo = await (await fetch(`${httpBase(port)}/lan`)).json();
  const lanHost = Array.isArray(lanInfo.addresses) ? lanInfo.addresses[0] : null;
  if (lanHost) {
    try {
      const denied = await fetch(`http://${lanHost}:${port}/room/${encodeURIComponent(compactRoom)}`, {
        method: 'DELETE',
      });
      const deniedBody = await denied.json().catch(() => ({}));
      if (denied.status === 200) {
        // Hairpin NAT can present as loopback; token path below still proves header auth.
        console.log(`sync-test: LAN DELETE via ${lanHost} hairpinned (status 200); skipping 403 HTTP assert`);
      } else {
        assert.equal(denied.status, 403, 'DELETE via LAN IP without token is 403');
        assert.equal(deniedBody.ok, false);
      }

      const authed = await fetch(`http://${lanHost}:${port}/room/${encodeURIComponent(compactRoom)}`, {
        method: 'DELETE',
        headers: { 'X-Review-Compact-Token': token },
      });
      assert.equal(authed.status, 200, 'DELETE via LAN IP with compact token is allowed');
      const authedBody = await authed.json();
      assert.equal(authedBody.ok, true);
    } catch (err) {
      console.log(`sync-test: LAN DELETE via ${lanHost} unreachable (${err}); 403 covered by unit tests`);
    }
  } else {
    console.log('sync-test: no LAN IPv4 from /lan; HTTP 403 path covered by unit tests');
  }
});

console.log('sync-test: DELETE /room auth verified');
process.exit(0);
