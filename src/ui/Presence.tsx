import type { LocaleId } from '../core/locale';
import { Icon } from './icons';
import { t } from './i18n';

export function Presence({ locale, online }: { locale: LocaleId; online: boolean }) {
  const label = online ? t(locale, 'online') : t(locale, 'offline');

  return (
    <div className={`presence${online ? ' online' : ''}`} title={t(locale, 'syncHint')} role="status" aria-label={label}>
      <span className="presence-face">
        <Icon name="person" size={14} />
      </span>
    </div>
  );
}
