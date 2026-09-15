import { createServer } from 'http';
import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { networkInterfaces } from 'os';
import { WebSocketServer } from 'ws';
import { setupWSConnection, docs } from 'y-websocket/bin/utils';
import { isRoomDeleteAuthorized } from './room-delete-auth.mjs';
import {
  formatHostForUrl,
  isValidRoomName,
  roomFromDeletePath,
  roomFromWebsocketPath,
} from './sync/netUtil.mjs';

const PORT = Number(process.env.REVIEW_SYNC_PORT) || 1234;
const HOST = process.env.REVIEW_HOST || '0.0.0.0';
const NET_LOG =
  process.env.REVIEW_NET_LOG === '1' ||
  process.env.REVIEW_NET_LOG === 'true' ||
  process.argv.includes('--log') ||
  process.argv.includes('--net-log');
/** Destroy empty in-memory rooms after this idle window (no YPERSISTENCE). */
const EMPTY_ROOM_GC_MS = Number(process.env.REVIEW_ROOM_GC_MS) || 5 * 60 * 1000;
const ROOM_GC_TICK_MS = 30_000;
const MAX_PAYLOAD = 32 * 1024 * 1024;
const MAX_ROOMS = Math.max(1, Number(process.env.REVIEW_MAX_ROOMS) || 512);
const NET_LOG_MAX_LINES = 200;
const NET_LOG_MAX_MSG = 8_192;
const startedAt = Date.now();

const ROOT = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(ROOT, 'logs', 'net');
const SESSION_STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const SESSION_REL = `logs/net/session-${SESSION_STAMP}.log`;
const LATEST_REL = 'logs/net/latest.log';
const SESSION_FILE = join(LOG_DIR, `session-${SESSION_STAMP}.log`);
const LATEST_FILE = join(LOG_DIR, 'latest.log');
const CURRENT_POINTER = join(LOG_DIR, 'CURRENT');

let logDirReady = false;

/** Create logs/net only when REVIEW_NET_LOG is on. */
function ensureLogDir() {
  if (!NET_LOG || logDirReady) return;
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(CURRENT_POINTER, SESSION_REL + '\n', 'utf8');
  writeFileSync(LATEST_FILE, '', 'utf8');
  logDirReady = true;
}

/**
 * Append one line to the active session file (+ mirror latest.log).
 * No-op unless REVIEW_NET_LOG is enabled.
 * @param {string} line
 */
function appendSession(line) {
  if (!NET_LOG) return;
  ensureLogDir();
  const text = line.endsWith('\n') ? line : line + '\n';
  try {
    appendFileSync(SESSION_FILE, text, 'utf8');
    appendFileSync(LATEST_FILE, text, 'utf8');
  } catch (err) {
    console.error('[review:net] file log write failed', err);
  }
}

/**
 * @param {string} level
 * @param {string} msg
 * @param {unknown} [data]
 * @param {string} [source]
 */
function fileLog(level, msg, data, source = 'server') {
  if (!NET_LOG) return;
  const row = {
    t: new Date().toISOString(),
    level,
    source,
    msg,
    ...(data !== undefined ? { data } : {}),
  };
  appendSession(JSON.stringify(row));
}

fileLog('info', 'session start', { file: SESSION_REL, port: PORT });

/** @param {string} addr */
function isPrivateV4(addr) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(addr)) return false;
  const [a, b] = addr.split('.').map(Number);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** Unique-local IPv6 (fc00::/7), skip link-local fe80::/10. */
function isPrivateV6(addr) {
  if (!addr || typeof addr !== 'string') return false;
  const a = addr.split('%')[0].toLowerCase();
  if (a.startsWith('fe80:')) return false;
  return a.startsWith('fc') || a.startsWith('fd');
}

/** Prefer Wi‑Fi/Ethernet private IPs; skip loopback, link-local, docker-ish bridges when better options exist. */
function listLanAddresses() {
  const preferred = [];
  const fallback = [];
  const nets = networkInterfaces();
  for (const [name, entries] of Object.entries(nets)) {
    if (!entries) continue;
    const dockerish = /^(docker|br-|veth|vmnet|vbox)/i.test(name);
    for (const entry of entries) {
      if (entry.internal) continue;
      const family = entry.family;
      const addr = entry.address;
      let ok = false;
      if (family === 'IPv4' || family === 4) {
        if (addr.startsWith('169.254.')) continue;
        ok = isPrivateV4(addr);
      } else if (family === 'IPv6' || family === 6) {
        ok = isPrivateV6(addr);
      }
      if (!ok) continue;
      if (dockerish) fallback.push(addr);
      else preferred.push(addr);
    }
  }
  const picked = preferred.length ? preferred : fallback;
  const unique = [...new Set(picked)];
  unique.sort((a, b) => lanRank(a) - lanRank(b));
  return unique;
}

