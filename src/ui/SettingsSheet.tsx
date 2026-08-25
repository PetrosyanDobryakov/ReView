import { useEffect, useState, type ReactNode } from 'react';
import {
  CHROME_THEME_IDS,
  readCustomColors,
  writeChromeTheme,
  writeCustomColors,
  type ChromeThemeId,
  type CustomChromeColors,
} from '../core/chromeTheme';
import {
  BIND_COLOR_ORDER,
  BIND_TOOL_ORDER,
  codeToDisplay,
  getColorBind,
  getColorBinds,
  getToolBind,
  getToolBinds,
  onKeybindsChange,
  resetKeybinds,
  setColorBind,
  setToolBind,
} from '../core/keybindings';
import { LOCALES, writeLocale, type LocaleId } from '../core/locale';
import type { SyncStatus } from '../core/store';
import {
  CURSOR_SCALE_MAX,
  CURSOR_SCALE_MIN,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  readPrefs,
  writePrefs,
  type AppPrefs,
} from '../core/prefs';
import type { ToolId } from '../engine/tools';
import { Icon, type IconName } from './icons';
import { BG_PRESETS, CHROME_LABEL, modKey, t } from './i18n';
import { MOTION, useExitPresence } from './motion';
import { SlideTrack } from './SlideTrack';
import { SwapText } from './SwapText';

type SettingsTab = 'system' | 'binds' | 'customize';

type BindTarget =
  | { kind: 'tool'; id: ToolId }
  | { kind: 'color'; color: string };

const TABS: SettingsTab[] = ['system', 'binds', 'customize'];

const TAB_LABEL: Record<SettingsTab, 'tabSystem' | 'tabBinds' | 'tabCustomize'> = {
  system: 'tabSystem',
  binds: 'tabBinds',
  customize: 'tabCustomize',
};

const CUSTOM_COLOR_FIELDS: Array<{
  key: keyof CustomChromeColors;
  label: 'customBg' | 'customPanel' | 'customText' | 'customAccent';
}> = [
  { key: 'bg', label: 'customBg' },
  { key: 'panel', label: 'customPanel' },
  { key: 'text', label: 'customText' },
  { key: 'accent', label: 'customAccent' },
];

const BLOCKED_BIND_CODES = new Set([
  'Escape',
  'Tab',
  'Enter',
  'Space',
  'MetaLeft',
  'MetaRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'CapsLock',
  'ContextMenu',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

function toolBindLabel(locale: LocaleId, id: ToolId): string {
  return t(locale, id)
    .replace(/ \(.+\)$/, '')
    .replace(/ [—–-].+$/, '')
    .trim();
}

function isLightPaper(hex: string): boolean {
  if (!/^#[0-9a-fA-F]{6}$/i.test(hex)) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 168;
}

function isListeningTarget(listening: BindTarget | null, target: BindTarget): boolean {
  if (!listening || listening.kind !== target.kind) return false;
  if (listening.kind === 'tool' && target.kind === 'tool') return listening.id === target.id;
  if (listening.kind === 'color' && target.kind === 'color') return listening.color === target.color;
  return false;
}

/** Height rollout for custom color swatches when Custom is chosen. */
function CustomSwatchRollout({ open, children }: { open: boolean; children: ReactNode }) {
  const mounted = useExitPresence(open, MOTION.sheet);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!mounted || !open) {
      setExpanded(false);
      return;
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setExpanded(true));
    });
    return () => cancelAnimationFrame(id);
  }, [mounted, open]);

  if (!mounted) return null;
  return (
    <div className={`custom-theme-roll${expanded ? ' is-open' : ''}`}>
      <div className="custom-theme-roll-clip">
        <div className="custom-theme-row">{children}</div>
      </div>
    </div>
  );
}

