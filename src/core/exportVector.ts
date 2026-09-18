import type { ShapeView, TextAlign } from './shapes';
import {
  BOARD_TYPEFACE,
  FRAME_LABEL_PAD_X,
  arrowBounds,
  arrowHeadLength,
  boardFont,
  cropFractions,
  defaultFontSizeFor,
  docPageIndex,
  describeArrow,
  displayInk,
  frameHeaderHeight,
  frameTitleLine,
  graphCurvePath,
  labelInk,
  imageHasCrop,
  pressureVaries,
  shapeLabelInnerWidth,
  resolveCalcBodyFill,
  resolveCalcStroke,
  STICKY_TEXT_PAD,
  tableCellStyle,
  tableGrid,
  TABLE_CELL_PAD_X,
  TABLE_CELL_PAD_TOP,
  LABEL_LINE_HEIGHT,
  TEXT_LINE_HEIGHT,
  themeFor,
  uncroppedBox,
  COLORS,
} from './shapes';
import { shapeRotation, rotatedAabb } from './transform';
import { parseStoredRich, wrapRichLines, type RichSpan, type RichStyle } from './richText';
import { renderFormula } from './formula';
import { measureMixedWidth, measureTextWidth, splitMixedRuns, wrapLinesByWidth } from './textLayout';

const STICKY_INK = '#3a2f00';
const SHAPE_INK = '#1c1c1a';

function exportStroke(v: ShapeView, paper: string | null): string {
  return paper ? displayInk(v.stroke, paper) : v.stroke;
}

/** Download is only safe once the blob was produced for the currently selected format. */
export function exportDownloadEnabled(
  previewUrl: string | null,
  previewFormat: string | null,
  format: string
): boolean {
  return Boolean(previewUrl) && previewFormat === format;
}

