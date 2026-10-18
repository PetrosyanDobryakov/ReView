/**
 * Unit checks for content-addressed media blobs (Stage 2 foundation).
 * Run: node --experimental-strip-types scripts/blobs-test.mjs
 * (IndexedDB parts run only where indexedDB exists; in Node they self-skip.)
 */
import assert from 'node:assert/strict';
import {
  CompositeBlobStore,
  IdbBlobStore,
  MemoryBlobStore,
  createBlobObjectUrl,
  hashBytes,
  isBlobHash,
  isBlobRef,
} from '../src/core/blobs.ts';

const enc = new TextEncoder();

// --- hash validation -------------------------------------------------------
assert.equal(isBlobHash('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'), true);
assert.equal(isBlobHash('BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD'), false);
assert.equal(isBlobHash('xyz'), false);
assert.equal(isBlobHash(''), false);
assert.equal(isBlobHash(null), false);
assert.equal(isBlobHash(42), false);
assert.equal(isBlobHash('ba7816bf'), false);

// --- known-answer hash ------------------------------------------------------
// sha256('abc') — canonical test vector.
assert.equal(await hashBytes(enc.encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
assert.match(await hashBytes(enc.encode('board-1')), /^[0-9a-f]{64}$/);
assert.notEqual(await hashBytes(enc.encode('a')), await hashBytes(enc.encode('b')));
await assert.rejects(hashBytes(new Uint8Array(0)), /empty/);

// --- BlobRef guard ----------------------------------------------------------
const goodHash = await hashBytes(enc.encode('img'));
assert.equal(
  isBlobRef({ blob: goodHash, thumb: null, mime: 'image/jpeg', bytes: 10 }),
  true
);
assert.equal(
  isBlobRef({ blob: goodHash, thumb: goodHash, mime: 'image/png', bytes: 0 }),
  true
);
assert.equal(isBlobRef({ blob: 'nope', thumb: null, mime: 'image/jpeg', bytes: 1 }), false);
assert.equal(isBlobRef({ blob: goodHash, thumb: 'nope', mime: 'image/jpeg', bytes: 1 }), false);
assert.equal(isBlobRef({ blob: goodHash, thumb: null, mime: 'nope', bytes: 1 }), false);
assert.equal(isBlobRef({ blob: goodHash, thumb: null, mime: 'image/jpeg', bytes: -1 }), false);
assert.equal(isBlobRef(null), false);

// --- memory store -----------------------------------------------------------
{
  const store = new MemoryBlobStore(1024);
  const bytes = enc.encode('hello-blob');
  const hash = await hashBytes(bytes);
  assert.equal(await store.has(hash), false);
  assert.equal(await store.get(hash), null);
  await store.put(hash, bytes, 'image/jpeg');
  assert.equal(await store.has(hash), true);
  const back = await store.get(hash);
  assert.ok(back);
  assert.equal(back.mime, 'image/jpeg');
  assert.deepEqual(Array.from(back.bytes), Array.from(bytes));
  // Idempotent re-put of identical bytes.
  await store.put(hash, bytes, 'image/jpeg');
  assert.equal(await store.has(hash), true);
  // Hash mismatch is rejected.
  await assert.rejects(store.put(hash, enc.encode('tampered'), 'image/jpeg'), /mismatch/);
  await assert.rejects(store.put('nope', bytes, 'image/jpeg'), /malformed/);
  assert.equal(await store.delete('0'.repeat(64)), false);
  assert.equal(await store.delete(hash), true);
  assert.equal(await store.has(hash), false);
}

// --- memory LRU eviction ----------------------------------------------------
{
  const store = new MemoryBlobStore(32);
  const hashes = [];
  for (let i = 0; i < 8; i++) {
    const bytes = enc.encode(`payload-${i}-pad!!`);
    const h = await hashBytes(bytes);
    hashes.push(h);
    await store.put(h, bytes, 'image/png');
  }
  assert.ok(store.size <= 32 || store.count === 1);
  // Newest survives.
  assert.equal(await store.has(hashes[hashes.length - 1]), true);
  // Oldest was evicted.
  assert.equal(await store.has(hashes[0]), false);
}

// --- composite: write-through + backfill ------------------------------------
{
  const fast = new MemoryBlobStore();
  const slow = new MemoryBlobStore();
  const combo = new CompositeBlobStore(fast, slow);
  const bytes = enc.encode('combo-bytes');
  const hash = await hashBytes(bytes);
  await combo.put(hash, bytes, 'image/webp');
  assert.equal(await fast.has(hash), true);
  assert.equal(await slow.has(hash), true);
  fast.clear();
  assert.equal(await fast.has(hash), false);
  const back = await combo.get(hash);
  assert.ok(back);
  assert.equal(back.mime, 'image/webp');
  // Slow hit backfilled fast.
  assert.equal(await fast.has(hash), true);
  assert.equal(await combo.delete(hash), true);
  assert.equal(await combo.has(hash), false);
}

// --- object URL helper ------------------------------------------------------
{
  const url = createBlobObjectUrl(enc.encode('x'), 'image/png');
  assert.ok(url === null || url.startsWith('blob:'));
  if (url) URL.revokeObjectURL(url);
}

// --- idb store: support probe + live roundtrip where available ---------------
assert.equal(typeof IdbBlobStore.isSupported(), 'boolean');
if (IdbBlobStore.isSupported()) {
  const store = new IdbBlobStore(4000);
  const bytes = enc.encode('idb-roundtrip');
  const hash = await hashBytes(bytes);
  await store.put(hash, bytes, 'image/jpeg');
  const back = await store.get(hash);
  assert.ok(back);
  assert.deepEqual(Array.from(back.bytes), Array.from(bytes));
  assert.ok((await store.allHashes()).includes(hash));
  assert.equal(await store.delete(hash), true);
  store.close();
} else {
  // Node: a wedged/missing IndexedDB degrades to misses, never throws.
  const store = new IdbBlobStore(500);
  const bytes = enc.encode('idb-miss');
  const hash = await hashBytes(bytes);
  assert.equal(await store.get(hash), null);
  assert.equal(await store.has(hash), false);
  assert.deepEqual(await store.allHashes(), []);
  await assert.rejects(store.put(hash, bytes, 'image/jpeg'), /unavailable|timeout/);
}

console.log('blobs-test: ok');
