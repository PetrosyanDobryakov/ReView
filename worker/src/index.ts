import { BoardRoom, EMPTY_GC_MS } from './room';
export { BoardRoom, EMPTY_GC_MS };

import { isValidRoomName, roomFromDeletePath, roomFromWebsocketPath } from './roomName';

interface Env {
  BOARD_ROOM: DurableObjectNamespace;
  /** Preferred compact/delete secret (wrangler secret put REVIEW_COMPACT_TOKEN). */
  REVIEW_COMPACT_TOKEN?: string;
  /** Alias accepted the same way as the Node sync server. */
  REVIEW_ROOM_DELETE_TOKEN?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Review-Compact-Token, X-Review-Room-Delete-Token, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/health' || url.pathname === '/healthz') {
      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
        });
      }
      return jsonResponse(200, {
        ok: true,
        service: 'review-sync-worker',
        emptyRoomGcMs: EMPTY_GC_MS,
      });
    }

    if (url.pathname === '/' || url.pathname === '') {
      return new Response('ReView sync worker — use wss://<host>/review-<boardId>', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS },
      });
    }

    const isRoomDelete = url.pathname.startsWith('/room/') && request.method === 'DELETE';
    const targetRoom = isRoomDelete
      ? roomFromDeletePath(url.pathname)
      : roomFromWebsocketPath(url.pathname);

    if (!isValidRoomName(targetRoom)) {
      return jsonResponse(400, { ok: false, error: 'bad room' });
    }

    // Occupied rooms still need a token; empty-room compact is decided inside the DO.
    const id = env.BOARD_ROOM.idFromName(targetRoom);
    const stub = env.BOARD_ROOM.get(id);
    const forwardUrl = new URL(request.url);
    return stub.fetch(new Request(forwardUrl.toString(), request));
  },
};
