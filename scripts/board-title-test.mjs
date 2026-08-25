/**
 * Board title Yjs sync + rename permission rules.
 */
import assert from 'node:assert/strict';
import * as Y from 'yjs';

const META_TITLE = 'title';
const META_OWNER_ID = 'ownerId';

// --- Yjs meta title propagates like other meta fields ---
const docA = new Y.Doc();
const docB = new Y.Doc();
docB.getMap('meta').set(META_OWNER_ID, 'owner-1');
docA.getMap('meta').set(META_OWNER_ID, 'owner-1');
docA.getMap('meta').set(META_TITLE, 'Team brainstorm');
Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
assert.equal(docB.getMap('meta').get(META_TITLE), 'Team brainstorm', 'title syncs via CRDT');

docA.getMap('meta').set(META_TITLE, 'Sprint planning');
Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
assert.equal(docB.getMap('meta').get(META_TITLE), 'Sprint planning', 'title updates propagate');

// --- permission rules (mirror boardTitle.ts) ---
function usesLocalBoardName(meta) {
  return meta?.savedLocally === true;
}

function boardRenameMode(meta, ownerId, userId) {
  if (!meta) return false;
  if (usesLocalBoardName(meta)) return 'local';
  if (ownerId && ownerId === userId) return 'sync';
  if (meta.status === 'local' && !ownerId) return 'sync';
  return false;
}

function canRenameBoardOnHome(meta) {
  if (!meta) return false;
  return meta.status !== 'remote' || usesLocalBoardName(meta);
}

const owner = 'user-owner';
const guest = 'user-guest';

assert.equal(boardRenameMode({ status: 'local' }, owner, owner), 'sync');
assert.equal(boardRenameMode({ status: 'remote' }, owner, guest), false);
assert.equal(boardRenameMode({ status: 'remote', savedLocally: true }, owner, guest), 'local');
assert.equal(canRenameBoardOnHome({ status: 'remote' }), false);
assert.equal(canRenameBoardOnHome({ status: 'local' }), true);

console.log('board-title: ok');
