/**
 * Optional WebSocket byte/type counters for [review:net] console diagnostics.
 * Default off — only runs while isNetLogEnabled().
 */

import { isNetLogEnabled, netLog } from './log';

export type WsTrafficDir = 'in' | 'out';

type Acc = {
  t0: number;
  inBytes: number;
  outBytes: number;
  inSync: number;
  inAware: number;
  inOther: number;
  outSync: number;
  outAware: number;
  outOther: number;
  maxIn: number;
  maxOut: number;
};

function emptyAcc(now: number): Acc {
  return {
    t0: now,
    inBytes: 0,
    outBytes: 0,
    inSync: 0,
    inAware: 0,
    inOther: 0,
    outSync: 0,
    outAware: 0,
    outOther: 0,
    maxIn: 0,
    maxOut: 0,
  };
}

/** Classify y-websocket binary frames (messageSync=0, messageAwareness=1). */
export function classifyWsPayload(data: unknown): { kind: 'sync' | 'awareness' | 'other'; bytes: number } {
  if (typeof data === 'string') return { kind: 'other', bytes: data.length };
  let u8: Uint8Array | null = null;
  if (data instanceof ArrayBuffer) u8 = new Uint8Array(data);
  else if (data instanceof Uint8Array) u8 = data;
  else if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView;
    u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  if (!u8) return { kind: 'other', bytes: 0 };
  const bytes = u8.byteLength;
  // Small message types encode as a single-byte varuint.
  if (bytes > 0 && u8[0]! < 128) {
    if (u8[0] === 0) return { kind: 'sync', bytes };
    if (u8[0] === 1) return { kind: 'awareness', bytes };
  }
  return { kind: 'other', bytes };
}

/**
 * Monkey-patch send + message on a live socket. Returns an unhook fn.
 * Safe to call repeatedly — skips if already tapped.
 */
export function tapWebSocketTraffic(ws: WebSocket | null | undefined): () => void {
  if (!ws || typeof ws.send !== 'function') return () => {};
  const marked = ws as WebSocket & { __reviewNetTap?: boolean };
  if (marked.__reviewNetTap) return () => {};
  marked.__reviewNetTap = true;

  let acc = emptyAcc(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const origSend = ws.send.bind(ws);

  const bump = (dir: WsTrafficDir, data: unknown) => {
    if (!isNetLogEnabled()) return;
    const { kind, bytes } = classifyWsPayload(data);
    if (dir === 'in') {
      acc.inBytes += bytes;
      acc.maxIn = Math.max(acc.maxIn, bytes);
      if (kind === 'sync') acc.inSync += 1;
      else if (kind === 'awareness') acc.inAware += 1;
      else acc.inOther += 1;
    } else {
      acc.outBytes += bytes;
      acc.maxOut = Math.max(acc.maxOut, bytes);
      if (kind === 'sync') acc.outSync += 1;
      else if (kind === 'awareness') acc.outAware += 1;
      else acc.outOther += 1;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - acc.t0 >= 1000) {
      netLog.info('ws traffic 1s', () => ({
        inBytes: acc.inBytes,
        outBytes: acc.outBytes,
        in: { sync: acc.inSync, awareness: acc.inAware, other: acc.inOther },
        out: { sync: acc.outSync, awareness: acc.outAware, other: acc.outOther },
        maxFrame: { in: acc.maxIn, out: acc.maxOut },
      }));
      acc = emptyAcc(now);
    }
  };

  ws.send = ((data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
    bump('out', data);
    return origSend(data as never);
  }) as WebSocket['send'];

  const onMessage = (ev: MessageEvent) => bump('in', ev.data);
  ws.addEventListener('message', onMessage);

  return () => {
    try {
      ws.removeEventListener('message', onMessage);
    } catch {
      /* */
    }
    try {
      ws.send = origSend;
    } catch {
      /* */
    }
    delete marked.__reviewNetTap;
  };
}
