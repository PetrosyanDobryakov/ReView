import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  pickerChromeThemeIds,
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
import { readPenSlots } from '../core/penColors';
import { adaptInkOnce } from '../core/store';
import { LOCALES, writeLocale, type LocaleId } from '../core/locale';
import { getCurrentBoardId } from '../core/store';
import {
  defaultSyncUrl,
  effectiveSyncUrl,
  fetchLanAddresses,
  getBoardRoomName,
  inviteHostname,
  isLocalHostname,
  isNetLogEnabled,
  isStaticHost,
  isSyncAvailable,
  isSyncEnabled,
  isP2pEnabled,
  lanAppUrl,
  netLog,
  reconnectSync,
  setNetLogEnabled,
  type SyncStatus,
} from '../net';
import { p2pSignalingUrls } from '../net/config';
import {
  CURSOR_SCALE_MAX,
  CURSOR_SCALE_MIN,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  parseSyncUrl,
  readPrefs,
  writePrefs,
  type AppPrefs,
} from '../core/prefs';
import { loadUser, onUserChange, saveUserColor, USER_COLOR_PALETTE } from '../core/user';
import type { ToolId } from '../engine/tools';
import { Icon, type IconName } from './icons';
import { BG_PRESETS, CHROME_LABEL, ORBIT_PAPER, modKey, pickerPaperPresets, t, type MessageKey } from './i18n';
import { isOrbitPaper } from '../core/orbit';
import { MOTION, useExitPresence } from './motion';
import { APP_VERSION } from '../core/version';

/**
 * 1.0 settings: a centered two-pane dialog. The rail scans top-down (you, then
 * four sections); each pane scrolls on its own. Same settings as the old sheet,
 * regrouped: nothing here writes new data.
 */
type Pane = 'look' | 'keys' | 'ui' | 'net';

const PANES: Array<{ id: Pane; icon: IconName; label: MessageKey }> = [
  { id: 'look', icon: 'palette', label: 'paneLook' },
  { id: 'keys', icon: 'keyboard', label: 'paneKeys' },
  { id: 'ui', icon: 'sliders', label: 'paneUi' },
  { id: 'net', icon: 'wifi', label: 'paneNet' },
];

type BindTarget = { kind: 'tool'; id: ToolId } | { kind: 'color'; color: string };

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

function plainLabel(text: string): string {
  return text
    .replace(/ \(.+\)$/, '')
    .replace(/ [—–-].+$/, '')
    .trim();
}

function isListeningTarget(listening: BindTarget | null, target: BindTarget): boolean {
  if (!listening || listening.kind !== target.kind) return false;
  if (listening.kind === 'tool' && target.kind === 'tool') return listening.id === target.id;
  if (listening.kind === 'color' && target.kind === 'color') return listening.color === target.color;
  return false;
}

function initialOf(name: string): string {
  const ch = [...name.trim()][0];
  return ch ? ch.toUpperCase() : '?';
}

