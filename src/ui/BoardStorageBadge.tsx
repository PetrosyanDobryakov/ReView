import type { BoardMeta } from '../core/boards';
import { boardStorageKind } from '../core/boards';
import type { LocaleId } from '../core/locale';
import { t } from './i18n';

type BoardStorageBadgeProps = {
  meta: BoardMeta;
  locale: LocaleId;
};

export function BoardStorageBadge({ meta, locale }: BoardStorageBadgeProps) {
  const kind = boardStorageKind(meta);
  const label = kind === 'onDevice' ? t(locale, 'badgeOnDevice') : t(locale, 'badgeSessionOnly');
  return (
    <span className={`board-storage-badge is-${kind}`} title={label}>
      {label}
    </span>
  );
}
