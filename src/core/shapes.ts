import { formulaImage, renderFormula } from './formula';
import { compileGraph } from './graphEval';
import { readPrefs } from './prefs';
import { degToRad, shapeRotation, worldToLocal, withShapeRotation, localToWorld } from './transform';
import { drawRichBlock, parseStoredRich } from './richText';
import { wrapLinesByWidth } from './textLayout';
import { isOrbitPaper, ORBIT_COLORS } from './orbit';
import {
  isClassicStickyText,
  ORBIT_DRAW,
  shouldUseOrbitDraw,
} from './orbitDraw';

export type ShapeType = 'rect' | 'ellipse' | 'sticky' | 'text' | 'pen' | 'arrow' | 'image' | 'video' | 'doc' | 'graph' | 'calculator' | 'diamond' | 'frame' | 'triangle' | 'parallelogram' | 'hexagon' | 'cylinder' | 'terminator' | 'subroutine' | 'display' | 'table';

/** Photo / video / PDF hosts that magnetize notes above them in z-order. */
export const MEDIA_HOST_TYPES: ReadonlySet<ShapeType> = new Set(['image', 'video', 'doc']);

/**
 * Big tray-like hosts that carry riders (tables, media, frames). A press on an
 * unselected host selects it and starts marquee — moving needs it pre-selected.
 */
export const RIDER_HOST_TYPES: ReadonlySet<ShapeType> = new Set(['table', 'frame', 'image', 'video', 'doc']);

/** Container-like shapes the eraser never touches (either mode) — ink on top of them still erases. */
export const NON_ERASABLE_TYPES: ReadonlySet<ShapeType> = new Set([
  'image',
  'video',
  'doc',
  'table',
  'graph',
  'calculator',
  'frame',
  'diamond',
  'triangle',
  'parallelogram',
  'hexagon',
  'cylinder',
  'terminator',
  'subroutine',
  'display',
]);

export type TextAlign = 'left' | 'center' | 'right';

export interface ShapeView {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text?: string;
  /** Character-level rich HTML from the text editor (optional). */
  richHtml?: string;
  fontSize?: number;
  points?: number[];
  /** Parallel to points (pairs): stylus pressure 0..1 per vertex for pens. */
  pressures?: number[];
  /** Rect corner radius in world units. `0` = sharp; omit defaults to rounded. */
  cornerRadius?: number;
  /** Arrow head length in world units. Omit → derived from strokeWidth. */
  arrowHead?: number;
  /** Degrees clockwise. Box shapes render rotated; pens/arrows bake into points. */
  rotation?: number;
  alpha?: number;
  textColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  textAlign?: TextAlign;
  highlight?: boolean;
  src?: string;
  pages?: string[];
  page?: number;
  locked?: boolean;
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
  expr?: string;
  /** Calculator: standard | scientific. */
  calcMode?: 'standard' | 'scientific';
  calcAngle?: 'deg' | 'rad';
  calcDisplay?: string;
  calcExpr?: string;
  calcMemory?: number | null;
  calcSecond?: boolean;
  /** Opaque JSON machine blob for mid-entry sync. */
  calcState?: string;
  fromId?: string;
  fromPort?: string;
  toId?: string;
  toPort?: string;
  /** Table grid: column / row counts. */
  cols?: number;
  rows?: number;
  /** Table cells, row-major plain text. */
  cells?: string[];
  /** Table first row styled as a header (default true). */
  header?: boolean;
  /** Table column widths / row heights as fractions summing to 1 (omit = uniform). */
  colW?: number[];
  rowH?: number[];
}

export const PORTS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export const EDGE_PORTS = ['n', 'e', 's', 'w'] as const;
export type PortId = (typeof PORTS)[number];
export type EdgePortId = (typeof EDGE_PORTS)[number];

export function portPos(v: ShapeView, port: PortId, offset = 0): { x: number; y: number } {
  let fx = 0.5, fy = 0.5;
  switch (port) {
    case 'nw': fx = 0; fy = 0; break;
    case 'n': fx = 0.5; fy = 0; break;
    case 'ne': fx = 1; fy = 0; break;
    case 'e': fx = 1; fy = 0.5; break;
    case 'se': fx = 1; fy = 1; break;
    case 's': fx = 0.5; fy = 1; break;
    case 'sw': fx = 0; fy = 1; break;
    case 'w': fx = 0; fy = 0.5; break;
  }
  let p = localToWorld(v, fx * v.w, fy * v.h);
  if (offset) {
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    p = { x: p.x + (dx / len) * offset, y: p.y + (dy / len) * offset };
  }
  return p;
}

/** Bend sign for curved arrows: horizontal vs vertical dominance. */
export function arrowBendSign(dx: number, dy: number): number {
  return Math.abs(dx) > Math.abs(dy) ? 1 : -1;
}

export function portDir(port: PortId): { x: number; y: number } {
  switch (port) {
    case 'n': return { x: 0, y: -1 };
    case 's': return { x: 0, y: 1 };
    case 'e': return { x: 1, y: 0 };
    case 'w': return { x: -1, y: 0 };
    case 'ne': return { x: 0.7, y: -0.7 };
    case 'nw': return { x: -0.7, y: -0.7 };
    case 'se': return { x: 0.7, y: 0.7 };
    case 'sw': return { x: -0.7, y: 0.7 };
  }
}

/** Outward port axis in world space after the shape's rotation. */
export function worldPortDir(port: PortId, rotationDeg = 0): { x: number; y: number } {
  const d = portDir(port);
  if (!rotationDeg) return { x: d.x, y: d.y };
  const rad = degToRad(rotationDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: d.x * cos - d.y * sin, y: d.x * sin + d.y * cos };
}

/** Connected-arrow endpoints + cubic controls in world space. */
export function connectedArrowGeometry(
  from: ShapeView,
  to: ShapeView,
  fromPort: PortId,
  toPort: PortId,
  style?: Pick<ShapeView, 'strokeWidth' | 'arrowHead'>
): { points: number[]; x: number; y: number; w: number; h: number } {
  const a = portPos(from, fromPort, 0);
  const b = portPos(to, toPort, 0);
  const fromDir = worldPortDir(fromPort, shapeRotation(from));
  const toDir = worldPortDir(toPort, shapeRotation(to));
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const offset = Math.min(80, dist * 0.35);
  const c1x = a.x + fromDir.x * offset;
  const c1y = a.y + fromDir.y * offset;
  const c2x = b.x + toDir.x * offset;
  const c2y = b.y + toDir.y * offset;
  const points = [a.x, a.y, c1x, c1y, c2x, c2y, b.x, b.y];
  return withArrowVisualBounds(style ?? { strokeWidth: 2 }, { points });
}

export interface ShapeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CropBox = Pick<ShapeView, 'cropX' | 'cropY' | 'cropW' | 'cropH'>;

/** Treat 0/NaN crop fractions as a full frame so reset/export never divide by zero. */
export function cropFractions(v: CropBox): { x: number; y: number; w: number; h: number } {
  const w = typeof v.cropW === 'number' && v.cropW > 0 && Number.isFinite(v.cropW) ? v.cropW : 1;
  const h = typeof v.cropH === 'number' && v.cropH > 0 && Number.isFinite(v.cropH) ? v.cropH : 1;
  const x = typeof v.cropX === 'number' && Number.isFinite(v.cropX) ? v.cropX : 0;
  const y = typeof v.cropY === 'number' && Number.isFinite(v.cropY) ? v.cropY : 0;
  return { x, y, w, h };
}

export function imageHasCrop(v: CropBox): boolean {
  return v.cropX !== undefined || v.cropY !== undefined || v.cropW !== undefined || v.cropH !== undefined;
}

/** World box of the uncropped bitmap from the currently displayed (possibly cropped) box. */
export function uncroppedBox(v: Pick<ShapeView, 'x' | 'y' | 'w' | 'h'> & CropBox): ShapeBox {
  const f = cropFractions(v);
  const w = v.w / f.w;
  const h = v.h / f.h;
  return {
    x: v.x - (f.x / f.w) * v.w,
    y: v.y - (f.y / f.h) * v.h,
    w,
    h,
  };
}

/**
 * World AABB of the full bitmap after a (possibly rotated) crop.
 * `uncroppedBox` is the local-frame full rect used by the crop overlay;
 * reset must reanchor so the crop window's world top-left stays put.
 */
export function restoreUncroppedBox(
  v: Pick<ShapeView, 'x' | 'y' | 'w' | 'h' | 'rotation'> & CropBox
): ShapeBox {
  const f = cropFractions(v);
  const full = uncroppedBox(v);
  if (!v.rotation) return full;
  const restored = { ...full, rotation: v.rotation };
  const want = localToWorld(v, 0, 0);
  const got = localToWorld(restored, f.x * full.w, f.y * full.h);
  return {
    x: full.x + (want.x - got.x),
    y: full.y + (want.y - got.y),
    w: full.w,
    h: full.h,
  };
}

export const BOARD_TYPEFACE = '"Space Grotesk", Onest, "Segoe UI", system-ui, sans-serif';
export const TEXT_HIGHLIGHT = 'rgba(255, 226, 122, 0.42)';

export function boardFont(
  size: number,
  fmt: { bold?: boolean; italic?: boolean } = {}
): string {
  const style = fmt.italic ? 'italic' : 'normal';
  const weight = fmt.bold ? '700' : '400';
  return `${style} ${weight} ${size}px ${BOARD_TYPEFACE}`;
}

export function shapeFont(v: Pick<ShapeView, 'fontSize' | 'bold' | 'italic'>, fallback = TEXT_FONT): string {
  return boardFont(v.fontSize ?? fallback, v);
}

function lineAnchorX(boxX: number, boxW: number, lineW: number, align: TextAlign): number {
  if (align === 'center') return boxX + (boxW - lineW) / 2;
  if (align === 'right') return boxX + boxW - lineW;
  return boxX;
}

function drawTextDecorations(
  ctx: CanvasRenderingContext2D,
  startX: number,
  lineY: number,
  lineW: number,
  size: number,
  color: string,
  underline?: boolean,
  strike?: boolean
): void {
  if (!underline && !strike) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size / 14);
  ctx.lineCap = 'round';
  if (underline) {
    const y = lineY + size * 1.08;
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(startX + lineW, y);
    ctx.stroke();
  }
  if (strike) {
    const y = lineY + size * 0.55;
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(startX + lineW, y);
    ctx.stroke();
  }
  ctx.restore();
}

export const COLORS = {
  background: '#1c1c1a',
  grid: 'rgba(236,234,228,0.055)',
  stroke: '#6b6b66',
  fill: '#ffffff',
  sticky: '#ffe27a',
  stickyStroke: '#d9b64d',
  pen: '#eceae4',
  text: '#eceae4',
  /** Overridden at runtime by the active chrome theme (see chromeTheme.syncSelectionColor). */
  selection: '#c4b8a8',
};

export const PEN_STROKE = 3;
export const STICKY_FONT = 16;
export const TEXT_FONT = 18;
export const SHAPE_FONT = 16;
/** Table cell text size. */
export const TABLE_FONT = 14;
/** Line box for sticky notes and flowchart labels (canvas, overlay, SVG). */
export const LABEL_LINE_HEIGHT = 1.25;
/** Line box for free text and table cells. */
export const TEXT_LINE_HEIGHT = 1.3;

export function textOverlayLineHeight(type: string | null | undefined): number {
  return type === 'text' || type === 'table' ? TEXT_LINE_HEIGHT : LABEL_LINE_HEIGHT;
}

const LABELLED_SHAPE_TYPES: ReadonlySet<ShapeType> = new Set([
  'rect',
  'ellipse',
  'diamond',
  'frame',
  'triangle',
  'parallelogram',
  'hexagon',
  'cylinder',
  'terminator',
  'subroutine',
  'display',
]);

/** Shapes that persist a `text` / `fontSize` field on the Y.Map. */
export function shapeHasTextField(type: ShapeType): boolean {
  return type === 'sticky' || type === 'text' || type === 'table' || LABELLED_SHAPE_TYPES.has(type);
}

/** Clamp a PDF/doc page index into `[0, count-1]` (empty list → 0). */
export function docPageIndex(page: number | null | undefined, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, page ?? 0), count - 1);
}

/** Next/prev from a possibly out-of-range stored page (display uses the clamp). */
export function docPageStep(page: number | null | undefined, count: number, dir: -1 | 1): number {
  const cur = docPageIndex(page, count);
  if (count <= 0) return 0;
  return Math.min(Math.max(0, cur + dir), count - 1);
}

/** Fallback font size when a shape has no stored `fontSize`. */
export function defaultFontSizeFor(type: ShapeType): number {
  if (type === 'sticky') return STICKY_FONT;
  if (type === 'table') return TABLE_FONT;
  if (LABELLED_SHAPE_TYPES.has(type)) return SHAPE_FONT;
  return TEXT_FONT;
}
/** Default table grid for click-created tables. */
export const TABLE_DEFAULT_COLS = 3;
export const TABLE_DEFAULT_ROWS = 4;
/** Approximate cell size used to derive cols/rows from a drag box. */
export const TABLE_CELL_W = 140;
export const TABLE_CELL_H = 56;
/** Table [+]/[−] chrome: world = value / zoom so the pills stay screen-sized. */
export const TABLE_PILL_OUT = 22;
export const TABLE_PILL_SPLIT = 22;
export const TABLE_PILL_R = 10;
/** Click-to-type text tool: overlay wrap width in world px (commit uses the same). */
export const TEXT_TOOL_WRAP_W = 240;
/** World-space insets for sticky / table / flowchart labels (overlay scales these by zoom). */
export const STICKY_TEXT_PAD = 8;
export const TABLE_CELL_PAD_X = 10;
export const TABLE_CELL_PAD_TOP = 8;
export const SHAPE_LABEL_PAD_X = 8;
export const FRAME_LABEL_PAD_X = 10;

/** Frame title bar height (canvas, overlay, and SVG share this). */
export function frameHeaderHeight(h: number): number {
  return Math.min(28, h * 0.22);
}

/** Frames paint a single header line; extra newlines never reach the canvas. */
export function frameTitleLine(text: string | undefined): string {
  return (text ?? '').split('\n')[0] ?? '';
}

/** Header row is bold even when the table itself is not. Overlay and SVG share this. */
export function tableCellStyle(
  v: Pick<ShapeView, 'bold' | 'italic' | 'underline' | 'strike' | 'textAlign'>,
  row: number,
  header: boolean
): { bold: boolean; italic: boolean; underline: boolean; strike: boolean; textAlign: TextAlign } {
  return {
    bold: (header && row === 0) || !!v.bold,
    italic: !!v.italic,
    underline: !!v.underline,
    strike: !!v.strike,
    textAlign: v.textAlign ?? 'left',
  };
}

