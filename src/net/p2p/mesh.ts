/**
 * Full-mesh P2P sync for one board.
 *
 * Hubs (any number) only introduce peers and pass their WebRTC handshakes.
 * Once a data channel is open, the Yjs document and awareness flow directly
 * between the two browsers and the hub is no longer involved; a link even
 * survives its hub going away.
 *
 * Updates a peer receives are relayed to its other links unless the target
 * already has a direct link to the sender (from its NEIGHBORS frame), so a
 * partial mesh (A-B-C where A and C cannot reach each other) still converges.
 */

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { HubConnection } from './hub';
import {
  Frame,
  PEER_PROTO,
  Reassembler,
  decodeHello,
  decodePing,
  encodeHello,
  encodePing,
  frame,
  split,
} from './protocol';
import { WebRtcLink, isInitiator, webrtcAvailable } from './webrtcLink';
import type { HubInfo, HubSource, MeshSnapshot, PeerInfo, PeerLink } from './types';

const PING_MS = 5_000;
/** A link that delivers nothing (not even PONG) for this long is dead. */
const SILENT_MS = 30_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/** Frame 0x07: UTF-8 JSON array of peer ids this peer has open links to. */
const NEIGHBORS = 0x07;

/** Origin for awareness removals the mesh does locally; never re-broadcast. */
const LOCAL_DROP = Symbol('mesh-drop');

export type HubSpec = { url: string; source: HubSource };

export type MeshOptions = {
  iceServers: RTCIceServer[];
  appVersion: string;
  onChange: () => void;
  log?: (msg: string, data?: Record<string, unknown>) => void;
};

type Entry = {
  peer: string;
  hubs: Set<string>;
  link: PeerLink | null;
  attempts: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  reasm: Reassembler;
  app: string | null;
  clients: Set<number>;
  neighbors: Set<string>;
  rtt: number | null;
  pingSeq: number;
  lastHeard: number;
};

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

export class Mesh {
  private readonly hubs = new Map<string, HubConnection>();
  private readonly entries = new Map<string, Entry>();
  private msgSeq = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(
    readonly doc: Y.Doc,
    readonly awareness: awarenessProtocol.Awareness,
    readonly room: string,
    readonly self: string,
    private readonly opts: MeshOptions,
  ) {
    doc.on('update', this.onDocUpdate);
    awareness.on('update', this.onAwarenessUpdate);
    this.pingTimer = setInterval(() => this.tick(), PING_MS);
  }

  /** Replace the hub set. Unchanged hubs keep their sockets. */
  setHubs(specs: HubSpec[]): void {
    if (this.destroyed) return;
    const want = new Map<string, HubSource>();
    for (const s of specs) if (!want.has(s.url)) want.set(s.url, s.source);
    for (const [url, hub] of this.hubs) {
      if (want.has(url)) continue;
      hub.close();
      this.hubs.delete(url);
      for (const e of this.entries.values()) {
        if (e.hubs.delete(url)) this.maybeForget(e);
      }
    }
    for (const [url, source] of want) {
      if (this.hubs.has(url)) continue;
      const hub: HubConnection = new HubConnection(url, source, this.room, this.self, {
        welcome: (peers) => {
          for (const p of peers) this.notePeer(url, p);
        },
        join: (p) => this.notePeer(url, p),
        leave: (p) => this.hubLostPeer(url, p),
        gone: (p) => this.hubLostPeer(url, p),
        signal: (from, data) => this.onSignal(url, from, data),
        state: () => this.changed(),
      });
      this.hubs.set(url, hub);
    }
    this.changed();
  }

  retryHubs(): void {
    for (const h of this.hubs.values()) h.retryNow();
  }

