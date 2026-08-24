export interface UserInfo {
  name: string;
  color: string;
}

const STORAGE_KEY = 'review-user';

const PALETTE = [
  '#7c8cff',
  '#ff6b6b',
  '#4cd964',
  '#ffa94d',
  '#d0bfff',
  '#ff9fd0',
  '#ffe27a',
  '#5fd4c8',
];

let cached: UserInfo | null = null;
const listeners = new Set<(user: UserInfo) => void>();

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function persist(user: UserInfo): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}

export function loadUser(): UserInfo {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserInfo> | null;
      if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) {
        cached = { name: parsed.name.trim().slice(0, 24), color: parsed.color || colorFor(parsed.name) };
      }
    }
  } catch {
    /* ignore */
  }
  if (!cached) {
    const n = String(100 + Math.floor(Math.random() * 900));
    cached = { name: `Гость-${n}`, color: colorFor(n) };
    persist(cached);
  }
  return cached;
}

export function saveUser(rawName: string): UserInfo {
  const prev = loadUser();
  const name = rawName.trim().slice(0, 24) || prev.name;
  cached = { name, color: prev.color || colorFor(name) };
  persist(cached);
  for (const l of [...listeners]) l(cached);
  return cached;
}

export function onUserChange(cb: (user: UserInfo) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
