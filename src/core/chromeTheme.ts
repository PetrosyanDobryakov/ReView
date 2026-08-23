export type ChromeThemeId = 'packet' | 'archive' | 'studio' | 'white' | 'ink';

export const CHROME_THEME_IDS: ChromeThemeId[] = ['packet', 'archive', 'ink', 'studio', 'white'];

const STORAGE_KEY = 'review-chrome-theme';

const THEME_COLORS: Record<ChromeThemeId, string> = {
  packet: '#242422',
  archive: '#2a2622',
  studio: '#d8d4cc',
  white: '#f4f4f5',
  ink: '#0e0e0e',
};

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
}

export function applyChromeTheme(id: ChromeThemeId): void {
  document.documentElement.dataset.chromeTheme = id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[id]);
}
