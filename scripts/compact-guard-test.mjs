import assert from 'node:assert/strict';
import {
  boardHadRemoteCollaborators,
  compactBlockedByRecentPeer,
  compactSavesEnough,
  estimateTextWidth,
  hasOtherLocalReplicas,
  markBoardHadRemote,
  noteDistinctRemote,
  noteRemotePeer,
  parseReplicaMap,
  pruneReplicaMap,
  releaseReplica,
  remotePeerRecentlySeen,
  replicaMapHasOther,
  replicaTabId,
  REPLICA_TTL_MS,
  shapesFromClipboardText,
  touchReplica,
  wrapLinesByWidth,
  wrapRichLines,
} from './core-bundle.mjs';

assert.equal(compactSavesEnough(10_000_000, 9_000_000), false, '10% smaller is not enough to compact');
assert.equal(compactSavesEnough(12 * 1024 * 1024, 12 * 1024 * 1024), false, 'photo boards with no savings must not compact');
assert.equal(compactSavesEnough(8 * 1024 * 1024 - 1, 8 * 1024 * 1024 - 1), false, 'the old 8MB force path is gone');
assert.equal(compactSavesEnough(372_000_000, 80_000), true, 'tombstone bloat still compact');
assert.equal(compactSavesEnough(0, 0), false);
assert.equal(compactSavesEnough(-1, 0), false);

assert.equal(compactBlockedByRecentPeer(0, 1000), false);
assert.equal(compactBlockedByRecentPeer(1000, 2000), true);
assert.equal(compactBlockedByRecentPeer(1000, 1000 + 120_000), false);

const map = parseReplicaMap('{"a":100,"b":"200"}');
assert.equal(map.a, 100);
assert.equal(map.b, 200);
assert.deepEqual(parseReplicaMap('not-json'), {});
assert.deepEqual(pruneReplicaMap({ a: 1, b: 500 }, 400, 100), { b: 500 });
assert.equal(replicaMapHasOther({ self: 10, other: 10 }, 'self', 10), true);
assert.equal(replicaMapHasOther({ self: 10 }, 'self', 10), false);

const mem = {
  data: /** @type {Record<string, string>} */ ({}),
  getItem(k) {
    return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null;
  },
  setItem(k, v) {
    this.data[k] = v;
  },
  removeItem(k) {
    delete this.data[k];
  },
};

touchReplica('board-1', 1000, 'tab-a', mem);
touchReplica('board-1', 1000, 'tab-b', mem);
assert.equal(hasOtherLocalReplicas('board-1', 1000, 'tab-a', mem), true, 'other same-origin tab blocks compact');
releaseReplica('board-1', 'tab-b', mem);
assert.equal(hasOtherLocalReplicas('board-1', 1000, 'tab-a', mem), false, 'released tab no longer blocks');

touchReplica('board-1', 1000, 'tab-stale', mem);
assert.equal(hasOtherLocalReplicas('board-1', 1000 + REPLICA_TTL_MS, 'tab-a', mem), false, 'expired heartbeat is ignored');

noteRemotePeer('board-2', 5000, mem);
assert.equal(remotePeerRecentlySeen('board-2', 5000 + 1000, 120_000, mem), true);
assert.equal(remotePeerRecentlySeen('board-2', 5000 + 120_000, 120_000, mem), false);
assert.equal(boardHadRemoteCollaborators('board-2', mem), false, 'a last-peer timestamp without latch does not block auto-compact forever');

noteDistinctRemote('board-3', 5000, mem);
assert.equal(boardHadRemoteCollaborators('board-3', mem), true, 'distinct remote latches the board');
assert.equal(remotePeerRecentlySeen('board-3', 5000 + 1000, 120_000, mem), true);
assert.equal(boardHadRemoteCollaborators('board-3', mem), true, 'latch does not expire');

markBoardHadRemote('solo-never', mem);
assert.equal(boardHadRemoteCollaborators('solo-never', mem), true);
assert.equal(boardHadRemoteCollaborators('untouched', mem), false, 'solo boards without remotes stay compactable');

const wrapped = wrapLinesByWidth('hello world everyone', 80, (s) => estimateTextWidth(s, 16));
assert.ok(wrapped.length > 1, 'plain wrap splits a long phrase');
assert.ok(wrapped.some((l) => l.includes('hello')));
const overlong = wrapLinesByWidth('abcdefghijklmnopqrstuvwxyz', 20, (s) => estimateTextWidth(s, 16));
assert.ok(overlong.length > 1, 'overlong words split rather than overflow');

const formulaKept = wrapLinesByWidth('see $a + b$ now', 10, (s) => s.length);
assert.ok(
  formulaKept.some((l) => l.includes('$a + b$')),
  'wrapping keeps a spaced formula on one token'
);
assert.ok(
  !formulaKept.some((l) => /\$a(?! \+ b\$)/.test(l) || l === '+' || l === 'b$'),
  'wrapping does not split inside $a + b$'
);
assert.deepEqual(wrapLinesByWidth('x$a + b$y', 100, (s) => s.length), ['x$a + b$y']);

const richFormula = wrapRichLines([{ text: 'see $a + b$ now' }], 10, (r) => r.text.length);
const richJoined = richFormula.map((line) => line.map((p) => p.text).join(''));
assert.ok(
  richJoined.some((l) => l.includes('$a + b$')),
  'rich wrap keeps a spaced formula together'
);
assert.ok(
  !richJoined.some((l) => l.includes('$a') && !l.includes('$a + b$')),
  'rich wrap does not break $a + b$ across lines'
);

assert.equal(typeof replicaTabId(mem), 'string');

const shapes = shapesFromClipboardText('{"__reviewShapes":[{"id":"s1","type":"rect"}]}');
assert.equal(shapes?.length, 1);
assert.equal(shapesFromClipboardText('hello'), null);
assert.equal(shapesFromClipboardText('{"__reviewShapes":[]}'), null);
assert.equal(shapesFromClipboardText('{"__reviewShapes":"nope"}'), null);

console.log('compact-guard-test: ok');
