/**
 * Unit checks for media ingest into the blob store (Stage 2, phase A).
 * Run: node --experimental-strip-types scripts/media-blobs-test.mjs
 * (Thumbnail rendering needs DOM canvas; in Node it degrades to null.)
 */
import assert from 'node:assert/strict';
import { hashBytes, MemoryBlobStore } from '../src/core/blobs.ts';
import {
  INGEST_MAX_BYTES,
  __clearBlobResolverForTests,
  attachDocBlobs,
  attachImageBlobs,
  collectLegacyMedia,
  decodeDataUrl,
  ensureBlobUrl,
  ingestDataUrlAsBlob,
  makeThumbBytes,
  releaseResolvedBlobUrl,
  resolvedBlobUrl,
  selectBlobKind,
  selectDocPaintSrc,
  selectPaintSrc,
  warmVisibleBlobMedia,
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

// --- LOD selection (pure) ------------------------------------------------------
assert.equal(selectBlobKind(0), 'thumb');
assert.equal(selectBlobKind(399), 'thumb');
assert.equal(selectBlobKind(400), 'full');
assert.equal(selectBlobKind(4000), 'full');

// --- paint source selection (pure) --------------------------------------------
assert.equal(selectPaintSrc('src', 'full-url', 'thumb-url'), 'full-url');
assert.equal(selectPaintSrc('src', null, 'thumb-url'), 'thumb-url');
assert.equal(selectPaintSrc('src', null, null), 'src');
assert.equal(selectPaintSrc(undefined, null, null), '');
assert.equal(selectDocPaintSrc('page', 'full-url', 'thumb-url'), 'full-url');
assert.equal(selectDocPaintSrc('page', null, 'thumb-url'), 'thumb-url');
assert.equal(selectDocPaintSrc('page', null, null), 'page');
assert.equal(selectDocPaintSrc(undefined, null, null), '');

// --- resolver: miss / load / cache / dedup / negative --------------------------
{
  __clearBlobResolverForTests();
  const store = new MemoryBlobStore();
  const bytes = enc.encode('paint-bytes');
  const hash = await hashBytes(bytes);
  let gets = 0;
  const counting = {
    get: async (h) => {
      gets += 1;
      return store.get(h);
    },
    has: (h) => store.has(h),
    put: (h, b, m) => store.put(h, b, m),
    delete: (h) => store.delete(h),
  };

  // Miss resolves null without throwing.
  assert.equal(await ensureBlobUrl(hash, counting), null);
  assert.equal(resolvedBlobUrl(hash), null);
  const getsAfterMiss = gets;
  // Negative cache: immediate retry does not touch the store again.
  assert.equal(await ensureBlobUrl(hash, counting), null);
  assert.equal(gets, getsAfterMiss);

  // Store the bytes, clear the negative mark via fresh hash path: use a new hash.
  const bytes2 = enc.encode('paint-bytes-2');
  const hash2 = await hashBytes(bytes2);
  await counting.put(hash2, bytes2, 'image/png');
  const [u1, u2] = await Promise.all([ensureBlobUrl(hash2, counting), ensureBlobUrl(hash2, counting)]);
  assert.ok(u1.startsWith('blob:'));
  assert.equal(u1, u2); // in-flight dedup + cache
  assert.equal(resolvedBlobUrl(hash2), u1);
  const getsAfterLoad = gets;
  assert.equal(await ensureBlobUrl(hash2, counting), u1);
  assert.equal(gets, getsAfterLoad); // cache hit: no store read
  assert.equal(releaseResolvedBlobUrl(hash2), true);
  assert.equal(resolvedBlobUrl(hash2), null);
  assert.equal(releaseResolvedBlobUrl(hash2), false);
}

// --- warmer kicks LOD loads for visible views ----------------------------------
{
  __clearBlobResolverForTests();
  const store = new MemoryBlobStore();
  const fullBytes = enc.encode('warm-full');
  const thumbBytes = enc.encode('warm-thumb');
  const full = await hashBytes(fullBytes);
  const thumb = await hashBytes(thumbBytes);
  await store.put(full, fullBytes, 'image/png');
  await store.put(thumb, thumbBytes, 'image/jpeg');

  // Small on screen -> thumb only.
  warmVisibleBlobMedia({ type: 'image', blob: full, thumb }, 100, undefined, store);
  for (let i = 0; i < 50 && !resolvedBlobUrl(thumb); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(resolvedBlobUrl(thumb).startsWith('blob:'));
  assert.equal(resolvedBlobUrl(full), null);

  // Large on screen -> full (thumb stays as-is).
  warmVisibleBlobMedia({ type: 'image', blob: full, thumb }, 2000, undefined, store);
  for (let i = 0; i < 50 && !resolvedBlobUrl(full); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(resolvedBlobUrl(full).startsWith('blob:'));

  // Doc shape warms only the current page.
  __clearBlobResolverForTests();
  warmVisibleBlobMedia(
    { type: 'doc', pageBlobs: [full, thumb], pageThumbs: [null, null] },
    2000,
    1,
    store
  );
  for (let i = 0; i < 50 && !resolvedBlobUrl(thumb); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(resolvedBlobUrl(thumb).startsWith('blob:'));
  assert.equal(resolvedBlobUrl(full), null);

  // No refs -> no work, no throw.
  warmVisibleBlobMedia({ type: 'image' }, 2000, undefined, store);
  warmVisibleBlobMedia({ type: 'rect' }, 2000, undefined, store);
  __clearBlobResolverForTests();
}

// --- collectLegacyMedia ----------------------------------------------------------
{
  const shape = (entries) => new Map(entries);
  const found = collectLegacyMedia([
    ['a', shape([['type', 'image'], ['src', PIXEL_PNG]])],
    ['b', shape([['type', 'image'], ['src', PIXEL_PNG], ['blob', 'abc']])],
    ['c', shape([['type', 'image'], ['src', 'blob:https://x/123']])],
    ['d', shape([['type', 'video'], ['src', 'data:video/mp4;base64,abcd']])],
    ['e', shape([['type', 'doc'], ['pages', [PIXEL_PNG, 'https://x/page2']]])],
    [
      'f',
      shape([
        ['type', 'doc'],
        ['pages', [PIXEL_PNG]],
        ['pageBlobs', ['deadbeef']],
      ]),
    ],
    [
      'g',
      shape([
        ['type', 'doc'],
        // Y.Array-like pages (duck-typed toArray).
        ['pages', { toArray: () => [PIXEL_PNG] }],
      ]),
    ],
    ['h', shape([['type', 'rect']])],
    ['i', { get() { throw new Error('bad map'); } }],
  ]);
  assert.deepEqual(
    found.map((it) => [it.id, it.kind, it.srcs.length]),
    [
      ['a', 'image', 1],
      ['d', 'video', 1],
      ['e', 'doc', 1],
      ['g', 'doc', 1],
    ]
  );
  assert.equal(found[0].srcs[0], PIXEL_PNG);
  assert.deepEqual(collectLegacyMedia([]), []);
}

console.log('media-blobs-test: ok');
