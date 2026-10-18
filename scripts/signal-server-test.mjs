/**
 * Integration check: real WebSocket clients through the relay core (Step 2b).
 * Spins an inline WS server (same wiring as scripts/signal-server.mjs) and
 * verifies two peers can subscribe + exchange a publish.
 * Run: node scripts/signal-server-test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createSignalRelay } from '../sync/signalRelay.mjs';

const PORT = 18235;
const relay = createSignalRelay();
const httpServer = http.createServer((req, res) => {
  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
httpServer.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.on('message', (data) => relay.onMessage(ws, data));
    ws.on('close', () => relay.onClose(ws));
  });
});
await new Promise((resolve) => httpServer.listen(PORT, '127.0.0.1', resolve));

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => ws.once('message', (data) => resolve(JSON.parse(String(data)))));
}

const a = await connect();
const b = await connect();
a.send(JSON.stringify({ type: 'subscribe', topics: ['review-test-room'] }));
b.send(JSON.stringify({ type: 'subscribe', topics: ['review-test-room'] }));
// Give the server a tick to register both subscriptions.
await new Promise((r) => setTimeout(r, 200));
assert.equal(relay.socketCount(), 2);

const seenA = nextMessage(a);
const seenB = nextMessage(b);
a.send(JSON.stringify({ type: 'publish', topic: 'review-test-room', data: { signal: 'offer-1' } }));
const [msgA, msgB] = await Promise.all([seenA, seenB]);
assert.deepEqual(msgA.data, { signal: 'offer-1' });
assert.deepEqual(msgB.data, { signal: 'offer-1' });
assert.equal(msgA.clients, 2);

// Ping round-trips.
const pong = nextMessage(a);
a.send(JSON.stringify({ type: 'ping' }));
assert.deepEqual(await pong, { type: 'pong' });

a.close();
b.close();
await new Promise((r) => setTimeout(r, 200));
assert.equal(relay.socketCount(), 0);
assert.equal(relay.topicCount(), 0);

wss.close();
httpServer.close();

console.log('signal-server-test: ok');
