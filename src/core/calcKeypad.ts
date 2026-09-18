/** Shared calculator keypad layouts (overlay + canvas silhouette). */

import type { CalcKey } from './calcEngine';

export type CalcKeyDef = { id: CalcKey; label: string; cls?: string; span?: number };

/** Standard mode rows — matches CalculatorPanel. */
export function standardCalcKeys(second = false): CalcKeyDef[][] {
  void second;
  return [
    [
      { id: 'MC', label: 'MC', cls: 'mem' },
      { id: 'MR', label: 'MR', cls: 'mem' },
      { id: 'M+', label: 'M+', cls: 'mem' },
      { id: 'M−', label: 'M−', cls: 'mem' },
    ],
    [
      { id: 'MS', label: 'MS', cls: 'mem' },
      { id: '%', label: '%', cls: 'fn' },
      { id: 'CE', label: 'CE', cls: 'fn' },
      { id: 'C', label: 'C', cls: 'fn' },
    ],
    [
      { id: '⌫', label: '⌫', cls: 'fn' },
      { id: '1/x', label: '1/x', cls: 'fn' },
      { id: 'x²', label: 'x²', cls: 'fn' },
      { id: '√', label: '√', cls: 'fn' },
    ],
    [
      { id: '7', label: '7' },
      { id: '8', label: '8' },
      { id: '9', label: '9' },
      { id: '÷', label: '÷', cls: 'op' },
    ],
    [
      { id: '4', label: '4' },
      { id: '5', label: '5' },
      { id: '6', label: '6' },
      { id: '×', label: '×', cls: 'op' },
    ],
    [
      { id: '1', label: '1' },
      { id: '2', label: '2' },
      { id: '3', label: '3' },
      { id: '−', label: '−', cls: 'op' },
    ],
    [
      { id: '±', label: '±' },
      { id: '0', label: '0' },
      { id: '.', label: '.' },
      { id: '+', label: '+', cls: 'op' },
    ],
    [{ id: '=', label: '=', cls: 'eq', span: 4 }],
  ];
}

/** Scientific mode rows — matches CalculatorPanel. */
export function scientificCalcKeys(second: boolean): CalcKeyDef[][] {
  return [
    [
      { id: 'MC', label: 'MC', cls: 'mem' },
      { id: 'MR', label: 'MR', cls: 'mem' },
      { id: 'M+', label: 'M+', cls: 'mem' },
      { id: 'M−', label: 'M−', cls: 'mem' },
      { id: 'MS', label: 'MS', cls: 'mem' },
    ],
    [
      { id: '2nd', label: '2nd', cls: second ? 'active fn' : 'fn' },
      { id: 'π', label: 'π', cls: 'fn' },
      { id: 'e', label: 'e', cls: 'fn' },
      { id: 'C', label: 'C', cls: 'fn' },
      { id: '⌫', label: '⌫', cls: 'fn' },
    ],
    [
      { id: 'x²', label: 'x²', cls: 'fn' },
      { id: '1/x', label: '1/x', cls: 'fn' },
      { id: '|x|', label: '|x|', cls: 'fn' },
      { id: 'Exp', label: 'exp', cls: 'fn' },
      { id: '%', label: '%', cls: 'fn' },
    ],
    [
      { id: '√', label: '√', cls: 'fn' },
      { id: '(', label: '(', cls: 'fn' },
      { id: ')', label: ')', cls: 'fn' },
      { id: 'n!', label: 'n!', cls: 'fn' },
      { id: '÷', label: '÷', cls: 'op' },
    ],
    [
      { id: second ? 'asin' : 'sin', label: second ? 'sin⁻¹' : 'sin', cls: 'fn' },
      { id: '7', label: '7' },
      { id: '8', label: '8' },
      { id: '9', label: '9' },
      { id: '×', label: '×', cls: 'op' },
    ],
    [
      { id: second ? 'acos' : 'cos', label: second ? 'cos⁻¹' : 'cos', cls: 'fn' },
      { id: '4', label: '4' },
      { id: '5', label: '5' },
      { id: '6', label: '6' },
      { id: '−', label: '−', cls: 'op' },
    ],
    [
      { id: second ? 'atan' : 'tan', label: second ? 'tan⁻¹' : 'tan', cls: 'fn' },
      { id: '1', label: '1' },
      { id: '2', label: '2' },
      { id: '3', label: '3' },
      { id: '+', label: '+', cls: 'op' },
    ],
    [
      { id: second ? 'sinh' : 'log', label: second ? 'sinh' : 'log', cls: 'fn' },
      { id: '±', label: '±' },
      { id: '0', label: '0' },
      { id: '.', label: '.' },
      { id: '=', label: '=', cls: 'eq' },
    ],
    [
      { id: second ? 'cosh' : 'ln', label: second ? 'cosh' : 'ln', cls: 'fn' },
      { id: second ? 'tanh' : '10ˣ', label: second ? 'tanh' : '10ˣ', cls: 'fn' },
      { id: 'eˣ', label: 'eˣ', cls: 'fn' },
      { id: 'xʸ', label: 'xʸ', cls: 'fn' },
      { id: 'CE', label: 'CE', cls: 'fn' },
    ],
  ];
}

