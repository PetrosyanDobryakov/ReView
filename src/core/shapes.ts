import { formulaImage, renderFormula } from './formula';
import { compileGraph } from './graphEval';
import { readPrefs } from './prefs';
import { shapeRotation, worldToLocal, withShapeRotation, localToWorld } from './transform';
import { drawRichBlock, parseStoredRich } from './richText';
import { isOrbitPaper } from './orbit';
import {
  isClassicStickyText,
  ORBIT_DRAW,
  shouldUseOrbitDraw,
} from './orbitDraw';

export type ShapeType = 'rect' | 'ellipse' | 'sticky' | 'text' | 'pen' | 'arrow' | 'image' | 'doc' | 'graph' | 'diamond' | 'frame' | 'triangle' | 'parallelogram' | 'hexagon' | 'cylinder' | 'terminator' | 'subroutine' | 'display';

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
  fromId?: string;
  fromPort?: string;
  toId?: string;
  toPort?: string;
}

export const PORTS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type PortId = (typeof PORTS)[number];

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

export interface ShapeBox {
  x: number;
  y: number;
  w: number;
  h: number;
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

export function arrowHeadLength(v: Pick<ShapeView, 'arrowHead' | 'strokeWidth'>): number {
  if (typeof v.arrowHead === 'number' && v.arrowHead > 0) return v.arrowHead;
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
 * Honors the Adapt ink preference — stored colors stay as authored.
 */
export function displayInk(color: string, boardBg: string): string {
  if (!readPrefs().adaptInkToPaper) return color;
  return readableTextOn(color, boardBg);
}

export function intersects(a: ShapeBox, b: ShapeBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** `inner` lies fully inside `outer` (with tolerance). */
export function containedIn(inner: ShapeBox, outer: ShapeBox, tol = 2): boolean {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.w <= outer.x + outer.w + tol &&
    inner.y + inner.h <= outer.y + outer.h + tol
  );
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
  const end = { x: pts[2], y: pts[3] };
  const fromPort = isPortId(v.fromPort) ? v.fromPort : null;
  const toPort = isPortId(v.toPort) ? v.toPort : null;
  const isConnected = Boolean(v.fromId && v.toId && fromPort && toPort);

  if (isConnected && fromPort && toPort) {
    const fromDir = portDir(fromPort);
    const toDir = portDir(toPort);
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    const offset = Math.min(80, dist * 0.35);
    const control1 = {
      x: start.x + fromDir.x * offset,
      y: start.y + fromDir.y * offset,
    };
    const control2 = {
      x: end.x + toDir.x * offset,
      y: end.y + toDir.y * offset,
    };
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

function sampleArrowCurve(curve: ArrowCurve, segments = 24): number[] {
  const points: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const point = pointOnArrowCurve(curve, i / segments);
    points.push(point.x, point.y);
  }
  return points;
}

export function arrowBounds(v: ShapeView): ShapeBox {
  const curve = arrowCurve(v);
  if (!curve) return { x: v.x, y: v.y, w: v.w, h: v.h };

  const points = sampleArrowCurve(curve);
  const head = arrowHeadLength(v);
  points.push(
    curve.end.x - head * Math.cos(curve.endAngle - 0.42),
    curve.end.y - head * Math.sin(curve.endAngle - 0.42),
    curve.end.x - head * Math.cos(curve.endAngle + 0.42),
    curve.end.y - head * Math.sin(curve.endAngle + 0.42)
  );

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxX = Math.max(maxX, points[i]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  const pad = v.strokeWidth / 2 + 5;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

export function pointInShape(v: ShapeView, px: number, py: number): boolean {
  // Pens/arrows store world-space points; rotation is baked in when applied.
  if (v.type === 'pen') {
    return pointNearPolyline(v.points ?? [], px, py, v.strokeWidth / 2 + 3);
  }
  if (v.type === 'arrow') {
    const curve = arrowCurve(v);
    return curve
      ? pointNearPolyline(sampleArrowCurve(curve), px, py, v.strokeWidth / 2 + 3)
      : false;
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
      const r = box.h / 2;
      if (x < box.x + r) {
        const dx = x - (box.x + r), dy = y - (box.y + r);
        return dx * dx + dy * dy <= r * r;
      }
      if (x > box.x + box.w - r) {
        const dx = x - (box.x + box.w - r), dy = y - (box.y + r);
        return dx * dx + dy * dy <= r * r;
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

function pointNearPolyline(pts: number[], px: number, py: number, tol: number): boolean {
  if (pts.length < 2) return false;
  const t2 = tol * tol;
  for (let i = 0; i < pts.length - 2; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const bx = pts[i + 2];
    const by = pts[i + 3];
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    let t = len2 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = px - (ax + abx * t);
    const dy = py - (ay + aby * t);
    if (dx * dx + dy * dy <= t2) return true;
  }
  return false;
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
  pressures?: number[],
  opts?: { bloom?: boolean }
): void {
  if (opts?.bloom && alpha > 0.04 && pts.length >= 2) {
    paintPenStroke(ctx, pts, width * 2.6, color, Math.min(1, alpha * 0.2), pressures);
    paintPenStroke(ctx, pts, width * 1.45, color, Math.min(1, alpha * 0.35), pressures);
  }
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

function splitOverlongWord(
  ctx: CanvasRenderingContext2D,
  word: string,
  maxWidth: number,
  fontSize: number
): string[] {
  const chunks: string[] = [];
  let chunk = '';
  for (const char of word) {
    const next = chunk + char;
    if (chunk && measureMixedLine(ctx, next, fontSize) > maxWidth) {
      chunks.push(chunk);
      chunk = char;
    } else {
      chunk = next;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  // Use measureMixedLine so $formula$ width matches drawMixedLine / commit height.
  const sizeMatch = /([\d.]+)px/.exec(ctx.font);
  const fontSize = sizeMatch ? Number(sizeMatch[1]) : 16;
  for (const raw of text.split('\n')) {
    if (!raw) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of raw.split(/\s+/)) {
      if (measureMixedLine(ctx, word, fontSize) > maxWidth) {
        if (line) {
          lines.push(line);
          line = '';
        }
        const chunks = splitOverlongWord(ctx, word, maxWidth, fontSize);
        lines.push(...chunks.slice(0, -1));
        line = chunks.at(-1) ?? '';
        continue;
      }
      const test = line ? line + ' ' + word : word;
      if (line && measureMixedLine(ctx, test, fontSize) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
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

export function drawShape(
  ctx: CanvasRenderingContext2D,
  v: ShapeView,
  textColor: string = COLORS.text,
  boardBg: string = COLORS.background,
  hideText = false
): void {
  if (shapeRotation(v) && v.type !== 'pen' && v.type !== 'arrow') {
    withShapeRotation(ctx, v, () =>
      drawShape(ctx, { ...v, rotation: 0 }, textColor, boardBg, hideText)
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
      ctx.fillStyle = v.fill;
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(cx, v.y);
      ctx.lineTo(v.x + v.w, cy);
      ctx.lineTo(cx, v.y + v.h);
      ctx.lineTo(v.x, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (v.text && !hideText) drawDiamondLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'frame': {
      // ponytail: frame — structural scheme container, dashed outer + solid header
      const headerH = Math.min(28, v.h * 0.22);
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
      if (v.text && !hideText) {
        ctx.save();
        ctx.fillStyle = v.textColor ?? textColor;
        ctx.font = `${Math.max(12, (v.fontSize ?? SHAPE_FONT) - 1)}px ${BOARD_TYPEFACE}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const pad = 10;
        ctx.fillText(v.text.split('\n')[0] ?? '', v.x + pad, v.y + headerH / 2, v.w - pad * 2);
        ctx.restore();
      }
      break;
    }
    case 'triangle': {
      const ax = v.x + v.w / 2, ay = v.y;
      const bx = v.x, by = v.y + v.h;
      const cx = v.x + v.w, cy = v.y + v.h;
      ctx.fillStyle = v.fill;
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(cx, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (v.text && !hideText) drawTriangleLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'parallelogram': {
      const skew = v.w * 0.2;
      ctx.fillStyle = v.fill;
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(v.x + skew, v.y);
      ctx.lineTo(v.x + v.w, v.y);
      ctx.lineTo(v.x + v.w - skew, v.y + v.h);
      ctx.lineTo(v.x, v.y + v.h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (v.text && !hideText) drawLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'hexagon': {
      const cy = v.y + v.h / 2;
      ctx.fillStyle = v.fill;
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(v.x + v.w * 0.25, v.y);
      ctx.lineTo(v.x + v.w * 0.75, v.y);
      ctx.lineTo(v.x + v.w, cy);
      ctx.lineTo(v.x + v.w * 0.75, v.y + v.h);
      ctx.lineTo(v.x + v.w * 0.25, v.y + v.h);
      ctx.lineTo(v.x, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (v.text && !hideText) drawLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'cylinder': {
      const ry = Math.min(v.h * 0.15, 18);
      const rx = v.w / 2, cx = v.x + rx;
      ctx.fillStyle = v.fill;
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      // body
      ctx.moveTo(v.x, v.y + ry);
      ctx.lineTo(v.x, v.y + v.h - ry);
      ctx.ellipse(cx, v.y + v.h - ry, rx, ry, 0, 0, Math.PI);
      ctx.lineTo(v.x + v.w, v.y + ry);
      ctx.ellipse(cx, v.y + ry, rx, ry, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // top ellipse
      ctx.beginPath();
      ctx.ellipse(cx, v.y + ry, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (v.text && !hideText) drawLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'terminator': {
      const r = v.h / 2;
      ctx.fillStyle = v.fill;
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.roundRect(v.x, v.y, v.w, v.h, r);
      ctx.fill();
      ctx.stroke();
      if (v.text && !hideText) drawLabel(ctx, v, textColor, boardBg);
      break;
    }
    case 'subroutine': {
      ctx.fillStyle = v.fill;
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.roundRect(v.x, v.y, v.w, v.h, 6);
      ctx.fill();
      ctx.stroke();
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
      ctx.fillStyle = v.fill;
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(v.x, v.y);
      ctx.lineTo(v.x + v.w * 0.85, v.y);
      ctx.lineTo(v.x + v.w, v.y + v.h / 2);
      ctx.lineTo(v.x + v.w * 0.85, v.y + v.h);
      ctx.lineTo(v.x, v.y + v.h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (v.text && !hideText) drawLabel(ctx, v, textColor, boardBg);
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
      if (orbit) {
        ctx.save();
        ctx.strokeStyle = withAlpha(ORBIT_DRAW.lilac, 0.28);
        ctx.lineWidth = Math.max(v.strokeWidth + 2.5, 3.5);
        ctx.beginPath();
        ctx.roundRect(v.x, v.y, v.w, v.h, 8);
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = drawFill;
      ctx.strokeStyle = drawStroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.roundRect(v.x, v.y, v.w, v.h, 8);
      ctx.fill();
      ctx.stroke();
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
        const lineHeight = size * 1.25;
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
      if (!v.text || hideText) break;
      const ink = displayInk(v.textColor ?? textColor, boardBg);
      const size = v.fontSize ?? TEXT_FONT;
      const lineHeight = size * 1.3;
      if (v.highlight) {
        ctx.fillStyle = TEXT_HIGHLIGHT;
        ctx.beginPath();
        ctx.roundRect(v.x - 4, v.y - 2, v.w + 8, v.h + 4, 4);
        ctx.fill();
      }
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
        v.pressures,
        { bloom: shouldUseOrbitDraw(boardBg) }
      );
      break;
    case 'arrow':
      drawArrow(ctx, v, boardBg);
      break;
    case 'image': {
      const img = getImage(v.src ?? '');
      if (img && img.complete && img.naturalWidth > 0) {
        if (v.cropX !== undefined || v.cropY !== undefined || v.cropW !== undefined || v.cropH !== undefined) {
          const sx = (v.cropX ?? 0) * img.naturalWidth;
          const sy = (v.cropY ?? 0) * img.naturalHeight;
          const sw = (v.cropW ?? 1) * img.naturalWidth;
          const sh = (v.cropH ?? 1) * img.naturalHeight;
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
    case 'doc': {
      const pages = v.pages ?? [];
      const src = pages[Math.min(v.page ?? 0, pages.length - 1)] ?? '';
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

function drawGraph(ctx: CanvasRenderingContext2D, v: ShapeView, boardBg: string): void {
  const chrome = graphChrome(v);
  const { labelSize, pad, tickLen, axisW, borderW, radius, titlePad, targetTickPx } = chrome;
  const plot = {
    x: v.x + pad.left,
    y: v.y + pad.top,
    w: Math.max(20, v.w - pad.left - pad.right),
    h: Math.max(20, v.h - pad.top - pad.bottom),
  };
  const panel = graphPanelFill(boardBg, v.fill);
  const ink = graphAxisInk(boardBg);
  const curve = displayInk(v.stroke || COLORS.stroke, boardBg);
  const themeText = themeFor(boardBg).text;

  ctx.save();
  // Card
  ctx.beginPath();
  ctx.roundRect(v.x, v.y, v.w, v.h, radius);
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.strokeStyle = ink.border;
  ctx.lineWidth = borderW;
  ctx.stroke();

  const compiled = compileGraph(v.expr ?? '');
  const exprLabel = `y = ${(v.expr ?? '').trim() || '…'}`;

  // Title chip (outside the clipped plot)
  ctx.fillStyle = themeText;
  ctx.globalAlpha = 0.72;
  ctx.font = `600 ${labelSize}px ${BOARD_TYPEFACE}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(exprLabel, v.x + titlePad, v.y + titlePad * 0.8, v.w - titlePad * 2);
  ctx.globalAlpha = 1;

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
  ctx.strokeStyle = curve;
  ctx.lineWidth = Math.max(1.5, (v.strokeWidth || 2) * Math.min(1.6, Math.max(0.85, chrome.scale)));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  let started = false;
  let prevPy = 0;
  for (let i = 0; i <= N; i++) {
    const y = ys[i];
    if (!isFinite(y)) {
      started = false;
      continue;
    }
    const py = toPxY(y);
    if (started && Math.abs(py - prevPy) > plot.h * 2) started = false;
    if (!started) {
      ctx.moveTo(toPxX(ts[i]), py);
      started = true;
    } else {
      ctx.lineTo(toPxX(ts[i]), py);
    }
    prevPy = py;
  }
  ctx.stroke();
  ctx.restore(); // end plot clip

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

export function drawArrow(ctx: CanvasRenderingContext2D, v: ShapeView, boardBg?: string): void {
  const curve = arrowCurve(v);
  if (!curve) return;
  const ink = boardBg ? displayInk(v.stroke, boardBg) : v.stroke;
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = v.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // soft shadow for beauty
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
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
    // free arrow with gentle curve via quadratic
    ctx.quadraticCurveTo(curve.control.x, curve.control.y, curve.end.x, curve.end.y);
  } else {
    ctx.lineTo(curve.end.x, curve.end.y);
  }
  ctx.stroke();
  ctx.shadowColor = 'transparent';
  const head = arrowHeadLength(v);
  const hx1 = curve.end.x - head * Math.cos(curve.endAngle - 0.42);
  const hy1 = curve.end.y - head * Math.sin(curve.endAngle - 0.42);
  const hx2 = curve.end.x - head * Math.cos(curve.endAngle + 0.42);
  const hy2 = curve.end.y - head * Math.sin(curve.endAngle + 0.42);
  ctx.beginPath();
  ctx.moveTo(curve.end.x, curve.end.y);
  ctx.lineTo(hx1, hy1);
  ctx.lineTo(hx2, hy2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
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
    lineHeight: size * 1.25,
    fontFn: (s, style) => boardFont(s, { bold: style.bold ?? v.bold, italic: style.italic ?? v.italic }),
    highlightFill: TEXT_HIGHLIGHT,
    maxBottom,
  });
}

function labelInk(v: ShapeView, textColor: string, boardBg?: string): string {
  const raw = v.textColor ?? textColor;
  return boardBg && v.type !== 'sticky' ? readableTextOn(raw, boardBg) : raw;
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
  const padX = 8;
  const maxW = Math.max(20, v.w - 16);
  const lineHeight = size * 1.25;

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
  const boxW = v.w * 0.55;
  const boxX = cx - boxW / 2;
  const lineHeight = size * 1.25;

  if (v.richHtml && v.richHtml.includes('<')) {
    const estLines = Math.max(1, text.split('\n').length);
    const startY = cy - ((estLines - 1) * lineHeight) / 2 - size / 2;
    drawShapeRichText(ctx, v, ink, boxX, startY, boxW, align, cy + v.h * 0.35);
    ctx.restore();
    return;
  }

  ctx.font = shapeFont(v, SHAPE_FONT);
  const lines = wrapText(ctx, text, Math.max(20, boxW));
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
  const boxW = v.w * 0.6;
  const boxX = v.x + (v.w - boxW) / 2;
  const lineHeight = size * 1.25;

  if (v.richHtml && v.richHtml.includes('<')) {
    const estLines = Math.max(1, text.split('\n').length);
    const startY = cy - ((estLines - 1) * lineHeight) / 2 - size / 2;
    drawShapeRichText(ctx, v, ink, boxX, startY, boxW, align, v.y + v.h - 8);
    ctx.restore();
    return;
  }

  ctx.font = shapeFont(v, SHAPE_FONT);
  const lines = wrapText(ctx, text, Math.max(20, boxW));
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
