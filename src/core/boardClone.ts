import { createBoard, deleteBoardData, getBoard, type BoardMeta } from './boards';
import { readLocale } from './locale';
import { t } from '../ui/i18n';
import { loadUpdateForBoard, stripCopiedIdentity, writeUpdateToBoard } from './boardShare';

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
