import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const messageSync = 0;
const messageAwareness = 1;
// const messageAuth = 2;

const EMPTY_GC_MS = 5 * 60 * 1000;

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

export class BoardRoom implements DurableObject {
  private doc: Y.Doc;
  private awareness: awarenessProtocol.Awareness;
  private conns = new Set<WebSocket>();

  constructor(private state: DurableObjectState, private env: unknown) {
    this.doc = new Y.Doc({ gc: false } as any);
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.bindBroadcastHandlers();

    // restore from storage if any (optional persistence)
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<Uint8Array>('doc');
      if (stored) {
        try { Y.applyUpdate(this.doc, stored); } catch {}
      }
    });
  }

  /** Attach doc/awareness → websocket broadcast. Must re-run after resetRoom(). */
  private bindBroadcastHandlers(): void {
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const msg = encoding.toUint8Array(encoder);
      for (const ws of this.conns) {
        if (ws === origin) continue;
        try { ws.send(msg); } catch {}
      }
    });

    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = added.concat(updated).concat(removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      const msg = encoding.toUint8Array(encoder);
      for (const ws of this.conns) {
        if (ws === origin) continue;
        try { ws.send(msg); } catch {}
      }
    });
  }

  /** Destroy current doc/awareness and create a fresh pair with handlers rebound. */
  private resetRoom(): void {
    try { this.doc.destroy(); } catch {}
    try { this.awareness.destroy(); } catch {}
    this.doc = new Y.Doc({ gc: false } as any);
    this.awareness = new awarenessProtocol.Awareness(this.doc);
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
      for (const ws of this.conns) { try { ws.close(1000, 'room cleared'); } catch {} }
      this.conns.clear();
      this.resetRoom();
      await this.state.storage.deleteAll();
      return new Response(JSON.stringify({ ok: true, cleared: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    // After alarm() GC, recreate an empty doc if needed before accepting clients.
    if (!this.doc || (this.doc as any).isDestroyed) {
      this.resetRoom();
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();

    this.conns.add(server as any);
    // cancel GC alarm while someone is connected
    await this.state.storage.deleteAlarm().catch(() => {});

    // send sync step 1 + awareness
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, messageSync);
    syncProtocol.writeSyncStep1(syncEncoder, this.doc);
    server.send(encoding.toUint8Array(syncEncoder));

    const awarenessStates = this.awareness.getStates();
    if (awarenessStates.size > 0) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, messageAwareness);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(awarenessStates.keys())));
      server.send(encoding.toUint8Array(enc));
    }

    server.addEventListener('message', (event: MessageEvent) => {
      try {
        const data = event.data as ArrayBuffer | Uint8Array | string;
        let uint8: Uint8Array;
        if (data instanceof ArrayBuffer) uint8 = new Uint8Array(data);
        else if (data instanceof Uint8Array) uint8 = data;
        else if (typeof data === 'string') uint8 = new TextEncoder().encode(data);
        else uint8 = new Uint8Array(data as ArrayBuffer);

        const decoder = decoding.createDecoder(uint8);
        const type = decoding.readVarUint(decoder);
        const encoder = encoding.createEncoder();
        if (type === messageSync) {
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, server);
          if (encoding.length(encoder) > 1) server.send(encoding.toUint8Array(encoder));
        } else if (type === messageAwareness) {
          awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), server);
        }
      } catch (e) {
        console.error('[BoardRoom] message error', e);
      }
    });

    // persist doc debounced (don't encode full doc on every stroke)
    let persistTimer: number | null = null;
    const schedulePersist = () => {
      if (persistTimer != null) return;
      persistTimer = setTimeout(() => {
        persistTimer = null;
        try { this.state.storage.put('doc', Y.encodeStateAsUpdate(this.doc)).catch(() => {}); } catch {}
      }, 1000) as unknown as number;
    };
    const onDocUpdate = () => schedulePersist();
    this.doc.on('update', onDocUpdate);

    const closeHandler = async () => {
      this.conns.delete(server as any);
      if (persistTimer != null) {
        clearTimeout(persistTimer as unknown as number);
        persistTimer = null;
        // Flush pending debounce so a disconnect within 1s of the last update is not lost.
        try { await this.state.storage.put('doc', Y.encodeStateAsUpdate(this.doc)); } catch {}
      }
      // remove awareness for this connection's clientID is handled by awarenessProtocol (client will send remove on close)
      // we also try to remove any awareness that belonged to this ws origin
      // y-protocols doesn't auto-remove on ws close, so we rely on client sending 'removed' on beforeunload.
      this.doc.off('update', onDocUpdate);
      if (this.conns.size === 0) {
        // schedule GC
        await this.state.storage.setAlarm(Date.now() + EMPTY_GC_MS);
        // persist final state
        try { await this.state.storage.put('doc', Y.encodeStateAsUpdate(this.doc)); } catch {}
      }
    };
    server.addEventListener('close', () => void closeHandler());
    server.addEventListener('error', () => void closeHandler());

    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm(): Promise<void> {
    if (this.conns.size === 0) {
      // GC if still empty, then leave a fresh empty doc so a later fetch is safe
      try { await this.state.storage.deleteAll(); } catch {}
      this.resetRoom();
    }
  }
}