/** CSS padding so the overlay wraps at the same world width as canvas labels. */
export function textOverlayPaddingCss(
  kind: { type?: string | null; centered?: boolean; highlight?: boolean; w?: number },
  zoom: number
): string {
  const z = Math.max(0.01, zoom);
  const px = (n: number) => `${n * z}px`;
  if (kind.type === 'table') return `${px(TABLE_CELL_PAD_TOP)} ${px(TABLE_CELL_PAD_X)}`;
  if (kind.type === 'sticky') return px(STICKY_TEXT_PAD);
  if (kind.type === 'diamond' || kind.type === 'triangle') {
    const w = kind.w ?? 0;
    const inner = shapeLabelInnerWidth(kind.type, w);
    return `0 ${px(Math.max(0, (w - inner) / 2))}`;
  }
  if (kind.type === 'frame') return `0 ${px(FRAME_LABEL_PAD_X)}`;
  if (kind.centered) return `0 ${px(SHAPE_LABEL_PAD_X)}`;
  return '0';
}

/** Overlay CSS width in screen pixels (matches the shape box; no 120px floor). */
export function textOverlayWidthPx(
  target: { centered?: boolean; w: number },
  zoom: number
): number {
  const z = Math.max(0.01, zoom);
  return Math.max(target.centered ? 20 : 8, target.w * z);
}
/** Legacy default for rects drawn before the sharp/rounded option existed. */
export const DEFAULT_RECT_RADIUS = 6;

export function hasFill(fill: string | undefined): boolean {
  return !!fill && fill !== 'transparent' && fill !== 'none';
}

export function rectCornerRadius(v: Pick<ShapeView, 'cornerRadius' | 'w' | 'h'>): number {
  const raw = v.cornerRadius === undefined ? DEFAULT_RECT_RADIUS : Math.max(0, v.cornerRadius);
  if (raw <= 0) return 0;
  return Math.min(raw, Math.abs(v.w) / 2, Math.abs(v.h) / 2);
}

/** Normalized table grid (cells sized by column/row fractions of the outer box). */
export interface TableGrid {
  cols: number;
  rows: number;
  cells: string[];
  header: boolean;
  /** Column widths / row heights as fractions summing to 1. */
  colW: number[];
  rowH: number[];
}

export function normalizeTableCells(cols: number, rows: number, cells?: unknown): string[] {
  const src = Array.isArray(cells) ? cells : [];
  const out: string[] = new Array(cols * rows).fill('');
  for (let i = 0; i < out.length && i < src.length; i++) {
    out[i] = typeof src[i] === 'string' ? src[i] : '';
  }
  return out;
}

/** Fractions summing to 1, or uniform when the stored sizes are invalid. */
export function normalizeTableSizes(n: number, arr?: unknown): number[] {
  if (Array.isArray(arr) && arr.length === n) {
    const nums = arr.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : NaN));
    if (nums.every((x) => x > 0)) {
      const sum = nums.reduce((a, b) => a + b, 0);
      if (sum > 0) return nums.map((x) => x / sum);
    }
  }
  return new Array(n).fill(1 / n);
}

/** Move the divider after column/row i-1 by delta (fractions); the neighbor compensates. */
export function shiftTableDivider(fracs: number[], i: number, delta: number, minF: number): number[] {
  if (i < 1 || i >= fracs.length) return fracs;
  const total = fracs[i - 1] + fracs[i];
  const lo = Math.min(minF, Math.max(0, total - minF));
  const a = Math.min(total - lo, Math.max(lo, fracs[i - 1] + delta));
  const out = [...fracs];
  out[i - 1] = a;
  out[i] = total - a;
  return out;
}

/** Which column/row a 0…1 offset falls in. */
export function tableAxisIndex(fracs: number[], t: number): number {
  if (!fracs.length) return 0;
  const tt = Math.max(0, Math.min(1 - 1e-12, t));
  let acc = 0;
  for (let i = 0; i < fracs.length; i++) {
    acc += fracs[i]!;
    if (tt <= acc + 1e-12) return i;
  }
  return fracs.length - 1;
}

/** Map a 0…1 offset through a same-length fraction change (divider drag). */
export function mapAlongTableFractions(from: number[], to: number[], t: number): number {
  if (from.length !== to.length || from.length === 0) return t;
  const oldE = [0];
  const newE = [0];
  let os = 0;
  let ns = 0;
  for (let i = 0; i < from.length; i++) {
    os += from[i]!;
    ns += to[i]!;
    oldE.push(os);
    newE.push(ns);
  }
  oldE[oldE.length - 1] = 1;
  newE[newE.length - 1] = 1;
  const tt = Math.max(0, Math.min(1, t));
  let i = 0;
  for (; i < oldE.length - 2; i++) {
    if (tt <= oldE[i + 1]! + 1e-12) break;
  }
  const a0 = oldE[i]!;
  const a1 = oldE[i + 1]!;
  const b0 = newE[i]!;
  const b1 = newE[i + 1]!;
  const span = a1 - a0;
  const u = span > 1e-12 ? (tt - a0) / span : 0;
  return b0 + u * (b1 - b0);
}

export function tableGrid(
  v: Pick<ShapeView, 'cols' | 'rows' | 'cells' | 'header' | 'colW' | 'rowH'>
): TableGrid {
  const cols = Math.min(24, Math.max(1, Math.floor(v.cols ?? TABLE_DEFAULT_COLS) || TABLE_DEFAULT_COLS));
  const rows = Math.min(64, Math.max(1, Math.floor(v.rows ?? TABLE_DEFAULT_ROWS) || TABLE_DEFAULT_ROWS));
  return {
    cols,
    rows,
    cells: normalizeTableCells(cols, rows, v.cells),
    header: v.header !== false,
    colW: normalizeTableSizes(cols, v.colW),
    rowH: normalizeTableSizes(rows, v.rowH),
  };
}

/** Cumulative fraction offset of column/row i. */
function tableCum(fracs: number[], i: number): number {
  let s = 0;
  for (let k = 0; k < i && k < fracs.length; k++) s += fracs[k];
  return s;
}

export function tableCellRect(
  v: Pick<ShapeView, 'x' | 'y' | 'w' | 'h' | 'cols' | 'rows' | 'cells' | 'header' | 'colW' | 'rowH'>,
  row: number,
  col: number
): ShapeBox {
  const g = tableGrid(v);
  const r = Math.min(g.rows - 1, Math.max(0, row));
  const c = Math.min(g.cols - 1, Math.max(0, col));
  return {
    x: v.x + tableCum(g.colW, c) * v.w,
    y: v.y + tableCum(g.rowH, r) * v.h,
    w: g.colW[c] * v.w,
    h: g.rowH[r] * v.h,
  };
}

export function tableCellAt(
  v: Pick<ShapeView, 'x' | 'y' | 'w' | 'h' | 'cols' | 'rows' | 'cells' | 'header' | 'colW' | 'rowH'> & {
    rotation?: number;
  },
  px: number,
  py: number
): { row: number; col: number } {
  const local = shapeRotation(v) ? worldToLocal(v, px, py) : { x: px - v.x, y: py - v.y };
  const g = tableGrid(v);
  const fx = v.w > 0 ? local.x / v.w : 0;
  const fy = v.h > 0 ? local.y / v.h : 0;
  let col = g.cols - 1;
  for (let c = 0; c < g.cols; c++) {
    if (fx < tableCum(g.colW, c + 1)) {
      col = c;
      break;
    }
  }
  let row = g.rows - 1;
  for (let r = 0; r < g.rows; r++) {
    if (fy < tableCum(g.rowH, r + 1)) {
      row = r;
      break;
    }
  }
  return { row, col };
}

/**
 * Shapes riding on tables (fully contained, transitively): they move with the table.
 * tableIds = already-moving tables; returns rider ids (excluding the input tables).
 */
export function tableRiderIds(
  shapes: Array<Pick<ShapeView, 'id' | 'x' | 'y' | 'w' | 'h' | 'type' | 'locked'> & { rotation?: number }>,
  tableIds: Set<string> | string[]
): string[] {
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const tables = [...tableIds].map((id) => byId.get(id)).filter((t) => t && t.type === 'table');
  if (!tables.length) return [];
  const riding = new Set<string>([...tableIds]);
  for (let pass = 0; pass < 4; pass++) {
    let added = false;
    for (const s of shapes) {
      if (riding.has(s.id) || s.locked) continue;
      for (const rid of riding) {
        const t = byId.get(rid);
        if (!t || t.type !== 'table') continue;
        if (tableCarries(t as ShapeView, s)) {
          riding.add(s.id);
          added = true;
          break;
        }
      }
    }
    if (!added) break;
  }
  for (const id of tableIds) riding.delete(id);
  return [...riding];
}

/**
 * Tray rule: a shape rides the table when its center is on it.
 * Freehand marks and notes (pen, unconnected arrow, sticky, text) always belong
 * where drawn — no size check. Connected arrows follow ports, so they must not
 * ride (that would yank the far end off its shape). Sheet-like shapes (rect,
 * ellipse, image, frame, doc, graph, nested tables) must also fit, so huge
 * backgrounds underneath stay put.
 */
export function tableCarries(
  t: Pick<ShapeView, 'x' | 'y' | 'w' | 'h'> & { rotation?: number },
  s: Pick<ShapeView, 'x' | 'y' | 'w' | 'h' | 'type'> & { fromId?: string; toId?: string }
): boolean {
  const tol = 2;
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const local = shapeRotation(t)
    ? worldToLocal(t, cx, cy)
    : { x: cx - t.x, y: cy - t.y };
  if (local.x < -tol || local.y < -tol || local.x > t.w + tol || local.y > t.h + tol) return false;
  if (s.type === 'arrow' && s.fromId && s.toId) return false;
  if (s.type === 'pen' || s.type === 'arrow' || s.type === 'sticky' || s.type === 'text') return true;
  return s.w <= t.w + tol * 2 && s.h <= t.h + tol * 2;
}

export function arrowHeadLength(v: Pick<ShapeView, 'arrowHead' | 'strokeWidth'>): number {
  if (typeof v.arrowHead === 'number') return Math.max(0, v.arrowHead);
  return Math.max(10, v.strokeWidth * 3.5);
}

