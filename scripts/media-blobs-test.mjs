/**
 * Unit checks for media ingest into the blob store (Stage 2, phase A).
 * Run: node --experimental-strip-types scripts/media-blobs-test.mjs
 * (Thumbnail rendering needs DOM canvas; in Node it degrades to null.)
 */
import assert from 'node:assert/strict';
import { hashBytes, MemoryBlobStore } from '../src/core/blobs.ts';
import {
  INGEST_MAX_BYTES,
  attachDocBlobs,
  attachImageBlobs,
  decodeDataUrl,
  ingestDataUrlAsBlob,
  makeThumbBytes,
} from '../src/core/mediaBlobs.ts';

const enc = new TextEncoder();
// 1x1 transparent PNG.
const PIXEL_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PIXEL_PNG = `data:image/png;base64,${PIXEL_PNG_B64}`;

// --- decodeDataUrl ----------------------------------------------------------
{
  const d = decodeDataUrl(PIXEL_PNG);
  assert.ok(d);
  assert.equal(d.mime, 'image/png');
  assert.deepEqual(Array.from(d.bytes), Array.from(Buffer.from(PIXEL_PNG_B64, 'base64')));
  // Whitespace / newlines tolerated.
  const wrapped = `data:image/png;base64,${PIXEL_PNG_B64.slice(0, 20)}\n ${PIXEL_PNG_B64.slice(20)}`;
  assert.ok(decodeDataUrl(wrapped));
  // Charset parameter tolerated, mime lowercased.
  assert.equal(decodeDataUrl('data:image/JPEG;charset=utf-8;base64,abcd')?.mime, 'image/jpeg');
  // Video mime passes through.
  assert.equal(decodeDataUrl('data:video/mp4;base64,abcd')?.mime, 'video/mp4');
  // Rejects.
  assert.equal(decodeDataUrl('not-a-data-url'), null);
  assert.equal(decodeDataUrl('data:image/png,abcdef'), null); // missing ;base64
  assert.equal(decodeDataUrl('data:image/png;base64,'), null); // empty payload
  assert.equal(decodeDataUrl('data:;base64,abcd'), null); // missing mime
  assert.equal(decodeDataUrl(''), null);
  assert.equal(decodeDataUrl(null), null);
  assert.equal(INGEST_MAX_BYTES, 32 * 1024 * 1024);
}

// --- thumbnails degrade without DOM ------------------------------------------
assert.equal(await makeThumbBytes(PIXEL_PNG), null);

// --- ingest one image (memory store) -----------------------------------------
{
  const store = new MemoryBlobStore();
  const ref = await ingestDataUrlAsBlob(PIXEL_PNG, { store });
  assert.ok(ref);
  assert.equal(ref.blob, await hashBytes(decodeDataUrl(PIXEL_PNG).bytes));
  assert.equal(ref.thumb, null); // no DOM canvas in Node
  assert.equal(ref.mime, 'image/png');
  assert.equal(ref.bytes, decodeDataUrl(PIXEL_PNG).bytes.length);
  assert.equal(await store.has(ref.blob), true);
  // Invalid input resolves null, never throws.
  assert.equal(await ingestDataUrlAsBlob('garbage', { store }), null);
}

// --- attachImageBlobs: patch applied, board guard respected ------------------
{
  const store = new MemoryBlobStore();
  const patches = [];
  const deps = {
    store,
    isCurrent: () => true,
    patch: (id, p) => patches.push([id, p]),
  };
  const ref = await attachImageBlobs('shape-1', PIXEL_PNG, deps);
  assert.ok(ref);
  assert.equal(patches.length, 1);
  assert.equal(patches[0][0], 'shape-1');
  assert.deepEqual(Object.keys(patches[0][1]).sort(), ['blob', 'bytes', 'mime', 'thumb']);
  assert.equal(patches[0][1].blob, ref.blob);
  assert.equal(patches[0][1].mime, 'image/png');

  // Left-the-board: ref still returned, but nothing patched.
  const patches2 = [];
  const ref2 = await attachImageBlobs('shape-2', PIXEL_PNG, {
    store,
    isCurrent: () => false,
    patch: (id, p) => patches2.push([id, p]),
  });
  assert.ok(ref2);
  assert.equal(patches2.length, 0);

  // Bad src: null, no patch.
  const patches3 = [];
  assert.equal(
    await attachImageBlobs('shape-3', 'nope', { store, patch: (id, p) => patches3.push([id, p]) }),
    null
  );
  assert.equal(patches3.length, 0);
}

// --- attachDocBlobs: per-page refs in one patch -------------------------------
{
  const store = new MemoryBlobStore();
  const patches = [];
  const page2 = `data:image/jpeg;base64,${Buffer.from(enc.encode('page-two-bytes')).toString('base64')}`;
  const res = await attachDocBlobs('doc-1', [PIXEL_PNG, page2], {
    store,
    isCurrent: () => true,
    patch: (id, p) => patches.push([id, p]),
  });
  assert.ok(res);
  assert.equal(res.pageBlobs.length, 2);
  assert.deepEqual(res.pageThumbs, [null, null]);
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0][1].pageBlobs, res.pageBlobs);
  assert.equal(await store.has(res.pageBlobs[0]), true);
  assert.equal(await store.has(res.pageBlobs[1]), true);
  // A bad page aborts the whole doc patch (src `pages` stays the truth).
  const patches2 = [];
  assert.equal(
    await attachDocBlobs('doc-2', [PIXEL_PNG, 'bad'], {
      store,
      isCurrent: () => true,
      patch: (id, p) => patches2.push([id, p]),
    }),
    null
  );
  assert.equal(patches2.length, 0);
}

console.log('media-blobs-test: ok');
