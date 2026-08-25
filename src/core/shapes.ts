import { formulaImage, renderFormula } from './formula';
import { compileGraph } from './graphEval';

export type ShapeType = 'rect' | 'ellipse' | 'sticky' | 'text' | 'pen' | 'arrow' | 'image' | 'doc' | 'graph' | 'diamond' | 'frame' | 'triangle' | 'parallelogram' | 'hexagon' | 'cylinder' | 'terminator' | 'subroutine' | 'display';

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
  fontSize?: number;
  points?: number[];
  alpha?: number;
  textColor?: string;
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
  let x = v.x + fx * v.w;
  let y = v.y + fy * v.h;
  if (offset) {
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    const dx = x - cx, dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    x += (dx / len) * offset;
    y += (dy / len) * offset;
  }
  return { x, y };
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

export function intersects(a: ShapeBox, b: ShapeBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function pointInShape(v: ShapeView, px: number, py: number): boolean {
  switch (v.type) {
    case 'ellipse': {
      const rx = v.w / 2;
      const ry = v.h / 2;
      if (!rx || !ry) return false;
      const dx = (px - (v.x + rx)) / rx;
      const dy = (py - (v.y + ry)) / ry;
      return dx * dx + dy * dy <= 1;
    }
    case 'diamond': {
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      const dx = Math.abs(px - cx) / (v.w / 2);
      const dy = Math.abs(py - cy) / (v.h / 2);
      return dx + dy <= 1;
    }
    case 'triangle': {
      const ax = v.x + v.w / 2, ay = v.y;
      const bx = v.x, by = v.y + v.h;
      const cx = v.x + v.w, cy = v.y + v.h;
      const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (!denom) return false;
      const a = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
      const b = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
      const c = 1 - a - b;
      return a >= 0 && b >= 0 && c >= 0;
    }
    case 'parallelogram': {
      const skew = v.w * 0.2;
      const pts = [
        { x: v.x + skew, y: v.y },
        { x: v.x + v.w, y: v.y },
        { x: v.x + v.w - skew, y: v.y + v.h },
        { x: v.x, y: v.y + v.h },
      ];
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    case 'hexagon': {
      const cy = v.y + v.h / 2;
      const pts = [
        { x: v.x + v.w * 0.25, y: v.y },
        { x: v.x + v.w * 0.75, y: v.y },
        { x: v.x + v.w, y: cy },
        { x: v.x + v.w * 0.75, y: v.y + v.h },
        { x: v.x + v.w * 0.25, y: v.y + v.h },
        { x: v.x, y: cy },
      ];
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    case 'cylinder': {
      // top ellipse + rect + bottom ellipse
      const rx = v.w / 2, ry = Math.min(v.h * 0.15, 18);
      if (py < v.y + ry) {
        const dx = (px - (v.x + rx)) / rx;
        const dy = (py - (v.y + ry)) / ry;
        return dx * dx + dy * dy <= 1;
      }
      if (py > v.y + v.h - ry) {
        const dx = (px - (v.x + rx)) / rx;
        const dy = (py - (v.y + v.h - ry)) / ry;
        return dx * dx + dy * dy <= 1;
      }
      return px >= v.x && px <= v.x + v.w && py >= v.y && py <= v.y + v.h;
    }
    case 'terminator': {
      const r = v.h / 2;
      if (px < v.x + r) {
        const dx = px - (v.x + r), dy = py - (v.y + r);
        return dx * dx + dy * dy <= r * r;
      }
      if (px > v.x + v.w - r) {
        const dx = px - (v.x + v.w - r), dy = py - (v.y + r);
        return dx * dx + dy * dy <= r * r;
      }
      return px >= v.x && px <= v.x + v.w && py >= v.y && py <= v.y + v.h;
    }
    case 'subroutine':
      return px >= v.x && px <= v.x + v.w && py >= v.y && py <= v.y + v.h;
    case 'display': {
      const pts = [
        { x: v.x, y: v.y },
        { x: v.x + v.w * 0.85, y: v.y },
        { x: v.x + v.w, y: v.y + v.h / 2 },
        { x: v.x + v.w * 0.85, y: v.y + v.h },
        { x: v.x, y: v.y + v.h },
      ];
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    case 'pen':
    case 'arrow':
      return pointNearPolyline(v.points ?? [], px, py, v.strokeWidth / 2 + 3);
    default:
      return px >= v.x && px <= v.x + v.w && py >= v.y && py <= v.y + v.h;
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

export function drawPenStroke(
  ctx: CanvasRenderingContext2D,
  pts: number[],
  width: number,
  color: string,
  alpha: number
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 2) {
    ctx.beginPath();
    ctx.arc(pts[0], pts[1], width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
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
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    if (!raw) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of raw.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (line && ctx.measureText(test).width > maxWidth) {
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
  size: number
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
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  v: ShapeView,
  textColor: string = COLORS.text,
  boardBg: string = COLORS.background
): void {
  const font = `${v.fontSize ?? TEXT_FONT}px ${BOARD_TYPEFACE}`;
  switch (v.type) {
    case 'rect': {
      ctx.fillStyle = v.fill;
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.roundRect(v.x, v.y, v.w, v.h, 6);
      ctx.fill();
      ctx.stroke();
      if (v.text) drawLabel(ctx, v, textColor);
      break;
    }
    case 'ellipse': {
      ctx.fillStyle = v.fill;
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.ellipse(v.x + v.w / 2, v.y + v.h / 2, v.w / 2, v.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (v.text) drawLabel(ctx, v, textColor);
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
      if (v.text) drawDiamondLabel(ctx, v, textColor);
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
      if (v.text) {
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
      if (v.text) drawTriangleLabel(ctx, v, textColor);
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
      if (v.text) drawLabel(ctx, v, textColor);
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
      if (v.text) drawLabel(ctx, v, textColor);
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
      if (v.text) drawLabel(ctx, v, textColor);
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
      if (v.text) drawLabel(ctx, v, textColor);
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
      if (v.text) drawLabel(ctx, v, textColor);
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
      if (v.text) drawLabel(ctx, v, textColor);
      break;
    }
    case 'sticky': {
      ctx.fillStyle = v.fill;
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.roundRect(v.x, v.y, v.w, v.h, 8);
      ctx.fill();
      ctx.stroke();
      if (v.text) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(v.x, v.y, v.w, v.h, 8);
        ctx.clip();
        ctx.fillStyle = v.textColor ?? '#3a2f00';
        ctx.font = font;
        ctx.textBaseline = 'top';
        const lineHeight = (v.fontSize ?? STICKY_FONT) * 1.25;
        let lineY = v.y + 8;
        for (const line of wrapText(ctx, v.text, v.w - 16)) {
          ctx.fillText(line, v.x + 8, lineY);
          lineY += lineHeight;
          if (lineY > v.y + v.h - 8) break;
        }
        ctx.restore();
      }
      break;
    }
    case 'text': {
      if (!v.text) break;
      ctx.fillStyle = readableTextOn(v.textColor ?? textColor, boardBg);
      ctx.font = font;
      ctx.textBaseline = 'top';
      const size = v.fontSize ?? TEXT_FONT;
      const lineHeight = size * 1.3;
      let lineY = v.y;
      for (const line of v.text.split('\n')) {
        drawMixedLine(ctx, line, v.x, lineY, lineHeight, size);
        lineY += lineHeight;
      }
      break;
    }
    case 'pen':
      drawPenStroke(ctx, v.points ?? [], v.strokeWidth, v.stroke, v.alpha ?? 1);
      break;
    case 'arrow':
      drawArrow(ctx, v);
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
      drawGraph(ctx, v);
      break;
  }
}

const GRAPH_X_RANGE = 10;

function drawGraph(ctx: CanvasRenderingContext2D, v: ShapeView): void {
  const size = Math.max(11, (v.fontSize ?? TEXT_FONT) * 0.8);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(v.x, v.y, v.w, v.h, 10);
  ctx.fillStyle = '#15171f';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.clip();

  const compiled = compileGraph(v.expr ?? '');
  const toPxX = (t: number) => v.x + ((t + GRAPH_X_RANGE) / (2 * GRAPH_X_RANGE)) * v.w;
  const toT = (px: number) => ((px - v.x) / v.w) * 2 * GRAPH_X_RANGE - GRAPH_X_RANGE;

  if (compiled.error !== undefined || !v.expr?.trim()) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `${size}px ${BOARD_TYPEFACE}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      compiled.error ? `⚠ ${compiled.error}` : 'y = f(x)',
      v.x + v.w / 2,
      v.y + v.h / 2
    );
    ctx.textAlign = 'left';
    ctx.restore();
    return;
  }

  let lo = Infinity;
  let hi = -Infinity;
  const N = Math.max(80, Math.min(400, Math.round(v.w)));
  const ts: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = toT(v.x + (i / N) * v.w);
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
    const pad = (hi - lo) * 0.12;
    lo -= pad;
    hi += pad;
  }
  const toPxY = (val: number) => v.y + (1 - (val - lo) / (hi - lo)) * v.h;

  // grid + axes with tick labels
  const step = niceStep(Math.max(GRAPH_X_RANGE / 6, (hi - lo) / 8));
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = Math.ceil(-GRAPH_X_RANGE / step) * step; gx <= GRAPH_X_RANGE; gx += step) {
    if (Math.abs(gx) < 1e-9) continue;
    const px = toPxX(gx);
    ctx.moveTo(px, v.y);
    ctx.lineTo(px, v.y + v.h);
  }
  for (let gy = Math.ceil(lo / step) * step; gy <= hi; gy += step) {
    if (Math.abs(gy) < 1e-9) continue;
    const py = toPxY(gy);
    if (py < v.y - 1 || py > v.y + v.h + 1) continue;
    ctx.moveTo(v.x, py);
    ctx.lineTo(v.x + v.w, py);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  const ax = toPxX(0);
  if (ax >= v.x && ax <= v.x + v.w) {
    ctx.moveTo(ax, v.y);
    ctx.lineTo(ax, v.y + v.h);
  }
  const ay = toPxY(0);
  if (ay >= v.y && ay <= v.y + v.h) {
    ctx.moveTo(v.x, ay);
    ctx.lineTo(v.x + v.w, ay);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = `${size}px ${BOARD_TYPEFACE}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let gx = Math.ceil(-GRAPH_X_RANGE / step) * step; gx <= GRAPH_X_RANGE; gx += step) {
    if (Math.abs(gx) < 1e-9) continue;
    const px = toPxX(gx);
    if (px < v.x + 12 || px > v.x + v.w - 12) continue;
    const labelY = Math.max(v.y + 3, Math.min(v.y + v.h - size - 4, ay));
    ctx.fillText(String(+gx.toFixed(4)), px, labelY + 2);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let gy = Math.ceil(lo / step) * step; gy <= hi; gy += step) {
    if (Math.abs(gy) < 1e-9) continue;
    const py = toPxY(gy);
    if (py < v.y + size || py > v.y + v.h - size) continue;
    ctx.fillText(String(+gy.toFixed(4)), ax + 4, py);
  }

  // curve
  ctx.strokeStyle = '#7c8cff';
  ctx.lineWidth = 2.25;
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
    if (started && Math.abs(py - prevPy) > v.h * 2) started = false;
    if (!started) {
      ctx.moveTo(toPxX(ts[i]), py);
      started = true;
    } else {
      ctx.lineTo(toPxX(ts[i]), py);
    }
    prevPy = py;
  }
  ctx.stroke();
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

export function drawArrow(ctx: CanvasRenderingContext2D, v: ShapeView): void {
  const pts = v.points ?? [];
  if (pts.length < 4) return;
  const ax = pts[0];
  const ay = pts[1];
  const bx = pts[2];
  const by = pts[3];
  // ponytail: beautiful curved arrows — use port directions for connected, gentle bend for free
  const isConnected = Boolean(v.fromId && v.toId && v.fromPort && v.toPort);
  let c1x = ax, c1y = ay, c2x = bx, c2y = by;
  let endAngle = Math.atan2(by - ay, bx - ax);
  if (isConnected) {
    const fromDir = portDir(v.fromPort as PortId);
    const toDir = portDir(v.toPort as PortId);
    const dist = Math.hypot(bx - ax, by - ay);
    const off = Math.min(80, dist * 0.35);
    c1x = ax + fromDir.x * off;
    c1y = ay + fromDir.y * off;
    c2x = bx + toDir.x * off;
    c2y = by + toDir.y * off;
    // end tangent is opposite of toDir
    endAngle = Math.atan2(by - c2y, bx - c2x);
    if (!isFinite(endAngle)) endAngle = Math.atan2(by - ay, bx - ax);
  } else {
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const bend = Math.min(40, len * 0.18) * (Math.abs(dx) > Math.abs(dy) ? 1 : -1);
    // gentle perpendicular bend for free arrows
    c1x = mx + nx * bend * 0.5;
    c1y = my + ny * bend * 0.5;
    c2x = c1x; c2y = c1y;
    endAngle = Math.atan2(by - c1y, bx - c1x);
  }
  ctx.save();
  ctx.strokeStyle = v.stroke;
  ctx.fillStyle = v.stroke;
  ctx.lineWidth = v.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // soft shadow for beauty
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  if (isConnected) {
    ctx.moveTo(ax, ay);
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, bx, by);
  } else if (pts.length === 4 && !isConnected) {
    // free arrow with gentle curve via quadratic
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(c1x, c1y, bx, by);
  } else {
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();
  ctx.shadowColor = 'transparent';
  const head = Math.max(10, v.strokeWidth * 3.5);
  const hx1 = bx - head * Math.cos(endAngle - 0.42);
  const hy1 = by - head * Math.sin(endAngle - 0.42);
  const hx2 = bx - head * Math.cos(endAngle + 0.42);
  const hy2 = by - head * Math.sin(endAngle + 0.42);
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(hx1, hy1);
  ctx.lineTo(hx2, hy2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, v: ShapeView, textColor: string): void {
  const size = v.fontSize ?? SHAPE_FONT;
  const lines = wrapText(ctx, v.text ?? '', Math.max(20, v.w - 16));
  if (!lines.length) return;
  ctx.save();
  ctx.beginPath();
  if (v.type === 'ellipse') {
    ctx.ellipse(v.x + v.w / 2, v.y + v.h / 2, v.w / 2, v.h / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.roundRect(v.x, v.y, v.w, v.h, 6);
  }
  ctx.clip();
  ctx.fillStyle = v.textColor ?? textColor;
  ctx.font = `${size}px ${BOARD_TYPEFACE}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lineHeight = size * 1.25;
  const startY = v.y + v.h / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, v.x + v.w / 2, startY + i * lineHeight));
  ctx.restore();
}

function drawDiamondLabel(ctx: CanvasRenderingContext2D, v: ShapeView, textColor: string): void {
  const size = v.fontSize ?? SHAPE_FONT;
  const lines = wrapText(ctx, v.text ?? '', Math.max(20, v.w * 0.55));
  if (!lines.length) return;
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
  ctx.fillStyle = v.textColor ?? textColor;
  ctx.font = `${size}px ${BOARD_TYPEFACE}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lineHeight = size * 1.25;
  const startY = cy - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, cx, startY + i * lineHeight));
  ctx.restore();
}

function drawTriangleLabel(ctx: CanvasRenderingContext2D, v: ShapeView, textColor: string): void {
  const size = v.fontSize ?? SHAPE_FONT;
  const lines = wrapText(ctx, v.text ?? '', Math.max(20, v.w * 0.6));
  if (!lines.length) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(v.x + v.w / 2, v.y);
  ctx.lineTo(v.x, v.y + v.h);
  ctx.lineTo(v.x + v.w, v.y + v.h);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = v.textColor ?? textColor;
  ctx.font = `${size}px ${BOARD_TYPEFACE}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cy = v.y + v.h * 0.62;
  const lineHeight = size * 1.25;
  const startY = cy - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, v.x + v.w / 2, startY + i * lineHeight));
  ctx.restore();
}
