/**
 * Unit checks for the `.review` v2 envelope (Stage 2 file share).
 * Run: node --experimental-strip-types scripts/board-file-test.mjs
 */
import assert from 'node:assert/strict';
import { hashBytes } from '../src/core/blobs.ts';
import { collectBlobHashes } from '../src/core/mediaBlobs.ts';
import {
  MAX_V2_BLOB_BYTES,
  MAX_V2_FILE_BYTES,
  base64ToBytes,
  bytesToBase64,
  createBoardFileV2,
  parseBoardFileV2,
  sniffBoardFileVersion,
  sniffMime,
} from '../src/core/boardFileV2.ts';

const enc = new TextEncoder();
const docUpdate = enc.encode('slim-yjs-update-bytes');
const imgBytes = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const imgHash = await hashBytes(imgBytes);
const pngHash = await hashBytes(pngBytes);

// --- base64 helpers ------------------------------------------------------------
assert.equal(bytesToBase64(new Uint8Array(0)), '');
assert.deepEqual(
  Array.from(base64ToBytes(bytesToBase64(imgBytes), 1024)),
  Array.from(imgBytes)
);
assert.equal(base64ToBytes('!!!not-base64!!!', 1024), null);
assert.equal(base64ToBytes('', 1024), null);
assert.equal(base64ToBytes(bytesToBase64(imgBytes), 2), null); // output cap
assert.equal(base64ToBytes(42, 1024), null);

// --- mime sniff ------------------------------------------------------------------
assert.equal(sniffMime(imgBytes), 'image/jpeg');
assert.equal(sniffMime(pngBytes), 'image/png');
assert.equal(sniffMime(enc.encode('GIF89a...')), 'image/gif');
assert.equal(
  sniffMime(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
  'image/webp'
);
assert.equal(
  sniffMime(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])),
  'video/mp4'
);
assert.equal(sniffMime(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])), 'video/webm');
assert.equal(sniffMime(enc.encode('hello')), 'application/octet-stream');

// --- create → parse roundtrip -------------------------------------------------------
const made = createBoardFileV2({
  boardId: 'b1',
  name: 'Board',
  teamId: 'default',
  createdAt: 1,
  exportedAt: 2,
  appVersion: '9.9.9',
  pages: ['main', 'p2'],
  docUpdate,
  blobs: [
    { hash: imgHash, bytes: imgBytes },
    { hash: pngHash, bytes: pngBytes },
  ],
});
assert.ok('file' in made);
assert.equal(made.file.v, 2);
assert.equal(made.file.kind, 'review-board');
const parsed = parseBoardFileV2(JSON.parse(JSON.stringify(made.file)));
assert.ok(parsed);
assert.equal(parsed.boardId, 'b1');
assert.equal(parsed.name, 'Board');
assert.deepEqual(parsed.pages, ['main', 'p2']);
assert.deepEqual(Array.from(parsed.docUpdate), Array.from(docUpdate));
assert.equal(parsed.blobs.size, 2);
assert.deepEqual(Array.from(parsed.blobs.get(imgHash)), Array.from(imgBytes));
assert.deepEqual(Array.from(parsed.blobs.get(pngHash)), Array.from(pngBytes));

// --- create guards ----------------------------------------------------------------------
assert.deepEqual(createBoardFileV2({
  boardId: 'b', name: 'n', teamId: 't', createdAt: 0, exportedAt: 0,
  appVersion: '', pages: [], docUpdate: new Uint8Array(0), blobs: [],
}).error, 'invalid');
assert.deepEqual(createBoardFileV2({
  boardId: '', name: 'n', teamId: 't', createdAt: 0, exportedAt: 0,
  appVersion: '', pages: [], docUpdate, blobs: [],
}).error, 'invalid');
// Duplicate hash rejected.
assert.deepEqual(createBoardFileV2({
  boardId: 'b', name: 'n', teamId: 't', createdAt: 0, exportedAt: 0,
  appVersion: '', pages: [], docUpdate,
  blobs: [
    { hash: imgHash, bytes: imgBytes },
    { hash: imgHash, bytes: imgBytes },
  ],
}).error, 'invalid');
// Malformed hash rejected.
assert.deepEqual(createBoardFileV2({
  boardId: 'b', name: 'n', teamId: 't', createdAt: 0, exportedAt: 0,
  appVersion: '', pages: [], docUpdate, blobs: [{ hash: 'nope', bytes: imgBytes }],
}).error, 'invalid');
// Oversize blob rejected without allocating base64.
const big = new Uint8Array(MAX_V2_BLOB_BYTES + 1);
assert.deepEqual(createBoardFileV2({
  boardId: 'b', name: 'n', teamId: 't', createdAt: 0, exportedAt: 0,
  appVersion: '', pages: [], docUpdate, blobs: [{ hash: imgHash, bytes: big }],
}).error, 'too_large');

// --- parse guards --------------------------------------------------------------------------
assert.equal(parseBoardFileV2(null), null);
assert.equal(parseBoardFileV2({ kind: 'review-board', v: 1, update: 'abcd' }), null);
assert.equal(parseBoardFileV2({ ...made.file, v: 3 }), null);
assert.equal(parseBoardFileV2({ ...made.file, blobs: { nope: 'abcd' } }), null);
assert.equal(parseBoardFileV2({ ...made.file, blobs: { [imgHash]: '!!!' } }), null);
assert.equal(parseBoardFileV2({ ...made.file, docUpdate: '' }), null);
assert.equal(parseBoardFileV2({ ...made.file, pages: 'main' }), null);
assert.ok(MAX_V2_FILE_BYTES >= 100 * 1024 * 1024);

// --- version sniff ------------------------------------------------------------------------------
assert.equal(sniffBoardFileVersion(made.file), 2);
assert.equal(sniffBoardFileVersion({ kind: 'review-board', v: 1, update: 'abcd' }), 1);
assert.equal(sniffBoardFileVersion({ kind: 'review-board', v: 2 }), null);
assert.equal(sniffBoardFileVersion(null), null);
assert.equal(sniffBoardFileVersion({ kind: 'nope' }), null);

// --- collectBlobHashes ------------------------------------------------------------------------------
{
  const shape = (entries) => new Map(entries);
  const hashes = collectBlobHashes([
    ['a', shape([['type', 'image'], ['blob', imgHash], ['thumb', pngHash]])],
    ['b', shape([['type', 'image'], ['blob', imgHash]])], // dedup
    ['c', shape([['type', 'doc'], ['pageBlobs', [imgHash]], ['pageThumbs', [pngHash, null]]])],
    ['d', shape([['type', 'rect']])],
    ['e', shape([['type', 'image'], ['src', 'data:image/png;base64,abcd']])], // legacy: no refs
  ]);
  assert.deepEqual(hashes.sort(), [imgHash, pngHash].sort());
  assert.deepEqual(collectBlobHashes([]), []);
}

console.log('board-file-test: ok');
