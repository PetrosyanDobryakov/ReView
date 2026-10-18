/**
 * Peer wire format on the `review` data channel. Every message is binary:
 * one type byte, then the body. Bodies larger than one data-channel message
 * are split into CHUNK frames and reassembled before dispatch.
 *
 *   0x01 SYNC       y-protocols sync message (step1 / step2 / update)
 *   0x02 AWARENESS  y-protocols awareness update
 *   0x03 PING       u32 seq, f64 sent-at ms
 *   0x04 PONG       echo of the PING body
 *   0x05 HELLO      UTF-8 JSON {@link Hello}
 *   0x06 CHUNK      u32 msgId, u32 index, u32 total, slice of the inner message
 *   0x07 NEIGHBORS  UTF-8 JSON array of peer ids with open links (mesh.ts)
 *   0x08 BLOB_WANT  u32 req, 32-byte SHA-256 of the media bytes
 *   0x09 BLOB_PART  u32 req, u32 total, u32 offset, u8 mime length, mime, bytes
 *   0x0a BLOB_MISS  u32 req (the peer does not have it)
 *
 * Media bytes live outside the Yjs document, keyed by content hash; peers
 * fetch them from each other on demand and the receiver checks the hash.
 */

export const PEER_PROTO = 1;

export const Frame = {
  Sync: 0x01,
  Awareness: 0x02,
  Ping: 0x03,
  Pong: 0x04,
  Hello: 0x05,
  Chunk: 0x06,
  BlobWant: 0x08,
  BlobPart: 0x09,
  BlobMiss: 0x0a,
} as const;
export type Frame = (typeof Frame)[keyof typeof Frame];

/**
 * 16 KiB is the size every WebRTC stack interoperates on without SCTP
 * message interleaving surprises (Chrome, Firefox, Safari, WebKitGTK).
 */
export const MAX_FRAME = 16 * 1024;
const CHUNK_HEADER = 1 + 12;
const CHUNK_BODY = MAX_FRAME - CHUNK_HEADER;
/** Refuse to reassemble anything bigger (a board with large videos fits). */
export const MAX_MESSAGE = 256 * 1024 * 1024;

export type Hello = {
  proto: number;
  /** App semver, for the P2P panel only. */
  app: string;
};

export function frame(type: Frame, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 1);
  out[0] = type;
  out.set(body, 1);
  return out;
}

/** Split a framed message into data-channel sized pieces. */
export function split(message: Uint8Array, msgId: number): Uint8Array[] {
  if (message.length <= MAX_FRAME) return [message];
  const total = Math.ceil(message.length / CHUNK_BODY);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const slice = message.subarray(i * CHUNK_BODY, (i + 1) * CHUNK_BODY);
    const out = new Uint8Array(CHUNK_HEADER + slice.length);
    out[0] = Frame.Chunk;
    const view = new DataView(out.buffer);
    view.setUint32(1, msgId >>> 0);
    view.setUint32(5, i);
    view.setUint32(9, total);
    out.set(slice, CHUNK_HEADER);
    parts.push(out);
  }
  return parts;
}

type Pending = { total: number; got: number; parts: Uint8Array[]; size: number };

/** Per-link reassembly. Chunks arrive in order (ordered channel) but we do not rely on it. */
export class Reassembler {
  private readonly pending = new Map<number, Pending>();

  /** Returns a complete framed message, or null while chunks are outstanding. */
  push(data: Uint8Array): Uint8Array | null {
    if (data.length === 0) return null;
    if (data[0] !== Frame.Chunk) return data;
    if (data.length < CHUNK_HEADER) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const id = view.getUint32(1);
    const index = view.getUint32(5);
    const total = view.getUint32(9);
    if (total === 0 || index >= total || total * CHUNK_BODY > MAX_MESSAGE + CHUNK_BODY) {
      this.pending.delete(id);
      return null;
    }
    let p = this.pending.get(id);
    if (!p || p.total !== total) {
      p = { total, got: 0, parts: new Array(total), size: 0 };
      this.pending.set(id, p);
    }
    if (!p.parts[index]) {
      const body = data.slice(CHUNK_HEADER);
      p.parts[index] = body;
      p.got += 1;
      p.size += body.length;
    }
    if (p.got < p.total) return null;
    this.pending.delete(id);
    const out = new Uint8Array(p.size);
    let off = 0;
    for (const part of p.parts) {
      out.set(part, off);
      off += part.length;
    }
    return out;
  }

