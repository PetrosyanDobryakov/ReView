import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { canClearRoom, isRoomDeleteAuthorized } from './auth';
import {
  MAX_WS_MESSAGE,
  createAsyncGate,
  deleteBlob,
  mergeTails,
  readBlob,
  shouldFullPersist,
  writeBlob,
  canDropPersistedTail,
  canGcEmptyRoom,
} from './persist';

const messageSync = 0;
const messageAwareness = 1;

/**
 * Text WebSocket keepalive that Cloudflare can auto-answer without waking the
 * Durable Object (setWebSocketAutoResponse). Solo clients use this instead of
 * awareness renewals so idle boards bill ~zero DO duration.
 */
export const WS_KEEPALIVE_REQUEST = 'review-ka';
export const WS_KEEPALIVE_RESPONSE = 'review-ka-ack';

export const EMPTY_GC_MS = 90 * 1000;
/**
 * Tail persist trails mutations instead of running inside the message handler:
 * per-message storage round-trips stall the single-threaded room under floods
 * (drag/move storms), delaying relay for everyone. Relay stays synchronous;
 * durability trails ~150 ms behind, plus flush-on-close/alarm. Wake-restore
 * (sync step 1 to live sockets) heals anything the gap missed.
 */
export const TAIL_FLUSH_MS = 150;
/**
 * Full-doc encode is O(board) CPU on the single-threaded DO. Never start it from
 * an awareness (cursor) frame, and only arm it after sync traffic goes quiet so
 * a draw flood cannot freeze relay mid-stroke.
 */
export const FULL_PERSIST_IDLE_MS = 250;
/**
 * While cursors/drafts are flowing, postpone full encode so O(board) CPU does
 * not stall awareness relay on the single-threaded isolate.
 */
export const AWARENESS_QUIET_BEFORE_FULL_MS = 120;

type SocketAttachment = { clients: number[] };

function readAttachment(ws: WebSocket): SocketAttachment {
  try {
    const raw = (ws as WebSocket & { deserializeAttachment?: () => unknown }).deserializeAttachment?.();
    if (raw && typeof raw === 'object' && Array.isArray((raw as SocketAttachment).clients)) {
      return {
        clients: (raw as SocketAttachment).clients.filter((n) => typeof n === 'number'),
      };
    }
  } catch {
    /* attachment missing after first frame */
  }
  return { clients: [] };
}

function writeAttachment(ws: WebSocket, att: SocketAttachment): void {
  try {
    (ws as WebSocket & { serializeAttachment?: (v: unknown) => void }).serializeAttachment?.(att);
  } catch {
    /* hibernation attachment is best-effort */
  }
}

function trackAwarenessClients(
  ws: unknown,
  added: number[],
  updated: number[],
  removed: number[],
): void {
  if (!ws || typeof (ws as WebSocket).serializeAttachment !== 'function') return;
  const socket = ws as WebSocket;
  const set = new Set(readAttachment(socket).clients);
  for (const id of added) set.add(id);
  for (const id of updated) set.add(id);
  for (const id of removed) set.delete(id);
  writeAttachment(socket, { clients: [...set] });
}

/**
 * Yjs room with hibernatable WebSockets: the DO sleeps between messages, so
 * idle-but-connected tabs bill ~zero duration. Socket identity lives on
 * websocket attachments (survives hibernation). The CRDT is stored as chunked
 * blobs so photo boards can exceed the 2 MiB SQLite `put()` row limit.
 */
