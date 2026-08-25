import { COLORS } from './shapes';

export type ChromeThemeId = 'packet' | 'archive' | 'studio' | 'white' | 'ink' | 'ocean' | 'forest' | 'sunset' | 'custom';

export const CHROME_THEME_IDS: ChromeThemeId[] = [
  'packet',
  'archive',
  'ink',
  'studio',
  'white',
  'ocean',
  'forest',
  'sunset',
  'custom',
];

const STORAGE_KEY = 'review-chrome-theme';
const CUSTOM_KEY = 'review-chrome-theme-custom';

const THEME_COLORS: Record<Exclude<ChromeThemeId, 'custom'>, string> = {
  packet: '#242422',
  archive: '#2a2622',
  studio: '#d8d4cc',
  white: '#f4f4f5',
  ink: '#0e0e0e',
  ocean: '#16202b',
  forest: '#17201a',
  sunset: '#241a20',
};

export interface CustomChromeColors {
  bg: string;
  panel: string;
  text: string;
  accent: string;
}

export const DEFAULT_CUSTOM_COLORS: CustomChromeColors = {
  bg: '#242422',
  panel: '#2e2e2b',
  text: '#eceae4',
  accent: '#d4cfc4',
};

function isHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function channel(value: string, i: number): number {
  return parseInt(value.slice(1 + i * 2, 3 + i * 2), 16);
}

function hexToRgb(value: string): [number, number, number] {
  return [channel(value, 0), channel(value, 1), channel(value, 2)];
}

function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

/** Mix `a` towards `b` by t (0..1). */
function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
}

function luminance(value: string): number {
  const [r, g, b] = hexToRgb(value);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function rgba(value: string, alpha: number): string {
  const [r, g, b] = hexToRgb(value);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function readCustomColors(): CustomChromeColors {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CustomChromeColors>;
      if (
        isHex(parsed.bg ?? '') &&
        isHex(parsed.panel ?? '') &&
        isHex(parsed.text ?? '') &&
        isHex(parsed.accent ?? '')
      ) {
        return { bg: parsed.bg!, panel: parsed.panel!, text: parsed.text!, accent: parsed.accent! };
      }
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CUSTOM_COLORS };
}

export function writeCustomColors(colors: CustomChromeColors): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(colors));
  } catch {
    /* ignore */
  }
  try {
    import('./userProfile').then((m) => m.persistUserProfile());
  } catch {
    /* ignore */
  }
}

function customVars(c: CustomChromeColors): Array<[string, string]> {
  const dark = luminance(c.bg) <= 0.5;
  return [
    ['--chrome-bg', c.bg],
    ['--chrome-panel', c.panel],
    ['--chrome-panel-2', mix(c.panel, c.text, 0.07)],
    ['--chrome-border', mix(c.panel, c.text, 0.17)],
    ['--chrome-border-soft', mix(c.panel, c.text, 0.1)],
    ['--chrome-text', c.text],
    ['--chrome-text-dim', mix(c.text, c.bg, 0.45)],
    ['--chrome-accent', c.accent],
    ['--chrome-accent-strong', mix(c.accent, c.text, 0.4)],
    ['--chrome-active-bg', rgba(c.accent, 0.13)],
    ['--chrome-active-ring', rgba(mix(c.accent, c.text, 0.4), 0.45)],
    ['--chrome-selection', c.accent],
    ['--chrome-success', dark ? '#6fae7a' : '#4a7a52'],
    ['--chrome-success-dim', dark ? 'rgba(111, 174, 122, 0.35)' : 'rgba(74, 122, 82, 0.28)'],
    ['--chrome-warn', dark ? '#c9a84a' : '#9a7a2a'],
    ['--chrome-danger', dark ? '#c96a62' : '#a04840'],
    ['--chrome-danger-bg', dark ? '#4a2826' : '#f0dcd8'],
    ['--chrome-danger-border', dark ? '#7a4038' : '#c89088'],
    ['--chrome-shadow', dark ? '0 8px 28px rgba(0, 0, 0, 0.32)' : '0 8px 28px rgba(28, 28, 26, 0.14)'],
  ];
}

const CUSTOM_VAR_NAMES = customVars(DEFAULT_CUSTOM_COLORS).map(([name]) => name);

function isChromeThemeId(value: string): value is ChromeThemeId {
  return CHROME_THEME_IDS.some((id) => id === value);
}

export function readChromeTheme(): ChromeThemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isChromeThemeId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return 'packet';
}

export function writeChromeTheme(id: ChromeThemeId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  applyChromeTheme(id);
  try {
    import('./userProfile').then((m) => m.persistUserProfile());
  } catch {
    /* ignore */
  }
}

/** Push the CSS `--chrome-selection` of the active theme into the canvas COLORS. */
function syncSelectionColor(): void {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--chrome-selection').trim();
    if (isHex(value)) COLORS.selection = value;
  } catch {
    /* keep current */
  }
}

export function applyChromeTheme(id: ChromeThemeId): void {
  document.documentElement.dataset.chromeTheme = id;
  const rootStyle = document.documentElement.style;
  let metaColor = THEME_COLORS[id as Exclude<ChromeThemeId, 'custom'>];
  let scheme: 'dark' | 'light' = 'dark';
  if (id === 'custom') {
    const colors = readCustomColors();
    for (const [name, value] of customVars(colors)) rootStyle.setProperty(name, value);
    metaColor = colors.bg;
    scheme = luminance(colors.bg) > 0.5 ? 'light' : 'dark';
  } else {
    for (const name of CUSTOM_VAR_NAMES) rootStyle.removeProperty(name);
    scheme = id === 'studio' || id === 'white' ? 'light' : 'dark';
  }
  document.documentElement.style.colorScheme = scheme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && metaColor) meta.setAttribute('content', metaColor);
  syncSelectionColor();
}
