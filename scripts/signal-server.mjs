/**
 * Standalone y-webrtc signaling server for LAN / self-host.
 *
 * Speaks the public y-webrtc JSON protocol (subscribe/unsubscribe/publish),
 * so any y-webrtc client works with zero changes — the app prefers this
 * server over the public one whenever the sync URL is loopback/LAN
 * (see p2pSignalingUrls in src/net/config.ts).
 *
 * Env: REVIEW_SIGNAL_PORT (default 1235), REVIEW_HOST (default 0.0.0.0).
 * Started automatically by `npm run dev`; for prod-like LAN hosting run it
 * next to `npm run server` and allow the port through the OS firewall
 * (same as :1234).
 */
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createSignalRelay } from '../sync/signalRelay.mjs';

const port = Number(process.env.REVIEW_SIGNAL_PORT || '1235');
const host = process.env.REVIEW_HOST || '0.0.0.0';
const PING_MS = 30_000;
const MAX_SOCKETS = Number(process.env.REVIEW_SIGNAL_MAX_SOCKETS || '512');

const relay = createSignalRelay();

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    const body = JSON.stringify({
      ok: true,
      service: 'review-signal',
      port,
      topics: relay.topicCount(),
      sockets: relay.socketCount(),
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(body);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('review-signal — y-webrtc signaling relay');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

server.on('upgrade', (req, socket, head) => {
  if (relay.socketCount() >= MAX_SOCKETS) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    let alive = true;
    const pingTimer = setInterval(() => {
      if (!alive) {
        clearInterval(pingTimer);
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }, PING_MS);
    if (typeof pingTimer.unref === 'function') pingTimer.unref();
    ws.on('pong', () => {
      alive = true;
    });
    ws.on('message', (data) => relay.onMessage(ws, data));
    ws.on('close', () => {
      clearInterval(pingTimer);
      relay.onClose(ws);
    });
    ws.on('error', () => {
      /* close handler cleans up */
    });
  });
});

server.listen(port, host, () => {
  console.log(`[review-signal] listening on ${host}:${port} (topics=${relay.topicCount()})`);
});

function shutdown(signal) {
  try {
    server.close();
  } catch {
    /* ignore */
  }
  process.exit(signal === 'SIGINT' ? 0 : 0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
