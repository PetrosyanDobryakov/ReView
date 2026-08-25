import type { ToolId } from './tools';
import { ICON_PATHS, type IconName } from '../ui/icons';
import { readPrefs } from '../core/prefs';

type CursorSpec = {
  icon?: IconName;
  /** Custom body markup inside the viewBox (overrides icon). */
  body?: string;
  /** Square viewBox size. Default 24. Use larger + inset art so strokes aren't clipped. */
  view?: number;
  hx: number;
  hy: number;
  fill?: boolean;
};

/** Same handle path as `Icon` for `lasso` in icons.tsx. */
const LASSO_HANDLE = 'M7.2 16.8c-1.3 2.2-2.9 3.8-3.6 3.8';
const PEN_FIT = 'translate(12 12) scale(0.86) translate(-12 -12)';

/** Tools that use a custom SVG cursor (pan keeps grab / grabbing). */
const SPECS: Partial<Record<ToolId, CursorSpec>> = {
  select: { icon: 'select', hx: 5, hy: 4, fill: true },
  // Exact toolbelt glyph (dashed loop + handle), padded in 32² so the tip isn't clipped.
  lasso: {
    view: 32,
    hx: 8,
    hy: 24,
    body:
      '<g transform="translate(4 3)" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
      `<path d="${ICON_PATHS.lasso}" stroke="#eceae4" stroke-width="2.2" stroke-dasharray="3.25 2.7"/>` +
      `<path d="${LASSO_HANDLE}" stroke="#eceae4" stroke-width="2.2"/>` +
      `<path d="${ICON_PATHS.lasso}" stroke="#1c1c1a" stroke-width="1.5" stroke-dasharray="3.25 2.7"/>` +
      `<path d="${LASSO_HANDLE}" stroke="#1c1c1a" stroke-width="1.5"/>` +
      '</g>',
  },
  // Nudge tip off the absolute corner so the nib outline isn't clipped.
  pen: {
    view: 32,
    hx: 6,
    hy: 26,
    body:
      '<g transform="translate(4 2) scale(1.05)">' +
      '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" fill="#1c1c1a" stroke="#eceae4" stroke-width="0.85" stroke-linejoin="round"/>' +
      '</g>',
  },
  eraser: { icon: 'eraser', hx: 5, hy: 19, fill: true },
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

function svgFor(spec: CursorSpec, pixelSize: number): string {
  const view = spec.view ?? 24;

  if (spec.body) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelSize}" height="${pixelSize}" viewBox="0 0 ${view} ${view}">` +
      spec.body +
      `</svg>`
    );
  }

  const icon = spec.icon;
  if (!icon) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelSize}" height="${pixelSize}" viewBox="0 0 ${view} ${view}"/>`;
  }

  const stroke = spec.fill
    ? `fill="#1c1c1a" stroke="#eceae4" stroke-width="0.85"`
    : `fill="none" stroke="#1c1c1a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`;
  const outline = spec.fill
    ? ''
    : `<path d="${ICON_PATHS[icon]}" fill="none" stroke="#eceae4" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;

  let body: string;
  if (icon === 'pen') {
    body = `<g transform="${PEN_FIT}"><path d="${ICON_PATHS.pen}" ${stroke} stroke-linejoin="round"/></g>`;
  } else if (spec.fill) {
    body = `<path d="${ICON_PATHS[icon]}" ${stroke} stroke-linejoin="round"/>`;
  } else {
    body = `${outline}<path d="${ICON_PATHS[icon]}" ${stroke}/>`;
  }

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
  const view = spec.view ?? 24;
  const key = `${id}:${scale}:${view}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pixelSize = Math.max(16, Math.round(view * scale));
  const hx = Math.max(0, Math.min(pixelSize - 1, Math.round(spec.hx * scale)));
  const hy = Math.max(0, Math.min(pixelSize - 1, Math.round(spec.hy * scale)));
  const url = `url("data:image/svg+xml,${encodeURIComponent(svgFor(spec, pixelSize))}") ${hx} ${hy}, crosshair`;
  cache.set(key, url);
  return url;
}

export function clearToolCursorCache(): void {
  cache.clear();
}
