/**
 * Mesh unit tests that run without cargo or browsers: a fake signaling hub
 * (WebSocket, same wire as review-host) + in-memory data links.
 * Covers: reassembly caps, blob span accounting, link queue caps,
 * doc/awareness sync, oversize-awareness drop, blob fetch (liar failover),
 * convergence after burst drops (resync debounce).
 * Run: node scripts/bundle-p2p.mjs && node --experimental-strip-types scripts/mesh-unit-test.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  Frame,
  MAX_AWARENESS,
  Mesh,
  Reassembler,
  RelayLink,
  WebRtcLink,
  frame,
  spanAdd,
  split,
} from './p2p-bundle.mjs';

// ---- reassembly caps ---------------------------------------------------------
{
  const body = new Uint8Array(100_000).fill(7);
  const msg = frame(Frame.Sync, body);
  const r = new Reassembler();
  let out = null;
  for (const p of split(msg, 1)) out = r.push(p);
  assert.ok(out && out.length === msg.length, 'roundtrip');
  for (let id = 2; id < 60; id++) {
    const m2 = frame(Frame.Sync, new Uint8Array(20_000).fill(1));
    r.push(split(m2, id)[0]);
  }
  assert.ok(r.dropped() > 0, 'open reassembly flood drops');
  console.log('mesh-unit: reassembler caps ok');
}

// ---- blob span accounting ----------------------------------------------------
{
  const spans = [];
  assert.equal(spanAdd(spans, 0, 100), 100);
  assert.equal(spanAdd(spans, 0, 100), 0, 'duplicate bytes counted once');
  assert.equal(spanAdd(spans, 50, 150), 50, 'overlap counted once');
  assert.equal(spanAdd(spans, 0, 200), 50, 'bridge fills the rest');
  console.log('mesh-unit: spanAdd ok');
}

// ---- webrtc link queue caps (stub data channel, no RTC needed) ---------------
{
  const link = new WebRtcLink('peer1', false, [], { open() {}, message() {}, close() {}, signal() {} });
  link.state = 'open';
  link.dc = { readyState: 'open', bufferedAmount: 99_999_999, send() {}, bufferedAmountLowThreshold: 0 };
  const aw = () => {
    const b = new Uint8Array(1000);
    b[0] = Frame.Awareness;
    return b;
  };
  const sy = () => {
    const b = new Uint8Array(16_000);
    b[0] = Frame.Sync;
    return b;
  };
  let syncFalse = 0;
  for (let i = 0; i < 2200; i++) {
    const r = link.send(i % 3 === 0 ? aw() : sy());
    if (i % 3 !== 0 && r === false) syncFalse++;
  }
  assert.ok(link.buffered - 99_999_999 <= 16 * 1024 * 1024, 'queue bounded');
  assert.ok(link.droppedAwareness > 0, 'old awareness shed');
  assert.ok(syncFalse > 0, 'bulk refused past cap');
  assert.equal(link.send(aw()), true, 'awareness reports sent when shed');
  assert.ok(link instanceof RelayLink === false);
  console.log('mesh-unit: link queue caps ok');
}

// ---- fake signaling hub -------------------------------------------------------
function fakeHub() {
  const rooms = new Map();
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const m = /^\/signal\/([^/]+)$/.exec(url.pathname);
    const peer = url.searchParams.get('peer') ?? '';
    if (!m || !peer) {
      ws.close(4400, 'bad room');
      return;
    }
    const room = decodeURIComponent(m[1]);
    let set = rooms.get(room);
    if (!set) {
      set = new Map();
      rooms.set(room, set);
    }
    set.set(peer, ws);
    ws.send(JSON.stringify({ t: 'welcome', proto: 1, peer, peers: [...set.keys()], host: 'fake' }));
    for (const [other, sock] of set) {
      if (other !== peer && sock.readyState === 1) {
        sock.send(JSON.stringify({ t: 'join', peer }));
      }
    }
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg?.t === 'ping') {
        ws.send(JSON.stringify({ t: 'pong' }));
        return;
      }
      if (msg?.t === 'signal' && typeof msg.to === 'string') {
        const dst = set.get(msg.to);
        if (dst && dst.readyState === 1) {
          dst.send(JSON.stringify({ t: 'signal', from: peer, data: msg.data }));
        } else {
          ws.send(JSON.stringify({ t: 'gone', peer: msg.to }));
        }
      }
    });
    ws.on('close', () => {
      if (set.get(peer) !== ws) return;
      set.delete(peer);
      if (!set.size) rooms.delete(room);
      for (const [, sock] of set) {
        if (sock.readyState === 1) sock.send(JSON.stringify({ t: 'leave', peer }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, wss, url: `ws://127.0.0.1:${port}` });
    });
  });
}

// ---- in-memory data links ------------------------------------------------------
function linkNet(blocked = new Set()) {
  const ends = new Map();
  const key = (a, b) => `${a}>${b}`;
  return (self) => (peer, _initiator, ev) => {
    const link = {
      peer,
      state: 'connecting',
      path: 'lan',
      bytesIn: 0,
      bytesOut: 0,
      buffered: 0,
      other: null,
      ev,
      send(data) {
        if (this.state !== 'open' || !this.other) return false;
        this.bytesOut += data.length;
        const other = this.other;
        const copy = data.slice();
        this.buffered += copy.length;
        setTimeout(() => {
          this.buffered -= copy.length;
          if (other.state !== 'open') return;
          other.bytesIn += copy.length;
          other.ev.message(copy);
        }, 0);
        return true;
      },
      signal() {},
      close() {
        if (this.state === 'closed') return;
        this.state = 'closed';
        ends.delete(key(self, peer));
        const o = this.other;
        this.other = null;
        this.ev.close('closed');
        if (o) o.close();
      },
    };
    ends.set(key(self, peer), link);
    const pairBlocked = blocked.has(`${self}|${peer}`) || blocked.has(`${peer}|${self}`);
    const twin = ends.get(key(peer, self));
    if (twin && twin.state === 'connecting' && !pairBlocked) {
      link.other = twin;
      twin.other = link;
      queueMicrotask(() => {
        link.state = 'open';
        twin.state = 'open';
        twin.ev.open();
        link.ev.open();
      });
    }
    return link;
  };
}

async function waitFor(fn, label, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout: ${label}`);
}

const hub = await fakeHub();
const meshes = [];
function peer(id, net, room, opts = {}) {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const logs = [];
  const mesh = new Mesh(doc, awareness, room, id, {
    iceServers: () => [],
    appVersion: 'test',
    onChange: () => {},
    createLink: net(id),
    log: (msg, data) => logs.push([msg, data]),
    ...opts,
  });
  mesh.setHubs([{ url: hub.url, source: 'self' }]);
  meshes.push(mesh);
  return { mesh, doc, awareness, logs };
}

try {
  // Doc + awareness both ways, chunked 300 KB update.
  {
    const net = linkNet();
    const a = peer('peer-aaaa', net, 'review-unit1');
    a.doc.getMap('shapes').set('early', 1);
    const b = peer('peer-bbbb', net, 'review-unit1');
    await waitFor(() => a.mesh.openLinks() === 1 && b.mesh.openLinks() === 1, 'links open');
    await waitFor(() => b.doc.getMap('shapes').get('early') === 1, 'late joiner sync');
    b.doc.getMap('shapes').set('fromB', 'hi');
    await waitFor(() => a.doc.getMap('shapes').get('fromB') === 'hi', 'B -> A');
    a.awareness.setLocalStateField('user', { name: 'Ann' });
    await waitFor(
      () => b.awareness.getStates().get(a.awareness.clientID)?.user?.name === 'Ann',
      'awareness'
    );
    const blob = 'x'.repeat(300_000);
    a.doc.getMap('shapes').set('big', blob);
    await waitFor(() => b.doc.getMap('shapes').get('big') === blob, 'chunked 300KB update');
    a.mesh.destroy();
    b.mesh.destroy();
    console.log('mesh-unit: two peers sync ok');
  }

  // Oversize inbound awareness is dropped, not applied.
  {
    const seen = [];
    const base = linkNet();
    const net = (id) => (peer, init, ev) => {
      const link = base(id)(peer, init, ev);
      seen.push({ self: id, peer, link });
      return link;
    };
    const a = peer('peer-aaaa', net, 'review-unit2');
    const b = peer('peer-bbbb', net, 'review-unit2');
    await waitFor(() => a.mesh.openLinks() === 1 && b.mesh.openLinks() === 1, 'link open');
    const before = b.awareness.getStates().size;
    const wire = seen.find((s) => s.self === 'peer-bbbb' && s.peer === 'peer-aaaa');
    assert.ok(wire && wire.link.state === 'open', 'captured open link');
    const evil = frame(Frame.Awareness, new Uint8Array(MAX_AWARENESS + 1024).fill(9));
    wire.link.ev.message(evil);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(b.awareness.getStates().size, before, 'oversize awareness not applied');
    assert.ok(
      b.logs.some(([m]) => m === 'oversize awareness dropped'),
      'oversize drop logged'
    );
    // Small garbage awareness still flows through the malformed guard.
    wire.link.ev.message(frame(Frame.Awareness, new Uint8Array([1, 2, 3])));
    b.mesh.destroy();
    a.mesh.destroy();
    console.log('mesh-unit: awareness cap ok');
  }

  // Blob fetch: happy path, liar failover, missing -> null.
  {
    const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const goodBytes = new Uint8Array(200_000).map((_, i) => i % 251);
    const goodHash = sha(goodBytes);
    const good = { bytes: goodBytes, mime: 'image/png' };
    const liarBytes = new Uint8Array(200_000).map((_, i) => (i + 1) % 251);
    assert.notEqual(sha(liarBytes), goodHash, 'liar bytes differ');
    const net = linkNet();
    const holderBad = peer('peer-liar', net, 'review-unit3', {
      blobs: async () => ({ bytes: liarBytes, mime: 'image/png' }),
    });
    const holderGood = peer('peer-hold', net, 'review-unit3', {
      blobs: async (h) => (h === goodHash ? good : null),
    });
    const want = peer('peer-want', net, 'review-unit3');
    await waitFor(() => want.mesh.openLinks() === 2, 'want links open');
    const got = await want.mesh.fetchBlob(goodHash);
    assert.ok(got && got.bytes.length === goodBytes.length, 'liar skipped, good served');
    assert.equal(sha(got.bytes), goodHash, 'hash verified');
    const missing = await want.mesh.fetchBlob('0'.repeat(64));
    assert.equal(missing, null, 'missing blob -> null');
    holderBad.mesh.destroy();
    holderGood.mesh.destroy();
    want.mesh.destroy();
    console.log('mesh-unit: blob fetch ok');
  }

  // Burst drops converge (debounced resync still heals).
  {
    const net = linkNet();
    const a = peer('peer-aaaa', net, 'review-unit4');
    const b = peer('peer-bbbb', net, 'review-unit4');
    const c = peer('peer-cccc', net, 'review-unit4');
    await waitFor(
      () => a.mesh.openLinks() === 2 && b.mesh.openLinks() === 2 && c.mesh.openLinks() === 2,
      'mesh up'
    );
    a.doc.getMap('shapes').set('k1', 'v1');
    await waitFor(() => b.doc.getMap('shapes').get('k1') === 'v1', 'spread');
    // Drop two links at once, then write while partitioned.
    b.mesh.destroy();
    c.mesh.destroy();
    a.doc.getMap('shapes').set('k2', 'v2');
    const b2 = peer('peer-bbbb', net, 'review-unit4');
    const c2 = peer('peer-cccc', net, 'review-unit4');
    await waitFor(() => b2.doc.getMap('shapes').get('k2') === 'v2', 'rejoin heals');
    await waitFor(() => c2.doc.getMap('shapes').get('k1') === 'v1', 'late joiner full state');
    a.mesh.destroy();
    b2.mesh.destroy();
    c2.mesh.destroy();
    console.log('mesh-unit: burst drops converge ok');
  }
} finally {
  for (const m of meshes) {
    try {
      m.destroy();
    } catch {}
  }
  hub.wss.close();
  hub.server.close();
}

console.log('mesh-unit-test: ok');
process.exit(0);