export class BoardRoom implements DurableObject {
  private doc: Y.Doc | null = null;
  private awareness: awarenessProtocol.Awareness | null = null;
  /** Unpersisted CRDT mutations since the last full encode. */
  private dirty = false;
  /** Incremental updates not yet merged into the `tail` blob (copied; Yjs recycles buffers). */
  private pending: Uint8Array[] = [];
  /** Last full-doc persist (throttle — encode+put is O(doc)). */
  private lastPersist = 0;
  /** Bumps on every CRDT update so full persist can tell a snapshot is stale. */
  private persistGen = 0;
  /** Serialize blob writes — overlapping flushFull/flushTail can drop the newer encode. */
  private readonly persist = createAsyncGate();
  /** Trailing tail-flush timer (debounced off the hot path). */
  private tailTimer: ReturnType<typeof setTimeout> | null = null;
  /** Trailing full-doc persist — only after sync idles (never from awareness). */
  private fullTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last awareness message time — full persist waits for a quiet window. */
  private lastAwareAt = 0;
  /**
   * True only while wipeRoomStorage runs. Upgrade fetches return 503 so they
   * cannot clear latches mid-deleteAll / resetRoom.
   */
  private wipeInFlight = false;
  /**
   * Set for the whole wipe and kept until the next successful websocket
   * accept. Blocks trailing persists and close-handler flushes from
   * resurrecting blobs after deleteAll.
   */
  private suppressPersist = false;
  /**
   * True after doc+tail were restored from storage (or after wipe left an
   * authoritative empty doc). False for an awareness-only stub hub so we
   * never encode an empty stub over persisted blobs on close/flush.
   */
  private docHydrated = false;
  /** Armed once — auto-response survives hibernation for all sockets on this DO. */
  private keepaliveAutoResponseArmed = false;

  constructor(private state: DurableObjectState, private env: unknown) {
    // Do NOT loadOrCreate in the constructor. Hibernation wakes for awareness
    // heartbeats were paying multi-second blob reads on every tick even though
    // presence fan-out needs no CRDT state. Accept + sync paths load lazily;
    // awareness-only uses ensureAwarenessHub() (empty in-memory stub).
    this.armKeepaliveAutoResponse();
  }

  /**
   * Solo idle tabs need an inbound frame every <30s (y-websocket reconnect).
   * Auto-respond to a tiny text ping without waking this isolate — awareness
   * echo still works for multi-peer, but solo must not pay wall time at all.
   */
  private armKeepaliveAutoResponse(): void {
    if (this.keepaliveAutoResponseArmed) return;
    try {
      const pairCtor = (
        globalThis as unknown as {
          WebSocketRequestResponsePair?: new (
            request: string,
            response: string,
          ) => unknown;
        }
      ).WebSocketRequestResponsePair;
      const arm = (
        this.state as DurableObjectState & {
          setWebSocketAutoResponse?: (pair: unknown) => void;
        }
      ).setWebSocketAutoResponse;
      if (typeof pairCtor === 'function' && typeof arm === 'function') {
        arm.call(this.state, new pairCtor(WS_KEEPALIVE_REQUEST, WS_KEEPALIVE_RESPONSE));
        this.keepaliveAutoResponseArmed = true;
      }
    } catch (err) {
      console.error('[BoardRoom] keepalive auto-response arm failed', err);
    }
  }

  /** Empty in-memory doc+awareness for awareness fan-out — no storage I/O. */
  private ensureAwarenessHub(): void {
    if (this.doc && !(this.doc as Y.Doc & { isDestroyed?: boolean }).isDestroyed) return;
    this.doc = new Y.Doc({ gc: false } as Record<string, unknown>);
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.dirty = false;
    this.pending = [];
    this.persistGen = 0;
    this.docHydrated = false;
    this.bindBroadcastHandlers();
  }

  /**
   * Restore chunked doc+tail when sync/accept needs real CRDT state.
   * @returns true when this call performed a fresh load (caller should sync-step1).
   */
  private async ensureDocLoaded(): Promise<boolean> {
    if (
      this.doc &&
      !(this.doc as Y.Doc & { isDestroyed?: boolean }).isDestroyed &&
      this.docHydrated
    ) {
      return false;
    }
    await this.loadOrCreate();
    return true;
  }

  private async loadOrCreate(): Promise<void> {
    try {
      this.doc?.destroy();
    } catch {
      /* */
    }
    try {
      (this.awareness as { destroy?: () => void } | null)?.destroy?.();
    } catch {
      /* */
    }
    const doc = new Y.Doc({ gc: false } as Record<string, unknown>);
    try {
      const stored = await readBlob(this.state.storage, 'doc');
      if (stored && stored.length) Y.applyUpdate(doc, stored);
    } catch (err) {
      console.error('[BoardRoom] load doc failed', err);
    }
    try {
      const tail = await readBlob(this.state.storage, 'tail');
      if (tail && tail.length) Y.applyUpdate(doc, tail);
    } catch (err) {
      console.error('[BoardRoom] load tail failed', err);
    }
    this.doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.dirty = false;
    this.pending = [];
    this.persistGen = 0;
    this.docHydrated = true;
    this.bindBroadcastHandlers();
  }

