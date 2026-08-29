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
  /** Chrome UI size multiplier (0.75–1.5). Does not affect the board canvas. */
  uiScale: number;
  /** Per-tool hover motion on the toolbelt. */
  toolHoverAnim: boolean;
  /**
   * Local board paper color. When set, overrides synced meta `bg` so collaborators
   * can use different papers on the same board.
   */
  paperBg: string | null;
  /** Snap neat freehand strokes to rect / ellipse / line / arrow. */
  recognizeShapes: boolean;
  /**
   * Soft-snap rotation to horizontal / vertical when close (Miro-style).
   * Off = always free. Shift while rotating also bypasses the magnet.
   */
  rotateSnap: boolean;
  /**
   * Override for the Yjs websocket URL. null = built-in
   * `VITE_SYNC_URL` or `ws(s)://<hostname>:1234`.
   */
  syncUrl: string | null;
  /** When false, the websocket provider is destroyed and peers are offline. */
  syncEnabled: boolean;
  /**
   * Unlock the Orbit chrome skin in Customize. Visual-only alternate world;
   * off by default so Packet stays the everyday look.
   */
  orbitUnlocked: boolean;
  /** Optional WebRTC p2p sync (for Vercel/static without a websocket server). */
  p2pEnabled: boolean;
  /** Signaling servers for y-webrtc. null = defaults. */
  p2pSignaling: string | null;
}

const STORAGE_KEY = 'review-prefs';

const DEFAULTS: AppPrefs = {
  saveRemoteBoards: false,
  adaptInkToPaper: true,
  toolCursorScale: 1,
  uiScale: 1,
  toolHoverAnim: true,
  paperBg: null,
  recognizeShapes: false,
  rotateSnap: true,
  syncUrl: null,
  syncEnabled: true,
  orbitUnlocked: false,
  p2pEnabled: false,
  p2pSignaling: null,
};

function normalizeSyncUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (!/^wss?:\/\//i.test(s)) return null;
  return s.replace(/\/$/, '');
}

export function parseSyncUrl(raw: string): string | null {
  return normalizeSyncUrl(raw);
}

function normalizeP2pSignaling(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (!/^wss?:\/\//i.test(s)) return null;
  return s.replace(/\/$/, '');
}

const CURSOR_SCALE_MIN = 0.7;
const CURSOR_SCALE_MAX = 1.8;
const UI_SCALE_MIN = 0.75;
const UI_SCALE_MAX = 1.5;

type Listener = (prefs: AppPrefs) => void;
const listeners = new Set<Listener>();

let cached: AppPrefs | null = null;

function clampCursorScale(n: number): number {
  if (!Number.isFinite(n)) return DEFAULTS.toolCursorScale;
  return Math.min(CURSOR_SCALE_MAX, Math.max(CURSOR_SCALE_MIN, Math.round(n * 100) / 100));
}

function clampUiScale(n: number): number {
  if (!Number.isFinite(n)) return DEFAULTS.uiScale;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(n * 100) / 100));
}

/** Push `--ui-scale` so chrome CSS `zoom` picks it up. */
export function applyUiScale(scale: number = readPrefs().uiScale): void {
  document.documentElement.style.setProperty('--ui-scale', String(clampUiScale(scale)));
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
    uiScale: typeof parsed.uiScale === 'number' ? clampUiScale(parsed.uiScale) : DEFAULTS.uiScale,
    toolHoverAnim: typeof parsed.toolHoverAnim === 'boolean' ? parsed.toolHoverAnim : DEFAULTS.toolHoverAnim,
    paperBg: typeof parsed.paperBg === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.paperBg) ? parsed.paperBg : null,
    recognizeShapes:
      typeof parsed.recognizeShapes === 'boolean' ? parsed.recognizeShapes : DEFAULTS.recognizeShapes,
    rotateSnap: typeof parsed.rotateSnap === 'boolean' ? parsed.rotateSnap : DEFAULTS.rotateSnap,
    syncUrl: Object.prototype.hasOwnProperty.call(parsed, 'syncUrl')
      ? normalizeSyncUrl(parsed.syncUrl)
      : DEFAULTS.syncUrl,
    syncEnabled: typeof parsed.syncEnabled === 'boolean' ? parsed.syncEnabled : DEFAULTS.syncEnabled,
    orbitUnlocked: typeof parsed.orbitUnlocked === 'boolean' ? parsed.orbitUnlocked : DEFAULTS.orbitUnlocked,
    p2pEnabled: typeof parsed.p2pEnabled === 'boolean' ? parsed.p2pEnabled : DEFAULTS.p2pEnabled,
    p2pSignaling: Object.prototype.hasOwnProperty.call(parsed, 'p2pSignaling')
      ? normalizeP2pSignaling(parsed.p2pSignaling)
      : DEFAULTS.p2pSignaling,
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
    uiScale: patch.uiScale !== undefined ? clampUiScale(patch.uiScale) : cur.uiScale,
    paperBg:
      patch.paperBg === null
        ? null
        : typeof patch.paperBg === 'string'
          ? /^#[0-9a-fA-F]{6}$/.test(patch.paperBg)
            ? patch.paperBg
            : cur.paperBg
          : cur.paperBg,
    syncUrl:
      patch.syncUrl !== undefined
        ? patch.syncUrl === null
          ? null
          : (() => {
              const normalized = normalizeSyncUrl(patch.syncUrl);
              if (normalized === null && typeof patch.syncUrl === 'string' && patch.syncUrl.trim() !== '') {
                throw new Error('Invalid syncUrl: must start with ws:// or wss://');
              }
              return normalized;
            })()
        : cur.syncUrl,
    syncEnabled: patch.syncEnabled !== undefined ? Boolean(patch.syncEnabled) : cur.syncEnabled,
    orbitUnlocked: patch.orbitUnlocked !== undefined ? Boolean(patch.orbitUnlocked) : cur.orbitUnlocked,
    p2pEnabled: patch.p2pEnabled !== undefined ? Boolean(patch.p2pEnabled) : cur.p2pEnabled,
    p2pSignaling:
      patch.p2pSignaling !== undefined
        ? patch.p2pSignaling === null
          ? null
          : (() => {
              const normalized = normalizeP2pSignaling(patch.p2pSignaling);
              if (normalized === null && typeof patch.p2pSignaling === 'string' && patch.p2pSignaling.trim() !== '') {
                throw new Error('Invalid p2pSignaling URL: must start with ws:// or wss://');
              }
              return normalized;
            })()
        : cur.p2pSignaling,
  };
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  if (next.uiScale !== cur.uiScale) applyUiScale(next.uiScale);
  const userFields: (keyof AppPrefs)[] = [
    'adaptInkToPaper',
    'toolCursorScale',
    'uiScale',
    'toolHoverAnim',
    'paperBg',
    'recognizeShapes',
    'rotateSnap',
  ];
  if (userFields.some((k) => patch[k] !== undefined)) {
    try {
      import('./userProfile').then((m) => m.persistUserProfile());
    } catch {
      /* ignore */
    }
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

export { CURSOR_SCALE_MIN, CURSOR_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_MAX };
