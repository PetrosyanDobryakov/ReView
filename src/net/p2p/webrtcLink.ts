/**
 * PeerLink over one RTCPeerConnection + one ordered `review` data channel.
 *
 * Roles are fixed per pair so offers never collide: the peer with the smaller
 * id is the initiator and sends the offer; the other side answers. Each
 * attempt carries a session id (`sid`) so late ICE from a dead attempt is
 * ignored instead of poisoning the new one.
 */

import { Frame, randomPeerId } from './protocol';
import type { LinkEvents, LinkPath, LinkState, PeerLink } from './types';

const OPEN_TIMEOUT_MS = 20_000;
const DISCONNECT_GRACE_MS = 8_000;
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 512 * 1024;
/**
 * Cap on queued bulk bytes. Past it bulk frames are refused: the receiver
 * skips the gap and a later resync heals it. Sized to fit the reassembler's
 * allowance so one huge catch-up message can still land whole.
 */
const MAX_BULK_BYTES = 64 * 1024 * 1024;
/**
 * Hot lane holds liveness only (latest-wins awareness, small live updates):
 * shed oldest awareness past this, refuse the rest. A big sync behind live
 * traffic must never delay the live feeling.
 */
const MAX_HOT_BYTES = 256 * 1024;
/** Frame types that ride the hot lane when they fit one frame (liveness, not bulk). */
const HOT_FRAMES = new Set<number>([
  Frame.Awareness,
  Frame.Ping,
  Frame.Pong,
  Frame.Hello,
  0x07, // NEIGHBORS (mesh-level gossip, defined in mesh.ts)
  Frame.Sync, // single-frame live updates only; chunked bulk rides bulk
  Frame.BlobWant,
  Frame.BlobMiss,
]);

type SignalMsg =
  | { kind: 'offer'; sid: string; sdp: string }
  | { kind: 'answer'; sid: string; sdp: string }
  | { kind: 'ice'; sid: string; candidate: RTCIceCandidateInit };

export function webrtcAvailable(): boolean {
  return typeof RTCPeerConnection === 'function';
}

export function isInitiator(self: string, other: string): boolean {
  return self < other;
}

function parseSignal(raw: unknown): SignalMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.sid !== 'string' || !m.sid) return null;
  if (m.kind === 'offer' && typeof m.sdp === 'string') return { kind: 'offer', sid: m.sid, sdp: m.sdp };
  if (m.kind === 'answer' && typeof m.sdp === 'string') return { kind: 'answer', sid: m.sid, sdp: m.sdp };
  if (m.kind === 'ice' && m.candidate && typeof m.candidate === 'object') {
    return { kind: 'ice', sid: m.sid, candidate: m.candidate as RTCIceCandidateInit };
  }
  return null;
}

