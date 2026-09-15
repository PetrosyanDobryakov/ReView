/** Keep in sync with `sync/netUtil.mjs` (covered by room-name-test). */

export const MAX_ROOM_NAME = 200;
export const ROOM_NAME_RE = /^[A-Za-z0-9._-]+$/;

export function pathnameOnly(urlPath: unknown): string {
  const raw = typeof urlPath === 'string' ? urlPath : '';
  return raw.split('?')[0] || '';
}

export function normalizeRoomName(name: unknown): string {
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

export function isValidRoomName(name: unknown): boolean {
  if (typeof name !== 'string' || !name) return false;
  if (name.length > MAX_ROOM_NAME) return false;
  if (name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  return ROOM_NAME_RE.test(name);
}

export function roomFromWebsocketPath(urlPath: unknown): string {
  const path = pathnameOnly(urlPath);
  return normalizeRoomName(path.replace(/^\//, ''));
}

export function roomFromDeletePath(urlPath: unknown): string {
  const path = pathnameOnly(urlPath);
  if (!path.startsWith('/room/')) return '';
  return normalizeRoomName(path.slice('/room/'.length));
}