  clear(): void {
    this.pending.clear();
  }
}

export function encodePing(seq: number, at: number): Uint8Array {
  const out = new Uint8Array(13);
  out[0] = Frame.Ping;
  const view = new DataView(out.buffer);
  view.setUint32(1, seq >>> 0);
  view.setFloat64(5, at);
  return out;
}

export function decodePing(body: Uint8Array): { seq: number; at: number } | null {
  if (body.length < 12) return null;
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { seq: view.getUint32(0), at: view.getFloat64(4) };
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

export function encodeHello(h: Hello): Uint8Array {
  return frame(Frame.Hello, utf8.encode(JSON.stringify(h)));
}

export function decodeHello(body: Uint8Array): Hello | null {
  try {
    const v = JSON.parse(fromUtf8.decode(body)) as Partial<Hello>;
    if (typeof v.proto !== 'number') return null;
    return { proto: v.proto, app: typeof v.app === 'string' ? v.app.slice(0, 40) : '' };
  } catch {
    return null;
  }
}

/** Largest media blob a peer will accept (the app caps a file at 32 MB). */
export const MAX_BLOB = 64 * 1024 * 1024;

const HEX_RE = /^[0-9a-f]{64}$/;

function hexToBytes(hex: string): Uint8Array | null {
  if (!HEX_RE.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function encodeBlobWant(req: number, hash: string): Uint8Array | null {
  const raw = hexToBytes(hash);
  if (!raw) return null;
  const out = new Uint8Array(1 + 4 + 32);
  out[0] = Frame.BlobWant;
  new DataView(out.buffer).setUint32(1, req >>> 0);
  out.set(raw, 5);
  return out;
}

export function decodeBlobWant(body: Uint8Array): { req: number; hash: string } | null {
  if (body.length !== 36) return null;
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { req: view.getUint32(0), hash: bytesToHex(body.subarray(4)) };
}

export type BlobPart = { req: number; total: number; offset: number; mime: string; bytes: Uint8Array };

export function encodeBlobPart(p: BlobPart): Uint8Array {
  const mime = utf8.encode(p.mime.slice(0, 100));
  const out = new Uint8Array(1 + 12 + 1 + mime.length + p.bytes.length);
  out[0] = Frame.BlobPart;
  const view = new DataView(out.buffer);
  view.setUint32(1, p.req >>> 0);
  view.setUint32(5, p.total);
  view.setUint32(9, p.offset);
  out[13] = mime.length;
  out.set(mime, 14);
  out.set(p.bytes, 14 + mime.length);
  return out;
}

export function decodeBlobPart(body: Uint8Array): BlobPart | null {
  if (body.length < 13) return null;
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const mimeLen = body[12];
  if (body.length < 13 + mimeLen) return null;
  const total = view.getUint32(4);
  const offset = view.getUint32(8);
  const bytes = body.subarray(13 + mimeLen);
  if (total > MAX_BLOB || offset + bytes.length > total) return null;
  return { req: view.getUint32(0), total, offset, mime: fromUtf8.decode(body.subarray(13, 13 + mimeLen)), bytes };
}

export function encodeBlobMiss(req: number): Uint8Array {
  const out = new Uint8Array(5);
  out[0] = Frame.BlobMiss;
  new DataView(out.buffer).setUint32(1, req >>> 0);
  return out;
}

export function decodeBlobMiss(body: Uint8Array): number | null {
  if (body.length < 4) return null;
  return new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0);
}

/** Short random id. `crypto.getRandomValues` works on plain-http LAN origins; `randomUUID` does not. */
export function randomPeerId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
