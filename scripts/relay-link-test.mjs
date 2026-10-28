/**
 * Unit checks for the relay hot lane (F3: liveness ahead of bulk).
 * Run: node --experimental-strip-types scripts/relay-link-test.mjs
 */
import assert from 'node:assert/strict';
import { RelayLink } from '../src/net/p2p/relayLink.ts';
import { Frame } from '../src/net/p2p/protocol.ts';
import { parseSummon } from '../src/net/types.ts';

const noop = () => {};
const events = { open: noop, message: noop, close: noop, signal: noop };

function frame(type, body) {
  const out = new Uint8Array(1 + body.length);
  out[0] = type;
  out.set(body, 1);
  return out;
}

/** Split a relay batch back into frames. */
function splitBatch(b64) {
  const bin = Buffer.from(b64, 'base64');
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = [];
  let at = 0;
  while (at + 4 <= bin.length) {
    const len = view.getUint32(at);
    out.push(bin.slice(at + 4, at + 4 + len));
    at += 4 + len;
  }
  return out;
}

function openLink(capture) {
  const link = new RelayLink(
    'peer',
    (msg) => {
      // Hellos/keepalives are not data batches.
      if (msg.kind === 'relay') capture.push(msg);
      return true;
    },
    events
  );
  link.signal({ kind: 'relay-hello', open: true });
  assert.equal(link.state, 'open');
  return link;
}

// --- hot lane jumps bulk -------------------------------------------------------
{
  const sent = [];
  const link = openLink(sent);
  // Bulk first: three 16 KiB sync frames (~48 KiB, two pump ticks worth).
  const bulk = frame(Frame.Sync, new Uint8Array(16 * 1024 - 1));
  link.send(bulk);
  link.send(bulk);
  link.send(bulk);
  // Liveness after: one small awareness frame.
  const hot = frame(Frame.Awareness, new Uint8Array([9, 9, 9]));
  link.send(hot);
  assert.ok(link.buffered > 0);
  // Wait for the first pump tick (200 ms).
  await new Promise((r) => setTimeout(r, 350));
  assert.ok(sent.length >= 1);
  const first = splitBatch(sent[0].d);
  assert.equal(first[0][0], Frame.Awareness);
  link.close();
}

// --- pump stats ---------------------------------------------------------------
{
  const sent = [];
  const link = openLink(sent);
  link.send(frame(Frame.Awareness, new Uint8Array([1, 2, 3])));
  link.send(frame(Frame.Sync, new Uint8Array(1024)));
  await new Promise((r) => setTimeout(r, 350));
  const st = link.stats();
  assert.ok(st.batches >= 1);
  assert.equal(st.hotBytes, 4);
  assert.equal(st.bulkBytes, 1025);
  assert.equal(st.sendFailures, 0);
  assert.equal(st.queuedHot, 0);
  assert.equal(st.queuedBulk, 0);
  link.close();
}

// --- FIFO preserved inside each lane ---------------------------------------------
{
  const sent = [];
  const link = openLink(sent);
  link.send(frame(Frame.Sync, new Uint8Array([1])));
  link.send(frame(Frame.Sync, new Uint8Array([2])));
  link.send(frame(Frame.Awareness, new Uint8Array([3])));
  link.send(frame(Frame.Awareness, new Uint8Array([4])));
  await new Promise((r) => setTimeout(r, 350));
  assert.ok(sent.length >= 1);
  const frames = splitBatch(sent[0].d);
  // Hot lane first, in order…
  assert.equal(frames[0][0], Frame.Awareness);
  assert.equal(frames[0][1], 3);
  assert.equal(frames[1][0], Frame.Awareness);
  assert.equal(frames[1][1], 4);
  // …then bulk, in order.
  assert.equal(frames[2][0], Frame.Sync);
  assert.equal(frames[2][1], 1);
  assert.equal(frames[3][0], Frame.Sync);
  assert.equal(frames[3][1], 2);
  link.close();
}

// --- failed send requeues with lanes intact -----------------------------------------
{
  const sent = [];
  let up = false;
  const link = new RelayLink(
    'peer',
    (msg) => {
      if (!up) return false;
      sent.push(msg);
      return true;
    },
    events
  );
  link.signal({ kind: 'relay-hello', open: true });
  link.send(frame(Frame.Sync, new Uint8Array([7])));
  link.send(frame(Frame.Ping, new Uint8Array([8])));
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(sent.length, 0); // nothing left the (down) relay
  up = true;
  await new Promise((r) => setTimeout(r, 350));
  assert.ok(sent.length >= 1);
  const frames = splitBatch(sent[0].d);
  assert.equal(frames[0][0], Frame.Ping); // hot still first after requeue
  assert.equal(frames[1][0], Frame.Sync);
  link.close();
}

// --- bring-to-me summon codec ------------------------------------------------------
{
  const good = { to: '*', x: 10, y: -20, zoom: 1.5, at: 1700000000000, by: 'host' };
  assert.deepEqual(parseSummon(good), good);
  assert.equal(parseSummon({ ...good, zoom: 99 }).zoom, 4, 'zoom clamps');
  assert.equal(parseSummon({ ...good, zoom: -5 }).zoom, 0.1, 'zoom clamps low');
  assert.equal(parseSummon(null), null);
  assert.equal(parseSummon('garbage'), null);
  assert.equal(parseSummon({ ...good, to: '' }), null);
  assert.equal(parseSummon({ ...good, by: '' }).by, '', 'empty writer id still flies');
  assert.equal(parseSummon({ ...good, x: NaN }), null);
  assert.equal(parseSummon({ ...good, at: Infinity }), null);
}

console.log('relay-link-test: ok');
