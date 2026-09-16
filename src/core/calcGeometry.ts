/** Calculator board-frame geometry (shared by silhouette, overlay, SelectTool). */

/** Default / reference keypad frame (create click size + silhouette scale). */
export const CALC_REF_W = 340;
export const CALC_REF_H = 520;
/** Minimum usable keypad size (design: keys stay hittable). */
export const CALC_MIN_W = 240;
export const CALC_MIN_H = 360;

/**
 * Shared CSS/canvas zoom floor for key labels.
 * Overlay sets `--calc-zoom` from `calcCssZoom`; silhouette uses `calcLabelWorldSize`
 * with the same min screen px so open/closed stop shrinking together (no staggered floors).
 * Engine currently paints with dpr=1; floor is in CSS/screen pixels, not device pixels.
 */
export const CALC_LABEL_MIN_SCREEN_PX = 10;
/** Floor for `--calc-zoom` (= cameraZoom × frameScale). ~0.55 ≈ readable at far zoom. */
export const CALC_CSS_ZOOM_FLOOR = 0.55;

/** Clamp calculator frame so resize cannot crush the keypad. */
export function clampCalcSize(w: number, h: number): { w: number; h: number } {
  return {
    w: Math.max(CALC_MIN_W, w),
    h: Math.max(CALC_MIN_H, h),
  };
}

/** Layout scale vs reference frame (independent of camera zoom). */
export function calcFrameScale(w: number, h: number): number {
  return Math.min(
    2.2,
    Math.max(0.45, Math.sqrt((Math.max(80, w) * Math.max(60, h)) / (CALC_REF_W * CALC_REF_H)))
  );
}

/** Effective overlay scale: tracks zoom×frame until the shared readability floor. */
export function calcCssZoom(cameraZoom: number, frameScale: number): number {
  const raw = Math.max(0, cameraZoom) * Math.max(0, frameScale);
  return Math.max(CALC_CSS_ZOOM_FLOOR, raw);
}

/**
 * World-space font size that tracks design×frame, then floors so on-screen size
 * stays ≥ CALC_LABEL_MIN_SCREEN_PX at the given camera zoom (from ctx transform).
 */
export function calcLabelWorldSize(designPx: number, frameScale: number, cameraZoom: number): number {
  const designed = Math.max(1, designPx * frameScale);
  const minWorld = CALC_LABEL_MIN_SCREEN_PX / Math.max(1e-6, cameraZoom);
  return Math.max(designed, minWorld);
}

/** Read uniform scale from a canvas transform (camera zoom after Engine's scale(z,z)). */
export function calcCtxZoom(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): number {
  const m = ctx.getTransform();
  return Math.max(1e-6, Math.hypot(m.a, m.b));
}
