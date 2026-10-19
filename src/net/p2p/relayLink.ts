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
 *
 * Two lanes: liveness frames (awareness/cursor/draft, ping, hello) jump ahead
 * of bulk sync/media in every batch, so a big update never starves the live
 * feeling even at 5 events a second.
 */

import type { LinkEvents, LinkPath, LinkState, PeerLink } from './types';
import { Frame } from './protocol.ts';

/** Raw bytes per relay event (base64 makes it ~4/3 of this). */
const MAX_BATCH = 24 * 1024;
/**
 * Hot lane per pump tick. Liveness frames are bytes-to-KBs, so 8 KiB is
 * effectively "all of them" while a hypothetical awareness flood can never
 * starve bulk sync behind it.
 */
const HOT_PER_TICK = 8 * 1024;
/** Frame types that ride the hot lane (liveness, not bulk). */
const HOT_FRAMES = new Set<number>([
  Frame.Awareness,
  Frame.Ping,
  Frame.Pong,
  Frame.Hello,
  0x07, // NEIGHBORS (mesh-level gossip, defined in mesh.ts)
]);
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

  /** Hot lane (liveness) and bulk lane (sync/media), in FIFO order each. */
  private hot: Uint8Array[] = [];
  private bulk: Uint8Array[] = [];
  private hotBytes = 0;
  private bulkBytes = 0;
  private seq = 0;
  private next = 0;
  private readonly held = new Map<number, Uint8Array>();
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private sendTimer: ReturnType<typeof setInterval> | null = null;
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHeard = Date.now();
  private lastSent = Date.now();
  /** Pump telemetry for diagnostics (cumulative, never reset except on destroy). */
  private statBatches = 0;
  private statHotBytes = 0;
  private statBulkBytes = 0;
  private statSendFailures = 0;

  readonly peer: string;
  private readonly sendMsg: (msg: RelayMsg) => boolean;
  private readonly on: LinkEvents;

  /** `send` delivers one message to the peer through the relays (false: no relay up). */
  constructor(peer: string, sendMsg: (msg: RelayMsg) => boolean, on: LinkEvents) {
    this.peer = peer;
    this.sendMsg = sendMsg;
    this.on = on;
    this.hello(false);
    this.helloTimer = setInterval(() => this.hello(false), HELLO_EVERY_MS);
    this.openTimer = setTimeout(() => this.shutdown('failed', 'relay timeout'), OPEN_TIMEOUT_MS);
    this.sendTimer = setInterval(() => this.pump(), SEND_INTERVAL_MS);
  }

  get buffered(): number {
    return this.hotBytes + this.bulkBytes;
  }

  /** Snapshot for diagnostics: what rode which lane, and what never left. */
  stats(): {
    batches: number;
    hotBytes: number;
    bulkBytes: number;
    sendFailures: number;
    queuedHot: number;
    queuedBulk: number;
  } {
    return {
      batches: this.statBatches,
      hotBytes: this.statHotBytes,
      bulkBytes: this.statBulkBytes,
      sendFailures: this.statSendFailures,
      queuedHot: this.hotBytes,
      queuedBulk: this.bulkBytes,
    };
  }

  send(frame: Uint8Array): boolean {
    if (this.state !== 'open') return false;
    // Hot lane first: a big sync behind a cursor must not delay liveness.
    if (frame.length > 0 && HOT_FRAMES.has(frame[0]!)) {
      this.hot.push(frame);
      this.hotBytes += frame.length;
    } else {
      this.bulk.push(frame);
      this.bulkBytes += frame.length;
    }
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

  /** Send one batch of queued frames, hot lane first, or a keepalive. */
  private pump(): void {
    if (this.state !== 'open') return;
    if (Date.now() - this.lastHeard > SILENT_MS) {
      this.shutdown('failed', 'relay silent');
      return;
    }
    if (!this.hot.length && !this.bulk.length) {
      if (Date.now() - this.lastSent > KEEPALIVE_MS) {
        this.lastSent = Date.now();
        this.sendMsg({ kind: 'relay-hello', open: true });
      }
      return;
    }
    const hotParts: Uint8Array[] = [];
    let hotSize = 0;
    while (this.hot.length && hotSize + 4 + this.hot[0]!.length <= HOT_PER_TICK) {
      const f = this.hot.shift()!;
      this.hotBytes -= f.length;
      hotParts.push(f);
      hotSize += 4 + f.length;
    }
    const bulkParts: Uint8Array[] = [];
    let bulkSize = 0;
    while (
      this.bulk.length &&
      (hotSize + bulkSize === 0 || hotSize + bulkSize + 4 + this.bulk[0]!.length <= MAX_BATCH)
    ) {
      const f = this.bulk.shift()!;
      this.bulkBytes -= f.length;
      bulkParts.push(f);
      bulkSize += 4 + f.length;
    }
    const parts = [...hotParts, ...bulkParts];
    const size = hotSize + bulkSize;
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
      this.statBatches += 1;
      this.statHotBytes += hotSize - 4 * hotParts.length;
      this.statBulkBytes += bulkSize - 4 * bulkParts.length;
      this.lastSent = Date.now();
    } else {
      // No relay up right now: put the frames back in front, lanes intact.
      this.statSendFailures += 1;
      this.hot.unshift(...hotParts);
      this.bulk.unshift(...bulkParts);
      this.hotBytes += hotSize - 4 * hotParts.length;
      this.bulkBytes += bulkSize - 4 * bulkParts.length;
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
    this.hot = [];
    this.bulk = [];
    this.hotBytes = 0;
    this.bulkBytes = 0;
    this.held.clear();
    this.on.close(reason);
  }
}