export function normalizeBox(a: { x: number; y: number }, b: { x: number; y: number }): ShapeBox {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** `#rrggbb` + alpha → `rgba(...)` (for canvas fills derived from the theme selection color). */
export function withAlpha(hex: string, alpha: number): string {
  const v = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return hex;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface BoardTheme {
  text: string;
  grid: string;
}

export function themeFor(bg: string): BoardTheme {
  if (isOrbitPaper(bg)) {
    return { text: ORBIT_DRAW.text, grid: ORBIT_DRAW.grid };
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(bg)) {
    return { text: COLORS.text, grid: COLORS.grid };
  }
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5
    ? { text: '#1c1c1a', grid: 'rgba(28, 28, 26, 0.07)' }
    : { text: '#eceae4', grid: 'rgba(236, 234, 228, 0.055)' };
}

/** WCAG relative luminance for `#rrggbb`, or null if not a hex color. */
export function relativeLuminance(hex: string): number | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = lin(parseInt(hex.slice(1, 3), 16));
  const g = lin(parseInt(hex.slice(3, 5), 16));
  const b = lin(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colors, or null if either is invalid. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return null;
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/** Minimum contrast for free-text on the board background (WCAG AA for normal text). */
export const MIN_BOARD_TEXT_CONTRAST = 4.5;

/**
 * Keep free-text readable on the board background.
 * Low-contrast picks (e.g. `#6b6b66` / `#1c1c1a` on a dark board) fall back to theme text.
 */
export function readableTextOn(fg: string, bg: string): string {
  const ratio = contrastRatio(fg, bg);
  if (ratio == null || ratio >= MIN_BOARD_TEXT_CONTRAST) return fg;
  return themeFor(bg).text;
}

/**
 * Display color for ink (pen / arrow / free text) on this client's paper.
 * Stored colors stay as authored — only pure black↔white is swapped.
 * Dark paper + near-black → near-white, light paper + near-white → near-black.
 */
export function displayInk(color: string, boardBg: string): string {
  if (!readPrefs().adaptInkToPaper) return color;
  const fg = relativeLuminance(color);
  const bg = relativeLuminance(boardBg);
  if (fg == null || bg == null) return color;
  const isDarkBg = bg < 0.12;
  const isLightBg = bg > 0.7;
  const isBlack = fg < 0.05; // #000000, #1c1c1a, #121110
  const isWhite = fg > 0.82; // #ffffff, #eceae4, #f8f9fa
  if (isDarkBg && isBlack) return themeFor(boardBg).text;
  if (isLightBg && isWhite) return themeFor(boardBg).text;
  return color;
}

export function intersects(a: ShapeBox, b: ShapeBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** `inner` lies fully inside `outer` (with tolerance). Axis-aligned boxes only. */
export function containedIn(inner: ShapeBox, outer: ShapeBox, tol = 2): boolean {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.w <= outer.x + outer.w + tol &&
    inner.y + inner.h <= outer.y + outer.h + tol
  );
}

/** `inner`'s corners lie in `outer`'s local unrotated frame (rotation-aware). */
export function containedInShape(
  inner: Pick<ShapeView, 'x' | 'y' | 'w' | 'h'> & { rotation?: number },
  outer: Pick<ShapeView, 'x' | 'y' | 'w' | 'h'> & { rotation?: number },
  tol = 2
): boolean {
  const corners = [
    localToWorld(inner, 0, 0),
    localToWorld(inner, inner.w, 0),
    localToWorld(inner, inner.w, inner.h),
    localToWorld(inner, 0, inner.h),
  ];
  for (const p of corners) {
    const local = worldToLocal(outer, p.x, p.y);
    if (local.x < -tol || local.y < -tol || local.x > outer.w + tol || local.y > outer.h + tol) {
      return false;
    }
  }
  return true;
}

const IMAGE_RIDER_TYPES = new Set(['text', 'sticky', 'pen']);

/** Build stacking ranks from board order (later index = painted on top). */
export function stackOrderIndex(order: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < order.length; i++) m.set(order[i]!, i);
  return m;
}

/**
 * Shapes that should translate/rotate with a moved host: table trays (cascading),
 * annotations glued to a photo/PDF, and anything nested in a frame.
 *
 * Photo/PDF/video notes magnetize only when they sit *above* the host in stacking order
 * (`orderIndex` or, if omitted, position in `shapes`: later = on top). Notes under
 * a photo do not ride. Frames still use containment only.
 */
export function hostRiderIds(
  shapes: Array<Pick<ShapeView, 'id' | 'x' | 'y' | 'w' | 'h' | 'type' | 'locked'> & { rotation?: number }>,
  hostIds: Set<string> | string[],
  orderIndex?: ReadonlyMap<string, number>
): string[] {
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const skip = new Set([...hostIds]);
  const riding = new Set<string>();
  const z =
    orderIndex ??
    (() => {
      const m = new Map<string, number>();
      for (let i = 0; i < shapes.length; i++) m.set(shapes[i]!.id, i);
      return m;
    })();

  const addFrom = (host: (typeof shapes)[number]) => {
    if (host.type === 'table') {
      for (const id of tableRiderIds(shapes, [host.id])) {
        if (!skip.has(id)) riding.add(id);
      }
      return;
    }
    if (host.type !== 'image' && host.type !== 'video' && host.type !== 'doc' && host.type !== 'frame') return;
    const hostZ = z.get(host.id) ?? -1;
    for (const s of shapes) {
      if (skip.has(s.id) || riding.has(s.id) || s.locked) continue;
      if (MEDIA_HOST_TYPES.has(host.type) && !IMAGE_RIDER_TYPES.has(s.type)) continue;
      if (MEDIA_HOST_TYPES.has(host.type) && (z.get(s.id) ?? -1) <= hostZ) continue;
      if (containedInShape(s, host)) riding.add(s.id);
    }
  };

  for (const id of hostIds) {
    const host = byId.get(id);
    if (host) addFrom(host);
  }
  for (let pass = 0; pass < 4; pass++) {
    const before = riding.size;
    for (const id of [...riding]) {
      const host = byId.get(id);
      if (host) addFrom(host);
    }
    if (riding.size === before) break;
  }
  return [...riding];
}

type Point = { x: number; y: number };

type ArrowCurve =
  | { kind: 'line'; start: Point; end: Point; endAngle: number }
  | { kind: 'quadratic'; start: Point; control: Point; end: Point; endAngle: number }
  | { kind: 'cubic'; start: Point; control1: Point; control2: Point; end: Point; endAngle: number };

function isPortId(value: string | undefined): value is PortId {
  return value !== undefined && PORTS.some((port) => port === value);
}

function arrowCurve(v: ShapeView): ArrowCurve | null {
  const pts = v.points ?? [];
  if (pts.length < 4) return null;

  const start = { x: pts[0], y: pts[1] };
  const fromPort = isPortId(v.fromPort) ? v.fromPort : null;
  const toPort = isPortId(v.toPort) ? v.toPort : null;
  const isConnected = Boolean(v.fromId && v.toId && fromPort && toPort);

  if (pts.length >= 8) {
    const control1 = { x: pts[2], y: pts[3] };
    const control2 = { x: pts[4], y: pts[5] };
    const end = { x: pts[6], y: pts[7] };
    let endAngle = Math.atan2(end.y - control2.y, end.x - control2.x);
    if (!isFinite(endAngle)) {
      endAngle = Math.atan2(end.y - start.y, end.x - start.x);
    }
    return { kind: 'cubic', start, control1, control2, end, endAngle };
  }

  const end = { x: pts[2], y: pts[3] };
  if (isConnected && fromPort && toPort) {
    const fromDir = portDir(fromPort);
    const toDir = portDir(toPort);
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    const offset = Math.min(80, dist * 0.35);
    const control1 = { x: start.x + fromDir.x * offset, y: start.y + fromDir.y * offset };
    const control2 = { x: end.x + toDir.x * offset, y: end.y + toDir.y * offset };
    let endAngle = Math.atan2(end.y - control2.y, end.x - control2.x);
    if (!isFinite(endAngle)) {
      endAngle = Math.atan2(end.y - start.y, end.x - start.x);
    }
    return { kind: 'cubic', start, control1, control2, end, endAngle };
  }

  if (pts.length === 4) {
    const midpoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    const normal = { x: -dy / len, y: dx / len };
    const bend = Math.min(40, len * 0.18) * arrowBendSign(dx, dy);
    const control = {
      x: midpoint.x + normal.x * bend * 0.5,
      y: midpoint.y + normal.y * bend * 0.5,
    };
    const endAngle = Math.atan2(end.y - control.y, end.x - control.x);
    return { kind: 'quadratic', start, control, end, endAngle };
  }

  return {
    kind: 'line',
    start,
    end,
    endAngle: Math.atan2(end.y - start.y, end.x - start.x),
  };
}

function pointOnArrowCurve(curve: ArrowCurve, t: number): Point {
  const u = 1 - t;
  if (curve.kind === 'quadratic') {
    return {
      x: u * u * curve.start.x + 2 * u * t * curve.control.x + t * t * curve.end.x,
      y: u * u * curve.start.y + 2 * u * t * curve.control.y + t * t * curve.end.y,
    };
  }
  if (curve.kind === 'cubic') {
    return {
      x:
        u * u * u * curve.start.x +
        3 * u * u * t * curve.control1.x +
        3 * u * t * t * curve.control2.x +
        t * t * t * curve.end.x,
      y:
        u * u * u * curve.start.y +
        3 * u * u * t * curve.control1.y +
        3 * u * t * t * curve.control2.y +
        t * t * t * curve.end.y,
    };
  }
  return {
    x: curve.start.x + (curve.end.x - curve.start.x) * t,
    y: curve.start.y + (curve.end.y - curve.start.y) * t,
  };
}

/** Adaptive shaft samples: short arrows stay cheap; long ones keep hit fidelity. */
function arrowSampleSegments(curve: ArrowCurve): number {
  const { start, end } = curve;
  let span = Math.hypot(end.x - start.x, end.y - start.y);
  if (curve.kind === 'quadratic') {
    span = Math.max(
      span,
      Math.hypot(curve.control.x - start.x, curve.control.y - start.y) +
        Math.hypot(end.x - curve.control.x, end.y - curve.control.y)
    );
  } else if (curve.kind === 'cubic') {
    span = Math.max(
      span,
      Math.hypot(curve.control1.x - start.x, curve.control1.y - start.y) +
        Math.hypot(curve.control2.x - curve.control1.x, curve.control2.y - curve.control1.y) +
        Math.hypot(end.x - curve.control2.x, end.y - curve.control2.y)
    );
  }
  return Math.max(4, Math.min(24, Math.ceil(span / 48) + 4));
}

function sampleArrowCurve(curve: ArrowCurve, segments = arrowSampleSegments(curve)): number[] {
  const points: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const point = pointOnArrowCurve(curve, i / segments);
    points.push(point.x, point.y);
  }
  return points;
}

function arrowHeadTips(curve: ArrowCurve, head: number): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: curve.end.x - head * Math.cos(curve.endAngle - 0.42),
    y1: curve.end.y - head * Math.sin(curve.endAngle - 0.42),
    x2: curve.end.x - head * Math.cos(curve.endAngle + 0.42),
    y2: curve.end.y - head * Math.sin(curve.endAngle + 0.42),
  };
}

type ArrowGeom = {
  fp: string;
  curve: ArrowCurve;
  shaft: number[];
  hitPoly: number[];
  bounds: ShapeBox;
  tip: { x1: number; y1: number; x2: number; y2: number };
  head: number;
};

/** Id → tessellated shaft/head/bounds. View objects are recreated on every Yjs patch. */
const arrowGeomCache = new Map<string, ArrowGeom>();
const ARROW_GEOM_CACHE_MAX = 4096;

/**
 * Camera zoom for the current paint/hit frame. Engine sets this before render so
 * LOD (calc keypad) can use screen-space thresholds without threading zoom
 * through every draw helper.
 */
let paintZoom = 1;

export function setPaintZoom(zoom: number): void {
  paintZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

export function getPaintZoom(): number {
  return paintZoom;
}

/** Cached wrapText results — measureText + wrap dominates when many stickies/labels stay dirty. */
const wrapTextCache = new Map<string, string[]>();
const WRAP_TEXT_CACHE_MAX = 2048;

export function wrapTextCacheSizeForTest(): number {
  return wrapTextCache.size;
}

export function clearWrapTextCacheForTest(): void {
  wrapTextCache.clear();
}

function arrowGeomFingerprint(v: ShapeView): string {
  const pts = v.points ?? [];
  return `${pts.length}:${pts.join(',')}|${v.strokeWidth}|${v.arrowHead ?? ''}|${v.fromId ?? ''}|${v.toId ?? ''}|${v.fromPort ?? ''}|${v.toPort ?? ''}`;
}

function buildArrowGeom(v: ShapeView, curve: ArrowCurve): ArrowGeom {
  const head = arrowHeadLength(v);
  const tip = arrowHeadTips(curve, head);
  const shaft = sampleArrowCurve(curve);
  const hitPoly = shaft.slice();
  hitPoly.push(curve.end.x, curve.end.y, tip.x1, tip.y1, curve.end.x, curve.end.y, tip.x2, tip.y2);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < shaft.length; i += 2) {
    const x = shaft[i];
    const y = shaft[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (tip.x1 < minX) minX = tip.x1;
  if (tip.y1 < minY) minY = tip.y1;
  if (tip.x1 > maxX) maxX = tip.x1;
  if (tip.y1 > maxY) maxY = tip.y1;
  if (tip.x2 < minX) minX = tip.x2;
  if (tip.y2 < minY) minY = tip.y2;
  if (tip.x2 > maxX) maxX = tip.x2;
  if (tip.y2 > maxY) maxY = tip.y2;
  const pad = v.strokeWidth / 2 + 5;
  return {
    fp: arrowGeomFingerprint(v),
    curve,
    shaft,
    hitPoly,
    tip,
    head,
    bounds: {
      x: minX - pad,
      y: minY - pad,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2,
    },
  };
}

function getArrowGeom(v: ShapeView): ArrowGeom | null {
  const curve = arrowCurve(v);
  if (!curve) return null;
  const id = v.id;
  const fp = arrowGeomFingerprint(v);
  if (id) {
    const hit = arrowGeomCache.get(id);
    if (hit && hit.fp === fp) return hit;
  }
  const geom = buildArrowGeom(v, curve);
  if (id) {
    if (arrowGeomCache.size >= ARROW_GEOM_CACHE_MAX) {
      let drop = (ARROW_GEOM_CACHE_MAX / 4) | 0;
      for (const key of arrowGeomCache.keys()) {
        arrowGeomCache.delete(key);
        if (--drop <= 0) break;
      }
    }
    arrowGeomCache.set(id, geom);
  }
  return geom;
}

/** Test helper — cache size after warm lookups (not a product API). */
export function arrowGeomCacheSizeForTest(): number {
  return arrowGeomCache.size;
}

/** Test helper — drop cached tessellations between cases. */
export function clearArrowGeomCacheForTest(): void {
  arrowGeomCache.clear();
}

function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  const v0x = cx - ax;
  const v0y = cy - ay;
  const v1x = bx - ax;
  const v1y = by - ay;
  const v2x = px - ax;
  const v2y = py - ay;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const den = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(den) < 1e-12) return false;
  const u = (dot11 * dot02 - dot01 * dot12) / den;
  const v = (dot00 * dot12 - dot01 * dot02) / den;
  return u >= 0 && v >= 0 && u + v <= 1;
}

/** Stored AABB for an arrow whose stroke is `patch.points` (curve + head). */
export function withArrowVisualBounds<T extends { points?: number[] }>(
  style: Pick<ShapeView, 'strokeWidth' | 'arrowHead'>,
  patch: T
): T & ShapeBox {
  const box = arrowBounds({
    id: '',
    type: 'arrow',
    points: patch.points,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: style.strokeWidth ?? 2,
    arrowHead: style.arrowHead,
  });
  return { ...patch, ...box };
}

export function arrowBounds(v: ShapeView): ShapeBox {
  const geom = getArrowGeom(v);
  if (!geom) return { x: v.x, y: v.y, w: v.w, h: v.h };
  return geom.bounds;
}

export function describeArrow(
  v: ShapeView,
  ox = 0,
  oy = 0
): { pathD: string; head: [number, number, number, number, number, number] } | null {
  const curve = arrowCurve(v);
  if (!curve) return null;
  const sx = curve.start.x + ox;
  const sy = curve.start.y + oy;
  const ex = curve.end.x + ox;
  const ey = curve.end.y + oy;
  let pathD: string;
  if (curve.kind === 'cubic') {
    pathD = `M${sx} ${sy} C${curve.control1.x + ox} ${curve.control1.y + oy} ${curve.control2.x + ox} ${curve.control2.y + oy} ${ex} ${ey}`;
  } else if (curve.kind === 'quadratic') {
    pathD = `M${sx} ${sy} Q${curve.control.x + ox} ${curve.control.y + oy} ${ex} ${ey}`;
  } else {
    pathD = `M${sx} ${sy} L${ex} ${ey}`;
  }
  const tip = arrowHeadTips(curve, arrowHeadLength(v));
  return { pathD, head: [ex, ey, tip.x1 + ox, tip.y1 + oy, tip.x2 + ox, tip.y2 + oy] };
}

/** Sampled shaft plus arrowhead outline — same geometry used to paint and hit-test. */
export function arrowHitPolyline(v: ShapeView): number[] {
  const geom = getArrowGeom(v);
  if (!geom) return v.points && v.points.length >= 2 ? v.points.slice() : [];
  return geom.hitPoly;
}

