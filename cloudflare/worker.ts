/**
 * ReView signaling hub on Cloudflare Workers. It serves no web UI: people
 * host that themselves (review-host, the desktop app, any static host) and
 * point it here with `VITE_HUBS` or the P2P panel.
 *
 * Same wire format as `rust/review-host/src/hub.rs` (proto 1). One Durable
 * Object per room; sockets use the hibernation API, so an idle room costs
 * nothing and `{"t":"ping"}` is answered by the runtime without waking the
 * object. The hub only introduces peers and forwards SDP/ICE text: binary
 * frames are refused, no data is stored, and a room forgets everything when
 * its last socket closes.
 */

import { DurableObject } from 'cloudflare:workers';

export interface Env {
  ROOMS: DurableObjectNamespace<SignalRoom>;
  /** Name peers see for this hub (default "Cloudflare"). */
  HUB_NAME?: string;
  /** Cloudflare Realtime TURN key (secrets). Unset: `/turn` answers 404. */
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
}

/**
 * Short-lived TURN credentials for peers whose direct link fails (both behind
 * one carrier NAT, strict firewalls). TURN forwards the already encrypted
 * WebRTC stream and cannot read it; the hub itself still carries no board
 * data. One credential per isolate, renewed well before it expires.
 */
const TURN_TTL_S = 24 * 3600;
const TURN_REUSE_MS = 6 * 3600 * 1000;
let turnCache: { at: number; body: string } | null = null;

async function turnCredentials(env: Env): Promise<Response> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return json({ ok: false, error: 'no turn' }, 404);
  if (!turnCache || Date.now() - turnCache.at > TURN_REUSE_MS) {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: TURN_TTL_S }),
      },
    );
    if (!res.ok) return json({ ok: false, error: `turn ${res.status}` }, 502);
    const data = (await res.json()) as { iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }> };
    // Port 53 is blocked in browsers and only costs a timeout.
    const iceServers = (data.iceServers ?? [])
      .map((s) => ({ ...s, urls: ([] as string[]).concat(s.urls).filter((u) => !/:53\b/.test(u)) }))
      .filter((s) => s.username && s.urls.length);
    turnCache = { at: Date.now(), body: JSON.stringify({ ok: true, ttl: TURN_TTL_S, iceServers }) };
  }
  return new Response(turnCache.body, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });
}

const PROTO = 1;
const MAX_ROOM_NAME = 200;
const MAX_PEERS = 64;
const MAX_FRAME = 64 * 1024;
/** A socket silent for this long (not even a ping) is dropped. */
const IDLE_MS = 75_000;
/** Sweep for dead sockets while a room has members. */
const SWEEP_MS = 60_000;
const PING = '{"t":"ping"}';
const PONG = '{"t":"pong"}';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
  });
}

export function normalizeRoomName(raw: string): string {
  const trim = (s: string) => s.trim().replace(/^\/+|\/+$/g, '');
  let decoded = trim(raw);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* keep raw; validation rejects it */
  }
  return trim(decoded);
}

export function isValidRoomName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_ROOM_NAME &&
    name !== '.' &&
    name !== '..' &&
    /^[A-Za-z0-9._-]+$/.test(name)
  );
}

export function isValidPeerId(id: string): boolean {
  return /^[A-Za-z0-9_-]{6,64}$/.test(id);
}

function hubName(env: Env): string {
  return env.HUB_NAME?.trim() || 'Cloudflare';
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname.startsWith('/signal/')) {
      const room = normalizeRoomName(url.pathname.slice('/signal/'.length));
      if (!isValidRoomName(room)) return json({ ok: false, error: 'bad room' }, 400);
      const peer = url.searchParams.get('peer') ?? '';
      if (!isValidPeerId(peer)) return json({ ok: false, error: 'bad peer' }, 400);
      if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return json({ ok: false, error: 'websocket only' }, 426);
      }
      const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
      const fwd = new URL(req.url);
      fwd.search = `?peer=${encodeURIComponent(peer)}&name=${encodeURIComponent(hubName(env))}`;
      return stub.fetch(new Request(fwd, req));
    }

    if (url.pathname === '/turn') return turnCredentials(env);

    if (url.pathname === '/health' || url.pathname === '/healthz') {
      // Rooms live in separate objects; there is no global count to report.
      return json({ ok: true, service: 'review-hub', proto: PROTO, name: hubName(env), runtime: 'cloudflare' });
    }

    return new Response(
      'ReView signaling hub. It serves no web UI; add this address as a hub (wss://<this host>) in ReView.\n',
      { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS } },
    );
  },
} satisfies ExportedHandler<Env>;

