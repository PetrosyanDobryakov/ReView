import { isOrbitPaper } from '../core/orbit';

/**
 * Quiet Orbit board accents — sparse pin lights only.
 * Main look is the WebGL Violet Swirl atmosphere under a transparent canvas.
 */
export function drawOrbitPaperField(
  ctx: CanvasRenderingContext2D,
  opts: {
    cx: number;
    cy: number;
    zoom: number;
    viewW: number;
    viewH: number;
    now: number;
    reduceMotion: boolean;
  }
): void {
  const { cx, cy, zoom, viewW, viewH, now, reduceMotion } = opts;
  const w = viewW / zoom;
  const h = viewH / zoom;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const t = reduceMotion ? 0 : now * 0.001;

  const cell = Math.max(120, Math.min(560, 140 / Math.min(Math.max(zoom, 0.12), 1.8)));
  const ix0 = Math.floor(x0 / cell) - 1;
  const iy0 = Math.floor(y0 / cell) - 1;
  const ix1 = Math.ceil((x0 + w) / cell) + 1;
  const iy1 = Math.ceil((y0 + h) / cell) + 1;
  const maxCells = 420;
  const cols = ix1 - ix0 + 1;
  const rows = iy1 - iy0 + 1;
  const stride = cols * rows > maxCells ? Math.ceil(Math.sqrt((cols * rows) / maxCells)) : 1;

  for (let iy = iy0; iy <= iy1; iy += stride) {
    for (let ix = ix0; ix <= ix1; ix += stride) {
      const n = hash2(ix, iy);
      if (n > 0.06) continue;
      const px = ix * cell + (hash2(ix, iy + 17) - 0.5) * cell * 0.65;
      const py = iy * cell + (hash2(ix + 31, iy) - 0.5) * cell * 0.65;
      const bright = 0.03 + (1 - n / 0.06) * 0.07;
      const pulse = reduceMotion ? 1 : 0.78 + 0.22 * Math.sin(t * 1.1 + n * 36);
      const r = (0.45 + n * 1.0) / zoom;
      ctx.fillStyle = `rgba(145, 107, 191, ${bright * pulse})`;
      const s = Math.max(0.35 / zoom, r);
      ctx.beginPath();
      ctx.arc(px, py, s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Light screen vignette — keep Warp readable. */
export function drawOrbitPaperScreen(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  _now: number,
  _reduceMotion: boolean
): void {
  const vignette = ctx.createRadialGradient(w * 0.5, h * 0.42, h * 0.18, w * 0.5, h * 0.5, h * 0.95);
  vignette.addColorStop(0, 'rgba(2, 1, 10, 0)');
  vignette.addColorStop(0.7, 'rgba(2, 1, 10, 0)');
  vignette.addColorStop(1, 'rgba(2, 1, 10, 0.35)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

export function orbitPaperActive(paperTo: string, paperFill: string): boolean {
  return isOrbitPaper(paperTo) || isOrbitPaper(paperFill);
}

export function orbitGridColor(): string {
  return 'rgba(145, 107, 191, 0.1)';
}

function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