export class WebRtcLink implements PeerLink {
  state: LinkState = 'connecting';
  path: LinkPath = 'unknown';
  bytesIn = 0;
  bytesOut = 0;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private sid: string | null = null;
  private remoteSet = false;
  private pendingIce: RTCIceCandidateInit[] = [];
  /** Hot lane (liveness) and bulk lane (chunked sync/media), in FIFO order each. */
  private hot: Uint8Array[] = [];
  private bulk: Uint8Array[] = [];
  private hotBytes = 0;
  private bulkBytes = 0;
  /** Queued awareness frames shed under load (idempotent, latest wins). */
  droppedAwareness = 0;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly peer: string,
    private readonly initiator: boolean,
    private readonly iceServers: RTCIceServer[],
    private readonly on: LinkEvents,
  ) {
    this.openTimer = setTimeout(() => this.fail('timeout'), OPEN_TIMEOUT_MS);
    if (initiator) void this.offer();
  }

  readonly iceLocal = new Set<string>();
  readonly iceRemote = new Set<string>();

  get buffered(): number {
    return (this.dc?.bufferedAmount ?? 0) + this.hotBytes + this.bulkBytes;
  }

  /** Chunked (multi-frame) messages ride bulk; single frames ride hot. */
  private isHot(frame: Uint8Array): boolean {
    if (frame.length === 0) return true;
    if (frame[0] === Frame.Chunk) return false;
    return HOT_FRAMES.has(frame[0]!);
  }

  send(frame: Uint8Array): boolean {
    const dc = this.dc;
    if (this.state !== 'open' || !dc || dc.readyState !== 'open') return false;
    if (this.isHot(frame)) return this.sendHot(frame);
    if (!this.hot.length && !this.bulk.length && dc.bufferedAmount <= HIGH_WATER) {
      return this.write(frame);
    }
    if (this.bulkBytes + frame.length > MAX_BULK_BYTES) return false;
    this.bulk.push(frame);
    this.bulkBytes += frame.length;
    return true;
  }

  /**
   * Liveness first: shed the oldest queued awareness when over the hot cap
   * (dropped cursors are re-sent on the next packet anyway), refuse the rest.
   * Awareness always reports sent — it is idempotent, latest wins.
   */
  private sendHot(frame: Uint8Array): boolean {
    const dc = this.dc;
    const isAware = frame.length > 0 && frame[0] === Frame.Awareness;
    if (this.hot.length || (dc && dc.bufferedAmount > HIGH_WATER)) {
      let over = this.hotBytes + frame.length - MAX_HOT_BYTES;
      for (let i = 0; i < this.hot.length && over > 0; i++) {
        const q = this.hot[i];
        if (q.length > 0 && q[0] === Frame.Awareness) {
          this.hotBytes -= q.length;
          over -= q.length;
          this.hot.splice(i, 1);
          i--;
          this.droppedAwareness += 1;
        }
      }
      if (this.hotBytes + frame.length > MAX_HOT_BYTES) {
        if (isAware) this.droppedAwareness += 1;
        return isAware;
      }
      this.hot.push(frame);
      this.hotBytes += frame.length;
      return true;
    }
    return this.write(frame);
  }

  signal(raw: unknown): void {
    const msg = parseSignal(raw);
    if (!msg || this.state === 'closed' || this.state === 'failed') return;
    if (msg.kind === 'offer') {
      if (this.initiator) return;
      if (msg.sid !== this.sid) this.resetPc(msg.sid);
      void this.answer(msg.sdp);
      return;
    }
    if (msg.sid !== this.sid) return;
    if (msg.kind === 'ice') {
      const typ = /\btyp (\w+)/.exec(msg.candidate?.candidate ?? '')?.[1];
      if (typ) this.iceRemote.add(typ);
    }
    if (msg.kind === 'answer') {
      if (!this.initiator || !this.pc || this.remoteSet) return;
      void this.pc
        .setRemoteDescription({ type: 'answer', sdp: msg.sdp })
        .then(() => this.remoteReady())
        .catch((e) => this.fail(`answer: ${String(e)}`));
      return;
    }
    if (!this.remoteSet) {
      this.pendingIce.push(msg.candidate);
      return;
    }
    void this.pc?.addIceCandidate(msg.candidate).catch(() => {});
  }

  close(): void {
    this.shutdown('closed', 'closed');
  }

  private fail(reason: string): void {
    this.shutdown('failed', reason);
  }

  private shutdown(state: 'closed' | 'failed', reason: string): void {
    if (this.state === 'closed' || this.state === 'failed') return;
    this.state = state;
    this.clearTimers();
    this.teardownPc();
    this.hot = [];
    this.bulk = [];
    this.hotBytes = 0;
    this.bulkBytes = 0;
    this.droppedAwareness = 0;
    this.on.close(reason);
  }

  private resetPc(sid: string): void {
    this.teardownPc();
    this.sid = sid;
    this.remoteSet = false;
    this.pendingIce = [];
    // `localStorage.REVIEW_ICE_RELAY = '1'`: TURN only (tests, diagnosing a relay).
    let relayOnly = false;
    try { relayOnly = localStorage.getItem('REVIEW_ICE_RELAY') === '1'; } catch { /* no storage */ }
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, ...(relayOnly ? { iceTransportPolicy: 'relay' as const } : {}) });
    this.pc = pc;
    pc.onicecandidate = (ev) => {
      if (this.pc !== pc || !ev.candidate) return;
      if (ev.candidate.type) this.iceLocal.add(ev.candidate.type);
      this.on.signal({ kind: 'ice', sid, candidate: ev.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      const s = pc.connectionState;
      if (s === 'failed') this.fail('ice failed');
      else if (s === 'disconnected') {
        if (!this.graceTimer) {
          this.graceTimer = setTimeout(() => {
            this.graceTimer = null;
            if (this.pc === pc && pc.connectionState !== 'connected') this.fail('disconnected');
          }, DISCONNECT_GRACE_MS);
        }
      } else if (s === 'connected' && this.graceTimer) {
        clearTimeout(this.graceTimer);
        this.graceTimer = null;
      }
    };
    pc.ondatachannel = (ev) => {
      if (this.pc !== pc || this.initiator) return;
      this.bindChannel(ev.channel);
    };
  }

  private async offer(): Promise<void> {
    try {
      this.resetPc(randomPeerId());
      const pc = this.pc!;
      const sid = this.sid!;
      this.bindChannel(pc.createDataChannel('review', { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      if (this.pc !== pc) return;
      this.on.signal({ kind: 'offer', sid, sdp: pc.localDescription?.sdp ?? '' });
    } catch (e) {
      this.fail(`offer: ${String(e)}`);
    }
  }

  private async answer(sdp: string): Promise<void> {
    const pc = this.pc;
    const sid = this.sid;
    if (!pc || !sid) return;
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await this.remoteReady();
      await pc.setLocalDescription(await pc.createAnswer());
      if (this.pc !== pc) return;
      this.on.signal({ kind: 'answer', sid, sdp: pc.localDescription?.sdp ?? '' });
    } catch (e) {
      this.fail(`answer: ${String(e)}`);
    }
  }

  private async remoteReady(): Promise<void> {
    this.remoteSet = true;
    const pending = this.pendingIce;
    this.pendingIce = [];
    for (const c of pending) {
      try { await this.pc?.addIceCandidate(c); } catch { /* stale candidate */ }
    }
  }

  private bindChannel(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = LOW_WATER;
    dc.onopen = () => {
      if (this.dc !== dc) return;
      this.state = 'open';
      if (this.openTimer) { clearTimeout(this.openTimer); this.openTimer = null; }
      void this.readPath();
      this.on.open();
    };
    dc.onmessage = (ev) => {
      if (this.dc !== dc) return;
      const data = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : null;
      if (!data) return;
      this.bytesIn += data.length;
      this.on.message(data);
    };
    dc.onbufferedamountlow = () => this.drain();
    dc.onclose = () => {
      if (this.dc === dc) this.shutdown('closed', 'channel closed');
    };
  }

  private write(frame: Uint8Array): boolean {
    try {
      this.dc!.send(frame as Uint8Array<ArrayBuffer>);
      this.bytesOut += frame.length;
      return true;
    } catch {
      this.fail('send');
      return false;
    }
  }

  private drain(): void {
    const dc = this.dc;
    if (!dc || dc.readyState !== 'open') return;
    // Liveness first: a big sync behind a cursor must not delay the live feeling.
    while (this.hot.length && dc.bufferedAmount <= HIGH_WATER) {
      const next = this.hot.shift()!;
      this.hotBytes -= next.length;
      if (!this.write(next)) return;
    }
    while (this.bulk.length && dc.bufferedAmount <= HIGH_WATER) {
      const next = this.bulk.shift()!;
      this.bulkBytes -= next.length;
      if (!this.write(next)) return;
    }
  }

  /** Which ICE pair won: same LAN, through NAT, or a user TURN relay. */
  private async readPath(): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    try {
      const stats = await pc.getStats();
      let pairId: string | null = null;
      stats.forEach((s) => {
        const r = s as { type: string; selectedCandidatePairId?: string };
        if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
      });
      let local: string | null = null;
      stats.forEach((s) => {
        const r = s as { type: string; id: string; state?: string; nominated?: boolean; localCandidateId?: string };
        if (r.type !== 'candidate-pair') return;
        if (pairId ? r.id === pairId : r.state === 'succeeded' && r.nominated) local = r.localCandidateId ?? null;
      });
      if (!local) return;
      const cand = stats.get(local) as { candidateType?: string } | undefined;
      const t = cand?.candidateType;
      this.path = t === 'host' ? 'lan' : t === 'relay' ? 'relay' : t ? 'direct' : 'unknown';
    } catch {
      /* stats are best effort */
    }
  }

  private teardownPc(): void {
    const dc = this.dc;
    this.dc = null;
    if (dc) {
      dc.onopen = dc.onmessage = dc.onclose = dc.onbufferedamountlow = null;
      try { dc.close(); } catch { /* ignore */ }
    }
    const pc = this.pc;
    this.pc = null;
    if (pc) {
      pc.onicecandidate = pc.onconnectionstatechange = pc.ondatachannel = null;
      try { pc.close(); } catch { /* ignore */ }
    }
  }

  private clearTimers(): void {
    if (this.openTimer) { clearTimeout(this.openTimer); this.openTimer = null; }
    if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = null; }
  }
}
