/**
 * Last-resort link: the mesh's frames carried through Nostr relays when no
 * WebRTC path exists (both peers behind one carrier NAT, no TURN).
 *
 * Every message rides the relay hub's sealed channel (AES-GCM under a key
 * derived from the board, ephemeral events the relay forwards and keeps
 * nothing of), so a relay sees only opaque bytes. Frames are batched,
 * numbered and sent through up to two relays at a paced rate; the receiver
 * drops duplicates, puts them back in order and skips a gap that does not
 * fill in time (Yjs resyncs whatever was lost). Throughput is modest: fine
 * for edits and cursors, slow for big media.
 */

import type { LinkEvents, LinkPath, LinkState, PeerLink } from './types';

/** Raw bytes per relay event (base64 makes it ~4/3 of this). */
const MAX_BATCH = 24 * 1024;
/** Events per second per link, kept under public relays' rate limits. */
const SEND_INTERVAL_MS = 200;
const HELLO_EVERY_MS = 2_000;
const OPEN_TIMEOUT_MS = 40_000;
/** A missing message is given up on after this long. */
const GAP_MS = 2_500;
/** Peer silent this long (no data, no keepalive): the link is gone. */
const SILENT_MS = 90_000;
const KEEPALIVE_MS = 25_000;

export type RelayMsg =
  | { kind: 'relay-hello'; open: boolean }
  | { kind: 'relay'; s: number; d: string }
  | { kind: 'relay-bye' };

export function isRelayMsg(data: unknown): data is RelayMsg {
  const k = data && typeof data === 'object' ? (data as { kind?: unknown }).kind : null;
  return k === 'relay-hello' || k === 'relay' || k === 'relay-bye';
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class RelayLink implements PeerLink {
  state: LinkState = 'connecting';
  readonly path: LinkPath = 'hub';
  bytesIn = 0;
  bytesOut = 0;

  private queue: Uint8Array[] = [];
  private queued = 0;
  private seq = 0;
  private next = 0;
  private readonly held = new Map<number, Uint8Array>();
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private sendTimer: ReturnType<typeof setInterval> | null = null;
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHeard = Date.now();
  private lastSent = Date.now();

  /** `send` delivers one message to the peer through the relays (false: no relay up). */
  constructor(
    readonly peer: string,
    private readonly sendMsg: (msg: RelayMsg) => boolean,
    private readonly on: LinkEvents,
  ) {
    this.hello(false);
    this.helloTimer = setInterval(() => this.hello(false), HELLO_EVERY_MS);
    this.openTimer = setTimeout(() => this.shutdown('failed', 'relay timeout'), OPEN_TIMEOUT_MS);
    this.sendTimer = setInterval(() => this.pump(), SEND_INTERVAL_MS);
  }

  get buffered(): number {
    return this.queued;
  }

  send(frame: Uint8Array): boolean {
    if (this.state !== 'open') return false;
    this.queue.push(frame);
    this.queued += frame.length;
    return true;
  }

  signal(raw: unknown): void {
    if (!isRelayMsg(raw) || this.state === 'closed' || this.state === 'failed') return;
    this.lastHeard = Date.now();
    if (raw.kind === 'relay-bye') {
      this.shutdown('closed', 'peer left');
      return;
    }
    if (raw.kind === 'relay-hello') {
      if (!raw.open) this.hello(true);
      this.markOpen();
      return;
    }
    this.markOpen();
    if (typeof raw.s !== 'number' || typeof raw.d !== 'string') return;
    if (raw.s < this.next || this.held.has(raw.s)) return;
    let bytes: Uint8Array;
    try {
      bytes = unb64(raw.d);
    } catch {
      return;
    }
    this.held.set(raw.s, bytes);
    this.drain();
  }

  close(): void {
    if (this.state === 'open') this.sendMsg({ kind: 'relay-bye' });
    this.shutdown('closed', 'closed');
  }

  private hello(open: boolean): void {
    this.sendMsg({ kind: 'relay-hello', open: open || this.state === 'open' });
  }

  private markOpen(): void {
    if (this.state !== 'connecting') return;
    this.state = 'open';
    if (this.helloTimer) clearInterval(this.helloTimer);
    this.helloTimer = null;
    if (this.openTimer) clearTimeout(this.openTimer);
    this.openTimer = null;
    this.on.open();
  }

  /** Send one batch of queued frames, or a keepalive. */
  private pump(): void {
    if (this.state !== 'open') return;
    if (Date.now() - this.lastHeard > SILENT_MS) {
      this.shutdown('failed', 'relay silent');
      return;
    }
    if (!this.queue.length) {
      if (Date.now() - this.lastSent > KEEPALIVE_MS) {
        this.lastSent = Date.now();
        this.sendMsg({ kind: 'relay-hello', open: true });
      }
      return;
    }
    const parts: Uint8Array[] = [];
    let size = 0;
    while (this.queue.length && (size === 0 || size + 4 + this.queue[0]!.length <= MAX_BATCH)) {
      const f = this.queue.shift()!;
      this.queued -= f.length;
      parts.push(f);
      size += 4 + f.length;
    }
    const batch = new Uint8Array(size);
    const view = new DataView(batch.buffer);
    let at = 0;
    for (const f of parts) {
      view.setUint32(at, f.length);
      batch.set(f, at + 4);
      at += 4 + f.length;
    }
    if (this.sendMsg({ kind: 'relay', s: this.seq, d: b64(batch) })) {
      this.seq += 1;
      this.bytesOut += size;
      this.lastSent = Date.now();
    } else {
      // No relay up right now: put the frames back in front.
      this.queue.unshift(...parts);
      this.queued += size - 4 * parts.length;
    }
  }

  /** Hand over every in-order batch; wait a little for a missing one, then skip it. */
  private drain(): void {
    while (this.held.has(this.next)) {
      const batch = this.held.get(this.next)!;
      this.held.delete(this.next);
      this.next += 1;
      this.deliver(batch);
      if (this.state !== 'open') return;
    }
    if (this.gapTimer) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
    if (this.held.size) {
      this.gapTimer = setTimeout(() => {
        this.gapTimer = null;
        this.next = Math.min(...this.held.keys());
        this.drain();
      }, GAP_MS);
    }
  }

  private deliver(batch: Uint8Array): void {
    const view = new DataView(batch.buffer, batch.byteOffset, batch.byteLength);
    let at = 0;
    while (at + 4 <= batch.length) {
      const len = view.getUint32(at);
      if (at + 4 + len > batch.length) return;
      this.bytesIn += len;
      this.on.message(batch.slice(at + 4, at + 4 + len));
      at += 4 + len;
    }
  }

  private shutdown(state: 'closed' | 'failed', reason: string): void {
    if (this.state === 'closed' || this.state === 'failed') return;
    this.state = state;
    for (const t of [this.helloTimer, this.sendTimer]) if (t) clearInterval(t);
    for (const t of [this.openTimer, this.gapTimer]) if (t) clearTimeout(t);
    this.helloTimer = this.sendTimer = null;
    this.openTimer = this.gapTimer = null;
    this.queue = [];
    this.queued = 0;
    this.held.clear();
    this.on.close(reason);
  }
}
