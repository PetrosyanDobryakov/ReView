import { BoardRoom } from './room';
export { BoardRoom };

interface Env {
  BOARD_ROOM: DurableObjectNamespace;
  /** Preferred compact/delete secret (wrangler secret put REVIEW_COMPACT_TOKEN). */
  REVIEW_COMPACT_TOKEN?: string;
  /** Alias accepted the same way as the Node sync server. */
  REVIEW_ROOM_DELETE_TOKEN?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Review-Compact-Token, X-Review-Room-Delete-Token, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version',
};

function compactTokenFromEnv(env: Env): string {
  const a = env.REVIEW_COMPACT_TOKEN;
  const b = env.REVIEW_ROOM_DELETE_TOKEN;
  if (typeof a === 'string' && a.length > 0) return a;
  if (typeof b === 'string' && b.length > 0) return b;
  return '';
}

function compactTokenFromHeaders(headers: Headers): string {
  const named =
    headers.get('X-Review-Compact-Token') ||
    headers.get('X-Review-Room-Delete-Token') ||
    '';
  if (named.length > 0) return named;
  const auth = headers.get('Authorization');
  if (auth) {
    const m = /^Bearer\s+(\S+)/i.exec(auth.trim());
    if (m) return m[1];
  }
  return '';
}

function tokensMatch(provided: string, expected: string): boolean {
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
 * Fail closed when no secret is set.
 */
export function isRoomDeleteAuthorized(request: Request, env: Env): boolean {
  const expected = compactTokenFromEnv(env);
  if (!expected) return false;
  return tokensMatch(compactTokenFromHeaders(request.headers), expected);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/health' || url.pathname === '/healthz') {
      return new Response(JSON.stringify({ ok: true, service: 'review-sync-worker' }), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    if (url.pathname === '/' || url.pathname === '') {
      return new Response('ReView sync worker — use wss://<host>/review-<boardId>', {
        headers: { 'Content-Type': 'text/plain', ...CORS },
      });
    }

    // room is the pathname without leading slash, e.g. review-abc123
    const room = decodeURIComponent(url.pathname.slice(1).split('?')[0].split('/')[0] || 'review');
    // also handle /room/<name> DELETE compat
    const isRoomDelete = url.pathname.startsWith('/room/') && request.method === 'DELETE';
    const targetRoom = isRoomDelete ? decodeURIComponent(url.pathname.slice(6)) : room;

    if (isRoomDelete && !isRoomDeleteAuthorized(request, env)) {
      return jsonResponse(403, { ok: false });
    }

    const id = env.BOARD_ROOM.idFromName(targetRoom);
    const stub = env.BOARD_ROOM.get(id);
    // forward original request (preserve Upgrade header for websocket)
    const forwardUrl = new URL(request.url);
    // keep path as is for DO to handle
    return stub.fetch(new Request(forwardUrl.toString(), request as any));
  },
};
