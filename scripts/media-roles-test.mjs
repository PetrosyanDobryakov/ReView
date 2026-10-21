/**
 * Unit checks for shared media playback logic (pure parts of mediaRoles):
 * state codec, staleness/echo guards, seek math, roles and permissions.
 * Run: node --experimental-strip-types scripts/media-roles-test.mjs
 */
import assert from 'node:assert/strict';
import {
  MEDIA_SYNC_SLOP_S,
  canControlMedia,
  decodeMediaState,
  encodeMediaState,
  nextMediaState,
  parseRoles,
  seekTargetAt,
} from '../src/core/mediaRoles.ts';

// --- codec round-trip --------------------------------------------------------
{
  const st = { playing: true, pos: 12.5, at: 1700000000000, vol: 0.8, by: 'user-1' };
  const back = decodeMediaState(encodeMediaState(st));
  assert.deepEqual(back, st);
  // Clamps.
  assert.equal(decodeMediaState(encodeMediaState({ ...st, pos: -5 })).pos, 0);
  assert.equal(decodeMediaState(encodeMediaState({ ...st, pos: 1e9 })).pos, 86400);
  assert.equal(decodeMediaState(encodeMediaState({ ...st, vol: 2 })).vol, 1);
  assert.equal(decodeMediaState(encodeMediaState({ ...st, vol: -1 })).vol, 0);
  // Rejects.
  assert.equal(decodeMediaState(''), null);
  assert.equal(decodeMediaState('garbage'), null);
  assert.equal(decodeMediaState('null'), null);
  assert.equal(decodeMediaState(JSON.stringify({ playing: true })), null);
  assert.equal(decodeMediaState(JSON.stringify({ ...st, by: '' })), null);
  assert.equal(decodeMediaState(null), null);
  assert.ok(MEDIA_SYNC_SLOP_S > 0);
}

// --- seek math ----------------------------------------------------------------
{
  const st = { playing: true, pos: 10, at: 100000, vol: 1, by: 'a' };
  assert.equal(seekTargetAt(st, 100000), 10);
  assert.equal(seekTargetAt(st, 105000), 15);
  assert.equal(seekTargetAt(st, 90000), 10); // writer clock ahead: no rewind
  assert.equal(seekTargetAt({ ...st, playing: false }, 199999), 10);
}

// --- echo + staleness guards ---------------------------------------------------
{
  const mk = (at, by = 'a') => encodeMediaState({ playing: true, pos: 1, at, vol: 1, by });
  assert.equal(nextMediaState(null, mk(100), 'a'), null); // own echo
  assert.ok(nextMediaState(null, mk(100, 'b'), 'a'));
  assert.equal(nextMediaState(100, mk(100, 'b'), 'a'), null); // same
  assert.equal(nextMediaState(101, mk(100, 'b'), 'a'), null); // reorder
  assert.ok(nextMediaState(99, mk(100, 'b'), 'a'));
  assert.equal(nextMediaState(null, 'garbage', 'a'), null);
}

// --- roles ----------------------------------------------------------------------
{
  assert.deepEqual(parseRoles(''), {});
  assert.deepEqual(parseRoles('nope'), {});
  assert.deepEqual(parseRoles(JSON.stringify({ u1: 'editor', u2: 'viewer', u3: 5 })), { u1: 'editor' });
  assert.equal(canControlMedia('owner', {}, 'owner'), true);
  assert.equal(canControlMedia('owner', {}, 'stranger'), false);
  assert.equal(canControlMedia('owner', { stranger: 'editor' }, 'stranger'), true);
  assert.equal(canControlMedia(null, { stranger: 'editor' }, 'stranger'), true);
  assert.equal(canControlMedia(null, {}, 'stranger'), false);
  assert.equal(canControlMedia('owner', {}, ''), false);
  // grantMediaRole lives in store.ts (needs a board doc) and stays untested
  // here; the permission predicate above is the part that matters.
}

console.log('media-roles-test: ok');