export function calcKeypadRows(mode: 'standard' | 'scientific', second = false): CalcKeyDef[][] {
  return mode === 'scientific' ? scientificCalcKeys(second) : standardCalcKeys(second);
}

export type CalcRect = { x: number; y: number; w: number; h: number };

export type CalcKeyRect = CalcKeyDef & CalcRect;

/** Shared ≡ + mode-title metrics (canvas paint + open overlay must match 1:1). */
export type CalcHeaderChrome = {
  /** World width of the nav (hamburger) hit/glyph cell. */
  navW: number;
  /** World gap between nav cell and mode title. */
  navGap: number;
  /** World height of nav / title controls (vertically centered in header). */
  controlH: number;
  /** ≡ font size (world px). */
  glyphPx: number;
  /** Mode title font size (world px). */
  titlePx: number;
  /** Optical Y nudge for ≡ (glyph sits high in Space Grotesk). */
  glyphNudgeY: number;
};

export type CalcFaceLayout = {
  scale: number;
  pad: number;
  radius: number;
  gap: number;
  cols: number;
  header: CalcRect;
  /** Nav ≡ + mode title — single source for canvas + CSS overlay. */
  chrome: CalcHeaderChrome;
  display: CalcRect;
  padArea: CalcRect;
  keys: CalcKeyRect[];
  fonts: {
    header: number;
    expr: number;
    display: number;
    key: number;
    keyFn: number;
  };
};

/**
 * World-local face geometry for a calculator frame.
 * Pass `scale` from `calcFrameScale(w,h)` — label sizes track frame only (never camera zoom).
 * Canvas paint and open-session hit targets must both use this.
 */
export function buildCalcFaceLayout(
  w: number,
  h: number,
  mode: 'standard' | 'scientific',
  second: boolean,
  scale: number
): CalcFaceLayout {
  const pad = Math.max(8, 12 * scale);
  const radius = Math.max(8, Math.min(18, 12 * scale));
  const gap = Math.max(3, 4.5 * scale);
  const sci = mode === 'scientific';
  const cols = sci ? 5 : 4;

  // Win-calc chrome row: nav ≡ + mode title (+ DEG) — same scale family as keys.
  // Design px (34 / 32 / 20 / 16 / 6) × frame scale — CSS uses the same via --calc-zoom.
  const chrome: CalcHeaderChrome = {
    navW: Math.max(28, 34 * scale),
    navGap: Math.max(4, 6 * scale),
    controlH: Math.max(28, 32 * scale),
    glyphPx: Math.max(16, 20 * scale),
    titlePx: Math.max(14, 16 * scale),
    glyphNudgeY: Math.max(0.4, 0.55 * scale),
  };
  const headerH = Math.max(chrome.controlH + 8 * scale, 44 * scale);
  const header: CalcRect = { x: pad, y: pad * 0.5, w: Math.max(20, w - pad * 2), h: headerH };

  // Generous display plane (Win Standard puts a tall result above the pad).
  const dispH = Math.max(78, Math.min(h * 0.22, 112 * scale));
  const dispY = header.y + header.h + pad * 0.2;
  const display: CalcRect = {
    x: pad,
    y: dispY,
    w: Math.max(20, w - pad * 2),
    h: dispH,
  };

  const gridTop = display.y + display.h + pad * 0.5;
  const gridH = Math.max(40, h - pad - gridTop);
  const padArea: CalcRect = { x: display.x, y: gridTop, w: display.w, h: gridH };

  const rows = calcKeypadRows(mode, second);
  const rowCount = rows.length;
  const cellW = (padArea.w - gap * (cols - 1)) / cols;
  const cellH = (padArea.h - gap * (rowCount - 1)) / rowCount;

  const keys: CalcKeyRect[] = [];
  for (let r = 0; r < rowCount; r++) {
    const row = rows[r] ?? [];
    let c = 0;
    for (const key of row) {
      const span = Math.max(1, key.span ?? 1);
      const kw = cellW * span + gap * (span - 1);
      keys.push({
        ...key,
        x: padArea.x + c * (cellW + gap),
        y: padArea.y + r * (cellH + gap),
        w: kw,
        h: cellH,
      });
      c += span;
    }
  }

  return {
    scale,
    pad,
    radius,
    gap,
    cols,
    header,
    chrome,
    display,
    padArea,
    keys,
    fonts: {
      // Mode title size — kept in sync with chrome.titlePx for callers that still read fonts.header.
      header: chrome.titlePx,
      expr: Math.max(11, 13 * scale),
      display: Math.min(48, Math.max(20, 30 * scale)),
      // Further bump vs 0.15.6 so glyphs fill spacious wells (Standard + Scientific).
      key: Math.max(12, 17 * scale),
      keyFn: Math.max(11, 15 * scale),
    },
  };
}