  openLinks(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.link?.state === 'open') n++;
    return n;
  }

  hubsOpen(): number {
    let n = 0;
    for (const h of this.hubs.values()) if (h.state === 'open') n++;
    return n;
  }

  snapshot(): MeshSnapshot {
    const hubs: HubInfo[] = [...this.hubs.values()].map((h) => ({
      url: h.url,
      source: h.source,
      state: h.state,
      name: h.name,
      peers: h.peers.size,
      error: h.error,
    }));
    const peers: PeerInfo[] = [...this.entries.values()].map((e) => ({
      peer: e.peer,
      state: e.link?.state ?? (e.retryTimer ? 'failed' : 'connecting'),
      path: e.link?.path ?? 'unknown',
      rtt: e.rtt,
      bytesIn: e.link?.bytesIn ?? 0,
      bytesOut: e.link?.bytesOut ?? 0,
      app: e.app,
      clients: [...e.clients],
      hubs: [...e.hubs],
      attempts: e.attempts,
    }));
    return { room: this.room, self: this.self, enabled: true, webrtc: webrtcAvailable(), hubs, peers };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    // Tell direct peers we are gone so cursors vanish now, not after 30s.
    try {
      const local = this.awareness.getLocalState();
      if (local !== null) {
        const id = this.awareness.clientID;
        const meta = this.awareness.meta.get(id);
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 1);
        encoding.writeVarUint(enc, id);
        encoding.writeVarUint(enc, (meta?.clock ?? 0) + 1);
        encoding.writeVarString(enc, 'null');
        this.broadcast(frame(Frame.Awareness, encoding.toUint8Array(enc)), null);
      }
    } catch { /* best effort */ }
    for (const e of this.entries.values()) {
      if (e.retryTimer) clearTimeout(e.retryTimer);
      e.link?.close();
    }
    this.entries.clear();
    for (const h of this.hubs.values()) h.close();
    this.hubs.clear();
  }

  // ---- peers -------------------------------------------------------------

  private entry(peer: string): Entry {
    let e = this.entries.get(peer);
    if (!e) {
      e = {
        peer,
        hubs: new Set(),
        link: null,
        attempts: 0,
        retryTimer: null,
        reasm: new Reassembler(),
        app: null,
        clients: new Set(),
        neighbors: new Set(),
        rtt: null,
        pingSeq: 0,
        lastHeard: 0,
      };
      this.entries.set(peer, e);
    }
    return e;
  }

  private notePeer(hub: string, peer: string): void {
    if (this.destroyed || peer === this.self) return;
    const e = this.entry(peer);
    e.hubs.add(hub);
    this.ensureLink(e);
    this.changed();
  }

  private hubLostPeer(hub: string, peer: string): void {
    const e = this.entries.get(peer);
    if (!e) return;
    e.hubs.delete(hub);
    this.maybeForget(e);
    this.changed();
  }

  /** Forget a peer no hub lists, unless its link is still up (links outlive hubs). */
  private maybeForget(e: Entry): void {
    if (e.hubs.size > 0) return;
    if (e.link && e.link.state === 'open') return;
    this.drop(e);
  }

  private drop(e: Entry): void {
    if (e.retryTimer) clearTimeout(e.retryTimer);
    e.retryTimer = null;
    const link = e.link;
    e.link = null;
    link?.close();
    this.dropClients(e);
    this.entries.delete(e.peer);
    this.announceNeighbors();
    this.changed();
  }

  private ensureLink(e: Entry): void {
    if (this.destroyed || !webrtcAvailable()) return;
    if (e.link && (e.link.state === 'connecting' || e.link.state === 'open')) return;
    if (e.retryTimer) return;
    const initiator = isInitiator(this.self, e.peer);
    e.attempts += 1;
    e.reasm.clear();
    const link: PeerLink = new WebRtcLink(e.peer, initiator, this.opts.iceServers, {
      open: () => this.onLinkOpen(e, link),
      message: (data) => this.onLinkMessage(e, link, data),
      close: (reason) => this.onLinkClose(e, link, reason),
      signal: (data) => this.sendSignal(e, data),
    });
    e.link = link;
    this.opts.log?.('link start', { peer: e.peer, initiator, attempt: e.attempts });
    // The initiator may be in a retry backoff; ask it to offer now.
    if (!initiator) this.sendSignal(e, { kind: 'knock' });
  }

  private onSignal(hub: string, from: string, data: unknown): void {
    if (this.destroyed || from === this.self) return;
    const e = this.entry(from);
    e.hubs.add(hub);
    const kind = data && typeof data === 'object' ? (data as { kind?: unknown }).kind : null;
    if (kind === 'knock') {
      if (isInitiator(this.self, from) && !(e.link && e.link.state === 'open')) {
        if (e.link?.state !== 'connecting') {
          if (e.retryTimer) clearTimeout(e.retryTimer);
          e.retryTimer = null;
          this.ensureLink(e);
        }
      }
      return;
    }
    if (kind === 'offer' && !isInitiator(this.self, from)) {
      // A new offer means the initiator restarted; our old link is stale.
      if (e.link && e.link.state !== 'connecting') {
        const old = e.link;
        e.link = null;
        old.close();
      }
      if (e.retryTimer) { clearTimeout(e.retryTimer); e.retryTimer = null; }
      if (!e.link) {
        this.ensureLinkQuiet(e);
      }
    }
    e.link?.signal(data);
  }

  /** Responder link for an incoming offer, without a knock (the offer is already here). */
  private ensureLinkQuiet(e: Entry): void {
    if (!webrtcAvailable()) return;
    e.attempts += 1;
    e.reasm.clear();
    const link: PeerLink = new WebRtcLink(e.peer, false, this.opts.iceServers, {
      open: () => this.onLinkOpen(e, link),
      message: (data) => this.onLinkMessage(e, link, data),
      close: (reason) => this.onLinkClose(e, link, reason),
      signal: (data) => this.sendSignal(e, data),
    });
    e.link = link;
  }

  private sendSignal(e: Entry, data: unknown): void {
    const ordered = [...e.hubs].map((u) => this.hubs.get(u)).filter((h): h is HubConnection => !!h);
    ordered.sort((a, b) => Number(b.state === 'open') - Number(a.state === 'open'));
    for (const h of ordered) if (h.send(e.peer, data)) return;
  }

  private onLinkOpen(e: Entry, link: PeerLink): void {
    if (e.link !== link) return;
    e.attempts = 0;
    e.lastHeard = Date.now();
    this.opts.log?.('link open', { peer: e.peer });
    this.sendTo(e, encodeHello({ proto: PEER_PROTO, app: this.opts.appVersion }));
    const enc = encoding.createEncoder();
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.sendTo(e, frame(Frame.Sync, encoding.toUint8Array(enc)));
    const states = [...this.awareness.getStates().keys()];
    if (states.length) {
      this.sendTo(e, frame(Frame.Awareness, awarenessProtocol.encodeAwarenessUpdate(this.awareness, states)));
    }
    this.announceNeighbors();
    this.changed();
  }

  private onLinkClose(e: Entry, link: PeerLink, reason: string): void {
    if (e.link !== link) return;
    e.link = null;
    e.rtt = null;
    e.neighbors.clear();
    this.dropClients(e);
    this.opts.log?.('link closed', { peer: e.peer, reason });
    this.announceNeighbors();
    if (this.destroyed) return;
    if (e.hubs.size === 0) {
      this.entries.delete(e.peer);
      this.changed();
      return;
    }
    const delay = Math.min(RETRY_BASE_MS * 2 ** Math.max(0, e.attempts - 1), RETRY_MAX_MS);
    e.retryTimer = setTimeout(() => {
      e.retryTimer = null;
      if (this.entries.get(e.peer) === e) this.ensureLink(e);
    }, delay);
    this.changed();
  }

  /** Remove awareness clients only this link vouched for. */
  private dropClients(e: Entry): void {
    if (!e.clients.size) return;
    const stillSeen = new Set<number>();
    for (const other of this.entries.values()) {
      if (other === e || other.link?.state !== 'open') continue;
      for (const c of other.clients) stillSeen.add(c);
    }
    const gone = [...e.clients].filter((c) => !stillSeen.has(c) && c !== this.awareness.clientID);
    e.clients.clear();
    if (gone.length) awarenessProtocol.removeAwarenessStates(this.awareness, gone, LOCAL_DROP);
  }

  // ---- data --------------------------------------------------------------

  private onLinkMessage(e: Entry, link: PeerLink, data: Uint8Array): void {
    if (e.link !== link) return;
    e.lastHeard = Date.now();
    const msg = e.reasm.push(data);
    if (!msg || msg.length === 0) return;
    const body = msg.subarray(1);
    switch (msg[0]) {
      case Frame.Sync: {
        const dec = decoding.createDecoder(body);
        const enc = encoding.createEncoder();
        try {
          syncProtocol.readSyncMessage(dec, enc, this.doc, e);
        } catch (err) {
          this.opts.log?.('bad sync frame', { peer: e.peer, err: String(err) });
          return;
        }
        if (encoding.length(enc) > 0) this.sendTo(e, frame(Frame.Sync, encoding.toUint8Array(enc)));
        return;
      }
      case Frame.Awareness: {
        this.trackClients(e, body);
        try {
          awarenessProtocol.applyAwarenessUpdate(this.awareness, body, e);
        } catch { /* malformed */ }
        return;
      }
      case Frame.Ping: {
        const out = new Uint8Array(msg);
        out[0] = Frame.Pong;
        this.sendTo(e, out);
        return;
      }
      case Frame.Pong: {
        const p = decodePing(body);
        if (p) e.rtt = Math.max(0, Math.round(performance.now() - p.at));
        return;
      }
      case Frame.Hello: {
        const h = decodeHello(body);
        if (h) {
          e.app = h.app || null;
          if (h.proto !== PEER_PROTO) this.opts.log?.('peer proto mismatch', { peer: e.peer, proto: h.proto });
        }
        this.changed();
        return;
      }
      case NEIGHBORS: {
        try {
          const list = JSON.parse(fromUtf8.decode(body)) as unknown;
          e.neighbors = new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
        } catch { /* ignore */ }
        return;
      }
      default:
        return;
    }
  }

  /** Remember which awareness clients arrived over this link (header-only parse). */
  private trackClients(e: Entry, update: Uint8Array): void {
    try {
      const dec = decoding.createDecoder(update);
      const n = decoding.readVarUint(dec);
      for (let i = 0; i < n; i++) {
        const id = decoding.readVarUint(dec);
        decoding.readVarUint(dec);
        const state = decoding.readVarString(dec);
        if (id === this.awareness.clientID) continue;
        if (state === 'null') e.clients.delete(id);
        else e.clients.add(id);
      }
    } catch { /* malformed: applyAwarenessUpdate will throw too */ }
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    const enc = encoding.createEncoder();
    syncProtocol.writeUpdate(enc, update);
    this.broadcast(frame(Frame.Sync, encoding.toUint8Array(enc)), this.originEntry(origin));
  };

  private readonly onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === LOCAL_DROP) return;
    const changed = changes.added.concat(changes.updated, changes.removed);
    if (!changed.length) return;
    const body = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed);
    this.broadcast(frame(Frame.Awareness, body), this.originEntry(origin));
  };

  private originEntry(origin: unknown): Entry | null {
    if (!origin || typeof origin !== 'object') return null;
    for (const e of this.entries.values()) if (e === origin) return e;
    return null;
  }

  /** Send to every open link except the source, skipping peers already linked to the source. */
  private broadcast(message: Uint8Array, from: Entry | null): void {
    for (const e of this.entries.values()) {
      if (e === from || e.link?.state !== 'open') continue;
      if (from && e.neighbors.has(from.peer)) continue;
      this.sendTo(e, message);
    }
  }

  private sendTo(e: Entry, message: Uint8Array): void {
    const link = e.link;
    if (!link || link.state !== 'open') return;
    this.msgSeq = (this.msgSeq + 1) >>> 0;
    for (const part of split(message, this.msgSeq)) {
      if (!link.send(part)) return;
    }
  }

  private announceNeighbors(): void {
    const open = [...this.entries.values()].filter((e) => e.link?.state === 'open').map((e) => e.peer);
    const msg = frame(NEIGHBORS as Frame, utf8.encode(JSON.stringify(open)));
    for (const e of this.entries.values()) this.sendTo(e, msg);
  }

  private tick(): void {
    const now = Date.now();
    for (const e of this.entries.values()) {
      if (e.link?.state !== 'open') continue;
      if (now - e.lastHeard > SILENT_MS) {
        this.opts.log?.('link silent, closing', { peer: e.peer });
        e.link.close();
        continue;
      }
      e.pingSeq = (e.pingSeq + 1) >>> 0;
      this.sendTo(e, encodePing(e.pingSeq, performance.now()));
    }
    this.changed();
  }

  private changePending = false;
  private changed(): void {
    if (this.changePending || this.destroyed) return;
    this.changePending = true;
    queueMicrotask(() => {
      this.changePending = false;
      if (!this.destroyed) this.opts.onChange();
    });
  }
}
