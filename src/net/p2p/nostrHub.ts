/**
 * A public Nostr relay used as a hub (`nostr+wss://relay.example`).
 *
 * Works like a review-host hub: it only introduces peers and passes their
 * WebRTC handshakes; board data never touches it. It exists because a
 * self-hosted or Cloudflare hub is not reachable everywhere (some networks
 * block `*.workers.dev`), while big public relays usually are, and need no
 * account.
 *
 * Messages are ephemeral events (kind 21078: relays forward them and keep
 * nothing). The room is a SHA-256 tag, and every payload is AES-GCM sealed
 * with a key derived from the room name, so the relay and its other users
 * see neither the board id nor any address in the handshake. Each peer says
 * `hi` on joining and every HEARTBEAT_MS; one not heard for PEER_TTL_MS is
 * gone. A `bye` on close makes leaving immediate.
 */

import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { HubEvents, SignalHub } from './hub';
import type { HubSource, HubState } from './types';

export const NOSTR_SCHEME = 'nostr+';
const KIND = 21078;
// Public relays rate-limit per IP; a slow heartbeat keeps well under that.
const HEARTBEAT_MS = 25_000;
const PEER_TTL_MS = 80_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

type Msg = { f: string; k: 'hi' | 'bye' | 'sig'; t?: string; d?: unknown };

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Room tag and payload key; same on every peer that knows the board. */
async function roomSecrets(room: string): Promise<{ topic: string; key: CryptoKey }> {
  const topic = bytesToHex(sha256(enc.encode(`review-room:${room}`)));
  const raw = sha256(enc.encode(`review-key:${room}`));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { topic, key };
}

export class NostrHub implements SignalHub {
  state: HubState = 'connecting';
  name: string | null;
  error: string | null = null;
  readonly peers = new Set<string>();

  private ws: WebSocket | null = null;
  private readonly seen = new Map<string, number>();
  private readonly secretKey = schnorr.utils.randomSecretKey();
  private readonly pubkey = bytesToHex(schnorr.getPublicKey(this.secretKey));
  private secrets: Promise<{ topic: string; key: CryptoKey }>;
  /** Keeps outgoing and incoming payloads in order across async crypto. */
  private outQueue: Promise<unknown> = Promise.resolve();
  private inQueue: Promise<unknown> = Promise.resolve();
  private beatTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private closed = false;

  constructor(
    readonly url: string,
    readonly source: HubSource,
    room: string,
    private readonly self: string,
    private readonly on: HubEvents,
  ) {
    this.name = 'nostr';
    this.secrets = roomSecrets(room);
    this.open();
  }

