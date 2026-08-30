import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const messageSync = 0;
const messageAwareness = 1;
// const messageAuth = 2;

const EMPTY_GC_MS = 5 * 60 * 1000;

export class BoardRoom implements DurableObject {
  private doc: Y.Doc;
  private awareness: awarenessProtocol.Awareness;
  private conns = new Set<WebSocket>();

  constructor(private state: DurableObjectState, private env: unknown) {
    this.doc = new Y.Doc({ gc: false } as any);
    this.awareness = new awarenessProtocol.Awareness(this.doc);

    // persist awareness + doc on update? DO keeps in memory while active.
    // When last client leaves, alarm will GC.
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

    // restore from storage if any (optional persistence)
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<Uint8Array>('doc');
      if (stored) {
        try { Y.applyUpdate(this.doc, stored); } catch {}
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // handle DELETE /room/<name> for compatibility (clear)
    if (request.method === 'DELETE' && url.pathname.startsWith('/room/')) {
      this.doc.destroy();
      this.awareness.destroy();
      this.doc = new Y.Doc({ gc: false } as any);
      this.awareness = new awarenessProtocol.Awareness(this.doc);
      for (const ws of this.conns) { try { ws.close(1000, 'room cleared'); } catch {} }
      this.conns.clear();
      await this.state.storage.deleteAll();
      return new Response(JSON.stringify({ ok: true, cleared: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
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
      if (persistTimer != null) { clearTimeout(persistTimer as unknown as number); persistTimer = null; }
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
      // GC if still empty
      try { await this.state.storage.deleteAll(); } catch {}
      this.doc.destroy();
      this.awareness.destroy();
    }
  }
}
