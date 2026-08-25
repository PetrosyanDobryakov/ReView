import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { createBoard, getBoard, type BoardMeta } from './boards';
import { readLocale } from './locale';
import { t } from '../ui/i18n';

function dbName(boardId: string): string {
  return `review-v1-${boardId}`;
}

async function loadBoardUpdate(boardId: string): Promise<Uint8Array | null> {
  const doc = new Y.Doc();
  const persist = new IndexeddbPersistence(dbName(boardId), doc);
  try {
    await persist.whenSynced;
    if (doc.getMap('shapes').size === 0 && doc.getArray('order').length === 0) {
      return null;
    }
    return Y.encodeStateAsUpdate(doc);
  } finally {
    try {
      await persist.destroy();
    } catch {
      /* ignore */
    }
    doc.destroy();
  }
}

async function writeBoardUpdate(boardId: string, update: Uint8Array): Promise<void> {
  const doc = new Y.Doc();
  const persist = new IndexeddbPersistence(dbName(boardId), doc);
  try {
    await persist.whenSynced;
    Y.applyUpdate(doc, update);
    // Give IndexedDB a beat to flush.
    await new Promise((r) => setTimeout(r, 80));
  } finally {
    try {
      await persist.destroy();
    } catch {
      /* ignore */
    }
    doc.destroy();
  }
}

/** Duplicate board metadata and IndexedDB document contents. */
export async function cloneBoard(sourceId: string): Promise<BoardMeta | null> {
  const src = getBoard(sourceId);
  if (!src) return null;
  const update = await loadBoardUpdate(sourceId);
  const locale = readLocale();
  const copy = createBoard(
    `${src.name} (${t(locale, 'duplicateBoard')})`,
    src.teamId,
    src.status === 'remote' ? 'local' : src.status
  );
  if (update) {
    try {
      await writeBoardUpdate(copy.id, update);
    } catch {
      /* metadata exists even if content copy fails */
    }
  }
  return copy;
}