export function SettingsSheet({
  open,
  locale,
  chromeTheme,
  bg,
  gridOn,
  sync,
  saved,
  nick,
  hideBoardSection = false,
  ephemeral = false,
  onNick,
  onLocale,
  onChromeTheme,
  onBg,
  onPaperReset,
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
  nick: string;
  hideBoardSection?: boolean;
  ephemeral?: boolean;
  onNick: (value: string) => void;
  onLocale: (id: LocaleId) => void;
  onChromeTheme: (id: ChromeThemeId) => void;
  onBg: (value: string) => void;
  onPaperReset?: () => void;
  onGrid: (on: boolean) => void;
  onClose: () => void;
}) {
  const mounted = useExitPresence(open, MOTION.sheetOut);
  const [tab, setTab] = useState<SettingsTab>('system');
  const [customColors, setCustomColors] = useState<CustomChromeColors>(() => readCustomColors());
  const [prefs, setPrefs] = useState<AppPrefs>(() => readPrefs());
  const [customBoardBg, setCustomBoardBg] = useState(() => {
    if (!BG_PRESETS.some((p) => p.value === bg) && /^#[0-9a-fA-F]{6}$/.test(bg)) return bg;
    try {
      const saved = localStorage.getItem('review-custom-board-bg');
      if (saved && /^#[0-9a-fA-F]{6}$/.test(saved)) return saved;
    } catch {
      /* ignore */
    }
    return '#3a4550';
  });
  const [toolBinds, setToolBinds] = useState(() => getToolBinds());
  const [colorBinds, setColorBinds] = useState(() => getColorBinds());
  const [listening, setListening] = useState<BindTarget | null>(null);

  const isCustomBg = !BG_PRESETS.some((p) => p.value === bg);

  useEffect(() => {
    if (isCustomBg && /^#[0-9a-fA-F]{6}$/.test(bg)) {
      setCustomBoardBg(bg);
      try {
        localStorage.setItem('review-custom-board-bg', bg);
      } catch {
        /* ignore */
      }
    }
  }, [bg, isCustomBg]);

  useEffect(() => {
    if (!open) {
      setListening(null);
      return;
    }
    const syncBinds = () => {
      setToolBinds(getToolBinds());
      setColorBinds(getColorBinds());
    };
    syncBinds();
    return onKeybindsChange(syncBinds);
  }, [open]);

  useEffect(() => {
    if (!listening) return;

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setListening(null);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (listening.kind === 'tool') setToolBind(listening.id, '');
        else setColorBind(listening.color, '');
        setListening(null);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (BLOCKED_BIND_CODES.has(e.code)) return;
      if (/^F\d+$/.test(e.code)) return;

      if (listening.kind === 'tool') setToolBind(listening.id, e.code);
      else setColorBind(listening.color, e.code);
      setListening(null);
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening]);

  if (!mounted) return null;

  const applyCustomColor = (key: keyof CustomChromeColors, value: string) => {
    const next = { ...customColors, [key]: value };
    setCustomColors(next);
    writeCustomColors(next);
    writeChromeTheme('custom');
    onChromeTheme('custom');
  };

  const patchPrefs = (patch: Partial<AppPrefs>) => {
    setPrefs(writePrefs(patch));
  };

  const switchTab = (next: SettingsTab) => {
    if (next === tab) return;
    setListening(null);
    setTab(next);
  };

  const toggleListen = (target: BindTarget) => {
    setListening((cur) => (isListeningTarget(cur, target) ? null : target));
  };

  return (
    <div className={`sheet-root${open ? '' : ' is-leaving'}`} role="presentation">
      <button className="sheet-backdrop" aria-label={t(locale, 'closeSettings')} onClick={onClose} />
      <aside className="sheet" role="dialog" aria-labelledby="settings-title" aria-hidden={!open}>
        <div className="sheet-top">
          <header className="sheet-head">
            <h2 id="settings-title">
              <SwapText text={t(locale, 'settings')} />
            </h2>
            <button type="button" className="icon-btn" title={t(locale, 'close')} aria-label={t(locale, 'close')} onClick={onClose}>
              <Icon name="close" size={16} />
            </button>
          </header>

          <div role="tablist" aria-label={t(locale, 'settings')}>
            <SlideTrack className="sheet-tabs" active={tab}>
              {TABS.map((id) => (
                <button
                  type="button"
                  key={id}
                  role="tab"
                  className="style-btn"
                  id={`settings-tab-${id}`}
                  data-slide-active={tab === id ? 'true' : undefined}
                  aria-selected={tab === id}
                  aria-controls={`settings-panel-${id}`}
                  onClick={() => switchTab(id)}
                >
                  <SwapText text={t(locale, TAB_LABEL[id])} />
                </button>
              ))}
            </SlideTrack>
          </div>
        </div>

        <div className="sheet-body">
          {tab === 'system' && (
            <div id="settings-panel-system" role="tabpanel" aria-labelledby="settings-tab-system" className="sheet-panel">
              <section className="sheet-section">
                <h3>
                  <SwapText text={t(locale, 'profile')} />
                </h3>
                <label className="nick-row">
                  <span>{t(locale, 'nickname')}</span>
                  <input
                    type="text"
                    className="nick-input"
                    value={nick}
                    maxLength={24}
                    placeholder={t(locale, 'nicknameHint')}
                    onChange={(e) => onNick(e.target.value)}
                  />
                </label>
              </section>

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
                    <span className={`status-line${ephemeral ? ' wait' : saved ? ' on' : ' wait'}`}>{t(locale, 'persist')}</span>
                    <span>{ephemeral ? t(locale, 'persistSession') : saved ? t(locale, 'persistSaved') : t(locale, 'loading')}</span>
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
                  <SwapText text={t(locale, 'advanced')} />
                </h3>
                <label className="sheet-range">
                  <span>{t(locale, 'uiScale')}</span>
                  <input
                    type="range"
                    min={UI_SCALE_MIN}
                    max={UI_SCALE_MAX}
                    step={0.05}
                    value={prefs.uiScale}
                    onChange={(e) => patchPrefs({ uiScale: Number(e.target.value) })}
                  />
                  <span className="sheet-range-value">{Math.round(prefs.uiScale * 100)}%</span>
                </label>
                <label className="sheet-range">
                  <span>{t(locale, 'toolCursorSize')}</span>
                  <input
                    type="range"
                    min={CURSOR_SCALE_MIN}
                    max={CURSOR_SCALE_MAX}
                    step={0.05}
                    value={prefs.toolCursorScale}
                    onChange={(e) => patchPrefs({ toolCursorScale: Number(e.target.value) })}
                  />
                  <span className="sheet-range-value">{Math.round(prefs.toolCursorScale * 100)}%</span>
                </label>
                <button
                  type="button"
                  className={`sheet-switch${prefs.toolHoverAnim ? ' on' : ''}`}
                  role="switch"
                  aria-checked={prefs.toolHoverAnim}
                  onClick={() => patchPrefs({ toolHoverAnim: !prefs.toolHoverAnim })}
                >
                  <span>{t(locale, 'toolHoverAnim')}</span>
                  <span className="switch" aria-hidden="true">
                    <span className="switch-thumb" />
                  </span>
                </button>
                <p className="sheet-hint">
                  <SwapText text={t(locale, 'toolHoverAnimHint')} />
                </p>
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
                    {t(locale, 'rotateSnap')} <span>{t(locale, 'rotateSnapGesture')}</span>
                  </li>
                  <li>
                    {t(locale, 'rotateFree')} <span>{t(locale, 'rotateFreeHint')}</span>
                  </li>
                  <li>
                    {modKey()}+Z <span>{t(locale, 'undo').replace(/ \(.+\)$/, '')}</span>
                  </li>
                  <li>
                    {modKey()}+D <span>{t(locale, 'ctxDuplicate')}</span>
                  </li>
                </ul>
              </section>
            </div>
          )}

          {tab === 'binds' && (
            <div id="settings-panel-binds" role="tabpanel" aria-labelledby="settings-tab-binds" className="sheet-panel">
              <section className="sheet-section">
                <h3>
                  <SwapText text={t(locale, 'tools')} />
                </h3>
                <p className="sheet-hint">
                  <SwapText text={t(locale, 'bindsHint')} />
                </p>
                <ul className="bind-list">
                  {BIND_TOOL_ORDER.map((id) => {
                    const target: BindTarget = { kind: 'tool', id };
                    const code = toolBinds[id] ?? getToolBind(id);
                    const name = toolBindLabel(locale, id);
                    const active = isListeningTarget(listening, target);
                    return (
                      <li key={id} className="bind-row">
                        <span className="bind-label">
                          <Icon name={id as IconName} size={16} />
                          <span>{name}</span>
                        </span>
                        <button
                          type="button"
                          className={`bind-key${active ? ' listening' : ''}${code ? '' : ' empty'}`}
                          aria-label={`${name}: ${active ? t(locale, 'bindPress') : codeToDisplay(code)}`}
                          aria-pressed={active}
                          onClick={() => toggleListen(target)}
                        >
                          {active ? t(locale, 'bindPress') : codeToDisplay(code)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="sheet-section">
                <h3>
                  <SwapText text={t(locale, 'bindsColors')} />
                </h3>
                <ul className="bind-list">
                  {BIND_COLOR_ORDER.map((color) => {
                    const target: BindTarget = { kind: 'color', color };
                    const code = colorBinds[color] ?? getColorBind(color);
                    const active = isListeningTarget(listening, target);
                    return (
                      <li key={color} className="bind-row">
                        <span className="bind-label">
                          <span className="bind-swatch" style={{ background: color }} aria-hidden="true" />
                          <span className="bind-hex">{color}</span>
                        </span>
                        <button
                          type="button"
                          className={`bind-key${active ? ' listening' : ''}${code ? '' : ' empty'}`}
                          aria-label={`${color}: ${active ? t(locale, 'bindPress') : codeToDisplay(code)}`}
                          aria-pressed={active}
                          onClick={() => toggleListen(target)}
                        >
                          {active ? t(locale, 'bindPress') : codeToDisplay(code)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <button
                type="button"
                className="sheet-action"
                onClick={() => {
                  setListening(null);
                  resetKeybinds();
                }}
              >
                <SwapText text={t(locale, 'bindReset')} />
              </button>
            </div>
          )}

          {tab === 'customize' && (
            <div id="settings-panel-customize" role="tabpanel" aria-labelledby="settings-tab-customize" className="sheet-panel">
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
                      style={
                        id === 'custom'
                          ? { background: customColors.bg, color: customColors.accent }
                          : undefined
                      }
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
                <CustomSwatchRollout open={chromeTheme === 'custom'}>
                  {CUSTOM_COLOR_FIELDS.map(({ key, label }) => (
                    <label
                      key={key}
                      className="custom-color"
                      title={t(locale, label)}
                      aria-label={t(locale, label)}
                      style={{ background: customColors[key] }}
                    >
                      <input
                        type="color"
                        value={customColors[key]}
                        onChange={(e) => applyCustomColor(key, e.target.value)}
                      />
                    </label>
                  ))}
                </CustomSwatchRollout>
              </section>

              {!hideBoardSection && (
                <section className="sheet-section">
                  <h3>
                    <SwapText text={t(locale, 'board')} />
                  </h3>
                  <SlideTrack className="bg-grid" active={isCustomBg ? 'custom' : bg}>
                    {BG_PRESETS.map((p) => (
                      <button
                        type="button"
                        key={p.value}
                        className={`bg-card${isLightPaper(p.value) ? ' light' : ''}`}
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
                    <button
                      type="button"
                      className={`bg-card${isLightPaper(isCustomBg ? bg : customBoardBg) ? ' light' : ''}`}
                      data-slide-active={isCustomBg ? 'true' : undefined}
                      style={{ background: isCustomBg ? bg : customBoardBg }}
                      title={t(locale, 'bgCustom')}
                      aria-label={t(locale, 'bgCustom')}
                      aria-pressed={isCustomBg}
                      onClick={() => onBg(customBoardBg)}
                    >
                      <span>{t(locale, 'bgCustom')}</span>
                    </button>
                  </SlideTrack>
                  <CustomSwatchRollout open={isCustomBg}>
                    <label
                      className="custom-color"
                      title={t(locale, 'bgCustom')}
                      aria-label={t(locale, 'bgCustom')}
                      style={{ background: /^#[0-9a-fA-F]{6}$/.test(bg) ? bg : customBoardBg }}
                    >
                      <input
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(bg) ? bg : customBoardBg}
                        onChange={(e) => {
                          setCustomBoardBg(e.target.value);
                          onBg(e.target.value);
                        }}
                      />
                    </label>
                  </CustomSwatchRollout>
                  {onPaperReset && (
                    <button type="button" className="style-btn" onClick={onPaperReset}>
                      {t(locale, 'paperUseBoard')}
                    </button>
                  )}
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
                  <button
                    type="button"
                    className={`sheet-switch${prefs.adaptInkToPaper ? ' on' : ''}`}
                    role="switch"
                    aria-checked={prefs.adaptInkToPaper}
                    onClick={() => patchPrefs({ adaptInkToPaper: !prefs.adaptInkToPaper })}
                  >
                    <span>{t(locale, 'adaptInk')}</span>
                    <span className="switch" aria-hidden="true">
                      <span className="switch-thumb" />
                    </span>
                  </button>
                  <p className="sheet-hint">
                    <SwapText text={t(locale, 'adaptInkHint')} />
                  </p>
                  <button
                    type="button"
                    className={`sheet-switch${prefs.recognizeShapes ? ' on' : ''}`}
                    role="switch"
                    aria-checked={prefs.recognizeShapes}
                    onClick={() => patchPrefs({ recognizeShapes: !prefs.recognizeShapes })}
                  >
                    <span>{t(locale, 'recognizeShapes')}</span>
                    <span className="switch" aria-hidden="true">
                      <span className="switch-thumb" />
                    </span>
                  </button>
                  <p className="sheet-hint">
                    <SwapText text={t(locale, 'recognizeShapesHint')} />
                  </p>
                  <button
                    type="button"
                    className={`sheet-switch${prefs.rotateSnap ? ' on' : ''}`}
                    role="switch"
                    aria-checked={prefs.rotateSnap}
                    onClick={() => patchPrefs({ rotateSnap: !prefs.rotateSnap })}
                  >
                    <span>{t(locale, 'rotateSnap')}</span>
                    <span className="switch" aria-hidden="true">
                      <span className="switch-thumb" />
                    </span>
                  </button>
                  <p className="sheet-hint">
                    <SwapText text={t(locale, 'rotateSnapHint')} />
                  </p>
                </section>
              )}
            </div>
          )}
        </div>
        <div className="sheet-fade" aria-hidden="true" />
      </aside>
    </div>
  );
}
