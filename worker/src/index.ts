import { BoardRoom } from './room';
export { BoardRoom };

interface Env {
  BOARD_ROOM: DurableObjectNamespace;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Review-Compact-Token, X-Review-Room-Delete-Token, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version',
};

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

    const id = env.BOARD_ROOM.idFromName(targetRoom);
    const stub = env.BOARD_ROOM.get(id);
    // forward original request (preserve Upgrade header for websocket)
    const forwardUrl = new URL(request.url);
    // keep path as is for DO to handle
    return stub.fetch(new Request(forwardUrl.toString(), request as any));
  },
};
