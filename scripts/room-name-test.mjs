import assert from 'node:assert/strict';
import {
  formatHostForUrl,
  isValidRoomName,
  normalizeRoomName,
  roomFromDeletePath,
  roomFromWebsocketPath,
} from '../sync/netUtil.mjs';
import * as workerRoom from '../worker/src/roomName.ts';

const cases = [
  ['review-bmmkxyz', true],
  ['review', true],
  ['sync-test-123', true],
  ['review-compact-auth-1', true],
  ['', false],
  ['.', false],
  ['..', false],
  ['foo/bar', false],
  ['foo\\bar', false],
  ['has space', false],
  ['a'.repeat(201), false],
  ['a'.repeat(200), true],
];

for (const [name, ok] of cases) {
  assert.equal(isValidRoomName(name), ok, `node isValidRoomName(${JSON.stringify(name)})`);
  assert.equal(workerRoom.isValidRoomName(name), ok, `worker isValidRoomName(${JSON.stringify(name)})`);
}

assert.equal(roomFromWebsocketPath('/review-abc?x=1'), 'review-abc');
assert.equal(roomFromWebsocketPath('/review-abc/'), 'review-abc');
assert.equal(roomFromDeletePath('/room/review-abc'), 'review-abc');
assert.equal(roomFromDeletePath('/room/review-abc/'), 'review-abc');
assert.equal(roomFromDeletePath('/health'), '');
assert.equal(normalizeRoomName('/review-x/'), 'review-x');

assert.equal(workerRoom.roomFromWebsocketPath('/review-abc?x=1'), 'review-abc');
assert.equal(workerRoom.roomFromDeletePath('/room/review-abc/'), 'review-abc');

assert.equal(formatHostForUrl('192.168.1.5'), '192.168.1.5');
assert.equal(formatHostForUrl('fd00::1'), '[fd00::1]');
assert.equal(formatHostForUrl('[fd00::1]'), '[fd00::1]');

console.log('room-name-test: all checks passed');
