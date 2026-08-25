export type LocaleId = 'ru' | 'en' | 'zh';

export const LOCALES: LocaleId[] = ['ru', 'en', 'zh'];

const STORAGE_KEY = 'review-locale';

export function isLocaleId(value: string): value is LocaleId {
  return value === 'ru' || value === 'en' || value === 'zh';
}

export function readLocale(): LocaleId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isLocaleId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return 'ru';
}

export function writeLocale(id: LocaleId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  applyLocale(id);
  try {
    import('./userProfile').then((m) => m.persistUserProfile());
  } catch {
    /* ignore */
  }
}

export function applyLocale(id: LocaleId): void {
  document.documentElement.lang = id;
}
