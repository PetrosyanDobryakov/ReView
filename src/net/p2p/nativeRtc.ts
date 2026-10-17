/**
 * `RTCPeerConnection` / `RTCDataChannel` for webviews that ship without
 * WebRTC (Ubuntu/Debian WebKitGTK), backed by webrtc-rs in the desktop app
 * (`src-tauri/src/rtc.rs`). It covers exactly the surface the mesh uses
 * (`webrtcLink.ts`) plus what a plain loopback test needs; it is not a
 * general WebRTC implementation.
 *
 * Installed only inside the desktop app and only when the webview has no
 * `RTCPeerConnection` of its own.
 */

import { Channel, invoke } from '@tauri-apps/api/core';

const EV_JSON = 0;
const EV_BINARY = 1;
const EV_TEXT = 2;

let nextPc = 1;
let nextChannel = 1;

type IceServerInit = { urls: string | string[]; username?: string; credential?: string };
type Desc = { type: 'offer' | 'answer'; sdp: string };
type IceInit = { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null };

class NativeIceCandidate {
  readonly candidate: string;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number | null;
  constructor(init: IceInit) {
    this.candidate = init.candidate;
    this.sdpMid = init.sdpMid ?? null;
    this.sdpMLineIndex = init.sdpMLineIndex ?? 0;
  }
  toJSON(): IceInit {
    return { candidate: this.candidate, sdpMid: this.sdpMid, sdpMLineIndex: this.sdpMLineIndex };
  }
}

export class NativeDataChannel {
  binaryType: 'arraybuffer' | 'blob' = 'arraybuffer';
  readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting';
  bufferedAmount = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onbufferedamountlow: ((ev: Event) => void) | null = null;
  private threshold = 0;

  constructor(
    private readonly pc: NativePeerConnection,
    readonly id: number,
    readonly label: string,
    readonly ordered: boolean,
  ) {}

  get bufferedAmountLowThreshold(): number {
    return this.threshold;
  }

  set bufferedAmountLowThreshold(n: number) {
    this.threshold = n;
    this.pc.queue(() => invoke('rtc_set_low_threshold', { id: this.pc.id, channel: this.id, threshold: n }));
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== 'open') throw new DOMException('channel not open', 'InvalidStateError');
    const text = typeof data === 'string';
    const bytes = text
      ? new TextEncoder().encode(data)
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.bufferedAmount += bytes.length;
    const headers: Record<string, string> = { 'x-rtc-id': String(this.pc.id), 'x-rtc-channel': String(this.id) };
    if (text) headers['x-rtc-text'] = '1';
    // Copy: the caller may reuse its buffer, and IPC takes ownership.
    const body = bytes.slice();
    this.pc.queue(async () => {
      const buffered = await invoke<number>('rtc_send', body, { headers });
      this.bufferedAmount = buffered;
    });
  }

  close(): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closing';
    this.pc.queue(() => invoke('rtc_close_channel', { id: this.pc.id, channel: this.id }));
  }

  /** Called by the connection for events addressed to this channel. */
  dispatch(kind: 'open' | 'close' | 'low'): void {
    if (kind === 'open') {
      this.readyState = 'open';
      this.onopen?.(new Event('open'));
    } else if (kind === 'close') {
      if (this.readyState === 'closed') return;
      this.readyState = 'closed';
      this.onclose?.(new Event('close'));
    } else {
      this.bufferedAmount = Math.min(this.bufferedAmount, this.threshold);
      this.onbufferedamountlow?.(new Event('bufferedamountlow'));
    }
  }

  deliver(data: Uint8Array, text: boolean): void {
    const payload = text
      ? new TextDecoder().decode(data)
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    this.onmessage?.(new MessageEvent('message', { data: payload }));
  }
}

export class NativePeerConnection {
  readonly id = nextPc++;
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: Desc | null = null;
  remoteDescription: Desc | null = null;
  onicecandidate: ((ev: { candidate: NativeIceCandidate | null }) => void) | null = null;
  onconnectionstatechange: ((ev: Event) => void) | null = null;
  ondatachannel: ((ev: { channel: NativeDataChannel }) => void) | null = null;

  private readonly channels = new Map<number, NativeDataChannel>();
  /** Every bridge call runs in order, after creation finished. */
  private chain: Promise<unknown>;
  private closed = false;

  constructor(config?: { iceServers?: IceServerInit[] }) {
    const iceServers = (config?.iceServers ?? []).map((s) => ({
      urls: Array.isArray(s.urls) ? s.urls : [s.urls],
      username: s.username ?? null,
      credential: s.credential ?? null,
    }));
    const events = new Channel<ArrayBuffer>();
    events.onmessage = (msg) => this.onEvent(new Uint8Array(msg));
    this.chain = invoke('rtc_create', { id: this.id, iceServers, events });
  }

