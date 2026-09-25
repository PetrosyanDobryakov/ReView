import { isOrbitPaper, ORBIT_COLORS } from '../core/orbit';

/** Full target-lock sequence on a new selection: converge, lock flash, hold, fade. */
export const ORBIT_LOCK_MS = 1100;

/** Dot tiers: each is 5x the previous spacing (same ladder as the line grid). */
const DOT_TIERS = 3;
/** Screen spacing (px) where a tier starts to appear, becomes a regular dot, becomes a major dot. */
const DOT_APPEAR = 48;
const DOT_REGULAR = 240;
const DOT_MAJOR = 1200;
const DOT_ALPHA = 0.2;
const DOT_ALPHA_MAJOR = 0.42;
const DOT_RGB = '169, 175, 185';

function ease(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

/** Alpha and size of a dot tier purely from its on-screen spacing — continuous in zoom. */
function dotLook(spacingPx: number): { alpha: number; size: number } {
  if (spacingPx < DOT_REGULAR) {
    const k = ease((spacingPx - DOT_APPEAR) / (DOT_REGULAR - DOT_APPEAR));
    return { alpha: DOT_ALPHA * k, size: 1.5 };
  }
  const k = ease((spacingPx - DOT_REGULAR) / (DOT_MAJOR - DOT_REGULAR));
  return { alpha: DOT_ALPHA + (DOT_ALPHA_MAJOR - DOT_ALPHA) * k, size: 1.5 + k };
}

/**
 * Orbit grid: a dot lattice instead of lines. Three tiers (x5 apart); each
 * tier's brightness and size follow its own screen spacing, so zooming fades
 * dots in and promotes them to majors smoothly instead of snapping between
 * ladder steps. Dots are screen-sized squares.
 */
export function drawOrbitDotGrid(
  ctx: CanvasRenderingContext2D,
  opts: { cx: number; cy: number; zoom: number; viewW: number; viewH: number }
): void {
  const { cx, cy, zoom: z, viewW, viewH } = opts;
  const w = viewW / z;
  const h = viewH / z;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  // Finest tier whose spacing has reached the appear threshold.
  let step = 50;
  while (step * z < DOT_APPEAR) step *= 5;
  while (step * z >= DOT_APPEAR * 5) step /= 5;

  ctx.save();
  for (let tier = 0; tier < DOT_TIERS; tier++) {
    const sp = step * Math.pow(5, tier);
    const next = sp * 5;
    const last = tier === DOT_TIERS - 1;
    const { alpha, size } = dotLook(sp * z);
    if (alpha <= 0.005) continue;
    const d = size / z;
    ctx.fillStyle = `rgba(${DOT_RGB}, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    for (let x = Math.floor(x0 / sp) * sp; x <= x0 + w; x += sp) {
      const onNextX = !last && Math.abs(x / next - Math.round(x / next)) < 1e-4;
      for (let y = Math.floor(y0 / sp) * sp; y <= y0 + h; y += sp) {
        // A dot belongs to the coarsest tier it sits on.
        if (onNextX && Math.abs(y / next - Math.round(y / next)) < 1e-4) continue;
        ctx.rect(x - d / 2, y - d / 2, d, d);
      }
    }
    ctx.fill();
  }
  ctx.restore();
}

/** Selection chrome (lock, marquee, lasso): neutral steel gray, matches --chrome-selection. */
const SELECT = '#B4B9C2';
const SELECT_RGB = '180, 185, 194';
/** Same stack as the chrome (see index.css body). */
const ORBIT_LABEL_FONT = "'Space Grotesk', Onest, 'Segoe UI', ui-sans-serif, system-ui, sans-serif";

/** Short outward ticks at the four corners of a box. */
function cornerTicks(ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number; h: number }, s: number, len: number): void {
  const o = 3 * s;
  const L = len * s;
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of [
    [b.x, b.y, -1, -1],
    [b.x + b.w, b.y, 1, -1],
    [b.x + b.w, b.y + b.h, 1, 1],
    [b.x, b.y + b.h, -1, 1],
  ] as const) {
    ctx.moveTo(cx + dx * o, cy + dy * o);
    ctx.lineTo(cx + dx * (o + L), cy + dy * (o + L));
  }
  ctx.stroke();
}

/**
 * Target lock on a new selection: four steel-gray corner brackets converge
 * onto the box, blink white once on lock, hold, then fade, with the size
 * readout under the box. No moving light, nothing that can tear on a rotated
 * or tiny box. `t` is progress 0..1, `s` is 1/zoom; `box` is in the shape's
 * rotated frame.
 */
export function drawOrbitLock(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  t: number,
  s: number,
  label: string
): void {
  const CONVERGE = 0.3;
  const BLINK = 0.42;
  const FADE = 0.7;
  const k = Math.min(1, t / CONVERGE);
  const ease = 1 - Math.pow(1 - k, 3);
  const gap = (1 - ease) * 18 * s;
  const alpha = t < CONVERGE ? k : t < FADE ? 1 : 1 - (t - FADE) / (1 - FADE);
  const blink = t >= CONVERGE && t < BLINK;
  const arm = Math.min(12 * s, box.w / 3, box.h / 3);
  const x0 = box.x - gap;
  const y0 = box.y - gap;
  const x1 = box.x + box.w + gap;
  const y1 = box.y + box.h + gap;
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.strokeStyle = blink ? '#FFFFFF' : SELECT;
  ctx.lineWidth = (blink ? 2 : 1.5) * s;
  ctx.lineCap = 'square';
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x1, y1, -1, -1],
    [x0, y1, 1, -1],
  ] as const) {
    ctx.moveTo(cx + dx * arm, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * arm);
  }
  ctx.stroke();
  if (t >= CONVERGE) {
    ctx.font = `500 ${10 * s}px ${ORBIT_LABEL_FONT}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = SELECT;
    ctx.globalAlpha = Math.max(0, alpha) * 0.9;
    ctx.fillText(label, box.x, box.y + box.h + 7 * s);
  }
  ctx.restore();
}

/** Orbit rubber band: faint gray fill, hairline edge, corner ticks, live size. */
export function drawOrbitMarquee(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  s: number
): void {
  const { x, y, w, h } = box;
  ctx.save();
  ctx.fillStyle = `rgba(${SELECT_RGB}, 0.06)`;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = `rgba(${SELECT_RGB}, 0.7)`;
  ctx.lineWidth = 1 * s;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = SELECT;
  ctx.lineWidth = 1.5 * s;
  ctx.lineCap = 'round';
  cornerTicks(ctx, box, s, 6);
  if (w > 24 * s && h > 12 * s) {
    ctx.globalAlpha = 0.9;
    ctx.font = `500 ${10 * s}px ${ORBIT_LABEL_FONT}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    ctx.fillStyle = SELECT;
    ctx.fillText(`${Math.round(w)} × ${Math.round(h)}`, x + w, y + h + 8 * s);
  }
  ctx.restore();
}

/**
 * Orbit lasso: one clean gray hairline over a faint fill, a dotted closing
 * chord, a ring at the start and a small lit head at the pen.
 */
export function drawOrbitLasso(
  ctx: CanvasRenderingContext2D,
  pts: ReadonlyArray<{ x: number; y: number }>,
  s: number
): void {
  if (pts.length < 2) return;
  const first = pts[0];
  const last = pts[pts.length - 1];
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.fillStyle = `rgba(${SELECT_RGB}, 0.06)`;
  ctx.fill();
  ctx.strokeStyle = SELECT;
  ctx.lineWidth = 1.25 * s;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(last.x, last.y);
  ctx.lineTo(first.x, first.y);
  ctx.strokeStyle = `rgba(${SELECT_RGB}, 0.35)`;
  ctx.lineWidth = 1 * s;
  ctx.setLineDash([1 * s, 5 * s]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(first.x, first.y, 3 * s, 0, Math.PI * 2);
  ctx.fillStyle = ORBIT_COLORS.void;
  ctx.fill();
  ctx.strokeStyle = SELECT;
  ctx.lineWidth = 1.25 * s;
  ctx.stroke();
  ctx.fillStyle = `rgba(${SELECT_RGB}, 0.25)`;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(last.x, last.y, 1.8 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Orbit "marked for delete" (whole-object eraser preview): red abort brackets
 * around the object and a fine diagonal hatch over it, instead of a dashed box.
 * Drawn in the shape's rotated frame; `s` is 1/zoom.
 */
export function drawOrbitEraseMark(
  ctx: CanvasRenderingContext2D,
  v: { x: number; y: number; w: number; h: number },
  s: number
): void {
  const pad = 4 * s;
  const x = v.x - pad;
  const y = v.y - pad;
  const w = v.w + pad * 2;
  const h = v.h + pad * 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 95, 109, 0.07)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255, 95, 109, 0.4)';
  ctx.lineWidth = 1 * s;
  const step = 7 * s;
  ctx.beginPath();
  for (let d = -h; d < w; d += step) {
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
  }
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = ORBIT_COLORS.abort;
  ctx.lineWidth = 1.5 * s;
  ctx.lineCap = 'square';
  const arm = Math.min(12 * s, w / 3, h / 3);
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x + w, y + h, -1, -1],
    [x, y + h, 1, -1],
  ] as const) {
    ctx.moveTo(cx + dx * arm, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * arm);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Orbit eraser reticle: thin ring, four inward ticks, center pip. Turns abort
 * red while it is over something it will delete. `turn` rotates the ticks with
 * the stroke so the reticle feels alive without a timer.
 */
export function drawOrbitEraser(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  s: number,
  hot: boolean,
  turn: number
): void {
  const color = hot ? ORBIT_COLORS.abort : ORBIT_COLORS.white;
  ctx.save();
  ctx.fillStyle = hot ? 'rgba(255, 95, 109, 0.08)' : 'rgba(242, 244, 247, 0.04)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.25 * s;
  ctx.stroke();
  const tick = Math.min(8 * s, r * 0.4);
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = turn + (i * Math.PI) / 2;
    const c = Math.cos(a);
    const n = Math.sin(a);
    ctx.moveTo(x + c * r, y + n * r);
    ctx.lineTo(x + c * (r - tick), y + n * (r - tick));
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 1.5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function orbitPaperActive(paperTo: string, paperFill: string): boolean {
  return isOrbitPaper(paperTo) || isOrbitPaper(paperFill);
}
