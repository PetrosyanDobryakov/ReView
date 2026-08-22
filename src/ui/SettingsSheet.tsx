import { CHROME_THEME_IDS, writeChromeTheme, type ChromeThemeId } from '../core/chromeTheme';
import { LOCALES, writeLocale, type LocaleId } from '../core/locale';
import type { SyncStatus } from '../core/store';
import { Icon } from './icons';
import { BG_PRESETS, CHROME_LABEL, modKey, t } from './i18n';
import { MOTION, useExitPresence } from './motion';
import { SlideTrack } from './SlideTrack';
import { SwapText } from './SwapText';

export function SettingsSheet({
  open,
  locale,
  chromeTheme,
  bg,
  gridOn,
  sync,
  saved,
  onLocale,
  onChromeTheme,
  onBg,
  onGrid,
  onClose,
}: {
  open: boolean;
  locale: LocaleId;
  chromeTheme: ChromeThemeId;
  bg: string;
  gridOn: boolean;
  sync: SyncStatus;
  saved: boolean;
  onLocale: (id: LocaleId) => void;
  onChromeTheme: (id: ChromeThemeId) => void;
  onBg: (value: string) => void;
  onGrid: (on: boolean) => void;
  onClose: () => void;
}) {
  const mounted = useExitPresence(open, MOTION.sheetOut);
  if (!mounted) return null;

  return (
    <div className={`sheet-root${open ? '' : ' is-leaving'}`} role="presentation">
      <button className="sheet-backdrop" aria-label={t(locale, 'closeSettings')} onClick={onClose} />
      <aside className="sheet" role="dialog" aria-labelledby="settings-title" aria-hidden={!open}>
        <header className="sheet-head">
          <h2 id="settings-title">
            <SwapText text={t(locale, 'settings')} />
          </h2>
          <button type="button" className="icon-btn" title={t(locale, 'close')} aria-label={t(locale, 'close')} onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </header>

        <section className="sheet-section">
          <h3>
            <SwapText text={t(locale, 'connection')} />
          </h3>
          <p className="sheet-hint">
            <SwapText text={t(locale, 'syncHint')} />
          </p>
          <ul className="sheet-keys">
            <li>
              <span className={`status-line${sync.online ? ' on' : ''}`}>
                {sync.online ? t(locale, 'online') : t(locale, 'offline')}
              </span>
              <span>{sync.online ? sync.users : '—'}</span>
            </li>
            <li>
              <span className={`status-line${saved ? ' on' : ' wait'}`}>{t(locale, 'persist')}</span>
              <span>{saved ? t(locale, 'persistSaved') : t(locale, 'loading')}</span>
            </li>
          </ul>
        </section>

        <section className="sheet-section">
          <h3>
            <SwapText text={t(locale, 'language')} />
          </h3>
          <SlideTrack className="locale-row" active={locale}>
            {LOCALES.map((id) => (
              <button
                type="button"
                key={id}
                className="style-btn"
                data-slide-active={locale === id ? 'true' : undefined}
                aria-pressed={locale === id}
                onClick={() => {
                  if (id === locale) return;
                  const dir = LOCALES.indexOf(id) >= LOCALES.indexOf(locale) ? '1' : '-1';
                  document.documentElement.style.setProperty('--locale-dir', dir);
                  writeLocale(id);
                  onLocale(id);
                }}
              >
                {id.toUpperCase()}
              </button>
            ))}
          </SlideTrack>
        </section>

        <section className="sheet-section">
          <h3>
            <SwapText text={t(locale, 'ui')} />
          </h3>
          <p className="sheet-hint">
            <SwapText text={t(locale, 'uiHint')} />
          </p>
          <SlideTrack className="theme-grid" active={chromeTheme}>
            {CHROME_THEME_IDS.map((id) => (
              <button
                type="button"
                key={id}
                className="theme-card"
                data-theme-preview={id}
                data-slide-active={chromeTheme === id ? 'true' : undefined}
                aria-pressed={chromeTheme === id}
                onClick={() => {
                  if (id === chromeTheme) return;
                  onChromeTheme(id);
                  writeChromeTheme(id);
                }}
              >
                {t(locale, CHROME_LABEL[id])}
              </button>
            ))}
          </SlideTrack>
        </section>

        <section className="sheet-section">
          <h3>
            <SwapText text={t(locale, 'board')} />
          </h3>
          <SlideTrack className="bg-grid" active={bg}>
            {BG_PRESETS.map((p) => (
              <button
                type="button"
                key={p.value}
                className={`bg-card${p.value.startsWith('#f') ? ' light' : ''}`}
                data-slide-active={bg === p.value ? 'true' : undefined}
                style={{ background: p.value }}
                title={t(locale, p.label)}
                aria-label={t(locale, p.label)}
                aria-pressed={bg === p.value}
                onClick={() => onBg(p.value)}
              >
                <span>{t(locale, p.label)}</span>
              </button>
            ))}
          </SlideTrack>
          <button
            type="button"
            className={`sheet-switch${gridOn ? ' on' : ''}`}
            role="switch"
            aria-checked={gridOn}
            onClick={() => onGrid(!gridOn)}
          >
            <span>{t(locale, 'grid')}</span>
            <span className="switch" aria-hidden="true">
              <span className="switch-thumb" />
            </span>
          </button>
        </section>

        <section className="sheet-section">
          <h3>
            <SwapText text={t(locale, 'gestures')} />
          </h3>
          <ul className="sheet-keys">
            <li>
              {t(locale, 'wheel')} <span>{t(locale, 'zoom')}</span>
            </li>
            <li>
              {t(locale, 'spaceRmb')} <span>{t(locale, 'panHint')}</span>
            </li>
            <li>
              {modKey()}+Z <span>{t(locale, 'undo').replace(/ \(.+\)$/, '')}</span>
            </li>
            <li>
              {modKey()}+D <span>{t(locale, 'ctxDuplicate')}</span>
            </li>
          </ul>
        </section>
      </aside>
    </div>
  );
}