type Attachment = { peer: string; seen: number };

/** One signaling room. Memory only; the object is evicted once it is idle. */
export class SignalRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const peer = url.searchParams.get('peer') ?? '';
    const host = url.searchParams.get('name') ?? 'Cloudflare';

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    const live = this.members();
    const replacing = live.has(peer);
    if (!replacing && live.size >= MAX_PEERS) {
      server.accept();
      server.send(JSON.stringify({ t: 'error', error: 'room-full' }));
      server.close(4429, 'room-full');
      return new Response(null, { status: 101, webSocket: client });
    }

    for (const old of this.ctx.getWebSockets(peer)) {
      try { old.close(4000, 'replaced'); } catch { /* already closing */ }
    }

    this.ctx.acceptWebSocket(server, [peer]);
    server.serializeAttachment({ peer, seen: Date.now() } satisfies Attachment);
    server.send(
      JSON.stringify({
        t: 'welcome',
        proto: PROTO,
        peer,
        peers: [...live.keys()].filter((p) => p !== peer),
        host,
      }),
    );
    if (!replacing) this.broadcast({ t: 'join', peer }, peer);
    await this.armSweep();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') {
      // The hub never carries data. Refuse instead of relaying.
      this.drop(ws, 1003, 'text only');
      return;
    }
    if (message.length > MAX_FRAME) {
      this.drop(ws, 1009, 'too big');
      return;
    }
    const me = this.attachment(ws);
    if (!me) return;
    me.seen = Date.now();
    ws.serializeAttachment(me);

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(message) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.t === 'ping') {
      ws.send(PONG);
      return;
    }
    if (msg.t !== 'signal' || typeof msg.to !== 'string') return;
    const to = msg.to;
    const target = to !== me.peer ? this.socketOf(to) : null;
    if (!target) {
      ws.send(JSON.stringify({ t: 'gone', peer: to }));
      return;
    }
    target.send(JSON.stringify({ t: 'signal', from: me.peer, data: msg.data ?? null }));
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.left(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.left(ws);
  }

  /** Close sockets that went quiet (half-open TCP from a phone that lost signal). */
  async alarm(): Promise<void> {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.attachment(ws);
      const pinged = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      if (a && now - Math.max(a.seen, pinged) > IDLE_MS) this.drop(ws, 1001, 'idle');
    }
    await this.armSweep();
  }

  private async armSweep(): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) return;
    if ((await this.ctx.storage.getAlarm()) == null) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
    }
  }

  private drop(ws: WebSocket, code: number, reason: string): void {
    try { ws.close(code, reason); } catch { /* already closed */ }
    this.left(ws);
  }

  /** Announce a leave unless the peer still has a newer socket here. */
  private left(ws: WebSocket): void {
    const me = this.attachment(ws);
    if (!me) return;
    ws.serializeAttachment(null);
    if (this.socketOf(me.peer, ws)) return;
    this.broadcast({ t: 'leave', peer: me.peer }, me.peer);
  }

  private attachment(ws: WebSocket): Attachment | null {
    return (ws.deserializeAttachment() as Attachment | null) ?? null;
  }

  /** Live socket per peer (sockets already handled as closed are skipped). */
  private members(): Map<string, WebSocket> {
    const out = new Map<string, WebSocket>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.attachment(ws);
      if (a && ws.readyState === WebSocket.OPEN) out.set(a.peer, ws);
    }
    return out;
  }

  private socketOf(peer: string, except?: WebSocket): WebSocket | null {
    for (const ws of this.ctx.getWebSockets(peer)) {
      if (ws !== except && this.attachment(ws) && ws.readyState === WebSocket.OPEN) return ws;
    }
    return null;
  }

  private broadcast(msg: unknown, skip: string): void {
    const text = JSON.stringify(msg);
    for (const [peer, ws] of this.members()) {
      if (peer === skip) continue;
      try { ws.send(text); } catch { /* its close handler cleans up */ }
    }
  }
}
