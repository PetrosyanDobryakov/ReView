import * as Y from 'yjs';
import { createBoard, deleteBoardData, getBoard, type BoardMeta } from './boards';
import { readLocale } from './locale';
import { META_OWNER_ID, META_TITLE } from './store';
import { t } from '../ui/i18n';
import { loadUpdateForBoard, writeUpdateToBoard } from './boardShare';

function stripCopiedIdentity(tmp: Y.Doc): void {
  try {
    const copyMeta = tmp.getMap('meta');
    if (copyMeta.has(META_TITLE)) copyMeta.delete(META_TITLE);
    if (copyMeta.has(META_OWNER_ID)) copyMeta.delete(META_OWNER_ID);
  } catch {
    /* keep content even if the meta strip fails */
  }
}

/** Duplicate board metadata and document contents (open session or IndexedDB). */
export async function cloneBoard(sourceId: string): Promise<BoardMeta | null> {
  const src = getBoard(sourceId);
  if (!src) return null;
  const loaded = await loadUpdateForBoard(sourceId);
  if (!loaded.ok) return null;
  const locale = readLocale();
  const copy = createBoard(
    `${src.name} (${t(locale, 'duplicateBoard')})`,
    src.teamId,
    src.status === 'remote' ? 'local' : src.status
  );
  try {
    await writeUpdateToBoard(copy.id, loaded.update, stripCopiedIdentity);
  } catch {
    await deleteBoardData(copy.id);
    return null;
  }
  return copy;
}
