/**
 * Shared sync-hub helpers (Node server, Cloudflare worker, tests).
 * Keep this file dependency-free so both runtimes can import it.
 */

export const MAX_ROOM_NAME = 200;
export const MAX_WS_PAYLOAD = 32 * 1024 * 1024;
export const ROOM_NAME_RE = /^[A-Za-z0-9._-]+$/;

/** Bracket IPv6 so it is legal in URLs (`ws://[fd00::1]:1234`). */
export function formatHostForUrl(host) {
  if (!host || typeof host !== 'string') return host;
  const h = host.trim();
  if (!h) return h;
  if (h.includes(':') && !h.startsWith('[')) return `[${h}]`;
  return h;
}

export function pathnameOnly(urlPath) {
  const raw = typeof urlPath === 'string' ? urlPath : '';
  return raw.split('?')[0] || '';
}

/**
 * Strip slashes and decode once. Does not validate.
 * @param {unknown} name
 */
export function normalizeRoomName(name) {
  if (typeof name !== 'string') return '';
  let n = name.trim();
  n = n.replace(/^\/+/, '').replace(/\/+$/, '');
  try {
    n = decodeURIComponent(n);
  } catch {
    /* keep raw */
  }
  n = n.replace(/^\/+/, '').replace(/\/+$/, '');
  return n;
}

export function isValidRoomName(name) {
  if (typeof name !== 'string' || !name) return false;
  if (name.length > MAX_ROOM_NAME) return false;
  if (name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  return ROOM_NAME_RE.test(name);
}

/** Room from a y-websocket path (`/review-<boardId>`). */
export function roomFromWebsocketPath(urlPath) {
  const path = pathnameOnly(urlPath);
  return normalizeRoomName(path.replace(/^\//, ''));
}

/** Room from `DELETE /room/<name>`. */
export function roomFromDeletePath(urlPath) {
  const path = pathnameOnly(urlPath);
  if (!path.startsWith('/room/')) return '';
  return normalizeRoomName(path.slice('/room/'.length));
}