  send(to: string, data: unknown): boolean {
    if (this.state !== 'open' || !this.ws) return false;
    this.publish({ f: this.self, k: 'sig', t: to, d: data });
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.state === 'open') this.publish({ f: this.self, k: 'bye' });
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    // Let the bye go out before the socket closes.
    void this.outQueue.finally(() => {
      if (!ws) return;
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
      try { ws.close(1000, 'bye'); } catch { /* ignore */ }
    });
    this.peers.clear();
    this.seen.clear();
  }

  retryNow(): void {
    if (this.closed || this.state === 'open') return;
    this.clearTimers();
    this.attempt = 0;
    this.open();
  }

  private open(): void {
    if (this.closed) return;
    this.state = this.attempt === 0 ? 'connecting' : 'retrying';
    this.on.state();
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url.slice(NOSTR_SCHEME.length));
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      void this.secrets.then(({ topic }) => {
        if (this.ws !== ws) return;
        const since = Math.floor(Date.now() / 1000) - 10;
        ws.send(JSON.stringify(['REQ', 'review', { kinds: [KIND], '#t': [topic], since }]));
        this.state = 'open';
        this.error = null;
        this.attempt = 0;
        this.on.welcome([]);
        this.on.state();
        this.publish({ f: this.self, k: 'hi' });
        this.beatTimer = setInterval(() => this.beat(), HEARTBEAT_MS);
      });
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') this.handle(ev.data);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.beatTimer) { clearInterval(this.beatTimer); this.beatTimer = null; }
      this.dropAll();
      if (this.state !== 'open') this.error = this.error ?? 'unreachable';
      this.scheduleRetry();
    };
    ws.onerror = () => {
      this.error = 'unreachable';
    };
  }

  private beat(): void {
    this.publish({ f: this.self, k: 'hi' });
    const now = Date.now();
    for (const [peer, at] of this.seen) {
      if (now - at > PEER_TTL_MS) this.lose(peer);
    }
  }

  private publish(msg: Msg): void {
    const ws = this.ws;
    this.outQueue = this.outQueue
      .then(async () => {
        const { topic, key } = await this.secrets;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const sealed = new Uint8Array(
          await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(msg))),
        );
        const body = new Uint8Array(iv.length + sealed.length);
        body.set(iv);
        body.set(sealed, iv.length);
        const created_at = Math.floor(Date.now() / 1000);
        const tags = [['t', topic]];
        const content = b64(body);
        const id = sha256(enc.encode(JSON.stringify([0, this.pubkey, created_at, KIND, tags, content])));
        const event = {
          id: bytesToHex(id),
          pubkey: this.pubkey,
          created_at,
          kind: KIND,
          tags,
          content,
          sig: bytesToHex(schnorr.sign(id, this.secretKey)),
        };
        ws?.send(JSON.stringify(['EVENT', event]));
      })
      .catch(() => { /* socket gone; the close handler retries */ });
  }

  private handle(text: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(frame)) return;
    if (frame[0] === 'OK' && frame[2] === false) {
      this.error = typeof frame[3] === 'string' ? frame[3] : 'rejected';
      this.on.state();
      return;
    }
    if (frame[0] === 'CLOSED') {
      this.error = typeof frame[2] === 'string' ? frame[2] : 'closed';
      this.on.state();
      return;
    }
    if (frame[0] !== 'EVENT') return;
    const event = frame[2] as { pubkey?: unknown; content?: unknown } | undefined;
    if (!event || event.pubkey === this.pubkey || typeof event.content !== 'string') return;
    const content = event.content;
    this.inQueue = this.inQueue
      .then(async () => {
        const { key } = await this.secrets;
        const body = unb64(content);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: body.subarray(0, 12) }, key, body.subarray(12));
        this.receive(JSON.parse(dec.decode(plain)) as Msg);
      })
      .catch(() => { /* not ours or damaged */ });
  }

  private receive(msg: Msg): void {
    if (this.closed || !msg || typeof msg.f !== 'string' || msg.f === this.self) return;
    const peer = msg.f;
    if (msg.k === 'bye') {
      this.lose(peer);
      return;
    }
    const isNew = !this.seen.has(peer);
    this.seen.set(peer, Date.now());
    if (isNew) {
      this.peers.add(peer);
      this.on.join(peer);
      this.on.state();
      // Answer a newcomer at once instead of on the next heartbeat.
      if (msg.k === 'hi') this.publish({ f: this.self, k: 'hi' });
    }
    if (msg.k === 'sig' && msg.t === this.self) this.on.signal(peer, msg.d);
  }

  private lose(peer: string): void {
    this.seen.delete(peer);
    if (this.peers.delete(peer)) {
      this.on.leave(peer);
      this.on.state();
    }
  }

  private dropAll(): void {
    for (const p of [...this.peers]) this.lose(p);
    this.seen.clear();
  }

  private scheduleRetry(): void {
    if (this.closed) return;
    const delay = Math.min(RETRY_BASE_MS * 2 ** this.attempt, RETRY_MAX_MS);
    this.attempt += 1;
    this.state = 'retrying';
    this.on.state();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private clearTimers(): void {
    if (this.beatTimer) { clearInterval(this.beatTimer); this.beatTimer = null; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }
}