function Toggle({
  label,
  hint,
  on,
  disabled,
  onChange,
}: {
  label: ReactNode;
  hint?: string;
  on: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      className={`sd-row sd-toggle${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="sd-row-text">
        <b>{label}</b>
        {hint ? <small>{hint}</small> : null}
      </span>
      <span className="switch" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </button>
  );
}

function Seg<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  label: string;
  onChange: (id: T) => void;
}) {
  return (
    <div className="sd-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={value === o.id ? 'on' : ''}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Range that commits on release (UI scale re-lays the whole chrome). */
function Range({
  value,
  min,
  max,
  step,
  label,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft != null) {
      onCommit(draft);
      setDraft(null);
    }
  };
  const pct = ((shown - min) / (max - min)) * 100;
  return (
    <span className="sd-range">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        aria-label={label}
        style={{ ['--fill' as string]: `${pct}%` }}
        onInput={(e) => setDraft(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => setDraft(Number((e.target as HTMLInputElement).value))}
        onPointerUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <output>{Math.round(shown * 100)}%</output>
    </span>
  );
}

/** Mini interface preview drawn in the theme's own tokens. */
function ThemePreview({ id, custom }: { id: ChromeThemeId; custom: CustomChromeColors }) {
  const style =
    id === 'custom'
      ? ({
          ['--chrome-bg' as string]: custom.bg,
          ['--chrome-panel' as string]: custom.panel,
          ['--chrome-border' as string]: 'rgba(127,127,127,.28)',
          ['--chrome-accent-strong' as string]: custom.accent,
          ['--chrome-text' as string]: custom.text,
        } as React.CSSProperties)
      : undefined;
  return (
    <span
      className={`sd-theme-pv${id === 'orbit' ? ' orbit-sky' : ''}`}
      data-chrome-theme={id === 'custom' ? undefined : id}
      style={style}
      aria-hidden="true"
    >
      <span className="pv-island pv-tl" />
      <span className="pv-island pv-tr" />
      <span className="pv-island pv-belt">
        <i className="on" />
        <i />
        <i />
        <i />
      </span>
    </span>
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
  focusSection = null,
  onNick,
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
  nick: string;
  hideBoardSection?: boolean;
  ephemeral?: boolean;
  focusSection?: 'connection' | null;
  onNick: (value: string) => void;
  onLocale: (id: LocaleId) => void;
  onChromeTheme: (id: ChromeThemeId) => void;
  onBg: (value: string) => void;
  onGrid: (on: boolean) => void;
  onClose: () => void;
}) {
  const mounted = useExitPresence(open, MOTION.sheetOut);
  const [pane, setPane] = useState<Pane>('look');
  /** Phones: the rail is a list; picking a section opens it full-screen. */
  const [phonePaneOpen, setPhonePaneOpen] = useState(false);
  const [customColors, setCustomColors] = useState<CustomChromeColors>(() => readCustomColors());
  const [prefs, setPrefs] = useState<AppPrefs>(() => readPrefs());
  const p2pOn = isP2pEnabled();
  const [userColor, setUserColor] = useState(() => loadUser().color);
  const [syncUrlDraft, setSyncUrlDraft] = useState(() => readPrefs().syncUrl ?? '');
  const [syncUrlError, setSyncUrlError] = useState(false);
  const [p2pSignalDraft, setP2pSignalDraft] = useState(() => readPrefs().p2pSignaling ?? '');
  const [p2pSignalError, setP2pSignalError] = useState(false);
  const [lanHosts, setLanHosts] = useState<string[]>([]);
  const [lanLoading, setLanLoading] = useState(false);
  const [lanError, setLanError] = useState(false);
  const [lanCopied, setLanCopied] = useState(false);
  const [netLogOn, setNetLogOn] = useState(() => isNetLogEnabled());
  const [query, setQuery] = useState('');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const boardSession = Boolean(getCurrentBoardId());
  const [customBoardBg, setCustomBoardBg] = useState(() => {
    // Orbit paper is its own preset, never a custom color: seeding Custom with
    // it re-applied Orbit and made Custom unreachable from the Orbit theme.
    const usable = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c) && !isOrbitPaper(c);
    if (!BG_PRESETS.some((p) => p.value === bg) && usable(bg)) return bg;
    try {
      const saved = localStorage.getItem('review-custom-board-bg');
      if (saved && usable(saved)) return saved;
    } catch {
      /* ignore */
    }
    return '#3a4550';
  });
  const [toolBinds, setToolBinds] = useState(() => getToolBinds());
  const [colorBinds, setColorBinds] = useState(() => getColorBinds());
  const [listening, setListening] = useState<BindTarget | null>(null);

  // Orbit is always on the menu in 1.0, tagged experimental; picking it unlocks it.
  const paperPresets = pickerPaperPresets(true);
  const themeIds = pickerChromeThemeIds(true);
  const orbitPaperSelected = isOrbitPaper(bg);
  const isCustomBg = !orbitPaperSelected && !paperPresets.some((p) => p.value === bg);

  useEffect(() => onUserChange((u) => setUserColor(u.color)), []);

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
    setPrefs(readPrefs());
    setUserColor(loadUser().color);
    setSyncUrlDraft(readPrefs().syncUrl ?? '');
    setSyncUrlError(false);
    setP2pSignalDraft(readPrefs().p2pSignaling ?? '');
    setP2pSignalError(false);
    setNetLogOn(isNetLogEnabled());
    setQuery('');
    setPhonePaneOpen(false);
    return onKeybindsChange(syncBinds);
  }, [open]);

  useEffect(() => {
    if (!open || focusSection !== 'connection') return;
    setPane('net');
    setPhonePaneOpen(true);
  }, [open, focusSection]);

  useEffect(() => {
    if (!open || pane !== 'net') return;
    if (typeof location !== 'undefined' && !isLocalHostname(location.hostname)) {
      setLanHosts([location.hostname]);
      setLanLoading(false);
      setLanError(false);
      return;
    }
    const ac = new AbortController();
    setLanLoading(true);
    setLanError(false);
    fetchLanAddresses(ac.signal)
      .then((info) => {
        setLanHosts(info.addresses);
        setLanError(info.addresses.length === 0);
      })
      .catch(() => {
        setLanHosts([]);
        setLanError(true);
      })
      .finally(() => setLanLoading(false));
    return () => ac.abort();
  }, [open, pane]);

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

  // Keep focus inside the dialog when it opens.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('.sd-nav.on')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const q = query.trim().toLowerCase();
  const actionRows = useMemo(
    () =>
      [
        { icon: 'undo' as IconName, label: plainLabel(t(locale, 'undo')), keys: [modKey(), 'Z'] },
        { icon: 'redo' as IconName, label: plainLabel(t(locale, 'redo')), keys: [modKey(), 'Shift', 'Z'] },
        { icon: 'copy' as IconName, label: t(locale, 'ctxCopy'), keys: [modKey(), 'C'] },
        { icon: 'paste' as IconName, label: t(locale, 'ctxPaste'), keys: [modKey(), 'V'] },
        { icon: 'duplicate' as IconName, label: t(locale, 'ctxDuplicate'), keys: [modKey(), 'D'] },
        { icon: 'lock' as IconName, label: t(locale, 'ctxLock'), keys: [modKey(), 'Shift', 'L'] },
        { icon: 'trash' as IconName, label: t(locale, 'ctxDelete'), keys: ['Del'] },
        { icon: 'plus' as IconName, label: t(locale, 'zoomIn'), keys: [modKey(), '+'] },
        { icon: 'minus' as IconName, label: t(locale, 'zoomOut'), keys: [modKey(), '−'] },
        { icon: 'fit' as IconName, label: t(locale, 'zoomFit'), keys: [modKey(), '1'] },
        { icon: 'search' as IconName, label: t(locale, 'zoomActual'), keys: [modKey(), '0'] },
        { icon: 'close' as IconName, label: t(locale, 'hideUiRow'), keys: ['H'] },
      ].filter((r) => !q || r.label.toLowerCase().includes(q) || r.keys.join(' ').toLowerCase().includes(q)),
    [locale, q]
  );

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

  const pickPane = (id: Pane) => {
    setListening(null);
    setPane(id);
    setPhonePaneOpen(true);
  };

  const toggleListen = (target: BindTarget) => {
    setListening((cur) => (isListeningTarget(cur, target) ? null : target));
  };

  const pickTheme = (id: ChromeThemeId) => {
    if (id === 'orbit' && !prefs.orbitUnlocked) patchPrefs({ orbitUnlocked: true });
    if (id === chromeTheme) return;
    onChromeTheme(id);
    writeChromeTheme(id);
  };

  const pickPaper = (value: string) => {
    if (isOrbitPaper(value) && !prefs.orbitUnlocked) patchPrefs({ orbitUnlocked: true });
    onBg(value);
  };

  const gridMode: 'none' | 'dots' | 'lines' = !gridOn ? 'none' : prefs.gridStyle;

  const toolRows = BIND_TOOL_ORDER.filter((id) => {
    if (!q) return true;
    const code = toolBinds[id] ?? getToolBind(id);
    return plainLabel(t(locale, id)).toLowerCase().includes(q) || codeToDisplay(code).toLowerCase() === q;
  });

  const paneTitle = (id: Pane) => t(locale, PANES.find((p) => p.id === id)!.label);

  const head = (id: Pane) => (
    <div className="sd-pane-h">
      <button
        type="button"
        className="icon-btn sd-back"
        aria-label={t(locale, 'close')}
        onClick={() => setPhonePaneOpen(false)}
      >
        <Icon name="chevronLeft" size={18} />
      </button>
      <h3>{paneTitle(id)}</h3>
      <button type="button" className="icon-btn" title={t(locale, 'close')} aria-label={t(locale, 'close')} onClick={onClose}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );

  const renderLook = () => (
    <>
      {head('look')}
      <section className="sd-grp">
        <div className="sd-grp-l">
          <span>{t(locale, 'ui')}</span>
          <span>{t(locale, 'chromeGroupHint')}</span>
        </div>
        <div className="sd-themes">
          {themeIds.map((id) => (
            <button
              type="button"
              key={id}
              className={`sd-theme${chromeTheme === id ? ' on' : ''}`}
              aria-pressed={chromeTheme === id}
              title={id === 'orbit' ? t(locale, 'orbitUnlockHint') : undefined}
              onClick={() => pickTheme(id)}
            >
              <ThemePreview id={id} custom={customColors} />
              <span className="sd-theme-name">
                {t(locale, CHROME_LABEL[id])}
                {id === 'orbit' ? <span className="sd-chip">{t(locale, 'expChip')}</span> : null}
              </span>
            </button>
          ))}
        </div>
        {chromeTheme === 'custom' && (
          <div className="sd-custom-colors" aria-label={t(locale, 'customColors2')}>
            {CUSTOM_COLOR_FIELDS.map(({ key, label }) => (
              <label key={key} className="sd-color-field" title={t(locale, label)}>
                <span className="sd-color-chip" style={{ background: customColors[key] }}>
                  <input type="color" value={customColors[key]} onChange={(e) => applyCustomColor(key, e.target.value)} />
                </span>
                <span>{t(locale, label)}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      {!hideBoardSection && (
        <>
          <section className="sd-grp">
            <div className="sd-grp-l">
              <span>{t(locale, 'paperGroup')}</span>
              <span>{t(locale, 'paperGroupHint')}</span>
            </div>
            <div className="sd-papers">
              {paperPresets.map((p) => {
                const orbit = p.value === ORBIT_PAPER;
                const on = orbit ? orbitPaperSelected : bg === p.value;
                return (
                  <button
                    type="button"
                    key={p.value}
                    className={`sd-paper${on ? ' on' : ''}${orbit ? ' orbit-sky' : ''}`}
                    style={orbit ? undefined : { backgroundColor: p.value, ['--dot' as string]: dotInk(p.value) }}
                    title={t(locale, p.label)}
                    aria-label={t(locale, p.label)}
                    aria-pressed={on}
                    onClick={() => pickPaper(p.value)}
                  />
                );
              })}
              <label
                className={`sd-paper sd-paper-custom${isCustomBg ? ' on' : ''}`}
                style={{ backgroundColor: isCustomBg ? bg : customBoardBg, ['--dot' as string]: dotInk(isCustomBg ? bg : customBoardBg) }}
                title={t(locale, 'bgCustom')}
              >
                <input
                  type="color"
                  aria-label={t(locale, 'bgCustom')}
                  value={/^#[0-9a-fA-F]{6}$/.test(bg) && isCustomBg ? bg : customBoardBg}
                  onClick={() => {
                    if (!isCustomBg) onBg(customBoardBg);
                  }}
                  onChange={(e) => {
                    setCustomBoardBg(e.target.value);
                    onBg(e.target.value);
                  }}
                />
                <Icon name="plus" size={14} />
              </label>
            </div>
            <div className="sd-row">
              <span className="sd-row-text">
                <b>{t(locale, 'gridStyle')}</b>
                <small>{t(locale, 'gridHint')}</small>
              </span>
              <Seg
                value={gridMode}
                label={t(locale, 'gridStyle')}
                options={[
                  { id: 'none', label: t(locale, 'gridNone') },
                  { id: 'dots', label: t(locale, 'gridDots') },
                  { id: 'lines', label: t(locale, 'gridLines') },
                ]}
                onChange={(id) => {
                  if (id === 'none') {
                    onGrid(false);
                    return;
                  }
                  if (!gridOn) onGrid(true);
                  patchPrefs({ gridStyle: id });
                }}
              />
            </div>
          </section>

          <section className="sd-grp">
            <div className="sd-grp-l">
              <span>{t(locale, 'inkSection')}</span>
            </div>
            <Toggle
              label={t(locale, 'adaptInk')}
              hint={t(locale, 'adaptInkHint')}
              on={prefs.adaptInkToPaper}
              onChange={(v) => patchPrefs({ adaptInkToPaper: v })}
            />
            <div className="sd-row">
              <span className="sd-row-text">
                <b>{t(locale, 'convertInk')}</b>
                <small>{t(locale, 'convertInkHint')}</small>
              </span>
              <button
                type="button"
                className="sd-btn"
                onClick={() => {
                  const n = adaptInkOnce();
                  if (n) {
                    try {
                      window.dispatchEvent(new CustomEvent('review-toast', { detail: { msg: `${n}` } }));
                    } catch {
                      /* ignore */
                    }
                  }
                }}
              >
                {t(locale, 'convertInkBtn')}
              </button>
            </div>
          </section>
        </>
      )}
    </>
  );

  const keycap = (code: string, active: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      className={`sd-kbd sd-kbd-btn${active ? ' listening' : ''}${code ? '' : ' empty'}`}
      aria-label={`${label}: ${active ? t(locale, 'bindPress') : codeToDisplay(code)}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {active ? t(locale, 'bindPress') : codeToDisplay(code)}
    </button>
  );

  const renderKeys = () => {
    const slots = readPenSlots();
    const colorRows = BIND_COLOR_ORDER.map((slot, index) => ({
      slot,
      index,
      swatch: slots[Number(slot)] ?? slots[index] ?? '#ffffff',
      label: t(locale, 'bindColor').replace('{n}', String(index + 1)),
    })).filter((r) => !q || r.label.toLowerCase().includes(q));
    const gestures: Array<[MessageKey, MessageKey]> = [
      ['wheel', 'zoom'],
      ['spaceRmb', 'panHint'],
      ['pinchTouch', 'pinchTouchHint'],
      ['longPressTouch', 'longPressTouchHint'],
      ['doubleTapTouch', 'doubleTapTouchHint'],
      ['rotateFree', 'rotateFreeHint'],
    ];
    const gestureRows = gestures.filter(
      ([a, b]) => !q || t(locale, a).toLowerCase().includes(q) || t(locale, b).toLowerCase().includes(q)
    );
    const empty = !toolRows.length && !colorRows.length && !actionRows.length && !gestureRows.length;
    return (
      <>
        {head('keys')}
        <label className="sd-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            value={query}
            placeholder={t(locale, 'keysSearch')}
            aria-label={t(locale, 'keysSearch')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        {empty && <p className="sd-empty">{t(locale, 'keysNone')}</p>}
        {toolRows.length > 0 && (
          <section className="sd-grp">
            <div className="sd-grp-l">
              <span>{t(locale, 'tools')}</span>
              <span>{t(locale, 'keysToolsHint')}</span>
            </div>
            <div className="sd-keys">
              {toolRows.map((id) => {
                const target: BindTarget = { kind: 'tool', id };
                const code = toolBinds[id] ?? getToolBind(id);
                const name = plainLabel(t(locale, id));
                return (
                  <div key={id} className="sd-key">
                    <Icon name={id as IconName} size={17} />
                    <span>{name}</span>
                    {keycap(code, isListeningTarget(listening, target), name, () => toggleListen(target))}
                  </div>
                );
              })}
            </div>
          </section>
        )}
        {colorRows.length > 0 && (
          <section className="sd-grp">
            <div className="sd-grp-l">
              <span>{t(locale, 'bindsColors')}</span>
            </div>
            <div className="sd-keys">
              {colorRows.map((r) => {
                const target: BindTarget = { kind: 'color', color: r.slot };
                const code = colorBinds[r.slot] ?? getColorBind(r.slot);
                return (
                  <div key={r.slot} className="sd-key">
                    <span className="sd-key-swatch" style={{ background: r.swatch }} aria-hidden="true" />
                    <span>{r.label}</span>
                    {keycap(code, isListeningTarget(listening, target), r.label, () => toggleListen(target))}
                  </div>
                );
              })}
            </div>
          </section>
        )}
        {actionRows.length > 0 && (
          <section className="sd-grp">
            <div className="sd-grp-l">
              <span>{t(locale, 'keysActions')}</span>
            </div>
            <div className="sd-keys">
              {actionRows.map((r) => (
                <div key={r.label} className="sd-key">
                  <Icon name={r.icon} size={17} />
                  <span>{r.label}</span>
                  <span className="sd-kbd-group">
                    {r.keys.map((k) => (
                      <kbd key={k} className="sd-kbd">
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
        {gestureRows.length > 0 && (
          <section className="sd-grp">
            <div className="sd-grp-l">
              <span>{t(locale, 'gestures')}</span>
              <span>{t(locale, 'gesturesHint')}</span>
            </div>
            <div className="sd-gestures">
              {gestureRows.map(([a, b]) => (
                <div key={a}>
                  <b>{t(locale, a)}</b>
                  {t(locale, b)}
                </div>
              ))}
            </div>
          </section>
        )}
        {!q && (
          <div className="sd-foot-actions">
            <button
              type="button"
              className="sd-btn"
              onClick={() => {
                setListening(null);
                resetKeybinds();
              }}
            >
              {t(locale, 'bindReset')}
            </button>
          </div>
        )}
      </>
    );
  };

  const renderUi = () => (
    <>
      {head('ui')}
      <section className="sd-grp">
        <div className="sd-row">
          <span className="sd-row-text">
            <b>{t(locale, 'language')}</b>
          </span>
          <Seg
            value={locale}
            label={t(locale, 'language')}
            options={LOCALES.map((id) => ({ id, label: id === 'ru' ? 'Русский' : id === 'en' ? 'English' : '中文' }))}
            onChange={(id) => {
              if (id === locale) return;
              const dir = LOCALES.indexOf(id) >= LOCALES.indexOf(locale) ? '1' : '-1';
              document.documentElement.style.setProperty('--locale-dir', dir);
              writeLocale(id);
              onLocale(id);
            }}
          />
        </div>
        <div className="sd-row">
          <span className="sd-row-text">
            <b>{t(locale, 'uiScale')}</b>
            <small>{t(locale, 'uiScaleHint')}</small>
          </span>
          <Range
            value={prefs.uiScale}
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={0.05}
            label={t(locale, 'uiScale')}
            onCommit={(v) => patchPrefs({ uiScale: v })}
          />
        </div>
        <div className="sd-row">
          <span className="sd-row-text">
            <b>{t(locale, 'toolCursorSize')}</b>
          </span>
          <Range
            value={prefs.toolCursorScale}
            min={CURSOR_SCALE_MIN}
            max={CURSOR_SCALE_MAX}
            step={0.05}
            label={t(locale, 'toolCursorSize')}
            onCommit={(v) => patchPrefs({ toolCursorScale: v })}
          />
        </div>
        <Toggle
          label={t(locale, 'toolHoverAnim')}
          hint={t(locale, 'toolHoverAnimHint')}
          on={prefs.toolHoverAnim}
          onChange={(v) => patchPrefs({ toolHoverAnim: v })}
        />
        <div className="sd-row">
          <span className="sd-row-text">
            <b>{t(locale, 'hideUiRow')}</b>
            <small>{t(locale, 'hideUiHint')}</small>
          </span>
          <kbd className="sd-kbd">H</kbd>
        </div>
      </section>
      <section className="sd-grp">
        <div className="sd-grp-l">
          <span>{t(locale, 'boardBehavior')}</span>
        </div>
        <Toggle
          label={t(locale, 'recognizeShapes')}
          hint={t(locale, 'recognizeShapesHint')}
          on={prefs.recognizeShapes}
          onChange={(v) => patchPrefs({ recognizeShapes: v })}
        />
        <Toggle
          label={t(locale, 'rotateSnap')}
          hint={t(locale, 'rotateSnapHint')}
          on={prefs.rotateSnap}
          onChange={(v) => patchPrefs({ rotateSnap: v })}
        />
        <Toggle
          label={t(locale, 'rotateHandleTop')}
          hint={t(locale, 'rotateHandleTopHint')}
          on={prefs.rotateHandleTop}
          onChange={(v) => patchPrefs({ rotateHandleTop: v })}
        />
        <Toggle
          label={t(locale, 'smoothPeerCursors')}
          hint={t(locale, 'smoothPeerCursorsHint')}
          on={prefs.smoothPeerCursors}
          onChange={(v) => patchPrefs({ smoothPeerCursors: v })}
        />
      </section>
    </>
  );

  const statusTitle = !boardSession
    ? t(locale, 'netHome')
    : !prefs.syncEnabled
      ? t(locale, 'netStatusOff')
      : sync.online
        ? t(locale, 'netStatusOnline')
        : t(locale, 'netStatusOffline');
  const statusSub = [
    boardSession && sync.online ? t(locale, 'netPeople').replace('{n}', String(Math.max(1, sync.users))) : null,
    boardSession ? `${t(locale, 'persist')}: ${ephemeral ? t(locale, 'persistSession') : saved ? t(locale, 'persistSaved') : t(locale, 'loading')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const inviteHost = inviteHostname(lanHosts);
  const inviteUrl = inviteHost ? lanAppUrl(inviteHost) : '';

  const renderNet = () => (
    <>
      {head('net')}
      <div className={`sd-status${boardSession && prefs.syncEnabled && sync.online ? ' on' : ''}`}>
        <span className="pulse" aria-hidden="true" />
        <span className="sd-row-text">
          <b>{statusTitle}</b>
          {statusSub ? <small>{statusSub}</small> : null}
        </span>
        {boardSession && (
          <button
            type="button"
            className="sd-btn"
            onClick={() => {
              const next = writePrefs({ syncEnabled: !prefs.syncEnabled });
              setPrefs(next);
              reconnectSync();
            }}
          >
            {prefs.syncEnabled ? t(locale, 'syncDisconnect') : t(locale, 'syncConnect')}
          </button>
        )}
      </div>

      <section className="sd-grp">
        <div className="sd-grp-l">
          <span>{t(locale, 'netSameWifi')}</span>
        </div>
        <div className="sd-addr">
          <code className={inviteUrl ? '' : 'dim'}>
            {lanLoading ? t(locale, 'syncLanLoading') : inviteUrl || t(locale, 'syncLanEmpty')}
          </code>
          <button
            type="button"
            className="sd-btn"
            disabled={lanLoading || !inviteUrl}
            onClick={async () => {
              if (!inviteUrl) return;
              try {
                await navigator.clipboard.writeText(inviteUrl);
                setLanCopied(true);
                window.setTimeout(() => setLanCopied(false), 2000);
              } catch {
                prompt(t(locale, 'syncLanCopyApp'), inviteUrl);
              }
            }}
          >
            <Icon name="copy" size={16} />
            {lanCopied ? t(locale, 'syncLanCopied') : t(locale, 'ctxCopy')}
          </button>
        </div>
        {!lanLoading && (lanError || !inviteUrl) ? <p className="sd-note">{t(locale, 'syncLanFirewall')}</p> : null}
      </section>

      <section className="sd-grp">
        <Toggle
          label={t(locale, 'saveRemoteBoards')}
          hint={t(locale, 'saveRemoteBoardsHint')}
          on={prefs.saveRemoteBoards}
          onChange={(v) => patchPrefs({ saveRemoteBoards: v })}
        />
        <Toggle
          label={t(locale, 'p2p')}
          hint={t(locale, 'p2pHint')}
          on={p2pOn}
          disabled={!boardSession}
          onChange={(v) => {
            setPrefs(writePrefs({ p2pEnabled: v }));
            reconnectSync();
          }}
        />
        {isStaticHost() && !isSyncAvailable() && !p2pOn && (
          <p className="sd-note">
            <strong>{t(locale, 'staticMode')}</strong> {t(locale, 'staticModeHint')}
          </p>
        )}
      </section>

      <details className="sd-dev">
        <summary>
          <Icon name="chevronRight" size={14} />
          {t(locale, 'devSection')}
        </summary>
        <div className="sd-dev-body">
          <ul className="sd-facts">
            <li>
              <span>{t(locale, 'syncRoom')}</span>
              <code>{getBoardRoomName(getCurrentBoardId())}</code>
            </li>
            <li>
              <span>{t(locale, 'syncUrl')}</span>
              <code title={isSyncEnabled() ? effectiveSyncUrl() : ''}>
                {isSyncEnabled() && effectiveSyncUrl() ? effectiveSyncUrl() : '—'}
              </code>
            </li>
          </ul>
          <label className="sd-field">
            <span>{t(locale, 'syncUrl')}</span>
            <input
              type="text"
              className="nick-input"
              value={syncUrlDraft}
              placeholder={defaultSyncUrl()}
              spellCheck={false}
              disabled={!boardSession}
              aria-invalid={syncUrlError}
              onChange={(e) => {
                setSyncUrlDraft(e.target.value);
                setSyncUrlError(false);
              }}
            />
            <small>{t(locale, syncUrlError ? 'syncUrlInvalid' : 'syncUrlHint')}</small>
          </label>
          <div className="sd-foot-actions">
            <button
              type="button"
              className="sd-btn primary"
              disabled={!boardSession}
              onClick={() => {
                const trimmed = syncUrlDraft.trim();
                if (trimmed) {
                  const parsed = parseSyncUrl(trimmed);
                  if (!parsed) {
                    setSyncUrlError(true);
                    return;
                  }
                  const next = writePrefs({ syncUrl: parsed });
                  setPrefs(next);
                  setSyncUrlDraft(next.syncUrl ?? '');
                } else {
                  const next = writePrefs({ syncUrl: null });
                  setPrefs(next);
                  setSyncUrlDraft('');
                }
                setSyncUrlError(false);
                reconnectSync();
              }}
            >
              {t(locale, 'syncUrlApply')}
            </button>
            <button
              type="button"
              className="sd-btn"
              disabled={!boardSession}
              onClick={() => {
                const next = writePrefs({ syncUrl: null });
                setPrefs(next);
                setSyncUrlDraft('');
                setSyncUrlError(false);
                reconnectSync();
              }}
            >
              {t(locale, 'syncUrlReset')}
            </button>
          </div>
          <label className="sd-field">
            <span>{t(locale, 'p2pSignaling')}</span>
            <input
              type="text"
              className="nick-input"
              value={p2pSignalDraft}
              placeholder={p2pSignalingUrls().join(', ')}
              spellCheck={false}
              disabled={!boardSession || !p2pOn}
              aria-invalid={p2pSignalError}
              onChange={(e) => {
                setP2pSignalDraft(e.target.value);
                setP2pSignalError(false);
              }}
            />
            <small>{p2pSignalError ? t(locale, 'p2pSignalingInvalid') : t(locale, 'p2pSignalingHint')}</small>
          </label>
          <div className="sd-foot-actions">
            <button
              type="button"
              className="sd-btn primary"
              disabled={!boardSession || !p2pOn}
              onClick={() => {
                const trimmed = p2pSignalDraft.trim();
                if (trimmed) {
                  if (!/^wss?:\/\//i.test(trimmed)) {
                    setP2pSignalError(true);
                    return;
                  }
                  const next = writePrefs({ p2pSignaling: trimmed });
                  setPrefs(next);
                  setP2pSignalDraft(next.p2pSignaling ?? '');
                } else {
                  const next = writePrefs({ p2pSignaling: null });
                  setPrefs(next);
                  setP2pSignalDraft('');
                }
                setP2pSignalError(false);
                reconnectSync();
              }}
            >
              {t(locale, 'syncUrlApply')}
            </button>
            <button
              type="button"
              className="sd-btn"
              disabled={!boardSession || !p2pOn}
              onClick={() => {
                const next = writePrefs({ p2pSignaling: null });
                setPrefs(next);
                setP2pSignalDraft('');
                setP2pSignalError(false);
                reconnectSync();
              }}
            >
              {t(locale, 'syncUrlReset')}
            </button>
          </div>
          <Toggle
            label={t(locale, 'netLog')}
            hint={t(locale, 'netLogHint')}
            on={netLogOn}
            onChange={(next) => {
              setNetLogEnabled(next);
              setNetLogOn(next);
              if (next) netLog.info('logging enabled via settings');
            }}
          />
        </div>
      </details>
    </>
  );

  return (
    <div className={`sheet-root sd-root${open ? '' : ' is-leaving'}`} role="presentation">
      <button className="sheet-backdrop sd-backdrop" aria-label={t(locale, 'closeSettings')} onClick={onClose} />
      <div
        ref={dialogRef}
        className={`sd${phonePaneOpen ? ' pane-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, 'settings')}
        aria-hidden={!open}
      >
        <nav className="sd-rail" aria-label={t(locale, 'settings')}>
          <div className="sd-me">
            <button
              type="button"
              className="icon-btn sd-rail-close"
              title={t(locale, 'close')}
              aria-label={t(locale, 'close')}
              onClick={onClose}
            >
              <Icon name="close" size={18} />
            </button>
            <span className="sd-me-av" style={{ background: userColor, ['--ring' as string]: userColor }} aria-hidden="true">
              {initialOf(nick)}
            </span>
            <span className="sd-me-text">
              <input
                type="text"
                className="sd-me-name"
                value={nick}
                maxLength={24}
                placeholder={t(locale, 'nicknameHint')}
                aria-label={t(locale, 'nickname')}
                onChange={(e) => onNick(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <small>{t(locale, 'identityHint')}</small>
            </span>
          </div>
          <div className="sd-me-colors" role="group" aria-label={t(locale, 'membersColor')}>
            {USER_COLOR_PALETTE.map((c) => (
              <button
                type="button"
                key={c}
                className={`sd-me-swatch${userColor.toLowerCase() === c.toLowerCase() ? ' on' : ''}`}
                style={{ background: c }}
                title={c}
                aria-label={c}
                aria-pressed={userColor.toLowerCase() === c.toLowerCase()}
                onClick={() => setUserColor(saveUserColor(c).color)}
              />
            ))}
          </div>
          {PANES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`sd-nav${pane === p.id ? ' on' : ''}`}
              aria-current={pane === p.id ? 'page' : undefined}
              onClick={() => pickPane(p.id)}
            >
              <Icon name={p.icon} size={18} />
              <span>{t(locale, p.label)}</span>
              <Icon name="chevronRight" size={14} />
            </button>
          ))}
          <div className="sd-rail-foot">v{APP_VERSION} · ReView</div>
        </nav>
        <div className="sd-pane" key={pane}>
          {pane === 'look' && renderLook()}
          {pane === 'keys' && renderKeys()}
          {pane === 'ui' && renderUi()}
          {pane === 'net' && renderNet()}
        </div>
      </div>
    </div>
  );
}

/** Dot color for a paper swatch preview (matches the board's dot grid ink). */
function dotInk(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/i.test(hex)) return 'rgba(236,234,228,.2)';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 140 ? 'rgba(26,26,28,.2)' : 'rgba(236,234,228,.2)';
}
