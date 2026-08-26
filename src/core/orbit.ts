import { readPrefs, writePrefs } from './prefs';

/** Orbit paper — Violet Swirl void (`#02010A`). */
export const ORBIT_PAPER = '#02010A';

/** Pre-rewrite OKI navy; still treated as Orbit paper for existing boards. */
export const ORBIT_PAPER_OKI = '#0B1026';

/**
 * Pre-rewrite pure black. Not Orbit by itself (custom black paper must stay opaque).
 * Migrated to `ORBIT_PAPER` when chrome is already Orbit.
 */
export const ORBIT_PAPER_LEGACY = '#000000';

/** [Violet Swirl](https://21st.dev/@serafimcloud/components/violet-swirl) Silk palette. */
export const ORBIT_COLORS = {
  void: '#02010A',
  deep: '#04052E',
  indigo: '#3D2C8D',
  lilac: '#916BBF',
  violet: '#7C5CFF',
  cyan: '#5B8CFF',
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
