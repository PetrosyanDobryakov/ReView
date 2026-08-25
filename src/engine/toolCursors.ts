import type { ToolId } from './tools';
import {
  ICON_NUDGE,
  ICON_PATHS,
  LASSO_HANDLE,
  LASSO_NUDGE,
  type IconName,
} from '../ui/icons';
import { readPrefs } from '../core/prefs';
import { viewPaperBg } from '../core/store';

type CursorSpec = {
  icon?: IconName;
  body?: (stroke: string) => string;
  view?: number;
  hx: number;
  hy: number;
};

const PEN_FIT = 'translate(12 12) scale(0.86) translate(-12 -12)';

/** Muted adaptive stroke — softer than board text (#1c1c1a / #eceae4). */
const STROKE_ON_LIGHT = '#6e6c66';
const STROKE_ON_DARK = '#a8a59c';

function cursorStroke(bg: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(bg)) return STROKE_ON_DARK;
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? STROKE_ON_LIGHT : STROKE_ON_DARK;
}

const STROKE = (c: string, w = 2) =>
  `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

/** Same markup as `Icon` for lasso — loop + handle + optical nudge. */
function lassoBody(pad: number, stroke: string): string {
  const [nx, ny] = LASSO_NUDGE;
  return (
    `<g transform="translate(${pad} ${pad}) translate(${nx} ${ny})" ${STROKE(stroke)}>` +
    `<path d="${ICON_PATHS.lasso}"/>` +
    `<path d="${LASSO_HANDLE}"/>` +
    '</g>'
  );
}

function iconBody(name: IconName, stroke: string): string {
  const nudge = ICON_NUDGE[name];
  const inner =
    name === 'pen'
      ? `<g transform="${PEN_FIT}"><path d="${ICON_PATHS.pen}"/></g>`
      : name === 'lasso'
        ? `<path d="${ICON_PATHS.lasso}"/><path d="${LASSO_HANDLE}"/>`
        : `<path d="${ICON_PATHS[name]}"/>`;
  const content = nudge
    ? `<g transform="translate(${nudge[0]} ${nudge[1]})">${inner}</g>`
    : inner;
  return `<g ${STROKE(stroke)}>${content}</g>`;
}

const SPECS: Partial<Record<ToolId, CursorSpec>> = {
  select: { icon: 'select', hx: 5, hy: 4 },
  lasso: {
    view: 40,
    hx: 12,
    hy: 28,
    body: (stroke) => lassoBody(8, stroke),
  },
  pen: {
    view: 32,
    hx: 6,
    hy: 26,
    body: (stroke) =>
      `<g transform="translate(4 2) scale(1.05)" ${STROKE(stroke)}><path d="${ICON_PATHS.pen}"/></g>`,
  },
  eraser: { icon: 'eraser', hx: 5, hy: 19 },
  rect: { icon: 'rect', hx: 12, hy: 12 },
  ellipse: { icon: 'ellipse', hx: 12, hy: 12 },
  sticky: { icon: 'sticky', hx: 12, hy: 12 },
  text: { icon: 'text', hx: 12, hy: 12 },
  arrow: { icon: 'arrow', hx: 12, hy: 12 },
  graph: { icon: 'graph', hx: 12, hy: 12 },
  diamond: { icon: 'diamond', hx: 12, hy: 12 },
  frame: { icon: 'frame', hx: 12, hy: 12 },
  triangle: { icon: 'triangle', hx: 12, hy: 12 },
  parallelogram: { icon: 'parallelogram', hx: 12, hy: 12 },
  hexagon: { icon: 'hexagon', hx: 12, hy: 12 },
  cylinder: { icon: 'cylinder', hx: 12, hy: 12 },
  terminator: { icon: 'terminator', hx: 12, hy: 12 },
  subroutine: { icon: 'subroutine', hx: 12, hy: 12 },
  display: { icon: 'display', hx: 12, hy: 12 },
};

const cache = new Map<string, string>();

function svgFor(spec: CursorSpec, pixelSize: number, stroke: string): string {
  const view = spec.view ?? 24;
  const body = spec.body
    ? spec.body(stroke)
    : spec.icon
      ? iconBody(spec.icon, stroke)
      : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelSize}" height="${pixelSize}" viewBox="0 0 ${view} ${view}">` +
    body +
    `</svg>`
  );
}

/** CSS `cursor` value for a tool, or null when the tool keeps its keyword cursor. */
export function cursorCssForTool(id: ToolId): string | null {
  const spec = SPECS[id];
  if (!spec) return null;
  const scale = readPrefs().toolCursorScale;
  const bg = viewPaperBg();
  const stroke = cursorStroke(bg);
  const view = spec.view ?? 24;
  const key = `${id}:${stroke}:${scale}:${view}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pixelSize = Math.max(16, Math.round(view * scale));
  const hx = Math.max(0, Math.min(pixelSize - 1, Math.round(spec.hx * scale)));
  const hy = Math.max(0, Math.min(pixelSize - 1, Math.round(spec.hy * scale)));
  const url = `url("data:image/svg+xml,${encodeURIComponent(svgFor(spec, pixelSize, stroke))}") ${hx} ${hy}, crosshair`;
  cache.set(key, url);
  return url;
}

export function clearToolCursorCache(): void {
  cache.clear();
}