function exportTextInk(v: ShapeView, paper: string | null, fallback: string): string {
  if (v.type === 'sticky') return v.textColor ?? STICKY_INK;
  const base = v.textColor ?? (paper ? themeFor(paper).text : fallback);
  if (!paper) return base;
  if (v.type === 'text' || v.type === 'graph') return displayInk(base, paper);
  return labelInk(v, base, paper);
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function boxOf(v: ShapeView): { x: number; y: number; w: number; h: number } {
  if (v.type === 'arrow') return arrowBounds(v);
  return rotatedAabb(v);
}

function fillOf(v: ShapeView): string {
  return v.fill === 'transparent' || v.fill === 'none' ? 'none' : esc(v.fill);
}

function paint(v: ShapeView, extra = ''): string {
  return `fill="${fillOf(v)}" stroke="${esc(v.stroke)}" stroke-width="${v.strokeWidth}"${extra}`;
}

function polygon(points: Array<[number, number]>, v: ShapeView, extra: string): string {
  return `<polygon points="${points.map(([px, py]) => `${px},${py}`).join(' ')}" ${paint(v, extra)}/>`;
}

function penDotRadius(v: ShapeView): number {
  const width = v.strokeWidth;
  const useP = pressureVaries(v.pressures, 1);
  const w = useP ? width * (0.35 + 0.65 * (v.pressures![0] ?? 0.5)) : width;
  return w / 2;
}

function formulaDisplaySize(latex: string, fontSize: number): { w: number; h: number; svg: string } | null {
  const r = renderFormula(latex);
  if (!r.valid) return null;
  const k = fontSize / 2;
  return {
    w: Math.max(1, Math.round(r.wEx * k)),
    h: Math.max(1, Math.round(r.hEx * k)),
    svg: r.svg,
  };
}

function measureStyled(text: string, fontSize: number, style: RichStyle): number {
  return measureMixedWidth(
    text,
    (s) => measureTextWidth(s, fontSize, style, (sz, st) => boardFont(sz, st)),
    (latex) => {
      const f = formulaDisplaySize(latex, fontSize);
      return f ? f.w + 4 : null;
    }
  );
}

function spanAttrs(style: RichStyle, ink: string): string {
  const bits: string[] = [];
  if (style.bold) bits.push('font-weight="700"');
  if (style.italic) bits.push('font-style="italic"');
  const deco: string[] = [];
  if (style.underline) deco.push('underline');
  if (style.strike) deco.push('line-through');
  if (deco.length) bits.push(`text-decoration="${deco.join(' ')}"`);
  bits.push(`fill="${esc(style.color ?? ink)}"`);
  return bits.join(' ');
}

function emitMixedLine(
  text: string,
  x0: number,
  yTop: number,
  fontSize: number,
  style: RichStyle,
  ink: string,
  extra: string
): { svg: string; width: number } {
  const parts: string[] = [];
  let x = x0;
  for (const run of splitMixedRuns(text)) {
    if (run.kind === 'formula') {
      const f = formulaDisplaySize(run.value, fontSize);
      if (f) {
        const px = f.svg.replace(/width="[^"]+"/, `width="${f.w}"`).replace(/height="[^"]+"/, `height="${f.h}"`);
        const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(px)}`;
        const iy = yTop + (fontSize - f.h) / 2;
        parts.push(
          `<image href="${esc(href)}" x="${x + 2}" y="${iy}" width="${f.w}" height="${f.h}"/>`
        );
        x += f.w + 4;
        continue;
      }
      const raw = `$${run.value}$`;
      const w = measureTextWidth(raw, fontSize, style, (sz, st) => boardFont(sz, st));
      parts.push(
        `<text x="${x}" y="${yTop}" font-size="${fontSize}" font-family="${esc(BOARD_TYPEFACE)}" dominant-baseline="hanging" ${spanAttrs(style, ink)}${extra}>${esc(raw)}</text>`
      );
      x += w;
      continue;
    }
    if (!run.value) continue;
    const w = measureTextWidth(run.value, fontSize, style, (sz, st) => boardFont(sz, st));
    if (style.highlight) {
      parts.push(
        `<rect x="${x - 1}" y="${yTop - 1}" width="${w + 2}" height="${fontSize * 1.15}" fill="rgba(255, 226, 122, 0.42)"/>`
      );
    }
    parts.push(
      `<text x="${x}" y="${yTop}" font-size="${fontSize}" font-family="${esc(BOARD_TYPEFACE)}" dominant-baseline="hanging" ${spanAttrs(style, ink)}${extra}>${esc(run.value)}</text>`
    );
    x += w;
  }
  return { svg: parts.join(''), width: x - x0 };
}

function layoutTextLines(
  spans: RichSpan[],
  maxWidth: number,
  fontSize: number
): { pieces: RichSpan[]; width: number }[] {
  const measureRun = (run: RichSpan) => measureStyled(run.text, fontSize, run);
  const wrapped = wrapRichLines(spans, Math.max(8, maxWidth), measureRun);
  return wrapped.map((pieces) => {
    let width = 0;
    for (const p of pieces) width += measureRun(p);
    return { pieces, width };
  });
}

function emitLaidOutLines(
  lines: { pieces: RichSpan[]; width: number }[],
  boxX: number,
  boxW: number,
  startY: number,
  fontSize: number,
  lineHeight: number,
  align: TextAlign,
  ink: string,
  extra: string,
  maxBottom?: number
): string {
  const parts: string[] = [];
  let y = startY;
  for (const line of lines) {
    if (maxBottom !== undefined && y > maxBottom) break;
    const x0 =
      align === 'center' ? boxX + (boxW - line.width) / 2 : align === 'right' ? boxX + boxW - line.width : boxX;
    let x = x0;
    for (const piece of line.pieces) {
      const emitted = emitMixedLine(piece.text, x, y, fontSize, piece, ink, extra);
      parts.push(emitted.svg);
      x += emitted.width;
    }
    y += lineHeight;
  }
  return parts.join('');
}

function laidLinesForShape(
  v: ShapeView,
  boxW: number,
  fontSize: number
): { pieces: RichSpan[]; width: number }[] {
  const spans = parseStoredRich(v.text, v.richHtml, {
    bold: v.bold,
    italic: v.italic,
    underline: v.underline,
    strike: v.strike,
    highlight: v.highlight,
    color: v.textColor,
  });
  if (v.richHtml && v.richHtml.includes('<')) return layoutTextLines(spans, boxW, fontSize);
  const plain = v.text ?? '';
  const style: RichStyle = {
    bold: v.bold,
    italic: v.italic,
    underline: v.underline,
    strike: v.strike,
    highlight: v.highlight,
    color: v.textColor,
  };
  return wrapLinesByWidth(plain, Math.max(8, boxW), (s) => measureStyled(s, fontSize, style)).map((t) => ({
    pieces: [{ ...style, text: t }] as RichSpan[],
    width: measureStyled(t, fontSize, style),
  }));
}

function svgTextFromShape(
  v: ShapeView,
  boxX: number,
  boxW: number,
  startY: number,
  align: TextAlign,
  ink: string,
  extra: string,
  lineHeight: number,
  fontSize: number,
  maxBottom?: number
): string {
  return emitLaidOutLines(
    laidLinesForShape(v, boxW, fontSize),
    boxX,
    boxW,
    startY,
    fontSize,
    lineHeight,
    align,
    ink,
    extra,
    maxBottom
  );
}

function labelBox(v: ShapeView, x: number): { boxX: number; boxW: number } {
  const boxW = shapeLabelInnerWidth(v.type, v.w);
  return { boxW, boxX: x + (v.w - boxW) / 2 };
}

function label(v: ShapeView, x: number, y: number, extra: string, paper: string | null): string {
  if (!v.text && !(v.richHtml && v.richHtml.includes('<'))) return '';
  const size = v.fontSize ?? defaultFontSizeFor(v.type);
  const { boxX, boxW } = labelBox(v, x);
  const ink = exportTextInk(v, paper, SHAPE_INK);
  const align = v.textAlign ?? 'center';
  const lineHeight = size * LABEL_LINE_HEIGHT;
  const laid = laidLinesForShape(v, boxW, size);
  if (!laid.length || (laid.length === 1 && !laid[0]!.pieces.some((p) => p.text))) return '';
  const startY = y + v.h / 2 - ((laid.length - 1) * lineHeight) / 2 - size / 2;
  const body = emitLaidOutLines(laid, boxX, boxW, startY, size, lineHeight, align, ink, '', y + v.h - 8);
  if (!body) return '';
  const clipId = `lbl${Math.round(x * 10)}-${Math.round(y * 10)}-${v.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return `<g${extra} clip-path="url(#${clipId})"><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${v.w}" height="${v.h}"/></clipPath>${body}</g>`;
}

export function shapesToSvg(
  views: ShapeView[],
  opts: { background: string | null; inkPaper?: string | null; pad?: number; clip?: { x: number; y: number; w: number; h: number } }
): { svg: string; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  if (opts.clip) {
    minX = opts.clip.x;
    minY = opts.clip.y;
    maxX = opts.clip.x + opts.clip.w;
    maxY = opts.clip.y + opts.clip.h;
  } else {
    for (const v of views) {
      const b = boxOf(v);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 100;
    maxY = 100;
  }
  const pad = opts.pad ?? 8;
  const width = Math.max(1, Math.ceil(maxX - minX + pad * 2));
  const height = Math.max(1, Math.ceil(maxY - minY + pad * 2));
  const ox = -minX + pad;
  const oy = -minY + pad;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  );
  if (opts.background) {
    parts.push(`<rect width="100%" height="100%" fill="${esc(opts.background)}"/>`);
  }
  const inkPaper = opts.inkPaper ?? opts.background;
  for (const v of views) {
    try {
    const rot = shapeRotation(v);
    const cx = v.x + v.w / 2 + ox;
    const cy = v.y + v.h / 2 + oy;
    const xf = rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : '';
    const x = v.x + ox;
    const y = v.y + oy;
    const opacity = v.alpha !== undefined && v.alpha < 1 ? ` opacity="${v.alpha}"` : '';
    if (v.type === 'pen' && v.points && v.points.length >= 2) {
      if (v.points.length === 2) {
        const r = penDotRadius(v);
        parts.push(
          `<circle cx="${v.points[0] + ox}" cy="${v.points[1] + oy}" r="${r}" fill="${esc(exportStroke(v, inkPaper))}" stroke="none"${opacity}/>`
        );
        continue;
      }
      const d: string[] = [];
      for (let i = 0; i < v.points.length; i += 2) {
        d.push(`${i === 0 ? 'M' : 'L'}${v.points[i] + ox} ${v.points[i + 1] + oy}`);
      }
      parts.push(
        `<path d="${d.join(' ')}" fill="none" stroke="${esc(exportStroke(v, inkPaper))}" stroke-width="${v.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${opacity}/>`
      );
      continue;
    }
    if (v.type === 'arrow' && v.points && v.points.length >= 4) {
      const arrow = describeArrow(v, ox, oy);
      if (arrow) {
        const ink = exportStroke(v, inkPaper);
        parts.push(
          `<path d="${arrow.pathD}" fill="none" stroke="${esc(ink)}" stroke-width="${v.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${opacity}/>`
        );
        if (arrowHeadLength(v) > 0) {
          const [ex, ey, x1, y1, x2, y2] = arrow.head;
          parts.push(
            `<polygon points="${ex},${ey} ${x1},${y1} ${x2},${y2}" fill="${esc(ink)}" stroke="${esc(ink)}" stroke-width="${Math.max(1, v.strokeWidth / 2)}" stroke-linejoin="round"${opacity}/>`
          );
        }
      }
      continue;
    }
    if (v.type === 'ellipse') {
      parts.push(
        `<ellipse cx="${x + v.w / 2}" cy="${y + v.h / 2}" rx="${v.w / 2}" ry="${v.h / 2}" ${paint(v, `${opacity}${xf}`)}/>`
      );
      parts.push(label(v, x, y, xf, inkPaper));
      continue;
    }
    if (v.type === 'image' && v.src) {
      if (imageHasCrop(v)) {
        const f = cropFractions(v);
        if (!(f.x === 0 && f.y === 0 && f.w === 1 && f.h === 1)) {
          const full = uncroppedBox({ x, y, w: v.w, h: v.h, cropX: v.cropX, cropY: v.cropY, cropW: v.cropW, cropH: v.cropH });
          const clipId = `c${parts.length}`;
          parts.push(
            `<g${opacity}${xf}><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${v.w}" height="${v.h}"/></clipPath><image href="${esc(v.src)}" x="${full.x}" y="${full.y}" width="${full.w}" height="${full.h}" preserveAspectRatio="none" clip-path="url(#${clipId})"/></g>`
          );
          continue;
        }
      }
      parts.push(
        `<image href="${esc(v.src)}" x="${x}" y="${y}" width="${v.w}" height="${v.h}"${opacity}${xf}/>`
      );
      continue;
    }
    if (v.type === 'doc' && v.pages?.length) {
      const src = v.pages[docPageIndex(v.page, v.pages.length)] ?? v.pages[0];
      if (src) {
        parts.push(
          `<image href="${esc(src)}" x="${x}" y="${y}" width="${v.w}" height="${v.h}"${opacity}${xf}/>`
        );
      }
      continue;
    }
    if (v.type === 'text' || v.type === 'sticky') {
      const clipId = `t${parts.length}`;
      const size = v.fontSize ?? defaultFontSizeFor(v.type);
      const ink = exportTextInk(v, inkPaper, '#eceae4');
      const lineHeight = v.type === 'sticky' ? size * LABEL_LINE_HEIGHT : size * TEXT_LINE_HEIGHT;
      const align = v.textAlign ?? 'left';
      const pad = v.type === 'sticky' ? STICKY_TEXT_PAD : 0;
      const boxX = x + pad;
      const boxW = Math.max(8, v.w - pad * 2);
      const startY = y + pad;
      const body = svgTextFromShape(v, boxX, boxW, startY, align, ink, '', lineHeight, size, y + v.h - pad);
      const note =
        v.type === 'sticky'
          ? `<rect x="${x}" y="${y}" width="${v.w}" height="${v.h}" rx="8" fill="${esc(v.fill)}"${
              v.stroke.trim().toLowerCase() !== COLORS.stickyStroke.toLowerCase()
                ? ` stroke="${esc(v.stroke)}"`
                : ''
            }/>`
          : '';
      const clipped = body
        ? `<g clip-path="url(#${clipId})"><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${v.w}" height="${v.h}"/></clipPath>${body}</g>`
        : '';
      parts.push(`<g${opacity}${xf}>${note}${clipped}</g>`);
      continue;
    }
    if (v.type === 'table') {
      const g = tableGrid(v);
      const cumX = (i: number) => {
        let s = 0;
        for (let k = 0; k < i && k < g.colW.length; k++) s += g.colW[k];
        return s;
      };
      const cumY = (i: number) => {
        let s = 0;
        for (let k = 0; k < i && k < g.rowH.length; k++) s += g.rowH[k];
        return s;
      };
      const size = v.fontSize ?? 14;
      const ink = exportTextInk(v, inkPaper, SHAPE_INK);
      const gridSw = Math.min(v.strokeWidth, 1.5);
      const padX = TABLE_CELL_PAD_X;
      const padTop = TABLE_CELL_PAD_TOP;
      const lineHeight = size * TEXT_LINE_HEIGHT;
      const gridLines: string[] = [];
      for (let c = 1; c < g.cols; c++) {
        const lx = x + cumX(c) * v.w;
        gridLines.push(`M${lx} ${y}L${lx} ${y + v.h}`);
      }
      for (let r = 1; r < g.rows; r++) {
        const ly = y + cumY(r) * v.h;
        gridLines.push(`M${x} ${ly}L${x + v.w} ${ly}`);
      }
      const clipId = `tbl${parts.length}`;
      const cellParts: string[] = [];
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          const text = g.cells[r * g.cols + c];
          if (!text) continue;
          const cellW = g.colW[c] * v.w;
          const cellH = g.rowH[r] * v.h;
          const maxLines = Math.max(1, Math.floor((cellH - padTop * 1.5) / lineHeight));
          const boxW = Math.max(20, cellW - padX * 2);
          const cellStyle = tableCellStyle(v, r, g.header);
          const style: RichStyle = {
            bold: cellStyle.bold,
            italic: cellStyle.italic,
            underline: cellStyle.underline,
            strike: cellStyle.strike,
          };
          const wrapped = wrapLinesByWidth(text, boxW, (s) => measureStyled(s, size, style)).slice(0, maxLines);
          const startY = y + cumY(r) * v.h + padTop;
          const boxX = x + cumX(c) * v.w + padX;
          const laid = wrapped.map((t) => ({
            pieces: [{ ...style, text: t }] as RichSpan[],
            width: measureStyled(t, size, style),
          }));
          cellParts.push(
            emitLaidOutLines(
              laid,
              boxX,
              boxW,
              startY,
              size,
              lineHeight,
              cellStyle.textAlign,
              ink,
              '',
              startY + cellH - 4
            )
          );
        }
      }
      const grid =
        gridLines.length
          ? `<path d="${gridLines.join(' ')}" fill="none" stroke="${esc(v.stroke)}" stroke-width="${gridSw}"/>`
          : '';
      parts.push(
        `<g${opacity}${xf}><rect x="${x}" y="${y}" width="${v.w}" height="${v.h}" ${paint(v, '')}/>${grid}<g clip-path="url(#${clipId})"><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${v.w}" height="${v.h}"/></clipPath>${cellParts.join('')}</g></g>`
      );
      continue;
    }
    if (v.type === 'diamond') {
      parts.push(
        polygon(
          [
            [x + v.w / 2, y],
            [x + v.w, y + v.h / 2],
            [x + v.w / 2, y + v.h],
            [x, y + v.h / 2],
          ],
          v,
          `${opacity}${xf}`
        )
      );
      parts.push(label(v, x, y, xf, inkPaper));
      continue;
    }
    if (v.type === 'triangle') {
      parts.push(
        polygon(
          [
            [x + v.w / 2, y],
            [x, y + v.h],
            [x + v.w, y + v.h],
          ],
          v,
          `${opacity}${xf}`
        )
      );
      parts.push(label(v, x, y, xf, inkPaper));
      continue;
    }
    if (v.type === 'parallelogram') {
      const skew = v.w * 0.2;
      parts.push(
        polygon(
          [
            [x + skew, y],
            [x + v.w, y],
            [x + v.w - skew, y + v.h],
            [x, y + v.h],
          ],
          v,
          `${opacity}${xf}`
        )
      );
      parts.push(label(v, x, y, xf, inkPaper));
      continue;
    }
    if (v.type === 'hexagon') {
      const cy = y + v.h / 2;
      parts.push(
        polygon(
          [
            [x + v.w * 0.25, y],
            [x + v.w * 0.75, y],
            [x + v.w, cy],
            [x + v.w * 0.75, y + v.h],
            [x + v.w * 0.25, y + v.h],
            [x, cy],
          ],
          v,
          `${opacity}${xf}`
        )
      );
      parts.push(label(v, x, y, xf, inkPaper));
      continue;
    }
    if (v.type === 'display') {
      parts.push(
        polygon(
          [
            [x, y],
            [x + v.w * 0.85, y],
            [x + v.w, y + v.h / 2],
            [x + v.w * 0.85, y + v.h],
            [x, y + v.h],
          ],
          v,
          `${opacity}${xf}`
        )
      );
      parts.push(label(v, x, y, xf, inkPaper));
      continue;
    }
    if (v.type === 'terminator') {
      parts.push(
        `<rect x="${x}" y="${y}" width="${v.w}" height="${v.h}" rx="${Math.min(v.w, v.h) / 2}" ${paint(v, `${opacity}${xf}`)}/>`
      );
      parts.push(label(v, x, y, xf, inkPaper));
      continue;
    }
    if (v.type === 'subroutine') {
      const inset = 8;
      parts.push(
        `<rect x="${x}" y="${y}" width="${v.w}" height="${v.h}" rx="6" ${paint(v, `${opacity}${xf}`)}/>`
      );
      parts.push(
        `<path d="M${x + inset} ${y}L${x + inset} ${y + v.h}M${x + v.w - inset} ${y}L${x + v.w - inset} ${y + v.h}" fill="none" stroke="${esc(v.stroke)}" stroke-width="${v.strokeWidth}"${opacity}${xf}/>`
      );
      parts.push(label(v, x, y, xf, inkPaper));
      continue;
    }
    if (v.type === 'cylinder') {
      const ry = Math.min(v.h * 0.15, 18);
      const rx = v.w / 2;
      const cx = x + rx;
      const extra = `${opacity}${xf}`;
      parts.push(
        `<path d="M${x} ${y + ry} L${x} ${y + v.h - ry} A${rx} ${ry} 0 0 0 ${x + v.w} ${y + v.h - ry} L${x + v.w} ${y + ry} A${rx} ${ry} 0 0 1 ${x} ${y + ry} Z" ${paint(v, extra)}/>`
      );
      parts.push(
        `<ellipse cx="${cx}" cy="${y + ry}" rx="${rx}" ry="${ry}" fill="none" stroke="${esc(v.stroke)}" stroke-width="${v.strokeWidth}"${extra}/>`
      );
      parts.push(label(v, x, y, xf, inkPaper));
      continue;
    }
    if (v.type === 'frame') {
      const headerH = frameHeaderHeight(v.h);
      parts.push(
        `<rect x="${x}" y="${y}" width="${v.w}" height="${v.h}" rx="8" fill="${fillOf(v)}" stroke="${esc(v.stroke)}" stroke-width="${v.strokeWidth}" stroke-dasharray="8 6"${opacity}${xf}/>`
      );
      parts.push(
        `<rect x="${x}" y="${y}" width="${v.w}" height="${headerH}" rx="8" fill="${esc(v.stroke)}" opacity="0.25"${xf}/>`
      );
      const title = frameTitleLine(v.text);
      if (title) {
        const size = v.fontSize ?? defaultFontSizeFor('frame');
        const ink = exportTextInk(v, inkPaper, '#eceae4');
        const boxW = Math.max(20, v.w - FRAME_LABEL_PAD_X * 2);
        const clipId = `frm${parts.length}`;
        const body = svgTextFromShape(
          { ...v, text: title, richHtml: undefined },
          x + FRAME_LABEL_PAD_X,
          Math.max(boxW, 1e6),
          y + headerH / 2 - size / 2,
          'left',
          ink,
          '',
          size * LABEL_LINE_HEIGHT,
          size,
          y + headerH
        );
        parts.push(
          `<g${xf} clip-path="url(#${clipId})"><clipPath id="${clipId}"><rect x="${x + FRAME_LABEL_PAD_X}" y="${y}" width="${boxW}" height="${headerH}"/></clipPath>${body}</g>`
        );
      }
      continue;
    }
    if (v.type === 'graph') {
      const g = graphCurvePath(v, ox, oy);
      parts.push(
        `<rect x="${x}" y="${y}" width="${v.w}" height="${v.h}" rx="${g.radius}" ${paint(v, `${opacity}${xf}`)}/>`
      );
      parts.push(
        `<text x="${x + 8}" y="${y + 18}" font-size="12" fill="${esc(exportTextInk(v, inkPaper, SHAPE_INK))}"${xf}>${esc(g.exprLabel)}</text>`
      );
      if (g.d) {
        const clipId = `g${parts.length}`;
        const px = g.plot.x + ox;
        const py = g.plot.y + oy;
        parts.push(
          `<g${opacity}${xf}><clipPath id="${clipId}"><rect x="${px}" y="${py}" width="${g.plot.w}" height="${g.plot.h}"/></clipPath><path d="${g.d}" fill="none" stroke="${esc(exportStroke(v, inkPaper))}" stroke-width="${v.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#${clipId})"/></g>`
        );
      }
      continue;
    }
    if (v.type === 'calculator') {
      const label = (v.calcDisplay ?? '0').trim() || '0';
      const mode = v.calcMode === 'scientific' ? 'Scientific' : 'Standard';
      const paper = inkPaper ?? COLORS.background;
      const body = resolveCalcBodyFill(paper, v.fill);
      const bezel = resolveCalcStroke(paper);
      parts.push(
        `<rect x="${x}" y="${y}" width="${v.w}" height="${v.h}" rx="12" fill="${esc(body)}" stroke="${esc(bezel)}" stroke-width="1.5"${opacity}${xf}/>`
      );
      parts.push(
        `<text x="${x + 10}" y="${y + 18}" font-size="11" fill="${esc(exportTextInk({ ...v, fill: body, stroke: bezel }, inkPaper, SHAPE_INK))}"${xf}>${esc(mode)}</text>`
      );
      parts.push(
        `<text x="${x + v.w - 10}" y="${y + 48}" font-size="16" text-anchor="end" fill="${esc(exportTextInk({ ...v, fill: body, stroke: bezel }, inkPaper, SHAPE_INK))}"${xf}>${esc(label)}</text>`
      );
      continue;
    }
    parts.push(
      `<rect x="${x}" y="${y}" width="${v.w}" height="${v.h}" rx="${v.cornerRadius === undefined ? 6 : Math.max(0, v.cornerRadius)}" ${paint(v, `${opacity}${xf}`)}/>`
    );
    parts.push(label(v, x, y, xf, inkPaper));
    } catch (err) {
      // ponytail: one bad shape must not kill the whole export
      console.warn('[review] svg export skipped shape', v.id, v.type, err);
    }
  }
  parts.push('</svg>');
  return { svg: parts.join(''), width, height };
}

/** Build a one-page PDF that embeds a JPEG (DCT) image. No external deps. */
export function jpegToPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const encoder = new TextEncoder();
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const imgObj = add(
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
  );
  // stream bytes appended later
  const contentStream = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\n`;
  const contents = add(
    `<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream`
  );
  const resources = add(`<< /ProcSet [/PDF /ImageC] /XObject << /Im0 ${imgObj} 0 R >> >>`);
  const page = add(
    `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${contents} 0 R /Resources ${resources} 0 R >>`
  );
  const pages = add(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  // fix parent ref in page
  objects[page - 1] = objects[page - 1].replace('/Parent 0 0 R', `/Parent ${pages} 0 R`);
  const catalog = add(`<< /Type /Catalog /Pages ${pages} 0 R >>`);

  const chunks: Uint8Array[] = [];
  const pushStr = (s: string) => chunks.push(encoder.encode(s));
  pushStr('%PDF-1.4\n');
  const offsets: number[] = [0];
  let offset = chunks.reduce((n, c) => n + c.length, 0);
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset);
    const id = i + 1;
    if (id === imgObj) {
      const head = `${id} 0 obj\n${objects[i]}`;
      pushStr(head);
      offset += encoder.encode(head).length;
      chunks.push(jpeg);
      offset += jpeg.length;
      // Stream length is jpeg.length — do not prefix endstream with a newline.
      pushStr('endstream\nendobj\n');
      offset += encoder.encode('endstream\nendobj\n').length;
    } else {
      const body = `${id} 0 obj\n${objects[i]}\nendobj\n`;
      pushStr(body);
      offset += encoder.encode(body).length;
    }
  }
  const xrefStart = offset;
  pushStr(`xref\n0 ${objects.length + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i <= objects.length; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
