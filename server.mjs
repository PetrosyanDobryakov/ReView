import { createServer } from 'http';
import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { networkInterfaces } from 'os';
import { WebSocketServer } from 'ws';
import { setupWSConnection, docs } from 'y-websocket/bin/utils';

const PORT = Number(process.env.REVIEW_SYNC_PORT) || 1234;
const HOST = process.env.REVIEW_HOST || '0.0.0.0';
const NET_LOG =
  process.env.REVIEW_NET_LOG === '1' || process.env.REVIEW_NET_LOG === 'true';
/** Destroy empty in-memory rooms after this idle window (no YPERSISTENCE). */
const EMPTY_ROOM_GC_MS = Number(process.env.REVIEW_ROOM_GC_MS) || 5 * 60 * 1000;
const ROOM_GC_TICK_MS = 30_000;

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

/** Prefer Wi‑Fi/Ethernet private IPs; skip loopback, link-local, docker-ish bridges when better options exist. */
function listLanAddresses() {
  const preferred = [];
  const fallback = [];
  const nets = networkInterfaces();
  for (const [name, entries] of Object.entries(nets)) {
    if (!entries) continue;
    const dockerish = /^(docker|br-|veth|vmnet|vbox)/i.test(name);
    for (const entry of entries) {
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      if (entry.internal) continue;
      const addr = entry.address;
      if (addr.startsWith('169.254.')) continue;
      if (!isPrivateV4(addr)) continue;
      if (dockerish) fallback.push(addr);
      else preferred.push(addr);
    }
  }
  const picked = preferred.length ? preferred : fallback;
  const unique = [...new Set(picked)];
  unique.sort((a, b) => lanRank(a) - lanRank(b));
  return unique;
}

/** Prefer typical home Wi‑Fi (192.168) over VPN/mesh 10.x when listing invite IPs. */
function lanRank(addr) {
  if (addr.startsWith('192.168.')) return 0;
  if (addr.startsWith('10.')) return 1;
  return 2;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

/** Room name from y-websocket path (`/review-<boardId>`). */
function roomFromReq(req) {
  const raw = typeof req.url === 'string' ? req.url : '';
  const path = raw.split('?')[0] || '';
  const room = decodeURIComponent(path.replace(/^\//, '').replace(/\/$/, ''));
  return room || '(unknown)';
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

const server = createServer(async (req, res) => {
  const url = req.url?.split('?')[0] || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (url === '/health' || url === '/healthz') {
    sendJson(res, 200, { ok: true, service: 'review-sync', port: PORT });
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
      const lines = Array.isArray(parsed.lines) ? parsed.lines : [parsed];
      for (const line of lines) {
        if (!line || typeof line !== 'object') continue;
        const row = {
          t: typeof line.t === 'string' ? line.t : new Date().toISOString(),
          level: typeof line.level === 'string' ? line.level : 'info',
          source: typeof line.client === 'string' ? line.client : 'client',
          msg: typeof line.msg === 'string' ? line.msg : String(line.msg ?? ''),
          ...(line.data !== undefined ? { data: line.data } : {}),
        };
        appendSession(JSON.stringify(row));
      }
      sendJson(res, 200, { ok: true, file: SESSION_REL, written: lines.length });
    } catch (err) {
      fileLog('warn', 'net-log POST failed', { err: String(err) });
      sendJson(res, 400, { ok: false, error: String(err) });
    }
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end('ReView — sync server');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (conn, req) => {
  const room = roomFromReq(req);
  const remote = remoteFromReq(req);
  console.log(`[review:net] ws connect room=${room} from=${remote}`);
  fileLog('info', 'ws connect', { room, from: remote });
  conn.on('close', () => {
    console.log(`[review:net] ws disconnect room=${room} from=${remote}`);
    fileLog('info', 'ws disconnect', { room, from: remote });
  });
  setupWSConnection(conn, req, { gc: true });
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
  throw err;
}

server.on('error', onListenError);
wss.on('error', onListenError);

server.listen(PORT, HOST, () => {
  const addresses = listLanAddresses();
  console.log(`[review] sync server on ${HOST}:${PORT}`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    console.log(`[review]   local:   ws://localhost:${PORT}`);
    for (const ip of addresses) {
      console.log(`[review]   network: ws://${ip}:${PORT}`);
    }
    if (!addresses.length) {
      console.log(`[review]   (no private LAN IPv4 found)`);
    }
    console.log(`[review]   UI (dev): http://<lan-ip>:${process.env.REVIEW_UI_PORT || '5173'}  — friends open that, not localhost`);
  } else {
    console.log(`[review]   ws://${HOST}:${PORT}`);
    console.log(`[review]   UI (dev): http://${HOST}:${process.env.REVIEW_UI_PORT || '5173'}`);
  }
  console.log(`[review:net] empty-room GC after ${Math.round(EMPTY_ROOM_GC_MS / 1000)}s`);
  if (NET_LOG) {
    console.log(`[review:net] session log → ${SESSION_REL}`);
    console.log(`[review:net] verbose HTTP logging on (REVIEW_NET_LOG)`);
  }
  fileLog('info', 'listen', { addresses, port: PORT, host: HOST, emptyRoomGcMs: EMPTY_ROOM_GC_MS });
});
