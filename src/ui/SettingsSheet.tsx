import { CHROME_THEME_IDS, writeChromeTheme, type ChromeThemeId } from '../core/chromeTheme';
import { LOCALES, writeLocale, type LocaleId } from '../core/locale';
import { Icon } from './icons';
import { BG_PRESETS, CHROME_LABEL, t } from './i18n';

export function SettingsSheet({
  open,
  locale,
  chromeTheme,
  bg,
  gridOn,
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
  onLocale: (id: LocaleId) => void;
  onChromeTheme: (id: ChromeThemeId) => void;
  onBg: (value: string) => void;
  onGrid: (on: boolean) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="sheet-root" role="presentation">
      <button className="sheet-backdrop" aria-label={t(locale, 'closeSettings')} onClick={onClose} />
      <aside className="sheet" role="dialog" aria-labelledby="settings-title">
        <header className="sheet-head">
          <h2 id="settings-title">{t(locale, 'settings')}</h2>
          <button className="icon-btn" title={t(locale, 'close')} onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </header>

        <section className="sheet-section">
          <h3>{t(locale, 'language')}</h3>
          <div className="locale-row">
            {LOCALES.map((id) => (
              <button
                key={id}
                className={`style-btn${locale === id ? ' active' : ''}`}
                onClick={() => {
                  writeLocale(id);
                  onLocale(id);
                }}
              >
                {id.toUpperCase()}
              </button>
            ))}
          </div>
        </section>

        <section className="sheet-section">
          <h3>{t(locale, 'ui')}</h3>
          <p className="sheet-hint">{t(locale, 'uiHint')}</p>
          <div className="theme-grid">
            {CHROME_THEME_IDS.map((id) => (
              <button
                key={id}
                className={`theme-card${chromeTheme === id ? ' active' : ''}`}
                data-theme-preview={id}
                onClick={() => {
                  onChromeTheme(id);
                  writeChromeTheme(id);
                }}
              >
                {t(locale, CHROME_LABEL[id])}
              </button>
            ))}
          </div>
        </section>

        <section className="sheet-section">
          <h3>{t(locale, 'board')}</h3>
          <div className="bg-grid">
            {BG_PRESETS.map((p) => (
              <button
                key={p.value}
                className={`bg-card${bg === p.value ? ' active' : ''}${p.value.startsWith('#f') ? ' light' : ''}`}
                style={{ background: p.value }}
                title={t(locale, p.label)}
                onClick={() => onBg(p.value)}
              >
                <span>{t(locale, p.label)}</span>
              </button>
            ))}
          </div>
          <label className="sheet-check">
            <input type="checkbox" checked={gridOn} onChange={(e) => onGrid(e.target.checked)} />
            {t(locale, 'grid')}
          </label>
        </section>

        <section className="sheet-section">
          <h3>{t(locale, 'gestures')}</h3>
          <ul className="sheet-keys">
            <li>
              {t(locale, 'wheel')} <span>{t(locale, 'zoom')}</span>
            </li>
            <li>
              {t(locale, 'spaceRmb')} <span>{t(locale, 'panHint')}</span>
            </li>
            <li>
              Ctrl+Z <span>{t(locale, 'undo').split(' (')[0]}</span>
            </li>
            <li>
              Ctrl+D <span>{t(locale, 'ctxDuplicate')}</span>
            </li>
          </ul>
        </section>
      </aside>
    </div>
  );
}