/** Prefer typical home Wi‑Fi (192.168) over VPN/mesh 10.x / IPv6 ULA when listing invite IPs. */
function lanRank(addr) {
  if (addr.startsWith('192.168.')) return 0;
  if (addr.startsWith('10.')) return 1;
  if (addr.includes(':')) return 3;
  return 2;
}

const CORS_METHODS = 'GET, HEAD, POST, DELETE, OPTIONS';
const CORS_HEADERS = 'Content-Type, Authorization, X-Review-Compact-Token, X-Review-Room-Delete-Token';

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': CORS_METHODS,
    'Access-Control-Allow-Headers': CORS_HEADERS,
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    ...extra,
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(payload);
}

function remoteFromReq(req) {
  return req.socket?.remoteAddress || req.headers?.['x-forwarded-for'] || '?';
}

/** @param {import('http').IncomingMessage} req */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 512_000) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function healthBody() {
  return {
    ok: true,
    service: 'review-sync',
    port: PORT,
    rooms: docs.size,
    emptyRoomGcMs: EMPTY_ROOM_GC_MS,
    maxPayload: MAX_PAYLOAD,
    maxRooms: MAX_ROOMS,
    netLog: Boolean(NET_LOG),
    uptimeMs: Date.now() - startedAt,
  };
}

const server = createServer(async (req, res) => {
  const url = req.url?.split('?')[0] || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (url === '/health' || url === '/healthz') {
    if (req.method === 'HEAD') {
      res.writeHead(200, corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
      res.end();
      return;
    }
    sendJson(res, 200, healthBody());
    return;
  }

  // Compaction helper — client cleared IndexedDB but server still holds a huge in-memory Y.Doc.
  // Loopback or REVIEW_COMPACT_TOKEN / REVIEW_ROOM_DELETE_TOKEN only; not a LAN API.
  if (url.startsWith('/room/') && req.method === 'DELETE') {
    const room = roomFromDeletePath(url);
    if (!isValidRoomName(room)) {
      sendJson(res, 400, { ok: false, error: 'bad room' });
      return;
    }
    if (!isRoomDeleteAuthorized(req)) {
      const remote = req.socket?.remoteAddress || '?';
      console.log(`[review:net] room DELETE denied from=${remote} room=${room}`);
      fileLog('warn', 'room DELETE denied', { from: remote, room });
      sendJson(res, 403, { ok: false });
      return;
    }
    const d = docs.get(room);
    if (d) {
      try {
        if (d.conns) {
          for (const conn of d.conns.keys()) {
            try { conn.close(1000, 'room cleared'); } catch {}
          }
        }
      } catch {}
      try { d.destroy(); } catch {}
      docs.delete(room);
      emptySince.delete(room);
      console.log(`[review:net] room cleared via DELETE room=${room}`);
      fileLog('info', 'room cleared', { room });
    }
    sendJson(res, 200, { ok: true, cleared: Boolean(d), room });
    return;
  }

  if (url === '/lan') {
    if (NET_LOG) {
      console.log(`[review:net] GET /lan from=${remoteFromReq(req)}`);
      fileLog('info', 'GET /lan', { from: remoteFromReq(req) });
    }
    sendJson(res, 200, { ok: true, port: PORT, addresses: listLanAddresses() });
    return;
  }

  if (url === '/net-log' && (req.method === 'GET' || req.method === 'POST')) {
    if (!NET_LOG) {
      req.resume();
      sendJson(res, 404, { ok: false });
      return;
    }
  }

  if (url === '/net-log' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      file: SESSION_REL,
      latest: LATEST_REL,
    });
    return;
  }

  if (url === '/net-log' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const incoming = Array.isArray(parsed.lines) ? parsed.lines : [parsed];
      const lines = incoming.slice(0, NET_LOG_MAX_LINES);
      let written = 0;
      for (const line of lines) {
        if (!line || typeof line !== 'object') continue;
        const msgRaw = line.msg;
        const msg =
          typeof msgRaw === 'string'
            ? msgRaw.slice(0, NET_LOG_MAX_MSG)
            : String(msgRaw ?? '').slice(0, NET_LOG_MAX_MSG);
        const row = {
          t: typeof line.t === 'string' ? line.t : new Date().toISOString(),
          level: typeof line.level === 'string' ? line.level : 'info',
          source: typeof line.client === 'string' ? line.client : 'client',
          msg,
          ...(line.data !== undefined ? { data: line.data } : {}),
        };
        appendSession(JSON.stringify(row));
        written += 1;
      }
      sendJson(res, 200, { ok: true, file: SESSION_REL, written });
    } catch (err) {
      fileLog('warn', 'net-log POST failed');
      sendJson(res, 400, { ok: false });
    }
    return;
  }

  res.writeHead(200, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
  res.end('ReView — sync server');
});