export function pointInShape(v: ShapeView, px: number, py: number): boolean {
  // Pens/arrows store world-space points; rotation is baked in when applied.
  if (v.type === 'pen') {
    const tol = v.strokeWidth / 2 + 3;
    // Spatial box already pads stroke; reject before walking dense polylines.
    if (px < v.x - tol || px > v.x + v.w + tol || py < v.y - tol || py > v.y + v.h + tol) {
      return false;
    }
    return pointNearPolyline(v.points ?? [], px, py, tol);
  }
  if (v.type === 'arrow') {
    const geom = getArrowGeom(v);
    if (!geom) return false;
    const tol = v.strokeWidth / 2 + 3;
    const b = geom.bounds;
    // Cheap reject before walking the tessellated shaft (bounds already pad stroke).
    if (px < b.x - tol || px > b.x + b.w + tol || py < b.y - tol || py > b.y + b.h + tol) return false;
    if (pointNearPolyline(geom.shaft, px, py, tol)) return true;
    const tip = geom.tip;
    const end = geom.curve.end;
    return pointInTriangle(px, py, end.x, end.y, tip.x1, tip.y1, tip.x2, tip.y2);
  }
  const rotated = Boolean(shapeRotation(v));
  const box = rotated ? { ...v, x: 0, y: 0, rotation: 0 } : v;
  const p = rotated ? worldToLocal(v, px, py) : { x: px, y: py };
  const x = p.x;
  const y = p.y;
  switch (box.type) {
    case 'ellipse': {
      const rx = box.w / 2;
      const ry = box.h / 2;
      if (!rx || !ry) return false;
      const dx = (x - (box.x + rx)) / rx;
      const dy = (y - (box.y + ry)) / ry;
      return dx * dx + dy * dy <= 1;
    }
    case 'diamond': {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const dx = Math.abs(x - cx) / (box.w / 2);
      const dy = Math.abs(y - cy) / (box.h / 2);
      return dx + dy <= 1;
    }
    case 'triangle': {
      const ax = box.x + box.w / 2, ay = box.y;
      const bx = box.x, by = box.y + box.h;
      const cx = box.x + box.w, cy = box.y + box.h;
      const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (!denom) return false;
      const a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom;
      const b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom;
      const c = 1 - a - b;
      return a >= 0 && b >= 0 && c >= 0;
    }
    case 'parallelogram': {
      const skew = box.w * 0.2;
      const pts = [
        { x: box.x + skew, y: box.y },
        { x: box.x + box.w, y: box.y },
        { x: box.x + box.w - skew, y: box.y + box.h },
        { x: box.x, y: box.y + box.h },
      ];
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    case 'hexagon': {
      const cy = box.y + box.h / 2;
      const pts = [
        { x: box.x + box.w * 0.25, y: box.y },
        { x: box.x + box.w * 0.75, y: box.y },
        { x: box.x + box.w, y: cy },
        { x: box.x + box.w * 0.75, y: box.y + box.h },
        { x: box.x + box.w * 0.25, y: box.y + box.h },
        { x: box.x, y: cy },
      ];
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    case 'cylinder': {
      const rx = box.w / 2, ry = Math.min(box.h * 0.15, 18);
      if (y < box.y + ry) {
        const dx = (x - (box.x + rx)) / rx;
        const dy = (y - (box.y + ry)) / ry;
        return dx * dx + dy * dy <= 1;
      }
      if (y > box.y + box.h - ry) {
        const dx = (x - (box.x + rx)) / rx;
        const dy = (y - (box.y + box.h - ry)) / ry;
        return dx * dx + dy * dy <= 1;
      }
      return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
    }
    case 'terminator': {
      const r = Math.min(box.w, box.h) / 2;
      if (box.w >= box.h) {
        if (x < box.x + r) {
          const dx = x - (box.x + r), dy = y - (box.y + r);
          return dx * dx + dy * dy <= r * r;
        }
        if (x > box.x + box.w - r) {
          const dx = x - (box.x + box.w - r), dy = y - (box.y + r);
          return dx * dx + dy * dy <= r * r;
        }
      } else {
        if (y < box.y + r) {
          const dx = x - (box.x + r), dy = y - (box.y + r);
          return dx * dx + dy * dy <= r * r;
        }
        if (y > box.y + box.h - r) {
          const dx = x - (box.x + r), dy = y - (box.y + box.h - r);
          return dx * dx + dy * dy <= r * r;
        }
      }
      return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
    }
    case 'subroutine':
      return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
    case 'display': {
      const pts = [
        { x: box.x, y: box.y },
        { x: box.x + box.w * 0.85, y: box.y },
        { x: box.x + box.w, y: box.y + box.h / 2 },
        { x: box.x + box.w * 0.85, y: box.y + box.h },
        { x: box.x, y: box.y + box.h },
      ];
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    default:
      return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  }
}

/**
 * World-space points that lie on the filled silhouette, used by lasso so a
 * loop around an empty AABB corner of a diamond/ellipse does not select, while
 * a loop around a real vertex (or a rect corner) still does.
 */
export function shapeLassoProbes(v: ShapeView): Array<{ x: number; y: number }> {
  const local: Array<{ x: number; y: number }> = [{ x: v.w / 2, y: v.h / 2 }];
  switch (v.type) {
    case 'diamond':
    case 'ellipse':
      local.push(
        { x: v.w / 2, y: 0 },
        { x: v.w, y: v.h / 2 },
        { x: v.w / 2, y: v.h },
        { x: 0, y: v.h / 2 }
      );
      break;
    case 'triangle':
      local.push({ x: v.w / 2, y: 0 }, { x: 0, y: v.h }, { x: v.w, y: v.h });
      break;
    case 'parallelogram': {
      const skew = v.w * 0.2;
      local.push(
        { x: skew, y: 0 },
        { x: v.w, y: 0 },
        { x: v.w - skew, y: v.h },
        { x: 0, y: v.h }
      );
      break;
    }
    case 'hexagon':
      local.push(
        { x: v.w * 0.25, y: 0 },
        { x: v.w * 0.75, y: 0 },
        { x: v.w, y: v.h / 2 },
        { x: v.w * 0.75, y: v.h },
        { x: v.w * 0.25, y: v.h },
        { x: 0, y: v.h / 2 }
      );
      break;
    case 'display':
      local.push(
        { x: 0, y: 0 },
        { x: v.w * 0.85, y: 0 },
        { x: v.w, y: v.h / 2 },
        { x: v.w * 0.85, y: v.h },
        { x: 0, y: v.h }
      );
      break;
    case 'cylinder':
    case 'terminator':
      local.push(
        { x: v.w / 2, y: 0 },
        { x: v.w, y: v.h / 2 },
        { x: v.w / 2, y: v.h },
        { x: 0, y: v.h / 2 }
      );
      break;
    default:
      local.push({ x: 0, y: 0 }, { x: v.w, y: 0 }, { x: v.w, y: v.h }, { x: 0, y: v.h });
  }
  return local.map((p) => localToWorld(v, p.x, p.y));
}

/** Min distance from a point to an open polyline (single vertex = point distance). */
export function polylineDistance(pts: number[], px: number, py: number): number {
  if (pts.length < 2) return Infinity;
  if (pts.length < 4) {
    return Math.hypot(px - pts[0], py - pts[1]);
  }
  let best = Infinity;
  for (let i = 0; i < pts.length - 2; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const abx = pts[i + 2] - ax;
    const aby = pts[i + 3] - ay;
    const len2 = abx * abx + aby * aby;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2)) : 0;
    const dx = px - (ax + abx * t);
    const dy = py - (ay + aby * t);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < best) best = d;
  }
  return best;
}

function pointNearPolyline(pts: number[], px: number, py: number, tol: number): boolean {
  return polylineDistance(pts, px, py) <= tol;
}

/** True only when stylus pressure actually changes — mice report a flat ~0.5. */
export function pressureVaries(pressures: number[] | undefined, pointCount: number): boolean {
  if (!pressures || pressures.length < 2 || pressures.length < pointCount) return false;
  let min = 1;
  let max = 0;
  for (let i = 0; i < pointCount; i++) {
    const p = pressures[i] ?? 0.5;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return max - min > 0.08;
}

function strokeHalfWidth(base: number, pressure: number): number {
  return Math.max(0.25, (base * (0.35 + 0.65 * pressure)) / 2);
}

/** Smooth quadratic polyline (constant width). */
function strokeSmoothPath(ctx: CanvasRenderingContext2D, pts: number[], width: number): void {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  if (pts.length === 4) {
    ctx.lineTo(pts[2], pts[3]);
  } else {
    for (let i = 2; i < pts.length - 2; i += 2) {
      const xc = (pts[i] + pts[i + 2]) / 2;
      const yc = (pts[i + 1] + pts[i + 3]) / 2;
      ctx.quadraticCurveTo(pts[i], pts[i + 1], xc, yc);
    }
    const n = pts.length - 4;
    ctx.quadraticCurveTo(pts[n], pts[n + 1], pts[n + 2], pts[n + 3]);
  }
  ctx.stroke();
}

/**
 * Variable-width ribbon from stylus pressure.
 * Filled outline + end caps — avoids the faceted look of per-segment lineTo strokes.
 */
function strokePressureRibbon(
  ctx: CanvasRenderingContext2D,
  pts: number[],
  width: number,
  pressures: number[]
): void {
  const n = pts.length / 2;
  if (n < 2) return;
  const leftX: number[] = [];
  const leftY: number[] = [];
  const rightX: number[] = [];
  const rightY: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2];
    const y = pts[i * 2 + 1];
    const r = strokeHalfWidth(width, pressures[i] ?? 0.5);
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    let tx = pts[i1 * 2] - pts[i0 * 2];
    let ty = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    leftX.push(x - ty * r);
    leftY.push(y + tx * r);
    rightX.push(x + ty * r);
    rightY.push(y - tx * r);
  }
  ctx.beginPath();
  ctx.moveTo(leftX[0], leftY[0]);
  for (let i = 1; i < n; i++) ctx.lineTo(leftX[i], leftY[i]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(rightX[i], rightY[i]);
  ctx.closePath();
  ctx.fill();
  // Round caps so ends match the smooth constant-width path.
  ctx.beginPath();
  ctx.arc(pts[0], pts[1], strokeHalfWidth(width, pressures[0] ?? 0.5), 0, Math.PI * 2);
  ctx.arc(
    pts[pts.length - 2],
    pts[pts.length - 1],
    strokeHalfWidth(width, pressures[n - 1] ?? 0.5),
    0,
    Math.PI * 2
  );
  ctx.fill();
}

export function drawPenStroke(
  ctx: CanvasRenderingContext2D,
  pts: number[],
  width: number,
  color: string,
  alpha: number,
  pressures?: number[]
): void {
  paintPenStroke(ctx, pts, width, color, alpha, pressures);
}

function paintPenStroke(
  ctx: CanvasRenderingContext2D,
  pts: number[],
  width: number,
  color: string,
  alpha: number,
  pressures?: number[]
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 2) {
    const useP = pressureVaries(pressures, 1);
    const w = useP ? width * (0.35 + 0.65 * (pressures![0] ?? 0.5)) : width;
    ctx.beginPath();
    ctx.arc(pts[0], pts[1], w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  if (pressureVaries(pressures, pts.length / 2)) {
    strokePressureRibbon(ctx, pts, width, pressures!);
  } else {
    strokeSmoothPath(ctx, pts, width);
  }
  ctx.restore();
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const sizeMatch = /([\d.]+)px/.exec(ctx.font);
  const fontSize = sizeMatch ? Number(sizeMatch[1]) : 16;
  // Quantize width so tiny float jitter from resize/zoom does not thrash the cache.
  const widthKey = Math.round(maxWidth * 4) / 4;
  const fp = `${widthKey}\0${ctx.font}\0${text}`;
  const cached = wrapTextCache.get(fp);
  if (cached) return cached;
  const lines = wrapLinesByWidth(text, maxWidth, (s) => measureMixedLine(ctx, s, fontSize));
  if (wrapTextCache.size >= WRAP_TEXT_CACHE_MAX) {
    let drop = (WRAP_TEXT_CACHE_MAX / 4) | 0;
    for (const key of wrapTextCache.keys()) {
      wrapTextCache.delete(key);
      if (--drop <= 0) break;
    }
  }
  wrapTextCache.set(fp, lines);
  return lines;
}

/** Inner wrap width for a shape's title / label. Overlay padding and SVG export share this. */
export function shapeLabelInnerWidth(type: string | null | undefined, w: number): number {
  if (type === 'diamond') return Math.max(20, (w * 11) / 20);
  if (type === 'triangle') return Math.max(20, (w * 3) / 5);
  return Math.max(20, w - SHAPE_LABEL_PAD_X * 2);
}

export interface TextRun {
  kind: 'text' | 'formula';
  value: string;
  w: number;
  h: number;
  img: HTMLImageElement | null;
}

export function layoutMixedLine(ctx: CanvasRenderingContext2D, text: string, fontSize: number): TextRun[] {
  const runs: TextRun[] = [];
  const re = /\$([^$]+)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (t: string) => {
    if (t) runs.push({ kind: 'text', value: t, w: ctx.measureText(t).width, h: fontSize, img: null });
  };
  while ((m = re.exec(text))) {
    pushText(text.slice(last, m.index));
    const latex = m[1];
    const metrics = renderFormula(latex);
    if (metrics.valid) {
      const img = formulaImage(latex, fontSize);
      runs.push({ kind: 'formula', value: latex, w: img.w + 4, h: img.h, img: img.img });
    } else {
      pushText(m[0]);
    }
    last = m.index + m[0].length;
  }
  pushText(text.slice(last));
  return runs;
}

export function measureMixedLine(ctx: CanvasRenderingContext2D, text: string, fontSize: number): number {
  let total = 0;
  for (const run of layoutMixedLine(ctx, text, fontSize)) total += run.w;
  return total;
}

function drawMixedLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  x: number,
  lineY: number,
  lineHeight: number,
  size: number,
  deco?: { color: string; underline?: boolean; strike?: boolean }
): void {
  const runs = layoutMixedLine(ctx, line, size);
  const centerY = lineY + lineHeight / 2;
  let cursor = x;
  for (const run of runs) {
    if (run.kind === 'text') {
      ctx.fillText(run.value, cursor, lineY);
      cursor += run.w;
    } else {
      if (run.img) ctx.drawImage(run.img, cursor + 2, centerY - run.h / 2, run.w - 4, run.h);
      else {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillText(`$${run.value}$`, cursor, lineY);
        ctx.restore();
      }
      cursor += run.w;
    }
  }
  if (deco && (deco.underline || deco.strike)) {
    drawTextDecorations(ctx, x, lineY, cursor - x, size, deco.color, deco.underline, deco.strike);
  }
}

