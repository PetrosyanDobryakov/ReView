/**
 * Per-user preferences — locale, UI, tool settings, keybinds, chrome theme.
 * Device-level prefs (saveRemoteBoards, sync URL) stay in review-prefs.
 */

import { loadUser } from './user';
import { applyLocale, isLocaleId, readLocale, type LocaleId } from './locale';
import { applyUiScale, readPrefs, writePrefs, type AppPrefs } from './prefs';
import {
  applySettingsSnapshot,
  exportSettingsSnapshot,
  type SettingsSnapshot,
} from './settings';
import { applyKeybinds, exportKeybinds, type Keybinds } from './keybindings';
import {
  applyChromeTheme,
  readChromeTheme,
  readCustomColors,
  writeCustomColors,
  type ChromeThemeId,
  type CustomChromeColors,
  CHROME_THEME_IDS,
} from './chromeTheme';

const STORAGE_KEY = 'review-user-profiles-v1';

export type UserPrefsSlice = Pick<
  AppPrefs,
  'adaptInkToPaper' | 'toolCursorScale' | 'uiScale' | 'toolHoverAnim' | 'paperBg' | 'recognizeShapes' | 'rotateSnap'
>;

export interface UserProfileData {
  locale?: LocaleId;
  prefs?: Partial<UserPrefsSlice>;
  toolSettings?: SettingsSnapshot;
  keybinds?: Keybinds;
  chromeTheme?: ChromeThemeId;
  customChrome?: CustomChromeColors;
}

type ProfileStore = Record<string, UserProfileData>;

function isChromeThemeId(value: string): value is ChromeThemeId {
  return CHROME_THEME_IDS.some((id) => id === value);
}

function readStore(): ProfileStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as ProfileStore;
  } catch {
    return {};
  }
}

function writeStore(store: ProfileStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

function collectProfile(): UserProfileData {
  const prefs = readPrefs();
  return {
    locale: readLocale(),
    prefs: {
      adaptInkToPaper: prefs.adaptInkToPaper,
      toolCursorScale: prefs.toolCursorScale,
      uiScale: prefs.uiScale,
      toolHoverAnim: prefs.toolHoverAnim,
      paperBg: prefs.paperBg,
      recognizeShapes: prefs.recognizeShapes,
      rotateSnap: prefs.rotateSnap,
    },
    toolSettings: exportSettingsSnapshot(),
    keybinds: exportKeybinds(),
    chromeTheme: readChromeTheme(),
    customChrome: readCustomColors(),
  };
}

function applyProfile(profile: UserProfileData): void {
  if (profile.locale && isLocaleId(profile.locale)) {
    try {
      localStorage.setItem('review-locale', profile.locale);
    } catch {
      /* ignore */
    }
    applyLocale(profile.locale);
  }
  if (profile.prefs) writePrefs(profile.prefs);
  if (profile.toolSettings) applySettingsSnapshot(profile.toolSettings);
  if (profile.keybinds) applyKeybinds(profile.keybinds);
  if (profile.customChrome) writeCustomColors(profile.customChrome);
  if (profile.chromeTheme && isChromeThemeId(profile.chromeTheme)) {
    try {
      localStorage.setItem('review-chrome-theme', profile.chromeTheme);
    } catch {
      /* ignore */
    }
    applyChromeTheme(profile.chromeTheme);
  }
  applyUiScale(readPrefs().uiScale);
}

/** Load the active user's profile (migrate legacy global keys on first run). */
export function bootstrapUserProfile(): void {
  const user = loadUser();
  const store = readStore();
  const existing = store[user.id];
  if (existing) {
    applyProfile(existing);
    return;
  }
  const migrated = collectProfile();
  store[user.id] = migrated;
  writeStore(store);
}

/** Persist the active user's profile after a preference change. */
export function persistUserProfile(): void {
  const user = loadUser();
  const store = readStore();
  store[user.id] = collectProfile();
  writeStore(store);
}
