import { ORBIT_PAPER } from '../core/orbit';

/**
 * Orbit board paper — camera-locked star field + soft orbital rings under ink.
 * Pure black / crimson / white only. Extremely quiet so drawing stays primary.
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

  // World-space cell hash stars (infinite board, no allocation).
  // Cell size tracks zoom so screen density stays ~constant and zoomed-out stays cheap.
  const cell = Math.max(64, Math.min(520, 88 / Math.min(Math.max(zoom, 0.12), 1.8)));
  const ix0 = Math.floor(x0 / cell) - 1;
  const iy0 = Math.floor(y0 / cell) - 1;
  const ix1 = Math.ceil((x0 + w) / cell) + 1;
  const iy1 = Math.ceil((y0 + h) / cell) + 1;
  const maxCells = 900;
  const cols = ix1 - ix0 + 1;
  const rows = iy1 - iy0 + 1;
  const stride = cols * rows > maxCells ? Math.ceil(Math.sqrt((cols * rows) / maxCells)) : 1;

  for (let iy = iy0; iy <= iy1; iy += stride) {
    for (let ix = ix0; ix <= ix1; ix += stride) {
      const n = hash2(ix, iy);
      if (n > 0.18) continue;
      const px = ix * cell + (hash2(ix, iy + 17) - 0.5) * cell * 0.7;
      const py = iy * cell + (hash2(ix + 31, iy) - 0.5) * cell * 0.7;
      const bright = 0.04 + (1 - n / 0.18) * 0.1;
      const pulse = reduceMotion ? 1 : 0.75 + 0.25 * Math.sin(t * 1.4 + n * 40);
      const r = (0.6 + n * 1.4) / zoom;
      const hot = n < 0.04;
      ctx.fillStyle = hot
        ? `rgba(255, ${Math.floor(40 + pulse * 50)}, ${Math.floor(40 + pulse * 40)}, ${bright * pulse * 1.35})`
        : `rgba(255, 255, 255, ${bright * pulse})`;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.35 / zoom, r), 0, Math.PI * 2);
      ctx.fill();
      if (hot && !reduceMotion) {
        ctx.fillStyle = `rgba(255, 50, 50, ${0.04 * pulse})`;
        ctx.beginPath();
        ctx.arc(px, py, r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Concentric orbital rings around world origin — very faint.
  const maxR = Math.hypot(Math.max(Math.abs(x0), Math.abs(x0 + w)), Math.max(Math.abs(y0), Math.abs(y0 + h)));
  ctx.save();
  ctx.lineWidth = 1.25 / zoom;
  const ringStep = 420;
  const phase = reduceMotion ? 0 : t * 0.08;
  for (let r = ringStep; r < maxR + ringStep; r += ringStep) {
    const a = 0.028 + 0.018 * Math.sin(phase + r * 0.004);
    ctx.strokeStyle = `rgba(255, 55, 55, ${a})`;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    // Sparse tick marks on every other ring
    if (Math.floor(r / ringStep) % 2 === 0) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${a * 0.85})`;
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2 + phase * 0.3;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        ctx.beginPath();
        ctx.moveTo(c * (r - 12), s * (r - 12));
        ctx.lineTo(c * (r + 12), s * (r + 12));
        ctx.stroke();
      }
    }
  }
  ctx.restore();

  // Soft world-space scan band (barely there) — drifts slowly in Y.
  if (!reduceMotion) {
    const scanY = Math.sin(t * 0.22) * 900;
    const band = 56;
    const g = ctx.createLinearGradient(0, scanY - band * 3, 0, scanY + band * 3);
    g.addColorStop(0, 'rgba(255, 0, 0, 0)');
    g.addColorStop(0.45, 'rgba(255, 0, 0, 0.018)');
    g.addColorStop(0.5, 'rgba(255, 40, 40, 0.05)');
    g.addColorStop(0.55, 'rgba(255, 0, 0, 0.018)');
    g.addColorStop(1, 'rgba(255, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x0 - 20, scanY - band * 3, w + 40, band * 6);
  }
}

/** Screen-space vignette + micro grain after camera transform is restored. */
export function drawOrbitPaperScreen(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  now: number,
  reduceMotion: boolean
): void {
  const vignette = ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.15, w * 0.5, h * 0.5, h * 0.85);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  // Tiny screen-space pin lights (HUD dust) — independent of pan.
  const t = reduceMotion ? 0 : now * 0.001;
  for (let i = 0; i < 28; i++) {
    const px = ((i * 97 + Math.sin(t * 0.3 + i) * 8) % 1000) / 1000 * w;
    const py = ((i * 53 + Math.cos(t * 0.25 + i * 0.7) * 6) % 1000) / 1000 * h;
    const a = 0.03 + (i % 5) * 0.008;
    ctx.fillStyle = i % 7 === 0 ? `rgba(255, 70, 70, ${a})` : `rgba(255, 255, 255, ${a})`;
    ctx.fillRect(px, py, 1, 1);
  }
}

export function orbitPaperActive(paperTo: string, paperFill: string): boolean {
  return paperTo === ORBIT_PAPER || paperFill === ORBIT_PAPER;
}

function hash2(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}
