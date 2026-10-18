/** App-level preferences (not per-board). */

import type { ToolId } from '../engine/tools';

export interface AppPrefs {
  /**
   * When true (default), boards opened from someone else's link are saved to
   * IndexedDB. With full P2P there is no server copy, so this device is where
   * the board lives. False = joined boards are session-only.
   */
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
   * When true, selection rotate control sits at the **top-middle** of the
   * selected object. When false (default), legacy corner grab (bottom-left).
   * Both placements use the Lucide-style rotate-cw SVG (`rotateIcon.ts`).
   * Applies to board selection chrome generally (not calculator-only).
   */
  rotateHandleTop: boolean;
  /**
   * When true (default), remote cursors use spring/lerp follow (can trail the wire).
   * When false, snap display pose to the latest awareness sample (realtime).
   */
  smoothPeerCursors: boolean;
  /** When false, the P2P mesh is torn down and this tab works alone. */
  syncEnabled: boolean;
  /**
   * Unlock the Orbit chrome skin in Customize. Visual-only alternate world;
   * off by default so Packet stays the everyday look.
   */
  orbitUnlocked: boolean;
  /** Extra hubs to join (a friend's review-host), as `ws://host:port` bases. */
  p2pHubs: string[];
  /** ICE lines (`stun:…`, or `turn:…|user|pass`). null = public STUN defaults; [] = LAN only. */
  p2pIce: string[] | null;
  /** Also join the hubs of review-hosts found on the LAN (mDNS). */
  p2pLanDiscovery: boolean;
  /** Also meet peers through public Nostr relays (sealed handshakes only). */
  p2pRelays: boolean;
  /** Fall back to Cloudflare TURN (from the hub) when a direct link fails. */
  p2pTurn: boolean;
  /** Custom toolbelt order per strip group + More shelf. null = defaults. */
  toolbarOrder: { nav: ToolId[]; create: ToolId[]; more?: ToolId[] } | null;
}

const STORAGE_KEY = 'review-prefs';

const DEFAULTS: AppPrefs = {
  saveRemoteBoards: true,
  adaptInkToPaper: true,
  toolCursorScale: 1,
  uiScale: 1,
  toolHoverAnim: true,
  paperBg: null,
  recognizeShapes: false,
  rotateSnap: true,
  rotateHandleTop: false,
  smoothPeerCursors: true,
  syncEnabled: true,
  orbitUnlocked: false,
  p2pHubs: [],
  p2pIce: null,
  p2pLanDiscovery: true,
  p2pRelays: true,
  p2pTurn: true,
  toolbarOrder: null,
};

const MAX_HUBS = 8;
const MAX_ICE = 8;

/** `ws://host:port` / `wss://host` bases, deduped. Anything else is dropped. */
function normalizeHubList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const s = v.trim().replace(/\/+$/, '');
    if (!/^wss?:\/\/[^\s/]+$/i.test(s)) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= MAX_HUBS) break;
  }
  return out;
}

function normalizeIceList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!/^(stun|turns?):\S+$/i.test(s.split('|')[0] ?? '')) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= MAX_ICE) break;
  }
  return out;
}

/** Parse the ICE textarea (one server per line). null when any line is invalid. */
export function parseIceLines(text: string): string[] | null {
  const lines = text.split(/[\n,]+/).map((l) => l.trim()).filter(Boolean);
  const parsed = normalizeIceList(lines) ?? [];
  return parsed.length === lines.length ? parsed : null;
}

const CURSOR_SCALE_MIN = 0.7;
const CURSOR_SCALE_MAX = 1.8;
const UI_SCALE_MIN = 0.75;
const UI_SCALE_MAX = 1.5;