function fillAndStrokePath(ctx: CanvasRenderingContext2D, v: ShapeView): void {
  ctx.strokeStyle = v.stroke;
  ctx.lineWidth = v.strokeWidth;
  if (hasFill(v.fill)) {
    ctx.fillStyle = v.fill;
    ctx.fill();
  }
  ctx.stroke();
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  v: ShapeView,
  textColor: string = COLORS.text,
  boardBg: string = COLORS.background,
  hideText = false,
  /** Table only: hide just this cell's text (the overlay covers it while editing). */
  hideCell?: { row: number; col: number },
  /** When true, caller already applied `withShapeRotation` — avoid per-frame `{...v}` clones. */
  skipRotation = false
): void {
  if (!skipRotation && shapeRotation(v) && v.type !== 'pen' && v.type !== 'arrow') {
    withShapeRotation(ctx, v, () =>
      drawShape(ctx, v, textColor, boardBg, hideText, hideCell, true)
    );
    return;
  }
  switch (v.type) {
    case 'rect': {
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      const rr = rectCornerRadius(v);
      if (rr > 0) ctx.roundRect(v.x, v.y, v.w, v.h, rr);
      else ctx.rect(v.x, v.y, v.w, v.h);
      if (hasFill(v.fill)) {
        ctx.fillStyle = v.fill;
        ctx.fill();
      }
      ctx.stroke();
      if (v.text && !hideText) drawLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'ellipse': {
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.ellipse(v.x + v.w / 2, v.y + v.h / 2, v.w / 2, v.h / 2, 0, 0, Math.PI * 2);
      if (hasFill(v.fill)) {
        ctx.fillStyle = v.fill;
        ctx.fill();
      }
      ctx.stroke();
      if (v.text && !hideText) drawLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'diamond': {
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      ctx.beginPath();
      ctx.moveTo(cx, v.y);
      ctx.lineTo(v.x + v.w, cy);
      ctx.lineTo(cx, v.y + v.h);
      ctx.lineTo(v.x, cy);
      ctx.closePath();
      fillAndStrokePath(ctx, v);
      if (v.text && !hideText) drawDiamondLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'frame': {
      // ponytail: frame — structural scheme container, dashed outer + solid header
      const headerH = frameHeaderHeight(v.h);
      ctx.save();
      ctx.fillStyle = v.fill === COLORS.fill ? 'rgba(255,255,255,0.06)' : v.fill;
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.roundRect(v.x, v.y, v.w, v.h, 8);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      // header
      ctx.fillStyle = v.stroke === COLORS.stroke ? 'rgba(236,234,228,0.09)' : v.stroke;
      ctx.beginPath();
      ctx.roundRect(v.x, v.y, v.w, headerH, [8, 8, 0, 0] as unknown as number);
      ctx.fill();
      ctx.restore();
      const title = frameTitleLine(v.text);
      if (title && !hideText) {
        ctx.save();
        const pad = FRAME_LABEL_PAD_X;
        const size = v.fontSize ?? SHAPE_FONT;
        ctx.beginPath();
        ctx.rect(v.x + pad, v.y, Math.max(0, v.w - pad * 2), headerH);
        ctx.clip();
        const ink = labelInk(v, textColor, boardBg);
        ctx.fillStyle = ink;
        ctx.font = shapeFont(v, SHAPE_FONT);
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const lx = v.x + pad;
        const ly = v.y + headerH / 2;
        ctx.fillText(title, lx, ly);
        const lw = ctx.measureText(title).width;
        drawTextDecorations(ctx, lx, ly - size / 2, lw, size, ink, v.underline, v.strike);
        ctx.restore();
      }
      break;
    }
    case 'triangle': {
      const ax = v.x + v.w / 2, ay = v.y;
      const bx = v.x, by = v.y + v.h;
      const cx = v.x + v.w, cy = v.y + v.h;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(cx, cy);
      ctx.closePath();
      fillAndStrokePath(ctx, v);
      if (v.text && !hideText) drawTriangleLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'parallelogram': {
      const skew = v.w * 0.2;
      ctx.beginPath();
      ctx.moveTo(v.x + skew, v.y);
      ctx.lineTo(v.x + v.w, v.y);
      ctx.lineTo(v.x + v.w - skew, v.y + v.h);
      ctx.lineTo(v.x, v.y + v.h);
      ctx.closePath();
      fillAndStrokePath(ctx, v);
      if (v.text && !hideText) drawLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'hexagon': {
      const cy = v.y + v.h / 2;
      ctx.beginPath();
      ctx.moveTo(v.x + v.w * 0.25, v.y);
      ctx.lineTo(v.x + v.w * 0.75, v.y);
      ctx.lineTo(v.x + v.w, cy);
      ctx.lineTo(v.x + v.w * 0.75, v.y + v.h);
      ctx.lineTo(v.x + v.w * 0.25, v.y + v.h);
      ctx.lineTo(v.x, cy);
      ctx.closePath();
      fillAndStrokePath(ctx, v);
      if (v.text && !hideText) drawLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'cylinder': {
      const ry = Math.min(v.h * 0.15, 18);
      const rx = v.w / 2, cx = v.x + rx;
      ctx.beginPath();
      // body
      ctx.moveTo(v.x, v.y + ry);
      ctx.lineTo(v.x, v.y + v.h - ry);
      ctx.ellipse(cx, v.y + v.h - ry, rx, ry, 0, 0, Math.PI);
      ctx.lineTo(v.x + v.w, v.y + ry);
      ctx.ellipse(cx, v.y + ry, rx, ry, 0, Math.PI, 0);
      ctx.closePath();
      fillAndStrokePath(ctx, v);
      // top ellipse
      ctx.beginPath();
      ctx.ellipse(cx, v.y + ry, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (v.text && !hideText) drawLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'terminator': {
      const r = Math.min(v.w, v.h) / 2;
      ctx.beginPath();
      ctx.roundRect(v.x, v.y, v.w, v.h, r);
      fillAndStrokePath(ctx, v);
      if (v.text && !hideText) drawLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'subroutine': {
      ctx.beginPath();
      ctx.roundRect(v.x, v.y, v.w, v.h, 6);
      fillAndStrokePath(ctx, v);
      const inset = 8;
      ctx.beginPath();
      ctx.moveTo(v.x + inset, v.y);
      ctx.lineTo(v.x + inset, v.y + v.h);
      ctx.moveTo(v.x + v.w - inset, v.y);
      ctx.lineTo(v.x + v.w - inset, v.y + v.h);
      ctx.stroke();
      if (v.text && !hideText) drawLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'display': {
      ctx.beginPath();
      ctx.moveTo(v.x, v.y);
      ctx.lineTo(v.x + v.w * 0.85, v.y);
      ctx.lineTo(v.x + v.w, v.y + v.h / 2);
      ctx.lineTo(v.x + v.w * 0.85, v.y + v.h);
      ctx.lineTo(v.x, v.y + v.h);
      ctx.closePath();
      fillAndStrokePath(ctx, v);
      if (v.text && !hideText) drawLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'table': {
      drawTable(ctx, v, textColor, boardBg, hideText, hideCell);
      break;
    }
    case 'sticky': {
      const orbit = shouldUseOrbitDraw(boardBg);
      const drawFill =
        orbit && v.fill.trim().toLowerCase() === COLORS.sticky.toLowerCase()
          ? ORBIT_DRAW.sticky
          : v.fill;
      const drawStroke =
        orbit && v.stroke.trim().toLowerCase() === COLORS.stickyStroke.toLowerCase()
          ? ORBIT_DRAW.stickyStroke
          : v.stroke;
      ctx.fillStyle = drawFill;
      ctx.strokeStyle = drawStroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.roundRect(v.x, v.y, v.w, v.h, 8);
      ctx.fill();
      if (orbit && drawFill === ORBIT_DRAW.sticky) {
        // Orbit sticky: hairline hull + warm band on top instead of a yellow body.
        ctx.save();
        ctx.clip();
        ctx.fillStyle = ORBIT_DRAW.stickyBand;
        ctx.fillRect(v.x, v.y, v.w, Math.min(4, v.h * 0.08));
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = ORBIT_DRAW.stickyStroke;
        ctx.lineWidth = 1 / Math.max(paintZoom, 0.05);
        ctx.stroke();
        ctx.restore();
      }
      // ponytail: classic yellow sticky is borderless (like a real sticky note);
      // stroke only when the user picked a custom border color.
      if (v.stroke.trim().toLowerCase() !== COLORS.stickyStroke.toLowerCase()) ctx.stroke();
      if (v.text && !hideText) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(v.x, v.y, v.w, v.h, 8);
        ctx.clip();
        const ink =
          orbit && isClassicStickyText(v.textColor)
            ? ORBIT_DRAW.stickyText
            : (v.textColor ?? '#3a2f00');
        const size = v.fontSize ?? STICKY_FONT;
        const lineHeight = size * LABEL_LINE_HEIGHT;
        const align = v.textAlign ?? 'left';
        if (v.richHtml && v.richHtml.includes('<')) {
          const spans = parseStoredRich(v.text, v.richHtml, {
            bold: v.bold,
            italic: v.italic,
            underline: v.underline,
            strike: v.strike,
            highlight: v.highlight,
            color: v.textColor,
          });
          drawRichBlock(ctx, spans, v.x + 8, v.y + 8, Math.max(8, v.w - 16), {
            fontSize: size,
            color: ink,
            align,
            lineHeight,
            fontFn: (s, style) =>
              boardFont(s, {
                bold: style.bold ?? v.bold,
                italic: style.italic ?? v.italic,
              }),
            highlightFill: TEXT_HIGHLIGHT,
            maxBottom: v.y + v.h - 8,
          });
        } else {
          ctx.fillStyle = ink;
          ctx.font = shapeFont(v, STICKY_FONT);
          ctx.textBaseline = 'top';
          let lineY = v.y + 8;
          for (const line of wrapText(ctx, v.text, v.w - 16)) {
            const lw = ctx.measureText(line).width;
            const lx = lineAnchorX(v.x + 8, v.w - 16, lw, align);
            ctx.fillText(line, lx, lineY);
            drawTextDecorations(ctx, lx, lineY, lw, size, ink, v.underline, v.strike);
            lineY += lineHeight;
            if (lineY > v.y + v.h - 8) break;
          }
        }
        ctx.restore();
      }
      break;
    }
    case 'text': {
      if (!v.text) break;
      const size = v.fontSize ?? TEXT_FONT;
      if (v.highlight) {
        ctx.fillStyle = TEXT_HIGHLIGHT;
        ctx.beginPath();
        ctx.roundRect(v.x - 4, v.y - 2, v.w + 8, v.h + 4, 4);
        ctx.fill();
      }
      if (hideText) break;
      const ink = displayInk(v.textColor ?? textColor, boardBg);
      const lineHeight = size * TEXT_LINE_HEIGHT;
      const align = v.textAlign ?? 'left';
      if (v.richHtml && v.richHtml.includes('<')) {
        const spans = parseStoredRich(v.text, v.richHtml, {
          bold: v.bold,
          italic: v.italic,
          underline: v.underline,
          strike: v.strike,
          highlight: v.highlight,
          color: v.textColor,
        });
        drawRichBlock(ctx, spans, v.x, v.y, Math.max(v.w, size * 2), {
          fontSize: size,
          color: ink,
          align,
          lineHeight,
          fontFn: (s, style) =>
            boardFont(s, {
              bold: style.bold ?? v.bold,
              italic: style.italic ?? v.italic,
            }),
          highlightFill: TEXT_HIGHLIGHT,
        });
      } else {
        ctx.fillStyle = ink;
        ctx.font = shapeFont(v, TEXT_FONT);
        ctx.textBaseline = 'top';
        let lineY = v.y;
        for (const line of wrapText(ctx, v.text, Math.max(v.w, size * 2))) {
          const lw = measureMixedLine(ctx, line, size);
          const lx = lineAnchorX(v.x, v.w, lw, align);
          drawMixedLine(ctx, line, lx, lineY, lineHeight, size, {
            color: ink,
            underline: v.underline,
            strike: v.strike,
          });
          lineY += lineHeight;
        }
      }
      break;
    }
    case 'pen':
      drawPenStroke(
        ctx,
        v.points ?? [],
        v.strokeWidth,
        displayInk(v.stroke, boardBg),
        v.alpha ?? 1,
        v.pressures
      );
      break;
    case 'arrow':
      drawArrow(ctx, v, boardBg);
      break;
    case 'image': {
      const img = getImage(v.src ?? '');
      if (img && img.complete && img.naturalWidth > 0) {
        if (imageHasCrop(v)) {
          const f = cropFractions(v);
          const sx = f.x * img.naturalWidth;
          const sy = f.y * img.naturalHeight;
          const sw = f.w * img.naturalWidth;
          const sh = f.h * img.naturalHeight;
          ctx.drawImage(img, sx, sy, sw, sh, v.x, v.y, v.w, v.h);
        } else {
          ctx.drawImage(img, v.x, v.y, v.w, v.h);
        }
      } else {
        ctx.fillStyle = '#2e2e2b';
        ctx.fillRect(v.x, v.y, v.w, v.h);
        ctx.strokeStyle = '#454540';
        ctx.lineWidth = 1;
        ctx.strokeRect(v.x, v.y, v.w, v.h);
      }
      break;
    }
    case 'video': {
      const vid = getVideo(v.src ?? '');
      const ready = vid && vid.readyState >= 2 && vid.videoWidth > 0;
      if (ready && vid) {
        ctx.drawImage(vid, v.x, v.y, v.w, v.h);
        if (vid.paused) drawVideoPlayAffordance(ctx, v);
      } else {
        ctx.fillStyle = '#1a1a18';
        ctx.fillRect(v.x, v.y, v.w, v.h);
        ctx.strokeStyle = '#454540';
        ctx.lineWidth = 1;
        ctx.strokeRect(v.x, v.y, v.w, v.h);
        drawVideoPlayAffordance(ctx, v);
      }
      break;
    }
    case 'doc': {
      const pages = v.pages ?? [];
      const src = pages[docPageIndex(v.page, pages.length)] ?? '';
      const img = src ? getImage(src) : null;
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, v.x, v.y, v.w, v.h);
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(v.x, v.y, v.w, v.h);
        ctx.strokeStyle = '#454540';
        ctx.lineWidth = 1;
        ctx.strokeRect(v.x, v.y, v.w, v.h);
      }
      break;
    }
    case 'graph':
      drawGraph(ctx, v, boardBg);
      break;
    case 'calculator':
      drawCalculator(ctx, v, boardBg, hideText);
      break;
  }
}

const GRAPH_X_RANGE = 10;
/** Default spawn size — chrome scale is relative to this. */
const GRAPH_REF_W = 420;
const GRAPH_REF_H = 300;

function graphPanelFill(boardBg: string, shapeFill: string): string {
  // Prefer an explicit fill when the user set one; otherwise lift slightly off the paper.
  if (shapeFill && shapeFill !== 'transparent' && shapeFill !== COLORS.fill) return shapeFill;
  const lum = relativeLuminance(boardBg);
  if (lum == null) return '#2e2e2b';
  return lum > 0.5 ? '#ffffff' : '#2a2a27';
}

function graphAxisInk(boardBg: string): { grid: string; axis: string; label: string; border: string } {
  const lum = relativeLuminance(boardBg) ?? 0.1;
  if (lum > 0.5) {
    return {
      grid: 'rgba(28, 28, 26, 0.08)',
      axis: 'rgba(28, 28, 26, 0.45)',
      label: 'rgba(28, 28, 26, 0.55)',
      border: 'rgba(28, 28, 26, 0.18)',
    };
  }
  return {
    grid: 'rgba(236, 234, 228, 0.1)',
    axis: 'rgba(236, 234, 228, 0.55)',
    label: 'rgba(236, 234, 228, 0.72)',
    border: 'rgba(236, 234, 228, 0.18)',
  };
}

/** Font / pad / tick density all track the graph frame so stretch stays readable. */
function graphChrome(v: ShapeView): {
  scale: number;
  labelSize: number;
  pad: { left: number; right: number; top: number; bottom: number };
  tickLen: number;
  axisW: number;
  borderW: number;
  radius: number;
  titlePad: number;
  /** Target world-px between major ticks — larger frame → denser steps. */
  targetTickPx: number;
} {
  const areaScale = Math.sqrt((Math.max(80, v.w) * Math.max(60, v.h)) / (GRAPH_REF_W * GRAPH_REF_H));
  const scale = Math.min(2.4, Math.max(0.5, areaScale));
  const labelSize = Math.round(Math.min(24, Math.max(9, 12 * scale)));
  return {
    scale,
    labelSize,
    pad: {
      left: Math.round(Math.max(26, 38 * scale)),
      right: Math.round(Math.max(10, 14 * scale)),
      top: Math.round(Math.max(20, 28 * scale)),
      bottom: Math.round(Math.max(20, 30 * scale)),
    },
    tickLen: Math.max(3, 4 * scale),
    axisW: Math.max(1, 1.2 * scale),
    borderW: Math.max(1, 1.25 * scale),
    radius: Math.max(6, Math.min(16, 10 * scale)),
    titlePad: Math.max(8, 10 * scale),
    // ~56px at default size; grows slowly so big frames get finer ticks without clutter.
    targetTickPx: Math.max(32, Math.min(80, 56 * Math.sqrt(scale))),
  };
}

/** Sampled curve + plot box for SVG export (same domain as canvas `drawGraph`). */
export function graphCurvePath(
  v: ShapeView,
  ox = 0,
  oy = 0
): {
  plot: ShapeBox;
  radius: number;
  exprLabel: string;
  d: string;
  error?: string;
} {
  const chrome = graphChrome(v);
  const plot = {
    x: v.x + chrome.pad.left,
    y: v.y + chrome.pad.top,
    w: Math.max(20, v.w - chrome.pad.left - chrome.pad.right),
    h: Math.max(20, v.h - chrome.pad.top - chrome.pad.bottom),
  };
  const exprLabel = `y = ${(v.expr ?? '').trim() || '…'}`;
  const compiled = compileGraph(v.expr ?? '');
  if (compiled.error !== undefined || !v.expr?.trim()) {
    return { plot, radius: chrome.radius, exprLabel, d: '', error: compiled.error };
  }
  const toT = (px: number) => ((px - plot.x) / plot.w) * 2 * GRAPH_X_RANGE - GRAPH_X_RANGE;
  let lo = Infinity;
  let hi = -Infinity;
  const N = Math.max(80, Math.min(640, Math.round(plot.w * 1.25)));
  const ts: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = toT(plot.x + (i / N) * plot.w);
    const y = compiled.fn(t);
    ts.push(t);
    ys.push(y);
    if (isFinite(y)) {
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  if (!isFinite(lo) || !isFinite(hi)) {
    lo = -5;
    hi = 5;
  }
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  } else {
    const padY = (hi - lo) * 0.1;
    lo -= padY;
    hi += padY;
  }
  if (lo > 0 && lo < (hi - lo) * 0.35) lo = 0;
  if (hi < 0 && -hi < (hi - lo) * 0.35) hi = 0;
  const toPxX = (t: number) => plot.x + ox + ((t + GRAPH_X_RANGE) / (2 * GRAPH_X_RANGE)) * plot.w;
  const toPxY = (val: number) => plot.y + oy + (1 - (val - lo) / (hi - lo)) * plot.h;
  const parts: string[] = [];
  let started = false;
  let prevPy = 0;
  for (let i = 0; i <= N; i++) {
    const y = ys[i];
    if (!isFinite(y)) {
      started = false;
      continue;
    }
    const px = toPxX(ts[i]);
    const py = toPxY(y);
    if (started && Math.abs(py - prevPy) > plot.h * 2) started = false;
    if (!started) {
      parts.push(`M${px} ${py}`);
      started = true;
    } else {
      parts.push(`L${px} ${py}`);
    }
    prevPy = py;
  }
  return { plot, radius: chrome.radius, exprLabel, d: parts.join(' ') };
}

function formatTick(n: number, step: number): string {
  if (!isFinite(n) || Math.abs(n) < step * 1e-6) return '0';
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return String(+n.toFixed(decimals));
}

/** Pick a nice step so ticks land ~every `targetPx` along `spanPx` for a value span. */
function stepForSpan(valueSpan: number, spanPx: number, targetPx: number): number {
  const slots = Math.max(2, spanPx / Math.max(24, targetPx));
  return niceStep(valueSpan / slots);
}

/**
 * Orbit instrument faces (graph + calculator): graphite hull on the void,
 * steel hairlines, white corner brackets, one status light.
 */
const ORBIT_PANEL = {
  hull: '#0A0A0C',
  well: '#040405',
  line: 'rgba(169, 175, 185, 0.24)',
  lineSoft: 'rgba(169, 175, 185, 0.12)',
  dot: 'rgba(169, 175, 185, 0.34)',
  axis: 'rgba(169, 175, 185, 0.5)',
  label: 'rgba(169, 175, 185, 0.82)',
  bracket: 'rgba(242, 244, 247, 0.7)',
} as const;

/** Hairline L-brackets on the four corners of an Orbit instrument card. */
function orbitCornerBrackets(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  len: number,
  inset: number,
  lw: number
): void {
  const l = x + inset;
  const t = y + inset;
  const r = x + w - inset;
  const b = y + h - inset;
  ctx.strokeStyle = ORBIT_PANEL.bracket;
  ctx.lineWidth = lw;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(l, t + len);
  ctx.lineTo(l, t);
  ctx.lineTo(l + len, t);
  ctx.moveTo(r - len, t);
  ctx.lineTo(r, t);
  ctx.lineTo(r, t + len);
  ctx.moveTo(r, b - len);
  ctx.lineTo(r, b);
  ctx.lineTo(r - len, b);
  ctx.moveTo(l + len, b);
  ctx.lineTo(l, b);
  ctx.lineTo(l, b - len);
  ctx.stroke();
}

/** Small status light: halo + solid core. */
function orbitStatusLight(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawGraph(ctx: CanvasRenderingContext2D, v: ShapeView, boardBg: string): void {
  const chrome = graphChrome(v);
  const { labelSize, pad, tickLen, axisW, borderW, titlePad, targetTickPx } = chrome;
  // Orbit: a telemetry plot — graphite card, dotted lattice, glowing trace.
  const orbit = shouldUseOrbitDraw(boardBg);
  const radius = orbit ? Math.max(1, 2 * chrome.scale) : chrome.radius;
  const plot = {
    x: v.x + pad.left,
    y: v.y + pad.top,
    w: Math.max(20, v.w - pad.left - pad.right),
    h: Math.max(20, v.h - pad.top - pad.bottom),
  };
  const panel = orbit ? ORBIT_PANEL.hull : graphPanelFill(boardBg, v.fill);
  const ink = orbit
    ? { grid: ORBIT_PANEL.dot, axis: ORBIT_PANEL.axis, label: ORBIT_PANEL.label, border: ORBIT_PANEL.line }
    : graphAxisInk(boardBg);
  const stroke = v.stroke || COLORS.stroke;
  const defaultStroke =
    stroke.toLowerCase() === COLORS.stroke.toLowerCase() ||
    stroke.toLowerCase() === ORBIT_DRAW.shapeStroke.toLowerCase();
  const curve = orbit && defaultStroke ? ORBIT_COLORS.white : displayInk(stroke, boardBg);
  const themeText = themeFor(boardBg).text;
  /** One screen px in world units (hairlines stay crisp at any zoom). */
  const px = 1 / Math.max(paintZoom, 0.05);

  ctx.save();
  // Card
  ctx.beginPath();
  ctx.roundRect(v.x, v.y, v.w, v.h, radius);
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.strokeStyle = ink.border;
  ctx.lineWidth = orbit ? Math.max(px, borderW * 0.8) : borderW;
  ctx.stroke();
  if (orbit) {
    orbitCornerBrackets(ctx, v.x, v.y, v.w, v.h, 12 * chrome.scale, 0, Math.max(px, 1.4 * chrome.scale));
  }

  const compiled = compileGraph(v.expr ?? '');
  const exprLabel = `y = ${(v.expr ?? '').trim() || '…'}`;

  // Title chip (outside the clipped plot)
  if (orbit) {
    // Label on the header centerline + a status light (nominal / caution).
    const midY = v.y + pad.top * 0.52;
    const lampR = Math.max(1.5 * px, labelSize * 0.2);
    const ok = compiled.error === undefined && Boolean(v.expr?.trim());
    orbitStatusLight(ctx, v.x + titlePad + lampR, midY, lampR, ok ? ORBIT_COLORS.nominal : ORBIT_COLORS.caution);
    ctx.fillStyle = ORBIT_COLORS.white;
    ctx.globalAlpha = 0.9;
    ctx.font = `500 ${labelSize}px ${BOARD_TYPEFACE}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tx = v.x + titlePad + lampR * 2 + labelSize * 0.55;
    ctx.fillText(exprLabel, tx, midY, v.x + v.w - titlePad - tx);
  } else {
    ctx.fillStyle = themeText;
    ctx.globalAlpha = 0.72;
    ctx.font = `600 ${labelSize}px ${BOARD_TYPEFACE}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(exprLabel, v.x + titlePad, v.y + titlePad * 0.8, v.w - titlePad * 2);
  }
  ctx.globalAlpha = 1;

  if (orbit) {
    // Recessed plot well.
    ctx.beginPath();
    ctx.roundRect(plot.x, plot.y, plot.w, plot.h, Math.max(2, 3 * chrome.scale));
    ctx.fillStyle = ORBIT_PANEL.well;
    ctx.fill();
    ctx.strokeStyle = ORBIT_PANEL.lineSoft;
    ctx.lineWidth = px;
    ctx.stroke();
  }

  if (compiled.error !== undefined || !v.expr?.trim()) {
    ctx.fillStyle = themeText;
    ctx.globalAlpha = 0.55;
    ctx.font = `${labelSize + 1}px ${BOARD_TYPEFACE}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      compiled.error ? compiled.error : 'y = f(x)',
      plot.x + plot.w / 2,
      plot.y + plot.h / 2,
      plot.w - 8
    );
    ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }

  const toPxX = (t: number) => plot.x + ((t + GRAPH_X_RANGE) / (2 * GRAPH_X_RANGE)) * plot.w;
  const toT = (px: number) => ((px - plot.x) / plot.w) * 2 * GRAPH_X_RANGE - GRAPH_X_RANGE;

  let lo = Infinity;
  let hi = -Infinity;
  const N = Math.max(80, Math.min(640, Math.round(plot.w * 1.25)));
  const ts: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = toT(plot.x + (i / N) * plot.w);
    const y = compiled.fn(t);
    ts.push(t);
    ys.push(y);
    if (isFinite(y)) {
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  if (!isFinite(lo) || !isFinite(hi)) {
    lo = -5;
    hi = 5;
  }
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  } else {
    const padY = (hi - lo) * 0.1;
    lo -= padY;
    hi += padY;
  }
  // Prefer including y=0 when the range is small enough to stay readable.
  if (lo > 0 && lo < (hi - lo) * 0.35) lo = 0;
  if (hi < 0 && -hi < (hi - lo) * 0.35) hi = 0;

  const toPxY = (val: number) => plot.y + (1 - (val - lo) / (hi - lo)) * plot.h;

  // Tick density follows frame size: stretch → finer (e.g. 2 → 1).
  const xStep = stepForSpan(2 * GRAPH_X_RANGE, plot.w, targetTickPx);
  const yStep = stepForSpan(hi - lo, plot.h, targetTickPx);

  // Grid (clipped to plot)
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.w, plot.h);
  ctx.clip();

  if (orbit) {
    // Dot lattice at every half step (matches the board's dot field).
    ctx.fillStyle = ink.grid;
    const r = Math.max(0.9 * px, 1.1 * chrome.scale);
    ctx.beginPath();
    for (let gx = Math.ceil(-GRAPH_X_RANGE / (xStep / 2)) * (xStep / 2); gx <= GRAPH_X_RANGE + 1e-9; gx += xStep / 2) {
      const dx = toPxX(gx);
      for (let gy = Math.ceil(lo / (yStep / 2)) * (yStep / 2); gy <= hi + 1e-9; gy += yStep / 2) {
        const dy = toPxY(gy);
        ctx.moveTo(dx + r, dy);
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  } else {
    ctx.strokeStyle = ink.grid;
    ctx.lineWidth = Math.max(0.75, borderW * 0.7);
    ctx.beginPath();
    for (let gx = Math.ceil(-GRAPH_X_RANGE / xStep) * xStep; gx <= GRAPH_X_RANGE + 1e-9; gx += xStep) {
      const px = toPxX(gx);
      ctx.moveTo(px, plot.y);
      ctx.lineTo(px, plot.y + plot.h);
    }
    for (let gy = Math.ceil(lo / yStep) * yStep; gy <= hi + 1e-9; gy += yStep) {
      const py = toPxY(gy);
      if (py < plot.y - 0.5 || py > plot.y + plot.h + 0.5) continue;
      ctx.moveTo(plot.x, py);
      ctx.lineTo(plot.x + plot.w, py);
    }
    ctx.stroke();
  }

  // Axes through origin when visible, else along the near edge of the plot.
  ctx.strokeStyle = ink.axis;
  ctx.lineWidth = axisW;
  ctx.beginPath();
  let ax = toPxX(0);
  if (ax < plot.x) ax = plot.x;
  if (ax > plot.x + plot.w) ax = plot.x + plot.w;
  let ay = toPxY(0);
  if (ay < plot.y) ay = plot.y;
  if (ay > plot.y + plot.h) ay = plot.y + plot.h;
  ctx.moveTo(ax, plot.y);
  ctx.lineTo(ax, plot.y + plot.h);
  ctx.moveTo(plot.x, ay);
  ctx.lineTo(plot.x + plot.w, ay);
  ctx.stroke();

  // Tick marks on axes
  ctx.strokeStyle = ink.axis;
  ctx.lineWidth = Math.max(0.75, axisW * 0.85);
  ctx.beginPath();
  for (let gx = Math.ceil(-GRAPH_X_RANGE / xStep) * xStep; gx <= GRAPH_X_RANGE + 1e-9; gx += xStep) {
    const px = toPxX(gx);
    if (px < plot.x + 1 || px > plot.x + plot.w - 1) continue;
    ctx.moveTo(px, ay - tickLen);
    ctx.lineTo(px, ay + tickLen);
  }
  for (let gy = Math.ceil(lo / yStep) * yStep; gy <= hi + 1e-9; gy += yStep) {
    const py = toPxY(gy);
    if (py < plot.y + 1 || py > plot.y + plot.h - 1) continue;
    ctx.moveTo(ax - tickLen, py);
    ctx.lineTo(ax + tickLen, py);
  }
  ctx.stroke();

  // Curve — stroke scales mildly with frame so it doesn't look hairline on huge cards.
  const curveW = Math.max(1.5, (v.strokeWidth || 2) * Math.min(1.6, Math.max(0.85, chrome.scale)));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Continuous runs of samples (breaks at gaps / asymptotes).
  const runs: number[][] = [];
  let run: number[] | null = null;
  let prevPy = 0;
  for (let i = 0; i <= N; i++) {
    const y = ys[i];
    if (!isFinite(y)) {
      run = null;
      continue;
    }
    const py = toPxY(y);
    if (run && Math.abs(py - prevPy) > plot.h * 2) run = null;
    if (!run) {
      run = [];
      runs.push(run);
    }
    run.push(toPxX(ts[i]), py);
    prevPy = py;
  }
  const traceRuns = () => {
    ctx.beginPath();
    for (const r of runs) {
      ctx.moveTo(r[0], r[1]);
      for (let j = 2; j < r.length; j += 2) ctx.lineTo(r[j], r[j + 1]);
    }
  };
  if (orbit) {
    // Soft fill down to the x axis, then a wide faint glow under a crisp core.
    const base = Math.min(plot.y + plot.h, Math.max(plot.y, ay));
    const glowInk = /^#[0-9a-fA-F]{6}$/.test(curve) ? curve : ORBIT_COLORS.white;
    const fill = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.h);
    fill.addColorStop(0, withAlpha(glowInk, 0.16));
    fill.addColorStop(1, withAlpha(glowInk, 0.02));
    ctx.fillStyle = fill;
    for (const r of runs) {
      if (r.length < 4) continue;
      ctx.beginPath();
      ctx.moveTo(r[0], base);
      for (let j = 0; j < r.length; j += 2) ctx.lineTo(r[j], r[j + 1]);
      ctx.lineTo(r[r.length - 2], base);
      ctx.closePath();
      ctx.fill();
    }
    // Blur is in device px: scale by the current transform so the glow tracks zoom.
    const m = ctx.getTransform();
    ctx.shadowColor = withAlpha(glowInk, 0.55);
    ctx.shadowBlur = Math.min(40, 7 * chrome.scale * Math.hypot(m.a, m.b));
  }
  traceRuns();
  ctx.strokeStyle = curve;
  ctx.lineWidth = curveW;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.restore(); // end plot clip

  if (orbit) {
    // Vehicle marker at the leading end of the trace: ring + solid core.
    const last = runs[runs.length - 1];
    if (last && last.length >= 2) {
      const mx = last[last.length - 2];
      const my = last[last.length - 1];
      if (my >= plot.y && my <= plot.y + plot.h) {
        const r = Math.max(2 * px, curveW * 1.25);
        ctx.fillStyle = curve;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = curve;
        ctx.lineWidth = Math.max(px, curveW * 0.5);
        ctx.beginPath();
        ctx.arc(mx, my, r * 2.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  // Tick labels — skip if too close to neighbours (protects dense large frames).
  ctx.fillStyle = ink.label;
  ctx.font = `${labelSize}px ${BOARD_TYPEFACE}`;
  const minLabelGap = labelSize * 1.6;

  const xAxisAtBottom = ay >= plot.y + plot.h - 1.5;
  const xLabelY = xAxisAtBottom ? ay - tickLen - 2 : plot.y + plot.h + Math.max(4, titlePad * 0.7);
  ctx.textAlign = 'center';
  ctx.textBaseline = xAxisAtBottom ? 'bottom' : 'top';
  let lastXLabel = -Infinity;
  for (let gx = Math.ceil(-GRAPH_X_RANGE / xStep) * xStep; gx <= GRAPH_X_RANGE + 1e-9; gx += xStep) {
    const px = toPxX(gx);
    if (px < plot.x + labelSize || px > plot.x + plot.w - labelSize) continue;
    if (px - lastXLabel < minLabelGap) continue;
    ctx.fillText(formatTick(gx, xStep), px, xLabelY);
    lastXLabel = px;
  }

  const yAxisAtLeft = ax <= plot.x + 1.5;
  ctx.textAlign = yAxisAtLeft ? 'left' : 'right';
  ctx.textBaseline = 'middle';
  const yLabelX = yAxisAtLeft ? ax + tickLen + 4 : plot.x - Math.max(6, titlePad * 0.6);
  let lastYLabel = -Infinity;
  for (let gy = Math.ceil(lo / yStep) * yStep; gy <= hi + 1e-9; gy += yStep) {
    const py = toPxY(gy);
    if (py < plot.y + labelSize * 0.6 || py > plot.y + plot.h - labelSize * 0.6) continue;
    if (Math.abs(py - lastYLabel) < minLabelGap) continue;
    ctx.fillText(formatTick(gy, yStep), yLabelX, py);
    lastYLabel = py;
  }

  // Axis names
  ctx.fillStyle = ink.label;
  ctx.font = `600 ${labelSize}px ${BOARD_TYPEFACE}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('x', v.x + v.w - titlePad, v.y + v.h - titlePad * 0.7);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('y', plot.x + Math.max(4, titlePad * 0.5), plot.y + Math.max(2, titlePad * 0.3));

  ctx.restore();
}

/** Re-export calc frame helpers (canonical: calcGeometry.ts). */
export {
  CALC_REF_W,
  CALC_REF_H,
  CALC_MIN_W,
  CALC_MIN_H,
  clampCalcSize,
  calcFrameScale,
  calcCssZoom,
  calcLabelWorldSize,
} from './calcGeometry';
import { buildCalcFaceLayout, calcTitleBaselineY } from './calcKeypad';
import { calcFrameScale } from './calcGeometry';

/** Live `--chrome-*` read without importing chromeTheme (avoids shapes↔theme cycle). */
function chromeCssColor(name: string): string {
  try {
    if (typeof document === 'undefined') return '';
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch {
    return '';
  }
}

/**
 * Calculator body fill — always board/chrome theme (`--chrome-panel`), never StyleBar
 * / selected-shape stroke-fill. Peers paint the same rule from local chrome tokens.
 * `_shapeFill` kept for call-site compatibility.
 */
export function resolveCalcBodyFill(boardBg: string, _shapeFill?: string): string {
  void _shapeFill;
  if (shouldUseOrbitDraw(boardBg)) return ORBIT_PANEL.hull;
  const panel = chromeCssColor('--chrome-panel');
  if (panel && /^#[0-9a-fA-F]{6}$/i.test(panel)) return panel;
  // Non-hex panels (e.g. Orbit rgba): lift off paper like graph defaults.
  const lum = relativeLuminance(boardBg);
  if (lum == null) return '#2e2e2b';
  return lum > 0.5 ? '#ffffff' : '#2a2a27';
}

/** Calculator bezel — chrome border / muted ink, not shape stroke from the style island. */
export function resolveCalcStroke(boardBg: string): string {
  const border = chromeCssColor('--chrome-border');
  if (border && /^#[0-9a-fA-F]{6}$/i.test(border)) return border;
  const text = chromeCssColor('--chrome-text');
  if (text && /^#[0-9a-fA-F]{6}$/i.test(text)) return withAlpha(text, 0.32);
  const lum = relativeLuminance(boardBg);
  return lum != null && lum > 0.5 ? 'rgba(28, 28, 26, 0.28)' : 'rgba(236, 234, 228, 0.28)';
}

function calcInkBase(body: string, boardBg: string): string {
  const panel = chromeCssColor('--chrome-panel');
  const chromeText = chromeCssColor('--chrome-text');
  if (
    panel &&
    chromeText &&
    /^#[0-9a-fA-F]{6}$/i.test(panel) &&
    /^#[0-9a-fA-F]{6}$/i.test(chromeText) &&
    body.toLowerCase() === panel.toLowerCase()
  ) {
    return chromeText;
  }
  return themeFor(body).text || themeFor(boardBg).text;
}

function calcInkOn(fill: string, boardBg: string): {
  text: string;
  muted: string;
  key: string;
  keyInk: string;
  keyBorder: string;
  display: string;
  displayInk: string;
  bezel: string;
  op: string;
  eq: string;
  eqInk: string;
} {
  const base = calcInkBase(fill, boardBg);
  const lum = relativeLuminance(fill) ?? relativeLuminance(boardBg) ?? 0.1;
  const light = lum > 0.55;
  // Prefer hex→rgba via withAlpha when base is #rrggbb; else fall back to theme alphas.
  if (/^#[0-9a-fA-F]{6}$/i.test(base)) {
    return {
      text: withAlpha(base, 0.92),
      muted: withAlpha(base, 0.5),
      key: withAlpha(base, light ? 0.08 : 0.1),
      keyInk: withAlpha(base, light ? 0.78 : 0.82),
      keyBorder: withAlpha(base, light ? 0.12 : 0.14),
      display: light ? withAlpha(base, 0.06) : 'rgba(0, 0, 0, 0.28)',
      displayInk: withAlpha(base, light ? 0.92 : 0.95),
      bezel: withAlpha(base, light ? 0.22 : 0.2),
      op: withAlpha(base, light ? 0.92 : 0.95),
      eq: withAlpha(base, light ? 0.12 : 0.16),
      eqInk: withAlpha(base, light ? 0.92 : 0.95),
    };
  }
  return {
    text: light ? 'rgba(28, 28, 26, 0.92)' : 'rgba(236, 234, 228, 0.92)',
    muted: light ? 'rgba(28, 28, 26, 0.5)' : 'rgba(236, 234, 228, 0.5)',
    key: light ? 'rgba(28, 28, 26, 0.08)' : 'rgba(236, 234, 228, 0.1)',
    keyInk: light ? 'rgba(28, 28, 26, 0.78)' : 'rgba(236, 234, 228, 0.82)',
    keyBorder: light ? 'rgba(28, 28, 26, 0.12)' : 'rgba(236, 234, 228, 0.14)',
    display: light ? 'rgba(28, 28, 26, 0.06)' : 'rgba(0, 0, 0, 0.28)',
    displayInk: light ? 'rgba(28, 28, 26, 0.92)' : 'rgba(236, 234, 228, 0.95)',
    bezel: light ? 'rgba(28, 28, 26, 0.22)' : 'rgba(236, 234, 228, 0.2)',
    op: light ? 'rgba(28, 28, 26, 0.92)' : 'rgba(236, 234, 228, 0.95)',
    eq: light ? 'rgba(28, 28, 26, 0.12)' : 'rgba(236, 234, 228, 0.16)',
    eqInk: light ? 'rgba(28, 28, 26, 0.92)' : 'rgba(236, 234, 228, 0.95)',
  };
}

/** Orbit calculator palette (same slots as `calcInkOn`). */
const ORBIT_CALC_INK: ReturnType<typeof calcInkOn> = {
  text: 'rgba(242, 244, 247, 0.92)',
  muted: 'rgba(169, 175, 185, 0.78)',
  key: '#141417',
  keyInk: 'rgba(242, 244, 247, 0.9)',
  keyBorder: 'rgba(169, 175, 185, 0.16)',
  display: ORBIT_PANEL.well,
  displayInk: ORBIT_COLORS.white,
  bezel: ORBIT_PANEL.lineSoft,
  op: ORBIT_COLORS.white,
  eq: ORBIT_COLORS.white,
  eqInk: ORBIT_COLORS.void,
};
const ORBIT_CALC_OP_KEY = '#1D1D22';

/**
 * Canvas paints the calculator face (peers, export, unfocused, open session).
 * When `hideOverlayOwned` is true (local keypad open), skip header chrome the
 * overlay owns (≡ + mode title) so labels are not double-painted under the nav.
 * Display + keypad stay on canvas; closed/unfocused still shows the full face.
 */
function drawCalculator(
  ctx: CanvasRenderingContext2D,
  v: ShapeView,
  boardBg: string,
  hideOverlayOwned = false
): void {
  const mode = v.calcMode === 'scientific' ? 'scientific' : 'standard';
  const scale = calcFrameScale(v.w, v.h);
  const layout = buildCalcFaceLayout(v.w, v.h, mode, Boolean(v.calcSecond), scale);
  const body = resolveCalcBodyFill(boardBg, v.fill);
  // Orbit: a flight-computer face — graphite keys, white execute key, status light.
  const orbit = shouldUseOrbitDraw(boardBg);
  const ink = orbit ? ORBIT_CALC_INK : calcInkOn(body, boardBg);
  const stroke = orbit ? ORBIT_PANEL.line : resolveCalcStroke(boardBg);
  const display = v.calcDisplay ?? '0';
  const expr = (v.calcExpr ?? '').trim();
  const modeLabel = mode === 'scientific' ? 'Scientific' : 'Standard';
  const { pad, fonts } = layout;
  const radius = orbit ? Math.max(1, 2 * layout.scale) : layout.radius;
  const onePx = 1 / Math.max(paintZoom, 0.05);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(v.x, v.y, v.w, v.h, radius);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = orbit ? Math.max(onePx, 1.1 * layout.scale) : Math.max(1, 1.5);
  ctx.stroke();
  if (orbit) {
    orbitCornerBrackets(ctx, v.x, v.y, v.w, v.h, 12 * layout.scale, 0, Math.max(onePx, 1.4 * layout.scale));
  }

  // Header — Win-calc nav bars + mode title (+ memory). Overlay owns interactive nav.
  // Metrics from layout.chrome so closed canvas matches open CSS overlay 1:1.
  if (!hideOverlayOwned) {
    const { chrome } = layout;
    const hx = v.x + layout.header.x;
    // Shared optical centerline for bars + title ink (not em-box mid alone).
    const opticalY = v.y + layout.header.y + layout.header.h * 0.5;
    const barCenterY = opticalY + chrome.iconAlignY;
    const cx = hx + chrome.navW * 0.5;
    const barW = chrome.navW * chrome.barWFrac;
    const pitch = chrome.barH + chrome.barGap;
    ctx.fillStyle = ink.text;
    for (const dy of [-pitch, 0, pitch]) {
      const y = barCenterY + dy - chrome.barH * 0.5;
      ctx.fillRect(cx - barW * 0.5, y, barW, chrome.barH);
    }
    ctx.font = `600 ${Math.round(chrome.titlePx)}px ${BOARD_TYPEFACE}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const metrics = ctx.measureText(modeLabel);
    const baseline = calcTitleBaselineY(opticalY, metrics, chrome.titlePx);
    ctx.fillText(
      modeLabel,
      hx + chrome.navW + chrome.navGap,
      baseline,
      Math.max(8, layout.header.w - chrome.navW - chrome.navGap)
    );
    if (v.calcMemory != null && Number.isFinite(v.calcMemory)) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = ink.text;
      ctx.fillText('M', hx + layout.header.w, opticalY);
    }
  }

  const dx = v.x + layout.display.x;
  const dy = v.y + layout.display.y;
  const dw = layout.display.w;
  const dh = layout.display.h;
  ctx.beginPath();
  ctx.roundRect(dx, dy, dw, dh, Math.max(6, 8 * layout.scale));
  ctx.fillStyle = ink.display;
  ctx.fill();
  ctx.strokeStyle = ink.bezel;
  ctx.lineWidth = orbit ? Math.max(onePx, 0.9 * layout.scale) : Math.max(0.75, layout.scale);
  ctx.stroke();
  if (orbit) {
    // Status light in the display corner: nominal, or abort on an error readout.
    const bad = /error|nan|∞|infinity|ошибка|错误/i.test(display);
    const r = Math.max(1.5 * onePx, 2.6 * layout.scale);
    orbitStatusLight(ctx, dx + pad * 0.6 + r, dy + pad * 0.45 + r * 1.6, r, bad ? ORBIT_COLORS.abort : ORBIT_COLORS.nominal);
  }

  if (expr) {
    ctx.fillStyle = ink.muted;
    ctx.font = `${Math.round(fonts.expr)}px ${BOARD_TYPEFACE}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(expr, dx + dw - pad * 0.6, dy + pad * 0.45, dw - pad);
  }
  ctx.fillStyle = ink.displayInk;
  ctx.font = `600 ${Math.round(fonts.display)}px ${BOARD_TYPEFACE}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(display, dx + dw - pad * 0.6, dy + dh - pad * 0.55, dw - pad);

  // Full-fidelity labeled keypad when keys are readable on screen.
  // Below ~7 CSS px, glyphs are noise — paint one pad fill (same color language).
  const keySample = layout.keys[0];
  const keyScreenH = keySample ? keySample.h * paintZoom : 0;
  if (!keySample || keyScreenH >= 7) {
    for (const key of layout.keys) {
      const x = v.x + key.x;
      const y = v.y + key.y;
      const rr = orbit ? Math.max(3, Math.min(key.w, key.h) * 0.14) : Math.max(4, Math.min(key.w, key.h) * 0.22);
      const isEq = key.cls?.includes('eq');
      const isOp = key.cls?.includes('op');
      const isFn = key.cls?.includes('fn') || key.cls?.includes('mem');
      ctx.beginPath();
      ctx.roundRect(x, y, key.w, key.h, rr);
      // Orbit: function keys are outline-only, operators a step lighter than digits.
      ctx.fillStyle = isEq
        ? ink.eq
        : orbit && isFn
          ? 'transparent'
          : orbit && isOp
            ? ORBIT_CALC_OP_KEY
            : ink.key;
      ctx.fill();
      ctx.strokeStyle = isEq ? 'transparent' : ink.keyBorder;
      ctx.lineWidth = orbit ? Math.max(onePx, 0.8 * layout.scale) : Math.max(0.6, 0.75 * layout.scale);
      if (!isEq) ctx.stroke();
      ctx.fillStyle = isEq ? ink.eqInk : isOp ? ink.op : isFn ? ink.muted : ink.keyInk;
      const px = Math.round(isFn ? fonts.keyFn : fonts.key);
      ctx.font = `${isOp || isEq ? '600' : '500'} ${px}px ${BOARD_TYPEFACE}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(key.label, x + key.w / 2, y + key.h / 2, key.w - 2);
    }
  } else {
    const pad = layout.padArea;
    ctx.beginPath();
    ctx.roundRect(v.x + pad.x, v.y + pad.y, pad.w, pad.h, Math.max(4, radius * 0.55));
    ctx.fillStyle = ink.key;
    ctx.fill();
  }
  ctx.restore();
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const norm = raw / pow;
  const nice = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return nice * pow;
}

const imageCache = new Map<string, HTMLImageElement>();
const imageListeners = new Set<(src: string) => void>();

export function onImageLoad(cb: (src: string) => void): () => void {
  imageListeners.add(cb);
  return () => {
    imageListeners.delete(cb);
  };
}

export function getImage(src: string): HTMLImageElement | null {
  if (!src.startsWith('data:image/') && !src.startsWith('blob:')) return null;
  const hit = imageCache.get(src);
  if (hit) return hit;
  const img = new Image();
  img.onload = () => {
    for (const l of imageListeners) l(src);
  };
  img.onerror = () => {
    imageCache.delete(src);
  };
  img.src = src;
  imageCache.set(src, img);
  return img;
}

export function releaseImage(src: string): void {
  if (src) imageCache.delete(src);
}

const videoCache = new Map<string, HTMLVideoElement>();
const videoListeners = new Set<(src: string) => void>();

export function onVideoLoad(cb: (src: string) => void): () => void {
  videoListeners.add(cb);
  return () => {
    videoListeners.delete(cb);
  };
}

export function getVideo(src: string): HTMLVideoElement | null {
  if (!src.startsWith('data:video/') && !src.startsWith('blob:')) return null;
  const hit = videoCache.get(src);
  if (hit) return hit;
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  const notify = () => {
    for (const l of videoListeners) l(src);
  };
  video.addEventListener('loadeddata', notify);
  video.addEventListener('error', () => {
    videoCache.delete(src);
  });
  video.src = src;
  videoCache.set(src, video);
  return video;
}

export function releaseVideo(src: string): void {
  if (!src) return;
  const v = videoCache.get(src);
  if (v) {
    try {
      v.pause();
      v.removeAttribute('src');
      v.load();
    } catch {
      /* ignore */
    }
    videoCache.delete(src);
  }
}

export function toggleVideoPlayback(src: string): boolean {
  const video = getVideo(src);
  if (!video) return false;
  if (video.paused) {
    void video.play().catch(() => {
      /* autoplay policy — user gesture should allow; ignore */
    });
    return true;
  }
  video.pause();
  return false;
}

export function isVideoPlaying(src: string | undefined): boolean {
  if (!src) return false;
  const video = videoCache.get(src);
  return Boolean(video && !video.paused && !video.ended);
}

/** True when the board needs continuous RAF paints for GIF / playing video. */
export function boardNeedsMediaPaint(views: Iterable<Pick<ShapeView, 'type' | 'src'>>): boolean {
  for (const v of views) {
    if (v.type === 'image' && v.src && v.src.startsWith('data:image/gif')) return true;
    if (v.type === 'video' && isVideoPlaying(v.src)) return true;
  }
  return false;
}

function drawVideoPlayAffordance(ctx: CanvasRenderingContext2D, v: ShapeView): void {
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2;
  const r = Math.max(10, Math.min(v.w, v.h) * 0.12);
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = '#ffffff';
  const tri = r * 0.45;
  ctx.beginPath();
  ctx.moveTo(cx - tri * 0.35, cy - tri);
  ctx.lineTo(cx - tri * 0.35, cy + tri);
  ctx.lineTo(cx + tri * 0.85, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawArrow(ctx: CanvasRenderingContext2D, v: ShapeView, boardBg?: string): void {
  const geom = getArrowGeom(v);
  if (!geom) return;
  const curve = geom.curve;
  const ink = boardBg ? displayInk(v.stroke, boardBg) : v.stroke;
  // No shadowBlur — per-arrow canvas shadows scale badly and dominate paint cost.
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = v.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(curve.start.x, curve.start.y);
  if (curve.kind === 'cubic') {
    ctx.bezierCurveTo(
      curve.control1.x,
      curve.control1.y,
      curve.control2.x,
      curve.control2.y,
      curve.end.x,
      curve.end.y
    );
  } else if (curve.kind === 'quadratic') {
    ctx.quadraticCurveTo(curve.control.x, curve.control.y, curve.end.x, curve.end.y);
  } else {
    ctx.lineTo(curve.end.x, curve.end.y);
  }
  ctx.stroke();
  if (geom.head > 0) {
    const tip = geom.tip;
    ctx.beginPath();
    ctx.moveTo(curve.end.x, curve.end.y);
    ctx.lineTo(tip.x1, tip.y1);
    ctx.lineTo(tip.x2, tip.y2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawShapeRichText(
  ctx: CanvasRenderingContext2D,
  v: ShapeView,
  ink: string,
  x: number,
  y: number,
  maxW: number,
  align: 'left' | 'center' | 'right',
  maxBottom?: number
): void {
  const size = v.fontSize ?? SHAPE_FONT;
  const spans = parseStoredRich(v.text, v.richHtml, {
    bold: v.bold,
    italic: v.italic,
    underline: v.underline,
    strike: v.strike,
    highlight: v.highlight,
    color: v.textColor,
  });
  drawRichBlock(ctx, spans, x, y, maxW, {
    fontSize: size,
    color: ink,
    align,
    lineHeight: size * LABEL_LINE_HEIGHT,
    fontFn: (s, style) => boardFont(s, { bold: style.bold ?? v.bold, italic: style.italic ?? v.italic }),
    highlightFill: TEXT_HIGHLIGHT,
    maxBottom,
  });
}

export function labelInk(
  v: Pick<ShapeView, 'type' | 'fill' | 'textColor'>,
  textColor: string,
  boardBg?: string
): string {
  const raw = v.textColor ?? textColor;
  if (!boardBg || v.type === 'sticky') return raw;
  // ponytail: labels sit inside the fill — contrast against it when opaque
  // (light theme text on a white table/rect would otherwise be invisible).
  if (hasFill(v.fill) && readPrefs().adaptInkToPaper) return readableTextOn(raw, v.fill);
  return displayInk(raw, boardBg);
}

/** Overlay paint color — same rules as canvas, without mutating stored `textColor`. */
export function overlayDisplayColor(
  target: { id?: string | null; type?: string | null; color: string },
  view: Pick<ShapeView, 'type' | 'fill' | 'textColor'> | undefined,
  paper: string
): string {
  if (target.type === 'sticky' || target.type === 'table') return target.color;
  if (target.type === 'text' || !view) return displayInk(target.color, paper);
  return labelInk({ ...view, textColor: target.color }, target.color, paper);
}

function drawTable(
  ctx: CanvasRenderingContext2D,
  v: ShapeView,
  textColor: string,
  boardBg?: string,
  hideText = false,
  hideCell?: { row: number; col: number }
): void {
  const { cols, rows, cells, header, colW: colF, rowH: rowF } = tableGrid(v);
  const cumX = (i: number) => tableCum(colF, i);
  const cumY = (i: number) => tableCum(rowF, i);
  const size = v.fontSize ?? TABLE_FONT;
  const ink = labelInk(v, textColor, boardBg);
  const padX = TABLE_CELL_PAD_X;
  const padTop = TABLE_CELL_PAD_TOP;
  const lineHeight = size * TEXT_LINE_HEIGHT;

  ctx.save();
  ctx.beginPath();
  ctx.rect(v.x, v.y, v.w, v.h);
  if (hasFill(v.fill)) {
    ctx.fillStyle = v.fill;
    ctx.fill();
  }
  ctx.clip();
  // hairline grid (no header tint — header reads through bold text only)
  ctx.strokeStyle = v.stroke;
  ctx.lineWidth = Math.min(v.strokeWidth, 1.5);
  ctx.beginPath();
  for (let c = 1; c < cols; c++) {
    const x = v.x + cumX(c) * v.w;
    ctx.moveTo(x, v.y);
    ctx.lineTo(x, v.y + v.h);
  }
  for (let r = 1; r < rows; r++) {
    const y = v.y + cumY(r) * v.h;
    ctx.moveTo(v.x, y);
    ctx.lineTo(v.x + v.w, y);
  }
  ctx.stroke();
  if (!hideText || hideCell) {
    ctx.fillStyle = ink;
    ctx.textBaseline = 'top';
    for (let r = 0; r < rows; r++) {
      const cellH = rowF[r] * v.h;
      const maxLines = Math.max(1, Math.floor((cellH - padTop * 1.5) / lineHeight));
      for (let c = 0; c < cols; c++) {
        // the cell under the open editor is covered by the overlay — hide just it
        if (hideCell && hideCell.row === r && hideCell.col === c) continue;
        const text = cells[r * cols + c];
        if (!text) continue;
        const style = tableCellStyle(v, r, header);
        ctx.font = boardFont(size, style);
        const cellW = colF[c] * v.w;
        const lines = wrapText(ctx, text, Math.max(20, cellW - padX * 2)).slice(0, maxLines);
        const bx = v.x + cumX(c) * v.w + padX;
        const maxW = Math.max(20, cellW - padX * 2);
        lines.forEach((line, i) => {
          const lw = ctx.measureText(line).width;
          const lx = lineAnchorX(bx, maxW, lw, style.textAlign);
          const ly = v.y + cumY(r) * v.h + padTop + i * lineHeight;
          ctx.fillText(line, lx, ly);
          drawTextDecorations(ctx, lx, ly, lw, size, ink, style.underline, style.strike);
        });
      }
    }
  }
  ctx.restore();
  // outer border on top, full user width
  ctx.save();
  ctx.strokeStyle = v.stroke;
  ctx.lineWidth = v.strokeWidth;
  ctx.beginPath();
  ctx.rect(v.x, v.y, v.w, v.h);
  ctx.stroke();
  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, v: ShapeView, textColor: string, boardBg?: string): void {
  const size = v.fontSize ?? SHAPE_FONT;
  const text = v.text ?? '';
  if (!text && !(v.richHtml && v.richHtml.includes('<'))) return;
  ctx.save();
  ctx.beginPath();
  if (v.type === 'ellipse') {
    ctx.ellipse(v.x + v.w / 2, v.y + v.h / 2, v.w / 2, v.h / 2, 0, 0, Math.PI * 2);
  } else {
    const rr = rectCornerRadius(v);
    if (rr > 0) ctx.roundRect(v.x, v.y, v.w, v.h, rr);
    else ctx.rect(v.x, v.y, v.w, v.h);
  }
  ctx.clip();
  const ink = labelInk(v, textColor, boardBg);
  const align = v.textAlign ?? 'center';
  const padX = SHAPE_LABEL_PAD_X;
  const maxW = shapeLabelInnerWidth(v.type, v.w);
  const lineHeight = size * LABEL_LINE_HEIGHT;

  if (v.richHtml && v.richHtml.includes('<')) {
    const estLines = Math.max(1, text.split('\n').length);
    const startY = v.y + v.h / 2 - ((estLines - 1) * lineHeight) / 2 - size / 2;
    drawShapeRichText(ctx, v, ink, v.x + padX, startY, maxW, align, v.y + v.h - padX);
    ctx.restore();
    return;
  }

  ctx.font = shapeFont(v, SHAPE_FONT);
  const lines = wrapText(ctx, text, maxW);
  if (!lines.length) {
    ctx.restore();
    return;
  }
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  const startY = v.y + v.h / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => {
    const lw = ctx.measureText(line).width;
    const lx = lineAnchorX(v.x + padX, maxW, lw, align);
    const ly = startY + i * lineHeight - size / 2;
    ctx.fillText(line, lx, startY + i * lineHeight);
    drawTextDecorations(ctx, lx, ly, lw, size, ink, v.underline, v.strike);
  });
  ctx.restore();
}

function drawDiamondLabel(ctx: CanvasRenderingContext2D, v: ShapeView, textColor: string, boardBg?: string): void {
  const size = v.fontSize ?? SHAPE_FONT;
  const text = v.text ?? '';
  if (!text && !(v.richHtml && v.richHtml.includes('<'))) return;
  ctx.save();
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2;
  ctx.beginPath();
  ctx.moveTo(cx, v.y);
  ctx.lineTo(v.x + v.w, cy);
  ctx.lineTo(cx, v.y + v.h);
  ctx.lineTo(v.x, cy);
  ctx.closePath();
  ctx.clip();
  const ink = labelInk(v, textColor, boardBg);
  const align = v.textAlign ?? 'center';
  const boxW = shapeLabelInnerWidth('diamond', v.w);
  const boxX = cx - boxW / 2;
  const lineHeight = size * LABEL_LINE_HEIGHT;

  if (v.richHtml && v.richHtml.includes('<')) {
    const estLines = Math.max(1, text.split('\n').length);
    const startY = cy - ((estLines - 1) * lineHeight) / 2 - size / 2;
    drawShapeRichText(ctx, v, ink, boxX, startY, boxW, align, cy + v.h * 0.35);
    ctx.restore();
    return;
  }

  ctx.font = shapeFont(v, SHAPE_FONT);
  const lines = wrapText(ctx, text, boxW);
  if (!lines.length) {
    ctx.restore();
    return;
  }
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  const startY = cy - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => {
    const lw = ctx.measureText(line).width;
    const lx = lineAnchorX(boxX, boxW, lw, align);
    const ly = startY + i * lineHeight - size / 2;
    ctx.fillText(line, lx, startY + i * lineHeight);
    drawTextDecorations(ctx, lx, ly, lw, size, ink, v.underline, v.strike);
  });
  ctx.restore();
}

function drawTriangleLabel(ctx: CanvasRenderingContext2D, v: ShapeView, textColor: string, boardBg?: string): void {
  const size = v.fontSize ?? SHAPE_FONT;
  const text = v.text ?? '';
  if (!text && !(v.richHtml && v.richHtml.includes('<'))) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(v.x + v.w / 2, v.y);
  ctx.lineTo(v.x, v.y + v.h);
  ctx.lineTo(v.x + v.w, v.y + v.h);
  ctx.closePath();
  ctx.clip();
  const ink = labelInk(v, textColor, boardBg);
  const align = v.textAlign ?? 'center';
  const cy = v.y + v.h * 0.62;
  const boxW = shapeLabelInnerWidth('triangle', v.w);
  const boxX = v.x + (v.w - boxW) / 2;
  const lineHeight = size * LABEL_LINE_HEIGHT;

  if (v.richHtml && v.richHtml.includes('<')) {
    const estLines = Math.max(1, text.split('\n').length);
    const startY = cy - ((estLines - 1) * lineHeight) / 2 - size / 2;
    drawShapeRichText(ctx, v, ink, boxX, startY, boxW, align, v.y + v.h - 8);
    ctx.restore();
    return;
  }

  ctx.font = shapeFont(v, SHAPE_FONT);
  const lines = wrapText(ctx, text, boxW);
  if (!lines.length) {
    ctx.restore();
    return;
  }
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  const startY = cy - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => {
    const lw = ctx.measureText(line).width;
    const lx = lineAnchorX(boxX, boxW, lw, align);
    const ly = startY + i * lineHeight - size / 2;
    ctx.fillText(line, lx, startY + i * lineHeight);
    drawTextDecorations(ctx, lx, ly, lw, size, ink, v.underline, v.strike);
  });
  ctx.restore();
}
