/**
 * One signaling socket to one hub (`<base>/signal/<room>?peer=<id>`).
 * See `rust/review-host/src/hub.rs` for the wire format.
 */

import { NOSTR_SCHEME, NostrHub } from './nostrHub';
import type { HubSource, HubState } from './types';

export const HUB_PROTO = 1;

const PING_MS = 20_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

export type HubEvents = {
  /** Fresh roster after (re)connect. */
  welcome(peers: string[]): void;
  join(peer: string): void;
  leave(peer: string): void;
  signal(from: string, data: unknown): void;
  gone(peer: string): void;
  state(): void;
};

/** What the mesh needs from a hub: a review-host socket or a Nostr relay. */
export interface SignalHub {
  readonly url: string;
  readonly source: HubSource;
  state: HubState;
  name: string | null;
  error: string | null;
  readonly peers: Set<string>;
  send(to: string, data: unknown): boolean;
  close(): void;
  retryNow(): void;
}

export function openHub(url: string, source: HubSource, room: string, self: string, on: HubEvents): SignalHub {
  return url.startsWith(NOSTR_SCHEME)
    ? new NostrHub(url, source, room, self, on)
    : new HubConnection(url, source, room, self, on);
}

/**
 * Normalize what a user types (`192.168.1.5:1234`, `http://x`, `wss://x/`) to a
 * hub base. `nostr+wss://relay` (or `nostr:relay`) is a public Nostr relay.
 */
export function normalizeHubUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  const nostr = s.match(/^nostr(?:\+|:\/*)(.+)$/i);
  if (nostr) {
    const inner = normalizeHubUrl(/^wss?:\/\//i.test(nostr[1]!) ? nostr[1]! : `wss://${nostr[1]}`);
    return inner ? `${NOSTR_SCHEME}${inner}` : null;
  }
  if (/^https?:\/\//i.test(s)) s = s.replace(/^http/i, 'ws');
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^wss?:\/\//i.test(s)) return null;
  if (!/^wss?:\/\//i.test(s)) s = `ws://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null;
    if (!u.hostname) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** An https page may not open ws:// to anything but loopback (mixed content). */
export function hubBlockedByMixedContent(url: string, pageProtocol: string): boolean {
  if (pageProtocol !== 'https:') return false;
  if (!url.startsWith('ws://')) return false;
  try {
    const h = new URL(url).hostname;
    return !(h === 'localhost' || h === '127.0.0.1' || h === '[::1]');
  } catch {
    return true;
  }
}

export class HubConnection implements SignalHub {
  state: HubState = 'connecting';
  name: string | null = null;
  error: string | null = null;
  readonly peers = new Set<string>();

  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private closed = false;

  constructor(
    readonly url: string,
    readonly source: HubSource,
    private readonly room: string,
    private readonly self: string,
    private readonly on: HubEvents,
  ) {
    const proto = typeof location !== 'undefined' ? location.protocol : 'http:';
    if (hubBlockedByMixedContent(url, proto)) {
      this.state = 'blocked';
      this.error = 'mixed-content';
      return;
    }
    this.open();
  }

  send(to: string, data: unknown): boolean {
    if (this.state !== 'open' || !this.ws) return false;
    try {
      this.ws.send(JSON.stringify({ t: 'signal', to, data }));
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
      try { ws.close(1000, 'bye'); } catch { /* ignore */ }
    }
    this.peers.clear();
  }

  /** Skip the backoff (user pressed reconnect, network came back). */
  retryNow(): void {
    if (this.closed || this.state === 'open' || this.state === 'blocked') return;
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
      ws = new WebSocket(
        `${this.url}/signal/${encodeURIComponent(this.room)}?peer=${encodeURIComponent(this.self)}`,
      );
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') this.handle(ev.data);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      const lost = [...this.peers];
      this.peers.clear();
      for (const p of lost) this.on.leave(p);
      if (ev.code === 4429) this.error = ev.reason || 'refused';
      else if (this.state !== 'open') this.error = this.error ?? 'unreachable';
      this.scheduleRetry();
    };
    ws.onerror = () => {
      this.error = 'unreachable';
    };
  }

  private handle(text: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    const peer = typeof msg.peer === 'string' ? msg.peer : '';
    switch (msg.t) {
      case 'welcome': {
        if (msg.proto !== HUB_PROTO) {
          this.error = `proto ${String(msg.proto)}`;
          this.state = 'error';
          this.closed = true;
          try { this.ws?.close(1000, 'proto'); } catch { /* ignore */ }
          this.on.state();
          return;
        }
        this.state = 'open';
        this.error = null;
        this.attempt = 0;
        this.name = typeof msg.host === 'string' ? msg.host : null;
        this.peers.clear();
        const list = Array.isArray(msg.peers) ? msg.peers.filter((p): p is string => typeof p === 'string') : [];
        for (const p of list) if (p !== this.self) this.peers.add(p);
        this.startPing();
        this.on.welcome([...this.peers]);
        this.on.state();
        return;
      }
      case 'join':
        if (peer && peer !== this.self) {
          this.peers.add(peer);
          this.on.join(peer);
          this.on.state();
        }
        return;
      case 'leave':
        if (this.peers.delete(peer)) {
          this.on.leave(peer);
          this.on.state();
        }
        return;
      case 'signal':
        if (typeof msg.from === 'string') this.on.signal(msg.from, msg.data);
        return;
      case 'gone':
        if (peer) {
          this.peers.delete(peer);
          this.on.gone(peer);
        }
        return;
      case 'error':
        this.error = typeof msg.error === 'string' ? msg.error : 'error';
        return;
      default:
        return;
    }
  }

  private startPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      try { this.ws?.send('{"t":"ping"}'); } catch { /* close handler retries */ }
    }, PING_MS);
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
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }
}
