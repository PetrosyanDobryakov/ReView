import { readPrefs, writePrefs } from './prefs';

/**
 * Orbit paper id. Boards store this exact value, so it never changes even though
 * the rendered void is `ORBIT_COLORS.void` (see `isOrbitPaper`).
 */
export const ORBIT_PAPER = '#02010A';

/** Pre-rewrite OKI navy; still treated as Orbit paper for existing boards. */
export const ORBIT_PAPER_OKI = '#0B1026';

/**
 * Pre-rewrite pure black. Not Orbit by itself (custom black paper must stay opaque).
 * Migrated to `ORBIT_PAPER` when chrome is already Orbit.
 */
export const ORBIT_PAPER_LEGACY = '#000000';

/**
 * Mission palette (SpaceX flight hardware): white, stainless steel and neutral
 * graphite on a near-black void. Two accents — Dragon display blue for interaction / selection, Merlin
 * plume orange for notes and highlights — plus flight-status colors.
 */
export const ORBIT_COLORS = {
  void: '#050506',
  hull: '#101012',
  graphite: '#1C1C1F',
  steel: '#A9AFB9',
  white: '#F2F4F7',
  dragon: '#7FA7E8',
  merlin: '#FF9A4D',
  nominal: '#5FD39A',
  caution: '#FFC24D',
  abort: '#FF5F6D',
} as const;

export function isOrbitPaper(bg: string): boolean {
  const n = bg.trim().toLowerCase();
  return n === ORBIT_PAPER.toLowerCase() || n === ORBIT_PAPER_OKI.toLowerCase();
}

/**
 * If prefs still store legacy black while Orbit chrome is on, rewrite to `ORBIT_PAPER`.
 * Call once at bootstrap so boards don't keep a broken `#000000` Orbit alias.
 */
export function migrateLegacyOrbitPaper(chromeIsOrbit: boolean): void {
  if (!chromeIsOrbit) return;
  const paper = readPrefs().paperBg;
  if (typeof paper === 'string' && paper.trim().toLowerCase() === ORBIT_PAPER_LEGACY.toLowerCase()) {
    writePrefs({ paperBg: ORBIT_PAPER });
  }
}

/**
 * Board camera as seen by the Orbit space shader. The Engine writes it on every
 * Orbit-paper paint; the shader reads it each frame so the starfield moves with
 * the board. `live` is false on Home / solid paper and the field drifts instead.
 */
export const orbitView = {
  live: false,
  x: 0,
  y: 0,
  zoom: 1,
};

export function setOrbitView(x: number, y: number, zoom: number): void {
  orbitView.live = true;
  orbitView.x = x;
  orbitView.y = y;
  orbitView.zoom = zoom;
}

export function clearOrbitView(): void {
  orbitView.live = false;
}
