/**
 * P2P mesh against a real review-host, with in-memory links instead of WebRTC.
 * Covers: wire framing, hub introductions, Yjs + awareness sync, chunked big
 * updates, relay through a middle peer, and that the hub keeps no state.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  Frame,
  MAX_FRAME,
  Mesh,
  Reassembler,
  frame,
  hubBlockedByMixedContent,
  isInitiator,
  normalizeHubUrl,
  randomPeerId,
  split,
} from './p2p-bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- framing --------------------------------------------------------------
{
  const big = new Uint8Array(MAX_FRAME * 3 + 123).map((_, i) => i % 251);
  const msg = frame(Frame.Sync, big);
  const parts = split(msg, 7);
  assert.equal(parts.length, 4);
  assert.ok(parts.every((p) => p.length <= MAX_FRAME));
  const r = new Reassembler();
  let out = null;
  for (const p of parts.slice().reverse()) out = r.push(p) ?? out;
  assert.deepEqual(out, msg, 'chunks reassemble in any order');
  const small = frame(Frame.Awareness, new Uint8Array([1, 2]));
  assert.deepEqual(split(small, 1), [small]);
  assert.equal(new Reassembler().push(small), small);
}

// ---- hub addresses ----------------------------------------------------------
assert.equal(normalizeHubUrl('192.168.1.5:1234'), 'ws://192.168.1.5:1234');
assert.equal(normalizeHubUrl('http://host.lan:1234/'), 'ws://host.lan:1234');
assert.equal(normalizeHubUrl('https://review.example.com/board/x'), 'wss://review.example.com');
assert.equal(normalizeHubUrl('wss://a.b'), 'wss://a.b');
assert.equal(normalizeHubUrl('ftp://x'), null);
assert.equal(normalizeHubUrl(''), null);
assert.equal(hubBlockedByMixedContent('ws://192.168.1.5:1234', 'https:'), true);
assert.equal(hubBlockedByMixedContent('ws://127.0.0.1:1234', 'https:'), false);
assert.equal(hubBlockedByMixedContent('ws://192.168.1.5:1234', 'http:'), false);
assert.equal(hubBlockedByMixedContent('wss://x', 'https:'), false);
assert.equal(isInitiator('a', 'b'), true);
assert.equal(isInitiator('b', 'a'), false);
assert.match(randomPeerId(), /^[0-9a-f]{24}$/);

// ---- in-memory links ----------------------------------------------------------
/** Links pair up by (self, peer). `blocked` pairs never open (NAT that cannot punch through). */
function linkNet(blocked = new Set(), lossy = new Set()) {
  const ends = new Map();
  const key = (a, b) => `${a}>${b}`;
  return (self) => (peer, _initiator, ev) => {
    const link = {
      peer,
      state: 'connecting',
      path: 'lan',
      bytesIn: 0,
      bytesOut: 0,
      other: null,
      send(data) {
        if (this.state !== 'open' || !this.other) return false;
        this.bytesOut += data.length;
        // A lossy direction accepts the frame and loses it (link dying mid-flight).
        if (lossy.has(`${self}>${peer}`)) return true;
        const other = this.other;
        const copy = data.slice();
        setTimeout(() => {
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
      ev,
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

// ---- real hub -----------------------------------------------------------------
execFileSync('cargo', ['build', '-q', '--manifest-path', path.join(root, 'rust', 'Cargo.toml'), '-p', 'review-host'], {
  stdio: 'inherit',
});
const port = 21000 + Math.floor(Math.random() * 20000);
const host = spawn(path.join(root, 'rust', 'target', 'debug', 'review-host'), ['--port', String(port), '--host', '127.0.0.1', '--no-mdns'], {
  stdio: 'ignore',
});
const hub = `ws://127.0.0.1:${port}`;
const health = async () => {
  try {
    return await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  } catch {
    return null;
  }
};

const meshes = [];
function peer(id, net, room) {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const mesh = new Mesh(doc, awareness, room, id, {
    iceServers: [],
    appVersion: 'test',
    onChange: () => {},
    createLink: net(id),
  });
  mesh.setHubs([{ url: hub, source: 'self' }]);
  meshes.push({ mesh, doc, awareness });
  return { mesh, doc, awareness };
}

try {
  await waitFor(async () => (await health())?.ok, 'host up');

  // Two peers: doc + awareness both ways, big update chunked.
  {
    const net = linkNet();
    const a = peer('peer-aaaa', net, 'review-p2ptest1');
    a.doc.getMap('shapes').set('early', 1);
    const b = peer('peer-bbbb', net, 'review-p2ptest1');
    await waitFor(() => a.mesh.openLinks() === 1 && b.mesh.openLinks() === 1, 'link open');
    await waitFor(() => b.doc.getMap('shapes').get('early') === 1, 'late joiner sync');
    b.doc.getMap('shapes').set('fromB', 'hi');
    await waitFor(() => a.doc.getMap('shapes').get('fromB') === 'hi', 'B -> A');
    a.awareness.setLocalStateField('user', { name: 'Ann' });
    await waitFor(() => b.awareness.getStates().get(a.awareness.clientID)?.user?.name === 'Ann', 'awareness');
    const blob = 'x'.repeat(300_000);
    a.doc.getMap('shapes').set('big', blob);
    await waitFor(() => b.doc.getMap('shapes').get('big') === blob, 'chunked 300KB update');
    const snap = a.mesh.snapshot();
    assert.equal(snap.hubs[0].state, 'open');
    assert.equal(snap.peers[0].state, 'open');
    assert.ok(snap.peers[0].bytesOut > 300_000);
    const h = await health();
    assert.deepEqual([h.rooms, h.peers], [1, 2]);
    // Leaving clears the remote cursor right away (not after the 30s timeout).
    b.mesh.destroy();
    await waitFor(() => !a.awareness.getStates().has(b.awareness.clientID), 'cursor removed on leave');
    a.mesh.destroy();
    await waitFor(async () => (await health()).rooms === 0, 'hub forgets room');
    console.log('p2p-test: two peers, chunking, awareness, leave ok');
  }

  // Three peers where A and C cannot connect: B relays.
  {
    const net = linkNet(new Set(['peer-aaaa|peer-cccc']));
    const a = peer('peer-aaaa', net, 'review-p2ptest2');
    const b = peer('peer-bbbb', net, 'review-p2ptest2');
    const c = peer('peer-cccc', net, 'review-p2ptest2');
    await waitFor(() => b.mesh.openLinks() === 2, 'B linked to A and C');
    assert.equal(a.mesh.openLinks(), 1);
    assert.equal(c.mesh.openLinks(), 1);
    a.doc.getMap('shapes').set('fromA', 1);
    await waitFor(() => c.doc.getMap('shapes').get('fromA') === 1, 'A -> C via B');
    c.doc.getMap('shapes').set('fromC', 2);
    await waitFor(() => a.doc.getMap('shapes').get('fromC') === 2, 'C -> A via B');
    console.log('p2p-test: relay through middle peer ok');
  }

  // Full mesh of three: neighbours suppress duplicate relays.
  {
    const net = linkNet();
    const a = peer('peer-aaaa', net, 'review-p2ptest3');
    const b = peer('peer-bbbb', net, 'review-p2ptest3');
    const c = peer('peer-cccc', net, 'review-p2ptest3');
    await waitFor(() => [a, b, c].every((p) => p.mesh.openLinks() === 2), 'full mesh');
    await new Promise((r) => setTimeout(r, 100));
    const sent = () => [a, b, c].reduce((n, p) => n + p.mesh.snapshot().peers.reduce((m, x) => m + x.bytesOut, 0), 0);
    const before = sent();
    a.doc.getMap('shapes').set('payload', 'y'.repeat(50_000));
    await waitFor(() => [b, c].every((p) => p.doc.getMap('shapes').get('payload')), 'full mesh sync');
    await new Promise((r) => setTimeout(r, 100));
    const delta = sent() - before;
    // A sends to B and C once each; nobody relays to a peer that already has a direct link to A.
    assert.ok(delta < 50_000 * 2.5, `relay suppressed (sent ${delta} bytes)`);
    console.log(`p2p-test: full mesh, ${delta} bytes for a 50KB edit (no duplicate relay)`);
  }
  // An edit lost on a dying link is repaired by the survivors. Relay
  // suppression assumed B would get C's edit directly; when C leaves, A and B
  // exchange state vectors so B still gets it, and B's later edits (which may
  // build on it) still apply on A.
  {
    const lossy = new Set();
    const net = linkNet(new Set(), lossy);
    const a = peer('peer-aaaa', net, 'review-p2ptest4');
    const b = peer('peer-bbbb', net, 'review-p2ptest4');
    const c = peer('peer-cccc', net, 'review-p2ptest4');
    await waitFor(() => [a, b, c].every((p) => p.mesh.openLinks() === 2), 'full mesh');
    await new Promise((r) => setTimeout(r, 100));
    lossy.add('peer-cccc>peer-bbbb');
    c.doc.getArray('order').push(['fromC']);
    await waitFor(() => a.doc.getArray('order').length === 1, 'C -> A');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(b.doc.getArray('order').length, 0, 'C -> B was lost');
    c.mesh.destroy();
    await waitFor(() => b.doc.getArray('order').length === 1, 'B repaired from A after C left');
    b.doc.getArray('order').push(['fromB']);
    await waitFor(() => a.doc.getArray('order').toArray().join() === 'fromC,fromB', 'B -> A after repair');
    console.log('p2p-test: lost edit on a dying link repaired by survivors');
  }
  console.log('p2p-test: OK');
} finally {
  for (const m of meshes) {
    try { m.mesh.destroy(); } catch {}
    try { m.awareness.destroy(); } catch {}
    try { m.doc.destroy(); } catch {}
  }
  host.kill('SIGTERM');
}
