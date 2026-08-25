import { readLocale } from './locale';
import { t } from '../ui/i18n';

export interface UserInfo {
  /** Stable across reconnects; published in awareness for peer-display overrides. */
  id: string;
  name: string;
  color: string;
}

const STORAGE_KEY = 'review-user';

export const USER_COLOR_PALETTE = [
  '#7c8cff',
  '#ff6b6b',
  '#4cd964',
  '#ffa94d',
  '#d0bfff',
  '#ff9fd0',
  '#ffe27a',
  '#5fd4c8',
] as const;

const PALETTE = USER_COLOR_PALETTE;

let cached: UserInfo | null = null;
const listeners = new Set<(user: UserInfo) => void>();

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function normalizeHex(raw: string): string | null {
  const s = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  return null;
}

function persist(user: UserInfo): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}

function emit(user: UserInfo): void {
  for (const l of [...listeners]) l(user);
}

function ensureUser(partial: Partial<UserInfo> & { name: string }): UserInfo {
  const id = typeof partial.id === 'string' && partial.id.trim() ? partial.id.trim() : newId();
  const name = partial.name.trim().slice(0, 24);
  const color = normalizeHex(partial.color ?? '') || colorFor(name || id);
  return { id, name, color };
}

export function loadUser(): UserInfo {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserInfo> | null;
      if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) {
        cached = ensureUser({
          id: typeof parsed.id === 'string' ? parsed.id : undefined,
          name: parsed.name,
          color: parsed.color,
        });
        // Migrate older records that lacked id / normalized color.
        persist(cached);
      }
    }
  } catch {
    /* ignore */
  }
  if (!cached) {
    const n = String(100 + Math.floor(Math.random() * 900));
    cached = ensureUser({ name: `${t(readLocale(), 'guestPrefix')}-${n}`, color: colorFor(n) });
    persist(cached);
  }
  return cached;
}

export function saveUser(rawName: string): UserInfo {
  const prev = loadUser();
  const name = rawName.trim().slice(0, 24) || prev.name;
  cached = { id: prev.id, name, color: prev.color || colorFor(name) };
  persist(cached);
  emit(cached);
  return cached;
}

export function saveUserColor(rawColor: string): UserInfo {
  const prev = loadUser();
  const color = normalizeHex(rawColor) || prev.color;
  cached = { id: prev.id, name: prev.name, color };
  persist(cached);
  emit(cached);
  return cached;
}

export function onUserChange(cb: (user: UserInfo) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
