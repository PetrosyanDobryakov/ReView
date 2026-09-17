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

/**
 * Lucide stroke-width in the 24 viewBox. Kept constant in viewBox units so the
 * path scale (`box/24`) yields a zoom-stable screen stroke — same pattern as
 * selection chrome using `lineWidth * s` in world space.
 *
 * Do **not** multiply by camera `s` (`1/zoom`) here: radius already scales with
 * `s`, so `lineWidth = 2 * s` under `ctx.scale(box/24)` made world stroke ∝ s²
 * and collapsed the glyph into overlapping blobs when zoomed out.
 */
export const ROTATE_CW_STROKE = 2;

/** Inline SVG source (asset / docs). Paint uses Path2D of the same paths. */
export const ROTATE_CW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ROTATE_CW_VIEW} ${ROTATE_CW_VIEW}" fill="none" stroke="currentColor" stroke-width="${ROTATE_CW_STROKE}" stroke-linecap="round" stroke-linejoin="round"><path d="${ROTATE_CW_ARC}"/><path d="${ROTATE_CW_HEAD}"/></svg>`;

/** Lazy Path2D so Node tests can import math helpers without a canvas DOM. */
let arcPath: Path2D | null = null;
let headPath: Path2D | null = null;

function rotateCwPaths(): { arc: Path2D; head: Path2D } {
  if (!arcPath) arcPath = new Path2D(ROTATE_CW_ARC);
  if (!headPath) headPath = new Path2D(ROTATE_CW_HEAD);
  return { arc: arcPath, head: headPath };
}

/**
 * Screen-px stroke thickness for a given icon half-size and camera scale
 * `s = 1/zoom` (world units per CSS pixel). Used by tests + docs.
 */
export function rotateCwScreenStrokePx(iconRadiusWorld: number, cameraS: number): number {
  if (!(cameraS > 0) || !(iconRadiusWorld > 0)) return 0;
  const pathScale = (iconRadiusWorld * 2) / ROTATE_CW_VIEW;
  const worldStroke = ROTATE_CW_STROKE * pathScale;
  return worldStroke / cameraS;
}

/**
 * Stroke the rotate-cw icon centered at the current transform origin.
 * `radius` is half the icon’s visual box in current user units (handle size).
 *
 * `lineWidthScale` is accepted for call-site compatibility with selection chrome
 * (`s = 1/zoom`) but is **ignored** — stroke width is viewBox-constant so it
 * tracks icon size (already ∝ `s`) rather than stacking another `s` factor.
 */
export function strokeRotateCwIcon(
  ctx: CanvasRenderingContext2D,
  radius: number,
  strokeStyle: string,
  _lineWidthScale = 1
): void {
  const box = radius * 2;
  const pathScale = box / ROTATE_CW_VIEW;
  const { arc, head } = rotateCwPaths();
  ctx.save();
  ctx.scale(pathScale, pathScale);
  ctx.translate(-ROTATE_CW_VIEW / 2, -ROTATE_CW_VIEW / 2);
  ctx.strokeStyle = strokeStyle;
  ctx.fillStyle = 'transparent';
  ctx.lineWidth = ROTATE_CW_STROKE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(arc);
  ctx.stroke(head);
  ctx.restore();
}
