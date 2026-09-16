/**
 * Brand-new selection rotate affordance — standard clockwise rotate arrow.
 * Lucide-style `rotate-cw` geometry (24×24 viewBox). Not derived from the
 * legacy swirl / “C” / hand-tuned arc glyph.
 */

/** Arc that sweeps clockwise into the arrow elbow. */
export const ROTATE_CW_ARC =
  'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8';

/** Arrowhead elbow (corner of the rotate affordance). */
export const ROTATE_CW_HEAD = 'M21 3v5h-5';

export const ROTATE_CW_VIEW = 24;

/**
 * Paint radius as a multiple of selection handle radius (`hr`).
 * Shared by top-middle and corner placements via `paintRotateKnob`.
 */
export const ROTATE_CW_ICON_RADIUS_SCALE = 1.28;

/** Soft disc radius multiple of `hr` (frames the glyph). */
export const ROTATE_CW_DISC_RADIUS_SCALE = 2.0;

/** Inline SVG source (asset / docs). Paint uses Path2D of the same paths. */
export const ROTATE_CW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ROTATE_CW_VIEW} ${ROTATE_CW_VIEW}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ROTATE_CW_ARC}"/><path d="${ROTATE_CW_HEAD}"/></svg>`;

const arcPath = /* @__PURE__ */ new Path2D(ROTATE_CW_ARC);
const headPath = /* @__PURE__ */ new Path2D(ROTATE_CW_HEAD);

/**
 * Stroke the rotate-cw icon centered at the current transform origin.
 * `radius` is half the icon’s visual box in current user units (handle size).
 */
export function strokeRotateCwIcon(
  ctx: CanvasRenderingContext2D,
  radius: number,
  strokeStyle: string,
  lineWidthScale = 1
): void {
  const box = radius * 2;
  const s = box / ROTATE_CW_VIEW;
  ctx.save();
  ctx.scale(s, s);
  ctx.translate(-ROTATE_CW_VIEW / 2, -ROTATE_CW_VIEW / 2);
  ctx.strokeStyle = strokeStyle;
  ctx.fillStyle = 'transparent';
  ctx.lineWidth = Math.max(1.5, 2 * lineWidthScale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(arcPath);
  ctx.stroke(headPath);
  ctx.restore();
}
