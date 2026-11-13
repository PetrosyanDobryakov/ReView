/**
 * Desktop mirror encoder: runs in a Web Worker so full Yjs snapshots never
 * block the main thread. The worker owns a second copy of the board doc —
 * the main thread forwards every applied update (small), and asks for a
 * full snapshot only when it's time to write the file. Snapshot bytes come
 * back transferred (zero copy).
 *
 * Protocol (main -> worker):
 *   { t: 'update', buf: ArrayBuffer } — apply to the worker doc
 *   { t: 'seed', buf: ArrayBuffer }   — drop the doc, start from this snapshot
 *   { t: 'snapshot', token: number }  — encode and post the bytes back
 * Worker -> main:
 *   { t: 'ready' }
 *   { t: 'snapshot', token, buf: ArrayBuffer } (transferred)
 *   { t: 'error', token, message }
 *
 * No DOM here (must run in Electron/Tauri webviews and build cleanly).
 */

import * as Y from 'yjs';

type InMessage =
  | { t: 'update'; buf: ArrayBuffer }
  | { t: 'seed'; buf: ArrayBuffer }
  | { t: 'snapshot'; token: number };

type OutMessage =
  | { t: 'ready' }
  | { t: 'snapshot'; token: number; buf: ArrayBuffer }
  | { t: 'error'; token: number; message: string };

const scope = globalThis as unknown as {
  onmessage: ((ev: { data: InMessage }) => void) | null;
  postMessage: (msg: OutMessage, transfer?: ArrayBuffer[]) => void;
};

let doc = new Y.Doc({ gc: false } as unknown as Record<string, unknown>);

scope.onmessage = (ev: { data: InMessage }) => {
  const msg = ev.data;
  try {
    if (msg.t === 'update') {
      Y.applyUpdate(doc, new Uint8Array(msg.buf));
    } else if (msg.t === 'seed') {
      try {
        doc.destroy();
      } catch {
        /* ignore */
      }
      doc = new Y.Doc({ gc: false } as unknown as Record<string, unknown>);
      Y.applyUpdate(doc, new Uint8Array(msg.buf));
    } else if (msg.t === 'snapshot') {
      const bytes = Y.encodeStateAsUpdate(doc);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      scope.postMessage({ t: 'snapshot', token: msg.token, buf }, [buf]);
    }
  } catch (err) {
    // Never answer a snapshot with empty bytes — the main thread would
    // overwrite a good backup with nothing. Report, it falls back to sync.
    if (msg.t === 'snapshot') {
      scope.postMessage({
        t: 'error',
        token: msg.token,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
};

scope.postMessage({ t: 'ready' });
