import { useEffect, useRef, useState } from 'react';
import type { LocaleId } from '../core/locale';
import { Icon } from './icons';
import { t } from './i18n';

export function Presence({ locale, online }: { locale: LocaleId; online: boolean }) {
  const label = online ? t(locale, 'online') : t(locale, 'offline');
  const wasOnline = useRef(online);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (online && !wasOnline.current) {
      setFlash(true);
      const id = window.setTimeout(() => setFlash(false), 700);
      wasOnline.current = online;
      return () => window.clearTimeout(id);
    }
    wasOnline.current = online;
  }, [online]);

  return (
    <div
      className={`presence${online ? ' online' : ''}${flash ? ' flash' : ''}`}
      title={t(locale, 'syncHint')}
      role="status"
      aria-label={label}
    >
      <span className="presence-face">
        <Icon name="person" size={14} />
      </span>
    </div>
  );
}
