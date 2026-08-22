export type ChromeThemeId = 'packet' | 'archive' | 'studio' | 'ink';

export const CHROME_THEME_IDS: ChromeThemeId[] = ['packet', 'archive', 'studio', 'ink'];

const STORAGE_KEY = 'doska-chrome-theme';

function isChromeThemeId(value: string): value is ChromeThemeId {
  return value === 'packet' || value === 'archive' || value === 'studio' || value === 'ink';
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
  const colors: Record<ChromeThemeId, string> = {
    packet: '#242422',
    archive: '#2a2622',
    studio: '#d8d4cc',
    ink: '#0e0e0e',
  };
  if (meta) meta.setAttribute('content', colors[id]);
}
