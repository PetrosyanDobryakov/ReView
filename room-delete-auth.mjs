import { timingSafeEqual } from 'crypto';

/**
 * Loopback TCP addresses we treat as the machine running this process.
 * Never use X-Forwarded-For here — that header is attacker-controlled on LAN.
 *
 * @param {unknown} addr
 */
export function isLoopbackAddress(addr) {
  if (!addr || typeof addr !== 'string') return false;
  let a = addr.trim().toLowerCase();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const zone = a.indexOf('%');
  if (zone !== -1) a = a.slice(0, zone);

  if (a === '::1' || a === '0:0:0:0:0:0:0:1' || a === 'localhost') return true;
  // Node usually reports ::ffff:127.0.0.1; accept the short documented alias too.
  if (a === ':ffff:127.0.0.1') return true;

  let v4 = a;
  if (a.startsWith('::ffff:')) v4 = a.slice(7);
  else if (a.startsWith('0:0:0:0:0:ffff:')) v4 = a.slice(16);

  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function compactTokenFromEnv(env = process.env) {
  const a = env.REVIEW_COMPACT_TOKEN;
  const b = env.REVIEW_ROOM_DELETE_TOKEN;
  if (typeof a === 'string' && a.length > 0) return a;
  if (typeof b === 'string' && b.length > 0) return b;
  return '';
}

/**
 * @param {import('http').IncomingHttpHeaders | undefined} headers
 */
export function compactTokenFromHeaders(headers) {
  if (!headers) return '';
  const named = headers['x-review-compact-token'] || headers['x-review-room-delete-token'] || '';
  if (typeof named === 'string' && named.length > 0) return named;
  const auth = headers.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(\S+)/i.exec(auth.trim());
    if (m) return m[1];
  }
  return '';
}

/**
 * @param {string} provided
 * @param {string} expected
 */
export function tokensMatch(provided, expected) {
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Authorize DELETE /room/<name>.
 * Loopback socket address OR matching server-side token.
 * `req.socket.remoteAddress` only — ignore X-Forwarded-For.
 *
 * @param {{ socket?: { remoteAddress?: string }, headers?: import('http').IncomingHttpHeaders }} req
 * @param {NodeJS.ProcessEnv} [env]
 */
export function isRoomDeleteAuthorized(req, env = process.env) {
  const remote = req?.socket?.remoteAddress || '';
  if (isLoopbackAddress(remote)) return true;
  const expected = compactTokenFromEnv(env);
  if (!expected) return false;
  return tokensMatch(compactTokenFromHeaders(req.headers), expected);
}