/** Keep only string ids, drop empties/dupes (validated against tool groups by the caller). */
function normalizeToolbarOrder(raw: unknown): { nav: ToolId[]; create: ToolId[]; more?: ToolId[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const clean = (v: unknown): ToolId[] => {
    if (!Array.isArray(v)) return [];
    const out: ToolId[] = [];
    for (const x of v) {
      if (typeof x === 'string' && x && !out.includes(x as ToolId)) out.push(x as ToolId);
    }
    return out;
  };
  const nav = clean(rec.nav);
  const create = clean(rec.create);
  const more = clean(rec.more);
  if (!nav.length && !create.length && !more.length) return null;
  return more.length ? { nav, create, more } : { nav, create };
}

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
    rotateHandleTop:
      typeof parsed.rotateHandleTop === 'boolean' ? parsed.rotateHandleTop : DEFAULTS.rotateHandleTop,
    smoothPeerCursors:
      typeof parsed.smoothPeerCursors === 'boolean' ? parsed.smoothPeerCursors : DEFAULTS.smoothPeerCursors,
    syncEnabled: typeof parsed.syncEnabled === 'boolean' ? parsed.syncEnabled : DEFAULTS.syncEnabled,
    orbitUnlocked: typeof parsed.orbitUnlocked === 'boolean' ? parsed.orbitUnlocked : DEFAULTS.orbitUnlocked,
    p2pHubs: normalizeHubList(parsed.p2pHubs),
    p2pIce: Object.prototype.hasOwnProperty.call(parsed, 'p2pIce') ? normalizeIceList(parsed.p2pIce) : DEFAULTS.p2pIce,
    p2pLanDiscovery:
      typeof parsed.p2pLanDiscovery === 'boolean' ? parsed.p2pLanDiscovery : DEFAULTS.p2pLanDiscovery,
    p2pRelays: typeof parsed.p2pRelays === 'boolean' ? parsed.p2pRelays : DEFAULTS.p2pRelays,
    p2pTurn: typeof parsed.p2pTurn === 'boolean' ? parsed.p2pTurn : DEFAULTS.p2pTurn,
    toolbarOrder: Object.prototype.hasOwnProperty.call(parsed, 'toolbarOrder')
      ? normalizeToolbarOrder(parsed.toolbarOrder)
      : DEFAULTS.toolbarOrder,
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
    syncEnabled: patch.syncEnabled !== undefined ? Boolean(patch.syncEnabled) : cur.syncEnabled,
    orbitUnlocked: patch.orbitUnlocked !== undefined ? Boolean(patch.orbitUnlocked) : cur.orbitUnlocked,
    p2pHubs: patch.p2pHubs !== undefined ? normalizeHubList(patch.p2pHubs) : cur.p2pHubs,
    p2pIce: patch.p2pIce !== undefined ? normalizeIceList(patch.p2pIce) : cur.p2pIce,
    p2pLanDiscovery:
      patch.p2pLanDiscovery !== undefined ? Boolean(patch.p2pLanDiscovery) : cur.p2pLanDiscovery,
    toolbarOrder:
      patch.toolbarOrder !== undefined ? normalizeToolbarOrder(patch.toolbarOrder) : cur.toolbarOrder,
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
    'rotateHandleTop',
    'smoothPeerCursors',
    'toolbarOrder',
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

/**
 * 0.15.6: rotate handle default is legacy corner (off). 0.15.2–0.15.5 shipped
 * default-on, so stored `true` is usually inherited rather than chosen. Flip
 * once per device so Customize matches the new default; users can turn top-middle
 * back on afterward. Marker prevents repeat resets.
 */
const ROTATE_HANDLE_TOP_OFF_MIGRATE = 'review-migrate-rotate-handle-top-off-0156';

export function migrateRotateHandleTopDefaultOff(): void {
  try {
    if (localStorage.getItem(ROTATE_HANDLE_TOP_OFF_MIGRATE) === '1') return;
    localStorage.setItem(ROTATE_HANDLE_TOP_OFF_MIGRATE, '1');
  } catch {
    return;
  }
  if (readPrefs().rotateHandleTop) {
    writePrefs({ rotateHandleTop: false });
  }
}

export { CURSOR_SCALE_MIN, CURSOR_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_MAX };
