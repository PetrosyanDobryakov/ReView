/**
 * Unit checks for the y-webrtc signaling relay core (Step 2b).
 * Run: node scripts/signal-relay-test.mjs
 */
import assert from 'node:assert/strict';
import {
  MAX_SIGNAL_MESSAGE_BYTES,
  MAX_SIGNAL_TOPICS_PER_SOCKET,
  createSignalRelay,
} from '../sync/signalRelay.mjs';

function fakeConn() {
  return {
    sent: [],
    closed: false,
    send(text) {
      this.sent.push(JSON.parse(text));
    },
    close() {
      this.closed = true;
    },
  };
}

assert.ok(MAX_SIGNAL_MESSAGE_BYTES >= 64 * 1024);
assert.ok(MAX_SIGNAL_TOPICS_PER_SOCKET >= 16);

// --- subscribe + publish fan-out ------------------------------------------------
{
  const relay = createSignalRelay();
  const a = fakeConn();
  const b = fakeConn();
  const c = fakeConn();
  relay.onMessage(a, JSON.stringify({ type: 'subscribe', topics: ['room-1'] }));
  relay.onMessage(b, JSON.stringify({ type: 'subscribe', topics: ['room-1'] }));
  relay.onMessage(c, JSON.stringify({ type: 'subscribe', topics: ['room-2'] }));
  assert.equal(relay.topicCount(), 2);
  assert.equal(relay.socketCount(), 3);

  relay.onMessage(a, JSON.stringify({ type: 'publish', topic: 'room-1', data: { hello: 1 } }));
  assert.equal(a.sent.length, 1); // sender is a subscriber too (matches reference relay)
  assert.equal(b.sent.length, 1);
  assert.equal(c.sent.length, 0);
  assert.deepEqual(a.sent[0].data, { hello: 1 });
  assert.equal(a.sent[0].clients, 2);
  assert.equal(b.sent[0].clients, 2);
}

// --- unsubscribe + close cleanup -------------------------------------------------
{
  const relay = createSignalRelay();
  const a = fakeConn();
  const b = fakeConn();
  relay.onMessage(a, JSON.stringify({ type: 'subscribe', topics: ['r'] }));
  relay.onMessage(b, JSON.stringify({ type: 'subscribe', topics: ['r'] }));
  relay.onMessage(b, JSON.stringify({ type: 'unsubscribe', topics: ['r'] }));
  relay.onMessage(a, JSON.stringify({ type: 'publish', topic: 'r', data: 1 }));
  assert.equal(a.sent.length, 1);
  assert.equal(b.sent.length, 0);
  assert.equal(a.sent[0].clients, 1);
  relay.onClose(a);
  assert.equal(relay.topicCount(), 0);
  assert.equal(relay.socketCount(), 0);
  relay.onClose(b); // double close safe
}

// --- ping/pong + garbage tolerance ------------------------------------------------
{
  const relay = createSignalRelay();
  const a = fakeConn();
  relay.onMessage(a, JSON.stringify({ type: 'ping' }));
  assert.deepEqual(a.sent, [{ type: 'pong' }]);
  relay.onMessage(a, 'not json{{{');
  relay.onMessage(a, JSON.stringify({ type: 'bogus' }));
  relay.onMessage(a, JSON.stringify({ type: 'publish' })); // no topic
  relay.onMessage(a, JSON.stringify({ type: 'subscribe', topics: 'nope' }));
  assert.equal(a.closed, false);
  assert.equal(relay.topicCount(), 0);
  // Buffer input accepted (ws delivers Buffer).
  relay.onMessage(a, Buffer.from(JSON.stringify({ type: 'ping' })));
  assert.equal(a.sent.length, 2);
  // Oversize input closes the socket.
  relay.onMessage(a, 'x'.repeat(MAX_SIGNAL_MESSAGE_BYTES + 1));
  assert.equal(a.closed, true);
}

// --- subscriber send failure evicts ------------------------------------------------
{
  const relay = createSignalRelay();
  const bad = { send() { throw new Error('dead'); }, close() {}, closed: false };
  const good = fakeConn();
  relay.onMessage(bad, JSON.stringify({ type: 'subscribe', topics: ['r'] }));
  relay.onMessage(good, JSON.stringify({ type: 'subscribe', topics: ['r'] }));
  relay.onMessage(good, JSON.stringify({ type: 'publish', topic: 'r', data: 1 }));
  assert.equal(good.sent.length, 1);
}

console.log('signal-relay-test: ok');
