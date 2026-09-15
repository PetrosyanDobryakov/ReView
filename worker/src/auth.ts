export interface CompactEnv {
  REVIEW_COMPACT_TOKEN?: string;
  REVIEW_ROOM_DELETE_TOKEN?: string;
}

export function compactTokenFromEnv(env: CompactEnv | unknown): string {
  const e = (env || {}) as CompactEnv;
  const a = e.REVIEW_COMPACT_TOKEN;
  const b = e.REVIEW_ROOM_DELETE_TOKEN;
  if (typeof a === 'string' && a.length > 0) return a;
  if (typeof b === 'string' && b.length > 0) return b;
  return '';
}

export function compactTokenFromHeaders(headers: Headers): string {
  const named =
    headers.get('X-Review-Compact-Token') ||
    headers.get('X-Review-Room-Delete-Token') ||
    '';
  if (named.length > 0) return named;
  const auth = headers.get('Authorization');
  if (auth) {
    const m = /^Bearer\s+(\S+)/i.exec(auth.trim());
    if (m) return m[1]!;
  }
  return '';
}

export function tokensMatch(provided: string, expected: string): boolean {
  if (!expected || !provided) return false;
  const enc = new TextEncoder();
  const a = enc.encode(provided);
  const b = enc.encode(expected);
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i]! ^ b[i]!;
  return out === 0;
}

/**
 * Authorize DELETE /room/<name> on the edge Worker.
 * No loopback on Cloudflare — require a configured secret that matches
 * X-Review-Compact-Token, X-Review-Room-Delete-Token, or Authorization: Bearer.
 * Fail closed when no secret is set (occupied rooms still need this).
 */
export function isRoomDeleteAuthorized(request: Request, env: CompactEnv | unknown): boolean {
  const expected = compactTokenFromEnv(env);
  if (!expected) return false;
  return tokensMatch(compactTokenFromHeaders(request.headers), expected);
}

/**
 * Occupied rooms require a matching secret (or Node loopback).
 * Empty rooms may be cleared without a token so client compact can wipe
 * a Durable Object after detach — same outcome as the 90s empty-room GC.
 */
export function canClearRoom(authorized: boolean, socketCount: number): boolean {
  if (authorized) return true;
  return socketCount <= 0;
}
