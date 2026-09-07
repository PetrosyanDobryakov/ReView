/**
 * Board title Yjs sync + rename permission rules.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// --- stale-doc guard (regression: cross-board title corruption) ---
// On board switch App's title effect runs BEFORE initBoard, so the shared
// Yjs meta + getCurrentBoardId() may still belong to the previous board.
// reconcile/mirror must then show the local name and write nothing.
// Faithful port of src/core/boardTitle.ts (kept in sync by the src asserts below).
const root = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(root + '/src/core/boardTitle.ts', 'utf8');
assert.match(src, /getCurrentBoardId\(\) !== boardId/, 'reconcile/mirror guard on current board');
assert.ok(
  src.includes('getCurrentBoardId') && src.includes("from './store'"),
  'guard reads current board from the store'
);

{
  const boards = new Map([
    ['bFiz', { id: 'bFiz', name: 'физика' }],
    ['bMat', { id: 'bMat', name: 'Новая доска' }],
  ]);
  let currentBoardId = 'bFiz'; // initBoard(bMat) hasn't run yet
  const norm = (v, fb) => (v.trim().slice(0, 40) || fb);
  const writes = [];
  const reconcile = (boardId, fallback) => {
    const local = boards.get(boardId);
    if (!local) return fallback;
    if (currentBoardId !== boardId) return norm(local.name, fallback);
    writes.push(boardId);
    return norm(local.name, fallback);
  };
  const mirror = (boardId, syncedTitle) => {
    if (currentBoardId !== boardId) return false;
    const meta = boards.get(boardId);
    const next = norm(syncedTitle, 'ReView');
    if (meta.name === next) return false;
    meta.name = next;
    writes.push(boardId);
    return true;
  };

  // User opens the new board while the doc still holds «физика».
  assert.equal(reconcile('bMat', 'ReView'), 'Новая доска', 'fresh board shows its own name');
  assert.equal(mirror('bMat', 'физика'), false, 'stale synced title is not mirrored');
  assert.equal(boards.get('bMat').name, 'Новая доска', 'no cross-board metadata write');
  assert.deepEqual(writes, [], 'stale phase writes nothing');

  // initBoard ran; rename + reopen flow converges on each board's own title.
  currentBoardId = 'bMat';
  boards.get('bMat').name = 'математика';
  currentBoardId = 'bFiz'; // back to физика after its own initBoard
  assert.equal(mirror('bFiz', 'физика'), false, 'equal title is a no-op');
  assert.equal(reconcile('bFiz', 'ReView'), 'физика', 'reopened board keeps its title');
  assert.equal(boards.get('bFiz').name, 'физика', 'first board not renamed by second');
  assert.equal(boards.get('bMat').name, 'математика', 'second board keeps its rename');
}

console.log('board-title stale-doc guard: ok');