  /** Attach doc/awareness → websocket broadcast. Must re-run after resetRoom(). */
  private bindBroadcastHandlers(): void {
    const doc = this.doc!;
    const awareness = this.awareness!;
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.dirty = true;
      this.persistGen += 1;
      this.pending.push(update.slice());
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder), origin);
      // Durability trails the relay — never block messages on storage.
      this.queueTailFlush();
    });

    awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        trackAwarenessClients(origin, added, updated, removed);
        const changed = added.concat(updated).concat(removed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageAwareness);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
        );
        const msg = encoding.toUint8Array(encoder);
        this.broadcast(msg, origin);
        // y-websocket clients force-reconnect after 30s with no inbound frame.
        // The reference server echoes awareness to every conn including the
        // sender; without that, solo tabs never receive anything and reconnect
        // → accept/sync reloads the full board blob every ~30s (~5s wall).
        if (origin && typeof (origin as WebSocket).send === 'function') {
          try {
            (origin as WebSocket).send(msg);
          } catch {
            /* sender gone */
          }
        }
      },
    );
  }

  private broadcast(msg: Uint8Array, origin: unknown): void {
    for (const ws of this.state.getWebSockets()) {
      if (ws === origin) continue;
      try {
        ws.send(msg);
      } catch {
        /* peer gone */
      }
    }
  }

  private sendSyncStep1(ws: WebSocket): void {
    if (!this.doc) return;
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, messageSync);
    syncProtocol.writeSyncStep1(syncEncoder, this.doc);
    try {
      ws.send(encoding.toUint8Array(syncEncoder));
    } catch {
      /* */
    }
  }

  private sendAwarenessSnapshot(ws: WebSocket): void {
    if (!this.awareness) return;
    const awarenessStates = this.awareness.getStates();
    if (awarenessStates.size === 0) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, messageAwareness);
    encoding.writeVarUint8Array(
      enc,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(awarenessStates.keys())),
    );
    try {
      ws.send(encoding.toUint8Array(enc));
    } catch {
      /* */
    }
  }

  private clearTailTimer(): void {
    if (this.tailTimer) {
      clearTimeout(this.tailTimer);
      this.tailTimer = null;
    }
    if (this.fullTimer) {
      clearTimeout(this.fullTimer);
      this.fullTimer = null;
    }
  }

  /** Merge pending updates into the `tail` blob (O(update), hibernation-safe). */
  private async flushTailUnlocked(): Promise<void> {
    if (this.suppressPersist || !this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    try {
      const prev = await readBlob(this.state.storage, 'tail');
      const merged = mergeTails(prev, batch);
      if (merged) await writeBlob(this.state.storage, 'tail', merged);
    } catch (err) {
      // Put the batch back so a later flushFull / retry can recover.
      if (this.suppressPersist) return;
      this.pending = batch.concat(this.pending);
      this.dirty = true;
      console.error('[BoardRoom] tail persist failed', err);
    }
  }

  /** Full-doc encode into chunked `doc`. Keep a tail if updates arrived during the write. */
  private async flushFullUnlocked(): Promise<void> {
    // Never encode an awareness-only stub over real blobs after a cheap wake.
    if (this.suppressPersist || !this.doc || !this.docHydrated) return;
    await this.flushTailUnlocked();
    if (this.suppressPersist) return;
    try {
      const encodeGen = this.persistGen;
      await writeBlob(this.state.storage, 'doc', Y.encodeStateAsUpdate(this.doc));
      await this.flushTailUnlocked();
      if (this.suppressPersist) return;
      if (!canDropPersistedTail(encodeGen, this.persistGen, this.pending.length)) {
        this.dirty = true;
        return;
      }
      await deleteBlob(this.state.storage, 'tail');
      if (!canDropPersistedTail(encodeGen, this.persistGen, this.pending.length)) {
        this.dirty = true;
        await this.flushTailUnlocked();
        return;
      }
      this.dirty = false;
      this.lastPersist = Date.now();
    } catch (err) {
      if (this.suppressPersist) return;
      this.dirty = true;
      console.error('[BoardRoom] full persist failed', err);
    }
  }

  private async flushFull(): Promise<void> {
    await this.persist(() => this.flushFullUnlocked());
  }

  /**
   * Schedule a trailing tail flush. Fire-and-forget via waitUntil: the message
   * handler must return without touching storage, so relay never queues behind
   * blob writes. A flush already in flight just picks the batch up.
   */
  private queueTailFlush(): void {
    if (this.suppressPersist || this.tailTimer) return;
    this.tailTimer = setTimeout(() => {
      this.tailTimer = null;
      if (this.suppressPersist) return;
      this.state.waitUntil(
        this.persist(async () => {
          try {
            await this.flushTailUnlocked();
          } finally {
            // More arrived while flushing — trail it, don't drop it.
            if (!this.suppressPersist && this.pending.length) this.queueTailFlush();
          }
        }),
      );
    }, TAIL_FLUSH_MS);
  }

  /**
   * Trailing full encode after sync idles. Awareness must never call this —
   * Y.encodeStateAsUpdate on a photo board freezes the isolate and bursts
   * every queued cursor/stroke relay. Teardown still awaits flushFull.
   */
  private queueFullPersist(): void {
    if (this.suppressPersist || !this.dirty) return;
    if (this.fullTimer) clearTimeout(this.fullTimer);
    this.fullTimer = setTimeout(() => {
      this.fullTimer = null;
      if (this.suppressPersist || !this.dirty) return;
      const sinceAware = Date.now() - this.lastAwareAt;
      if (this.lastAwareAt > 0 && sinceAware < AWARENESS_QUIET_BEFORE_FULL_MS) {
        // Cursors still flowing — trail again instead of freezing relay mid-stream.
        this.queueFullPersist();
        return;
      }
      if (!shouldFullPersist(this.lastPersist, Date.now())) return;
      this.state.waitUntil(this.flushFull());
    }, FULL_PERSIST_IDLE_MS);
  }

  /**
   * Cancel trailing persists, drain the persist gate, wipe Durable Object
   * storage, then install a fresh empty doc. `suppressPersist` stays true
   * until the next websocket accept so late webSocketClose handlers cannot
   * rewrite blobs after deleteAll.
   *
   * Runs under `blockConcurrencyWhile` so an Upgrade fetch cannot accept a
   * socket between deleteAll and resetRoom. `wipeInFlight` makes concurrent
   * Upgrades return 503 until wipe finishes.
   */
  private async wipeRoomStorage(): Promise<void> {
    this.wipeInFlight = true;
    this.suppressPersist = true;
    this.clearTailTimer();
    this.pending = [];
    this.dirty = false;
    try {
      await this.state.blockConcurrencyWhile(async () => {
        await this.persist(async () => {
          this.pending = [];
          this.dirty = false;
          await this.state.storage.deleteAll();
        });
        this.resetRoom();
      });
    } finally {
      this.wipeInFlight = false;
    }
  }

  /** Destroy current doc/awareness and create a fresh pair with handlers rebound. */
  private resetRoom(): void {
    this.clearTailTimer();
    try {
      this.doc?.destroy();
    } catch {
      /* */
    }
    try {
      (this.awareness as { destroy?: () => void } | null)?.destroy?.();
    } catch {
      /* */
    }
    this.doc = new Y.Doc({ gc: false } as Record<string, unknown>);
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.dirty = false;
    this.pending = [];
    this.persistGen = 0;
    this.lastPersist = 0;
    // Wipe left storage empty — this empty doc is authoritative.
    this.docHydrated = true;
    this.bindBroadcastHandlers();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

    if (request.method === 'DELETE' && url.pathname.startsWith('/room/')) {
      const authorized = isRoomDeleteAuthorized(request, this.env);
      const sockets = this.state.getWebSockets();
      if (!canClearRoom(authorized, sockets.length)) {
        return new Response(JSON.stringify({ ok: false }), { status: 403, headers: cors });
      }
      // Mark wipe before close so webSocketClose handlers skip flushFull and
      // cannot rewrite blobs after deleteAll.
      this.wipeInFlight = true;
      this.suppressPersist = true;
      this.clearTailTimer();
      this.pending = [];
      this.dirty = false;
      for (const ws of sockets) {
        try {
          ws.close(1000, 'room cleared');
        } catch {
          /* */
        }
      }
      await this.wipeRoomStorage();
      return new Response(JSON.stringify({ ok: true, cleared: true }), { headers: cors });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    // Reject accepts while wipeRoomStorage is running. Post-wipe
    // suppressPersist stays set so close handlers remain no-ops until we
    // accept below — that must not 503 forever.
    if (this.wipeInFlight) {
      return new Response(JSON.stringify({ ok: false, wiping: true }), {
        status: 503,
        headers: cors,
      });
    }

    // Accept needs real CRDT state for sync-step1 (never the awareness stub).
    await this.ensureDocLoaded();
    if (this.wipeInFlight) {
      return new Response(JSON.stringify({ ok: false, wiping: true }), {
        status: 503,
        headers: cors,
      });
    }
    // Clear the post-wipe latch now that a real peer is joining again.
    this.suppressPersist = false;
    const doc = this.doc!;
    const awareness = this.awareness!;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.armKeepaliveAutoResponse();
    this.state.acceptWebSocket(server);
    writeAttachment(server, { clients: [] });

    await this.state.storage.deleteAlarm().catch(() => {});

    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, messageSync);
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    server.send(encoding.toUint8Array(syncEncoder));

    const awarenessStates = awareness.getStates();
    if (awarenessStates.size > 0) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, messageAwareness);
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awarenessStates.keys())),
      );
      server.send(encoding.toUint8Array(enc));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    try {
      // Fallback when auto-response is unavailable (tests / older runtime): still
      // answer the solo keepalive without touching CRDT/storage. Prefer the
      // hibernation auto-response path — that does not invoke this handler.
      if (typeof message === 'string') {
        if (message === WS_KEEPALIVE_REQUEST) {
          try {
            ws.send(WS_KEEPALIVE_RESPONSE);
          } catch {
            /* sender gone */
          }
          return;
        }
        return;
      }

      let uint8: Uint8Array;
      if (message instanceof Uint8Array) uint8 = message;
      else uint8 = new Uint8Array(message);

      if (uint8.byteLength > MAX_WS_MESSAGE) {
        console.error('[BoardRoom] message too large', uint8.byteLength);
        return;
      }

      const decoder = decoding.createDecoder(uint8);
      const type = decoding.readVarUint(decoder);

      // Peek type before any storage I/O: awareness heartbeats must not reload
      // multi-MB board blobs on hibernation wake (~seconds of DO wall time).
      if (type === messageAwareness) {
        this.ensureAwarenessHub();
        this.lastAwareAt = Date.now();
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness!,
          decoding.readVarUint8Array(decoder),
          ws,
        );
        return;
      }

      if (type === messageSync) {
        const freshlyLoaded = await this.ensureDocLoaded();
        if (freshlyLoaded) {
          this.sendSyncStep1(ws);
          this.sendAwarenessSnapshot(ws);
        }
        const doc = this.doc!;
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
        if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
        // Doc path only — awareness must not arm O(board) encode.
        this.queueFullPersist();
      }
    } catch (e) {
      console.error('[BoardRoom] message error', e);
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    await this.handleSocketGone(ws);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.handleSocketGone(ws);
  }

  private async handleSocketGone(ws: WebSocket): Promise<void> {
    if (this.suppressPersist) return;
    if (this.awareness) {
      const clients = readAttachment(ws).clients;
      if (clients.length) {
        try {
          awarenessProtocol.removeAwarenessStates(this.awareness, clients, null);
        } catch {
          /* */
        }
      }
    }
    // Awareness-only stub: storage already holds the last flush — do not rewrite.
    if (this.docHydrated) await this.flushFull();
    if (this.suppressPersist) return;
    if (this.state.getWebSockets().length === 0) {
      await this.state.storage.setAlarm(Date.now() + EMPTY_GC_MS);
    }
  }

  async alarm(): Promise<void> {
    if (this.suppressPersist) return;
    if (this.docHydrated && (this.dirty || this.pending.length)) await this.flushFull();
    if (!canGcEmptyRoom(this.state.getWebSockets().length, this.dirty, this.pending.length)) {
      if (this.state.getWebSockets().length === 0) {
        await this.state.storage.setAlarm(Date.now() + EMPTY_GC_MS);
      }
      return;
    }
    try {
      await this.wipeRoomStorage();
    } catch {
      /* */
    }
  }
}
