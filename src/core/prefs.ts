/** App-level preferences (not per-board). */

export interface AppPrefs {
  /** When false (default), remote/"other users'" boards are not written to IndexedDB. */
  saveRemoteBoards: boolean;
}

const STORAGE_KEY = 'review-prefs';

const DEFAULTS: AppPrefs = {
  saveRemoteBoards: false,
};

type Listener = (prefs: AppPrefs) => void;
const listeners = new Set<Listener>();

let cached: AppPrefs | null = null;

function emit(): void {
  const prefs = readPrefs();
  for (const l of [...listeners]) l(prefs);
}

export function readPrefs(): AppPrefs {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppPrefs>;
      cached = {
        saveRemoteBoards: typeof parsed.saveRemoteBoards === 'boolean' ? parsed.saveRemoteBoards : DEFAULTS.saveRemoteBoards,
      };
      return cached;
    }
  } catch {
    /* ignore */
  }
  cached = { ...DEFAULTS };
  return cached;
}

export function writePrefs(patch: Partial<AppPrefs>): AppPrefs {
  const next: AppPrefs = { ...readPrefs(), ...patch };
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  emit();
  return next;
}

export function onPrefsChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