  /** Run `fn` after every earlier bridge call; returns its result. */
  queue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => {});
    return next;
  }

  createDataChannel(label: string, init?: { ordered?: boolean }): NativeDataChannel {
    const dc = new NativeDataChannel(this, nextChannel++, label, init?.ordered !== false);
    this.channels.set(dc.id, dc);
    void this.queue(() =>
      invoke('rtc_create_data_channel', { id: this.id, channel: dc.id, label, ordered: dc.ordered }),
    );
    return dc;
  }

  async createOffer(): Promise<Desc> {
    const sdp = await this.queue(() => invoke<string>('rtc_create_offer', { id: this.id }));
    return { type: 'offer', sdp };
  }

  async createAnswer(): Promise<Desc> {
    const sdp = await this.queue(() => invoke<string>('rtc_create_answer', { id: this.id }));
    return { type: 'answer', sdp };
  }

  async setLocalDescription(desc: Desc): Promise<void> {
    const sdp = await this.queue(() => invoke<string>('rtc_set_local', { id: this.id, kind: desc.type, sdp: desc.sdp }));
    this.localDescription = { type: desc.type, sdp: sdp || desc.sdp };
  }

  async setRemoteDescription(desc: Desc): Promise<void> {
    await this.queue(() => invoke('rtc_set_remote', { id: this.id, kind: desc.type, sdp: desc.sdp }));
    this.remoteDescription = { type: desc.type, sdp: desc.sdp };
  }

  async addIceCandidate(c: IceInit | NativeIceCandidate | null): Promise<void> {
    if (!c || !c.candidate) return;
    const init = c instanceof NativeIceCandidate ? c.toJSON() : c;
    await this.queue(() =>
      invoke('rtc_add_ice', {
        id: this.id,
        candidate: {
          candidate: init.candidate,
          sdpMid: init.sdpMid ?? null,
          sdpMLineIndex: init.sdpMLineIndex ?? 0,
          usernameFragment: init.usernameFragment ?? null,
        },
      }),
    );
  }

  /** Just enough of `getStats()` for `webrtcLink.readPath`. */
  async getStats(): Promise<Map<string, Record<string, unknown>>> {
    const kind = await this.queue(() => invoke<string | null>('rtc_path', { id: this.id }));
    const stats = new Map<string, Record<string, unknown>>();
    if (kind) {
      stats.set('T', { id: 'T', type: 'transport', selectedCandidatePairId: 'P' });
      stats.set('P', { id: 'P', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'L' });
      stats.set('L', { id: 'L', type: 'local-candidate', candidateType: kind });
    }
    return stats;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connectionState = 'closed';
    for (const dc of this.channels.values()) dc.dispatch('close');
    void this.queue(() => invoke('rtc_close', { id: this.id }));
  }

  private onEvent(frame: Uint8Array): void {
    if (this.closed || frame.length === 0) return;
    const kind = frame[0];
    if (kind === EV_BINARY || kind === EV_TEXT) {
      if (frame.length < 5) return;
      const cid = new DataView(frame.buffer, frame.byteOffset + 1, 4).getUint32(0);
      this.channels.get(cid)?.deliver(frame.subarray(5), kind === EV_TEXT);
      return;
    }
    if (kind !== EV_JSON) return;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(new TextDecoder().decode(frame.subarray(1))) as Record<string, unknown>;
    } catch {
      return;
    }
    const cid = typeof ev.channel === 'number' ? ev.channel : -1;
    switch (ev.t) {
      case 'ice': {
        const c = ev.candidate as IceInit | null;
        this.onicecandidate?.({ candidate: c ? new NativeIceCandidate(c) : null });
        return;
      }
      case 'state':
        this.connectionState = String(ev.state) as RTCPeerConnectionState;
        this.onconnectionstatechange?.(new Event('connectionstatechange'));
        return;
      case 'datachannel': {
        const dc = new NativeDataChannel(this, cid, String(ev.label ?? ''), ev.ordered !== false);
        this.channels.set(cid, dc);
        this.ondatachannel?.({ channel: dc });
        return;
      }
      case 'open':
      case 'close':
      case 'low':
        this.channels.get(cid)?.dispatch(ev.t);
        return;
      default:
        return;
    }
  }
}

/** Install the polyfill when running in the desktop app without native WebRTC. */
export function installNativeRtc(): boolean {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return false;
  if (typeof (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection === 'function') return false;
  (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = NativePeerConnection;
  (globalThis as unknown as { RTCIceCandidate: unknown }).RTCIceCandidate = NativeIceCandidate;
  (globalThis as unknown as { __reviewNativeRtc?: boolean }).__reviewNativeRtc = true;
  return true;
}