const wss = new WebSocketServer({
  server,
  maxPayload: MAX_PAYLOAD,
  perMessageDeflate: false,
});

wss.on('connection', (conn, req) => {
  const room = roomFromWebsocketPath(req.url);
  const remote = remoteFromReq(req);
  if (!isValidRoomName(room)) {
    console.log(`[review:net] ws reject bad room from=${remote} room=${room}`);
    fileLog('warn', 'ws reject bad room', { room, from: remote });
    try { conn.close(1008, 'bad room'); } catch {}
    return;
  }
  if (!docs.has(room) && docs.size >= MAX_ROOMS) {
    console.log(`[review:net] ws reject max rooms from=${remote} room=${room} size=${docs.size}`);
    fileLog('warn', 'ws reject max rooms', { room, from: remote, size: docs.size });
    try { conn.close(1013, 'too many rooms'); } catch {}
    return;
  }
  console.log(`[review:net] ws connect room=${room} from=${remote}`);
  fileLog('info', 'ws connect', { room, from: remote });
  conn.on('close', (code, reason) => {
    console.log(`[review:net] ws disconnect room=${room} from=${remote} code=${code} reason=${reason?.toString() ?? ''}`);
    fileLog('info', 'ws disconnect', { room, from: remote, code, reason: reason?.toString() });
  });
  conn.on('error', (err) => {
    console.error(`[review:net] ws error room=${room} from=${remote}`, err);
    fileLog('warn', 'ws error', { room, from: remote, err: String(err?.message ?? err) });
  });
  try {
    req.url = `/${room}`;
    setupWSConnection(conn, req, { gc: false });
  } catch (err) {
    console.error(`[review:net] setupWSConnection failed room=${room}`, err);
    fileLog('warn', 'setupWSConnection failed', { room, from: remote, err: String(err) });
    try { conn.close(1011, 'setup failed'); } catch {}
  }
});

/** Track when rooms last became empty; destroy after EMPTY_ROOM_GC_MS. */
const emptySince = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [name, doc] of docs) {
    const conns = doc.conns;
    if (!conns || conns.size > 0) {
      emptySince.delete(name);
      continue;
    }
    const since = emptySince.get(name);
    if (since == null) {
      emptySince.set(name, now);
      continue;
    }
    if (now - since < EMPTY_ROOM_GC_MS) continue;
    try {
      doc.destroy();
    } catch (err) {
      fileLog('warn', 'room destroy failed', { room: name, err: String(err) });
    }
    docs.delete(name);
    emptySince.delete(name);
    console.log(`[review:net] room gc room=${name}`);
    fileLog('info', 'room gc', { room: name });
  }
}, ROOM_GC_TICK_MS).unref?.();

function onListenError(err) {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'EADDRINUSE') {
    console.log(`[review] sync already running on :${PORT}`);
    process.exit(0);
  }
  if (err && typeof err === 'object' && 'code' in err && String(err.code).includes('WS_ERR')) {
    console.error('[review:net] ws payload error (ignored)', err);
    fileLog('warn', 'ws payload error', { err: String(err) });
    return;
  }
  throw err;
}

server.on('error', onListenError);
wss.on('error', onListenError);

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[review] ${signal}, closing`);
  fileLog('info', 'shutdown', { signal });
  try { wss.close(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref?.();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, HOST, () => {
  const addresses = listLanAddresses();
  console.log(`[review] sync server on ${HOST}:${PORT}`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    console.log(`[review]   local:   ws://localhost:${PORT}`);
    for (const ip of addresses) {
      console.log(`[review]   network: ws://${formatHostForUrl(ip)}:${PORT}`);
    }
    if (!addresses.length) {
      console.log(`[review]   (no private LAN address found)`);
    }
    console.log(`[review]   UI (dev): http://<lan-ip>:${process.env.REVIEW_UI_PORT || '5173'}  — friends open that, not localhost`);
  } else {
    console.log(`[review]   ws://${formatHostForUrl(HOST)}:${PORT}`);
    console.log(`[review]   UI (dev): http://${formatHostForUrl(HOST)}:${process.env.REVIEW_UI_PORT || '5173'}`);
  }
  console.log(`[review:net] empty-room GC after ${Math.round(EMPTY_ROOM_GC_MS / 1000)}s`);
  if (NET_LOG) {
    console.log(`[review:net] session log → ${SESSION_REL}`);
    console.log(`[review:net] verbose HTTP logging on (REVIEW_NET_LOG)`);
  }
  fileLog('info', 'listen', { addresses, port: PORT, host: HOST, emptyRoomGcMs: EMPTY_ROOM_GC_MS, maxPayload: MAX_PAYLOAD, maxRooms: MAX_ROOMS });
});
