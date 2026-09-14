import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const messageSync = 0;
const messageAwareness = 1;
// const messageAuth = 2;

const EMPTY_GC_MS = 90 * 1000;

interface RoomEnv {
  REVIEW_COMPACT_TOKEN?: string;
  REVIEW_ROOM_DELETE_TOKEN?: string;
}

function compactTokenFromEnv(env: RoomEnv | unknown): string {
  const e = (env || {}) as RoomEnv;
  const a = e.REVIEW_COMPACT_TOKEN;
  const b = e.REVIEW_ROOM_DELETE_TOKEN;
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

/** Defense in depth inside the DO — same fail-closed rule as the Worker edge. */
function isRoomDeleteAuthorized(request: Request, env: unknown): boolean {
  const expected = compactTokenFromEnv(env);
  if (!expected) return false;
  return tokensMatch(compactTokenFromHeaders(request.headers), expected);
}

/**
 * Yjs room with hibernatable WebSockets: the DO sleeps between messages, so
 * idle-but-connected tabs bill ~zero duration. No per-connection state lives
 * in memory — sockets come from state.getWebSockets(), the doc from storage.
 */
export class BoardRoom implements DurableObject {
  private doc: Y.Doc | null = null;
  private awareness: awarenessProtocol.Awareness | null = null;
  /** Set by the doc 'update' handler; flushed to storage before sleeping. */
  private dirty = false;

  constructor(private state: DurableObjectState, private env: unknown) {
    this.state.blockConcurrencyWhile(async () => {
      await this.loadOrCreate();
    });
  }

  /** Restore the doc from storage (fresh empty pair when nothing stored). */
  private async loadOrCreate(): Promise<void> {
    const doc = new Y.Doc({ gc: false } as any);
    try {
      const stored = await this.state.storage.get<Uint8Array>('doc');
      if (stored) Y.applyUpdate(doc, stored);
    } catch {}
    this.doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.dirty = false;
    this.bindBroadcastHandlers();
  }

  /** Attach doc/awareness → websocket broadcast. Must re-run after resetRoom(). */
  private bindBroadcastHandlers(): void {
    const doc = this.doc!;
    const awareness = this.awareness!;
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.dirty = true;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder), origin);
    });

    awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = added.concat(updated).concat(removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
      this.broadcast(encoding.toUint8Array(encoder), origin);
    });
  }

  private broadcast(msg: Uint8Array, origin: unknown): void {
    for (const ws of this.state.getWebSockets()) {
      if (ws === origin) continue;
      try { ws.send(msg); } catch {}
    }
  }

  /** Persist every applied mutation synchronously — a hibernating DO may be
   * evicted at any time, so in-memory debounce would lose data. */
  private async flush(): Promise<void> {
    if (!this.dirty || !this.doc) return;
    this.dirty = false;
    try { await this.state.storage.put('doc', Y.encodeStateAsUpdate(this.doc)); } catch {}
  }

  /** Destroy current doc/awareness and create a fresh pair with handlers rebound. */
  private resetRoom(): void {
    try { this.doc?.destroy(); } catch {}
    try { (this.awareness as any)?.destroy(); } catch {}
    this.doc = new Y.Doc({ gc: false } as any);
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.dirty = false;
    this.bindBroadcastHandlers();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // handle DELETE /room/<name> for compatibility (clear)
    if (request.method === 'DELETE' && url.pathname.startsWith('/room/')) {
      if (!isRoomDeleteAuthorized(request, this.env)) {
        return new Response(JSON.stringify({ ok: false }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      for (const ws of this.state.getWebSockets()) { try { ws.close(1000, 'room cleared'); } catch {} }
      this.resetRoom();
      await this.state.storage.deleteAll();
      return new Response(JSON.stringify({ ok: true, cleared: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    // After alarm() GC the in-memory pair is fresh-empty; reload persisted state if any.
    if (!this.doc || (this.doc as any).isDestroyed) {
      await this.loadOrCreate();
    }
    const doc = this.doc!;
    const awareness = this.awareness!;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    // hibernation: the DO may sleep while sockets stay open at the edge
    (this.state as any).acceptWebSocket(server);

    // cancel GC alarm while someone is connected
    await this.state.storage.deleteAlarm().catch(() => {});

    // send sync step 1 + awareness
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, messageSync);
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    server.send(encoding.toUint8Array(syncEncoder));

    const awarenessStates = awareness.getStates();
    if (awarenessStates.size > 0) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, messageAwareness);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awarenessStates.keys())));
      server.send(encoding.toUint8Array(enc));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (!this.doc || (this.doc as any).isDestroyed) {
      await this.loadOrCreate();
    }
    const doc = this.doc!;
    const awareness = this.awareness!;
    try {
      let uint8: Uint8Array;
      if (message instanceof ArrayBuffer) uint8 = new Uint8Array(message);
      else if (message instanceof Uint8Array) uint8 = message;
      else if (typeof message === 'string') uint8 = new TextEncoder().encode(message);
      else uint8 = new Uint8Array(message as ArrayBuffer);

      const decoder = decoding.createDecoder(uint8);
      const type = decoding.readVarUint(decoder);
      const encoder = encoding.createEncoder();
      if (type === messageSync) {
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
        if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
      } else if (type === messageAwareness) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
      }
    } catch (e) {
      console.error('[BoardRoom] message error', e);
    }
    await this.flush();
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    await this.handleSocketGone();
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.handleSocketGone();
  }

  private async handleSocketGone(): Promise<void> {
    // y-protocols doesn't auto-remove awareness on ws close, so we rely on the client sending 'removed' on beforeunload.
    await this.flush();
    if (this.state.getWebSockets().length === 0) {
      // schedule GC
      await this.state.storage.setAlarm(Date.now() + EMPTY_GC_MS);
    }
  }

  async alarm(): Promise<void> {
    // stale alarm raced with a reconnect — someone is home, stay alive
    if (this.state.getWebSockets().length > 0) return;
    await this.flush();
    if (this.state.getWebSockets().length > 0) return;
    // GC if still empty, then leave a fresh empty doc so a later fetch is safe
    try { await this.state.storage.deleteAll(); } catch {}
    this.resetRoom();
  }
}
