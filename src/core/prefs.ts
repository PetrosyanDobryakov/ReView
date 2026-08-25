/** App-level preferences (not per-board). */

export interface AppPrefs {
  /** When false (default), remote/"other users'" boards are not written to IndexedDB. */
  saveRemoteBoards: boolean;
  /**
   * When true, low-contrast ink (pen / arrow / free text) is remapped to stay readable
   * on this client's paper. Stored colors are unchanged — each viewer adapts locally.
   */
  adaptInkToPaper: boolean;
  /** Multiplier for on-canvas tool cursors (0.7–1.8). */
  toolCursorScale: number;
  /** Per-tool hover motion on the toolbelt. */
  toolHoverAnim: boolean;
  /**
   * Local board paper color. When set, overrides synced meta `bg` so collaborators
   * can use different papers on the same board.
   */
  paperBg: string | null;
}

const STORAGE_KEY = 'review-prefs';

const DEFAULTS: AppPrefs = {
  saveRemoteBoards: false,
  adaptInkToPaper: true,
  toolCursorScale: 1,
  toolHoverAnim: true,
  paperBg: null,
};

const CURSOR_SCALE_MIN = 0.7;
const CURSOR_SCALE_MAX = 1.8;

type Listener = (prefs: AppPrefs) => void;
const listeners = new Set<Listener>();

let cached: AppPrefs | null = null;

function clampCursorScale(n: number): number {
  if (!Number.isFinite(n)) return DEFAULTS.toolCursorScale;
  return Math.min(CURSOR_SCALE_MAX, Math.max(CURSOR_SCALE_MIN, Math.round(n * 100) / 100));
}

function emit(): void {
  const prefs = readPrefs();
  for (const l of [...listeners]) l(prefs);
}

function parsePrefs(raw: unknown): AppPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  const parsed = raw as Partial<AppPrefs>;
  return {
    saveRemoteBoards:
      typeof parsed.saveRemoteBoards === 'boolean' ? parsed.saveRemoteBoards : DEFAULTS.saveRemoteBoards,
    adaptInkToPaper:
      typeof parsed.adaptInkToPaper === 'boolean' ? parsed.adaptInkToPaper : DEFAULTS.adaptInkToPaper,
    toolCursorScale:
      typeof parsed.toolCursorScale === 'number' ? clampCursorScale(parsed.toolCursorScale) : DEFAULTS.toolCursorScale,
    toolHoverAnim: typeof parsed.toolHoverAnim === 'boolean' ? parsed.toolHoverAnim : DEFAULTS.toolHoverAnim,
    paperBg: typeof parsed.paperBg === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.paperBg) ? parsed.paperBg : null,
  };
}

export function readPrefs(): AppPrefs {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      cached = parsePrefs(JSON.parse(raw) as unknown);
      return cached;
    }
  } catch {
    /* ignore */
  }
  cached = { ...DEFAULTS };
  return cached;
}

export function writePrefs(patch: Partial<AppPrefs>): AppPrefs {
  const cur = readPrefs();
  const next: AppPrefs = {
    ...cur,
    ...patch,
    toolCursorScale:
      patch.toolCursorScale !== undefined ? clampCursorScale(patch.toolCursorScale) : cur.toolCursorScale,
    paperBg:
      patch.paperBg === null
        ? null
        : typeof patch.paperBg === 'string'
          ? /^#[0-9a-fA-F]{6}$/.test(patch.paperBg)
            ? patch.paperBg
            : cur.paperBg
          : cur.paperBg,
  };
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

export { CURSOR_SCALE_MIN, CURSOR_SCALE_MAX };
