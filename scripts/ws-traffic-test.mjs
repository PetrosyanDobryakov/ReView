/**
 * WS traffic classifier for net debug.
 */
import assert from 'node:assert/strict';

/** Mirror of classifyWsPayload — keep in sync with src/net/wsTraffic.ts. */
function classifyWsPayload(data) {
  if (typeof data === 'string') return { kind: 'other', bytes: data.length };
  let u8 = null;
  if (data instanceof ArrayBuffer) u8 = new Uint8Array(data);
  else if (data instanceof Uint8Array) u8 = data;
  else if (ArrayBuffer.isView(data)) {
    u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (!u8) return { kind: 'other', bytes: 0 };
  const bytes = u8.byteLength;
  if (bytes > 0 && u8[0] < 128) {
    if (u8[0] === 0) return { kind: 'sync', bytes };
    if (u8[0] === 1) return { kind: 'awareness', bytes };
  }
  return { kind: 'other', bytes };
}

assert.deepEqual(classifyWsPayload(new Uint8Array([0, 1, 2])), { kind: 'sync', bytes: 3 });
assert.deepEqual(classifyWsPayload(new Uint8Array([1, 9])), { kind: 'awareness', bytes: 2 });
assert.deepEqual(classifyWsPayload(new Uint8Array([2])), { kind: 'other', bytes: 1 });
assert.deepEqual(classifyWsPayload('ping'), { kind: 'other', bytes: 4 });

console.log('ws-traffic: all checks passed');
