/** Calculator board-frame geometry (shared by silhouette, overlay, SelectTool). */

/** Default / reference keypad frame (create click size + silhouette scale). */
export const CALC_REF_W = 340;
export const CALC_REF_H = 520;
/** Minimum usable keypad size (design: keys stay hittable). */
export const CALC_MIN_W = 240;
export const CALC_MIN_H = 360;

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
