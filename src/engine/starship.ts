/**
 * Orbit frenzy finale: a Starship launch from a pad at the bottom of the view.
 *
 * The whole scene lives in world space (pad, tower, stack, plumes, steam), so
 * zooming out mid-flight shows all of it with nothing clipped. Lengths are
 * authored in screen px at spawn ("u") and scaled by `s` (world per screen px).
 *
 * Hardware is pre-rendered once into sprites:
 * - Super Heavy: stainless steel with cryo frost over the tanks, chines, three
 *   grid fins, the vented hot-staging ring and a row of engine bells;
 * - Ship: windward heat shield of black hexagonal tiles (foreshortened around
 *   the barrel and up the ogive nose) with a sliver of bare steel on the lee
 *   side, forward and aft flaps;
 * - tower with chopsticks, and the launch mount.
 * Plumes, glow and the steam cloud are drawn live with additive blending.
 *
 * Timeline: ignition on the pad (frost sheds off the tanks), a near-vertical
 * climb with a gentle gravity turn, a vapor cone through max-Q, hot staging
 * (flash + vent jets), and the Ship pulls away on its vacuum engines. The
 * booster flips on its center engines, burns back toward the pad, turns
 * engines-down, falls, lights a landing burn (13 engines, then the center 3),
 * hovers down beside the tower and is caught by the chopsticks.
 */

const ASPECT = 13.8;
/** Share of stack height (booster incl. hot-staging ring / ship). */
const BOOSTER_FRAC = 0.585;
/** Launch mount height as a share of stack height. */
const OLM_FRAC = 0.14;

/** Seconds from spawn. */
const FADE_IN = 0.45;
const IGNITE = 0.8;
const LIFTOFF = 2.4;
/** Seconds after liftoff. */
const SEP = 6.2;
const SHIP_FADE_AT = SEP + 7.5;
const SHIP_FADE = 1.6;
/**
 * Booster return (seconds after separation): flip on the center engines,
 * boostback, flip to engines-down. The landing burn lights on its own once
 * the fall needs it (suicide-burn guidance), so the catch always lands.
 */
const B_FLIP1 = [0.25, 1.35] as const;
const B_BOOSTBACK = [1.3, 2.2] as const;
const B_FLIP2 = [2.2, 3.5] as const;
/** Seconds the arms take to close, and the hold after the catch. */
const ARMS_CLOSE = 0.65;
const HOLD = 1.8;
/** Safety net: the scene fades by then even if the catch never happened. */
const HARD_END = LIFTOFF + SEP + 15;
const SCENE_FADE = 2.2;
const MAX_PUFFS = 360;
const MAX_FLAKES = 180;
/** Fixed step for the booster's guidance (frame-rate independent). */
const STEP = 1 / 120;

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function smooth(t: number): number {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Canvas2D = HTMLCanvasElement;

function makeCanvas(w: number, h: number): { c: Canvas2D; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

/** Horizontal cylinder shading: dark limbs, soft key light left of center. */
function cylinderShade(g: CanvasRenderingContext2D, x: number, w: number, strength = 1): CanvasGradient {
  const k = strength;
  const sh = g.createLinearGradient(x, 0, x + w, 0);
  sh.addColorStop(0, `rgba(0, 0, 0, ${0.62 * k})`);
  sh.addColorStop(0.16, `rgba(0, 0, 0, ${0.22 * k})`);
  sh.addColorStop(0.36, `rgba(255, 255, 255, ${0.1 * k})`);
  sh.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
  sh.addColorStop(0.8, `rgba(0, 0, 0, ${0.3 * k})`);
  sh.addColorStop(1, `rgba(0, 0, 0, ${0.7 * k})`);
  return sh;
}

/** 300-series stainless: neutral-warm mid steel with a bright specular band. */
function steelFill(g: CanvasRenderingContext2D, x: number, w: number): CanvasGradient {
  const st = g.createLinearGradient(x, 0, x + w, 0);
  st.addColorStop(0, '#3a3c40');
  st.addColorStop(0.14, '#7c7f84');
  st.addColorStop(0.3, '#c3c4c6');
  st.addColorStop(0.38, '#eceae6');
  st.addColorStop(0.46, '#b9b8b6');
  st.addColorStop(0.7, '#86878a');
  st.addColorStop(0.9, '#55575b');
  st.addColorStop(1, '#303236');
  return st;
}

function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number, c: number, sx: number): void {
  const hw = 0.866 * c * sx;
  g.moveTo(cx, cy - c);
  g.lineTo(cx + hw, cy - 0.5 * c);
  g.lineTo(cx + hw, cy + 0.5 * c);
  g.lineTo(cx, cy + c);
  g.lineTo(cx - hw, cy + 0.5 * c);
  g.lineTo(cx - hw, cy - 0.5 * c);
  g.closePath();
}

/** Cryogenic frost: a matte veil plus fine horizontal streaks, ragged edges. */
function frost(
  g: CanvasRenderingContext2D,
  x: number,
  w: number,
  y0: number,
  y1: number,
  unit: number,
  alpha: number,
  r: () => number
): void {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const cols = 24;
  g.fillStyle = `rgba(232, 236, 240, ${alpha})`;
  for (let i = 0; i < cols; i++) {
    const a = y0 + (r() - 0.5) * unit * 3;
    const b = y1 + (r() - 0.5) * unit * 3;
    g.fillRect(x + (i / cols) * w, a, w / cols + 0.5, b - a);
  }
  const n = Math.round(((y1 - y0) * w) / (unit * unit * 6));
  for (let i = 0; i < n; i++) {
    const sy = y0 + r() * (y1 - y0);
    const sx = x + r() * w;
    const len = unit * (1 + r() * 4);
    g.fillStyle = r() < 0.7 ? `rgba(250, 252, 255, ${0.03 + r() * 0.08})` : `rgba(90, 96, 104, ${0.03 + r() * 0.06})`;
    g.fillRect(sx, sy, len, unit * (0.3 + r() * 0.4));
  }
  g.restore();
}

interface Sprite {
  c: Canvas2D;
  /** Size in u, and the anchor (u from the sprite's top-left) of the body axis. */
  w: number;
  h: number;
  ax: number;
  ay: number;
}

/** Catch-pin height, measured down from the booster's top (u). */
function boosterPinY(W: number, B: number): number {
  return B * 0.048 + W * 0.46 + W * 0.12;
}

/**
 * Super Heavy, nose up; anchor = base center. `W` = diameter, `B` = length (u).
 * Includes the hot-staging ring at the top and engine bells below the base.
 */
function boosterSprite(W: number, B: number, R: number): Sprite | null {
  const finOut = W * 0.36;
  const bellH = W * 0.34;
  const w = W + finOut * 2;
  const h = B + bellH;
  const cv = makeCanvas(w * R, h * R);
  if (!cv) return null;
  const { c, g } = cv;
  g.scale(R, R);
  const x0 = finOut;
  const r = mulberry32(0x5e11);
  const unit = W / 26;

  // Engine bells (outer ring glimpsed under the skirt).
  g.fillStyle = '#16171a';
  for (let i = 0; i < 7; i++) {
    const bx = x0 + W * (0.1 + (i * 0.8) / 6);
    const bw = W * 0.1;
    g.beginPath();
    g.moveTo(bx - bw * 0.35, B);
    g.lineTo(bx + bw * 0.35, B);
    g.lineTo(bx + bw * 0.62, B + bellH * (i % 2 ? 0.8 : 1));
    g.lineTo(bx - bw * 0.62, B + bellH * (i % 2 ? 0.8 : 1));
    g.closePath();
    g.fill();
  }

  // Barrel.
  g.fillStyle = steelFill(g, x0, W);
  g.fillRect(x0, 0, W, B);
  const ring = B * 0.036;
  // Frost over the methane (upper) and oxygen (lower) tanks; bare steel at the common dome.
  frost(g, x0, W, ring + B * 0.06, B * 0.34, unit, 0.12, r);
  frost(g, x0, W, B * 0.39, B * 0.9, unit, 0.18, r);
  // Weld seams between barrel rings.
  const rings = 30;
  for (let i = 1; i < rings; i++) {
    const y = ring + ((B - ring) * i) / rings;
    g.fillStyle = 'rgba(20, 22, 26, 0.18)';
    g.fillRect(x0, y, W, unit * 0.35);
    g.fillStyle = 'rgba(255, 255, 255, 0.07)';
    g.fillRect(x0, y + unit * 0.35, W, unit * 0.25);
  }
  // Chines along both limbs.
  g.fillStyle = '#5d6066';
  g.fillRect(x0 - unit * 0.9, B * 0.14, unit * 0.9, B * 0.62);
  g.fillRect(x0 + W, B * 0.14, unit * 0.9, B * 0.62);
  // Aft skirt + heat shield lip.
  const skirt = g.createLinearGradient(0, B * 0.93, 0, B);
  skirt.addColorStop(0, 'rgba(20, 21, 24, 0)');
  skirt.addColorStop(1, 'rgba(20, 21, 24, 0.85)');
  g.fillStyle = skirt;
  g.fillRect(x0, B * 0.93, W, B * 0.07);
  // Cylinder shading over everything on the barrel.
  g.fillStyle = cylinderShade(g, x0, W, 0.8);
  g.fillRect(x0, 0, W, B);

  // Hot-staging ring: dark band with open vents.
  g.fillStyle = '#18191c';
  g.fillRect(x0, 0, W, ring);
  g.fillStyle = '#4b4e54';
  for (let i = 0; i < 9; i++) {
    const t = (i + 0.5) / 9;
    const sx = Math.sin((t - 0.5) * Math.PI);
    const vx = x0 + W * (0.5 + 0.5 * sx);
    const vw = W * 0.05 * Math.cos((t - 0.5) * Math.PI);
    g.fillRect(vx - vw / 2, ring * 0.22, vw, ring * 0.56);
  }
  g.fillStyle = 'rgba(255, 255, 255, 0.22)';
  g.fillRect(x0, 0, W, unit * 0.4);

  // Three grid fins below the ring: two at the limbs, one facing us.
  const finY = ring + B * 0.012;
  const finH = W * 0.46;
  const drawFin = (fx: number, fw: number) => {
    g.fillStyle = '#23252a';
    g.fillRect(fx, finY, fw, finH);
    g.strokeStyle = 'rgba(170, 175, 182, 0.55)';
    g.lineWidth = unit * 0.35;
    g.beginPath();
    const n = 5;
    for (let k = 1; k < n; k++) {
      g.moveTo(fx + (fw * k) / n, finY);
      g.lineTo(fx + (fw * k) / n, finY + finH);
      g.moveTo(fx, finY + (finH * k) / n);
      g.lineTo(fx + fw, finY + (finH * k) / n);
    }
    g.stroke();
    g.strokeStyle = '#6a6e75';
    g.strokeRect(fx, finY, fw, finH);
  };
  drawFin(x0 - finOut, finOut);
  drawFin(x0 + W, finOut);
  drawFin(x0 + W * 0.36, W * 0.28);

  // Catch pins under the fins: the hardpoints that land on the chopsticks.
  const pinY = boosterPinY(W, B);
  for (const side of [-1, 1]) {
    const px = side < 0 ? x0 - W * 0.07 : x0 + W;
    g.fillStyle = '#2a2c31';
    g.fillRect(px, pinY - W * 0.05, W * 0.07, W * 0.1);
    g.fillStyle = 'rgba(200, 204, 210, 0.45)';
    g.fillRect(px, pinY - W * 0.05, W * 0.07, W * 0.02);
  }

  return { c, w, h, ax: x0 + W / 2, ay: B };
}

/**
 * Ship, nose up; anchor = base center. Windward heat shield toward the viewer,
 * turned so a sliver of the steel lee side shows on the right.
 */
function shipSprite(W: number, L: number, R: number): Sprite | null {
  const flapOut = W * 0.42;
  const w = W + flapOut * 2;
  const h = L;
  const cv = makeCanvas(w * R, h * R);
  if (!cv) return null;
  const { c, g } = cv;
  g.scale(R, R);
  const cx = w / 2;
  const half = W / 2;
  const noseL = W * 2.05;
  const rAt = (y: number) => {
    if (y >= noseL) return half;
    const t = Math.max(0, y / noseL);
    return half * Math.pow(Math.sin((Math.PI / 2) * t), 0.8);
  };
  const r = mulberry32(0x7a11);

  // Flaps behind the body: aft pair (large), forward pair (small, up by the nose).
  const flap = (y0: number, y1: number, out: number, sweep: number) => {
    for (const side of [-1, 1]) {
      const bx = cx + side * rAt((y0 + y1) / 2) * 0.96;
      g.beginPath();
      g.moveTo(bx, y0);
      g.lineTo(bx + side * out, y0 + (y1 - y0) * sweep);
      g.lineTo(bx + side * out, y1);
      g.lineTo(bx, y1);
      g.closePath();
      const fg = g.createLinearGradient(bx, 0, bx + side * out, 0);
      fg.addColorStop(0, '#111215');
      fg.addColorStop(1, '#23252a');
      g.fillStyle = fg;
      g.fill();
      g.strokeStyle = side > 0 ? 'rgba(170, 174, 180, 0.7)' : 'rgba(120, 124, 130, 0.45)';
      g.lineWidth = W * 0.025;
      g.stroke();
    }
  };
  flap(L * 0.76, L * 0.97, flapOut, 0.34);
  flap(noseL * 0.62, noseL * 1.08, flapOut * 0.62, 0.42);

  // Body outline.
  const body = new Path2D();
  const N = 48;
  body.moveTo(cx, 0);
  for (let i = 1; i <= N; i++) {
    const y = (noseL * i) / N;
    body.lineTo(cx + rAt(y), y);
  }
  body.lineTo(cx + half, L);
  body.lineTo(cx - half, L);
  for (let i = N; i >= 1; i--) {
    const y = (noseL * i) / N;
    body.lineTo(cx - rAt(y), y);
  }
  body.closePath();

  g.save();
  g.clip(body);
  // Steel underneath (shows on the lee side).
  g.fillStyle = steelFill(g, cx - half, W);
  g.fillRect(cx - half, 0, W, L);
  frost(g, cx - half, W, L * 0.56, L * 0.94, W / 26, 0.22, r);

  // Heat shield: pointy-top hex tiles laid on the cylinder, foreshortened at the limbs.
  const lee = 0.74; // radians past which the tiles stop (steel beyond)
  const cTile = W / 17;
  const rowH = cTile * 1.5;
  const dTheta = (Math.sqrt(3) * cTile) / half;
  const rows = Math.ceil(L / rowH) + 1;
  g.fillStyle = '#060607';
  // Grout base under the tiled region (ragged edge comes from the tiles themselves).
  for (let k = 0; k < rows; k++) {
    const y = k * rowH;
    const rad = rAt(Math.min(L, y));
    if (rad < cTile * 0.4) continue;
    g.fillRect(cx - rad, y - rowH, rad + rad * Math.sin(lee - dTheta * 0.5), rowH * 2);
  }
  for (let k = 0; k < rows; k++) {
    const y = k * rowH;
    const rad = rAt(Math.min(L, y));
    if (rad < cTile * 0.4) {
      // The very tip: one solid cap.
      g.fillStyle = '#141518';
      g.beginPath();
      g.arc(cx, Math.max(cTile, y), cTile, 0, Math.PI * 2);
      g.fill();
      continue;
    }
    const scale = rad / half;
    const step = dTheta / scale;
    const off = (k % 2 ? 0.5 : 0) * step;
    for (let th = -Math.PI / 2 + off; th < lee; th += step) {
      const cosT = Math.cos(th);
      if (cosT < 0.06) continue;
      const x = cx + rad * Math.sin(th);
      // Most tiles near-black; a few lighter replacements, as on the flight vehicles.
      const odd = r();
      const l = odd < 0.006 ? 70 + r() * 30 : 16 + r() * 13;
      g.fillStyle = `rgb(${l | 0}, ${l | 0}, ${(l + 3) | 0})`;
      g.beginPath();
      hexPath(g, x, y, cTile * 0.9, cosT);
      g.fill();
    }
  }
  // Roundness over tiles and steel.
  g.fillStyle = cylinderShade(g, cx - half, W, 0.9);
  g.fillRect(cx - half, 0, W, L);
  // Aft skirt band.
  g.fillStyle = 'rgba(8, 8, 10, 0.75)';
  g.fillRect(cx - half, L - W * 0.08, W, W * 0.08);
  g.restore();

  // Hairline edge light on the lee limb.
  g.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  g.lineWidth = W * 0.02;
  g.beginPath();
  g.moveTo(cx + half, L);
  g.lineTo(cx + half, noseL);
  g.stroke();

  return { c, w, h, ax: cx, ay: L };
}

/**
 * Launch tower: lattice with a crane at the top, drawn with the stack on the
 * +x side. The chopsticks move, so they are drawn live. Anchor = tower base
 * center.
 */
function towerSprite(W: number, towerH: number, R: number): Sprite | null {
  const T = W * 1.3;
  const w = T + W * 0.4;
  const top = W * 0.9;
  const h = towerH + top;
  const cv = makeCanvas(w * R, h * R);
  if (!cv) return null;
  const { c, g } = cv;
  g.scale(R, R);
  const x0 = W * 0.4;
  const y0 = top;
  const rail = T * 0.12;
  g.fillStyle = '#1b1c20';
  g.fillRect(x0, y0, rail, towerH);
  g.fillRect(x0 + T - rail, y0, rail, towerH);
  g.fillStyle = 'rgba(120, 124, 132, 0.35)';
  g.fillRect(x0 + T - rail, y0, rail * 0.35, towerH);
  // Bracing.
  g.strokeStyle = '#26282d';
  g.lineWidth = T * 0.05;
  g.beginPath();
  const seg = T * 1.05;
  for (let y = y0; y < y0 + towerH - 1; y += seg) {
    const yb = Math.min(y0 + towerH, y + seg);
    g.moveTo(x0 + rail, y);
    g.lineTo(x0 + T - rail, yb);
    g.moveTo(x0 + T - rail, y);
    g.lineTo(x0 + rail, yb);
    g.moveTo(x0, y);
    g.lineTo(x0 + T, y);
  }
  g.stroke();
  // Crane jib and lightning mast.
  g.fillStyle = '#202227';
  g.fillRect(x0 + T * 0.1, y0 - W * 0.12, T * 0.8, W * 0.12);
  g.strokeStyle = '#2b2d33';
  g.lineWidth = W * 0.06;
  g.beginPath();
  g.moveTo(x0 + T * 0.5, y0 - W * 0.12);
  g.lineTo(x0 - W * 0.3, y0 - W * 0.55);
  g.moveTo(x0 + T * 0.5, y0);
  g.lineTo(x0 + T * 0.5, y0 - top * 0.95);
  g.stroke();
  // Carriage rail up the stack-side face.
  g.fillStyle = 'rgba(150, 154, 160, 0.22)';
  g.fillRect(x0 + T - rail * 0.2, y0, rail * 0.2, towerH);
  return { c, w, h, ax: x0 + T / 2, ay: h };
}

/** Orbital launch mount: table on splayed legs over the flame deflector. */
function mountSprite(W: number, OLM: number, R: number): Sprite | null {
  const w = W * 2.6;
  const h = OLM;
  const cv = makeCanvas(w * R, h * R);
  if (!cv) return null;
  const { c, g } = cv;
  g.scale(R, R);
  const cx = w / 2;
  const tableW = W * 1.7;
  const tableH = OLM * 0.16;
  g.fillStyle = '#1a1b1f';
  // Legs.
  for (const sx of [-1, -0.36, 0.36, 1]) {
    const topX = cx + sx * tableW * 0.46;
    const botX = cx + sx * w * 0.47;
    const lw = W * (Math.abs(sx) > 0.5 ? 0.16 : 0.1);
    g.beginPath();
    g.moveTo(topX - lw / 2, tableH);
    g.lineTo(topX + lw / 2, tableH);
    g.lineTo(botX + lw / 2, h);
    g.lineTo(botX - lw / 2, h);
    g.closePath();
    g.fill();
  }
  // Table ring.
  g.fillStyle = '#202227';
  g.fillRect(cx - tableW / 2, 0, tableW, tableH);
  g.fillStyle = 'rgba(160, 164, 170, 0.35)';
  g.fillRect(cx - tableW / 2, 0, tableW, tableH * 0.18);
  // Deflector plate.
  g.fillStyle = '#16171a';
  g.fillRect(cx - W * 0.8, h - OLM * 0.06, W * 1.6, OLM * 0.06);
  return { c, w, h, ax: cx, ay: h };
}

let puffCache: { soft: Canvas2D[]; glow: Canvas2D[] } | null = null;

/** Soft steam puffs (a few variants) and their plume-lit, orange twins. */
function puffSprites(): { soft: Canvas2D[]; glow: Canvas2D[] } | null {
  if (puffCache) return puffCache;
  const soft: Canvas2D[] = [];
  const glow: Canvas2D[] = [];
  for (let v = 0; v < 3; v++) {
    const S = 128;
    const a = makeCanvas(S, S);
    const b = makeCanvas(S, S);
    if (!a || !b) return null;
    const r = mulberry32(0xc10d + v * 977);
    for (let i = 0; i < 16; i++) {
      const ang = r() * Math.PI * 2;
      const d = r() * 26;
      const x = 64 + Math.cos(ang) * d;
      const y = 64 + Math.sin(ang) * d * 0.8;
      const rad = 18 + r() * 20;
      const gr = a.g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(236, 238, 242, 0.42)');
      gr.addColorStop(0.6, 'rgba(220, 223, 228, 0.18)');
      gr.addColorStop(1, 'rgba(220, 223, 228, 0)');
      a.g.fillStyle = gr;
      a.g.fillRect(0, 0, S, S);
    }
    // Shade the underside.
    a.g.globalCompositeOperation = 'source-atop';
    const sh = a.g.createLinearGradient(0, 30, 0, 110);
    sh.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    sh.addColorStop(1, 'rgba(70, 72, 80, 0.55)');
    a.g.fillStyle = sh;
    a.g.fillRect(0, 0, S, S);
    b.g.drawImage(a.c, 0, 0);
    b.g.globalCompositeOperation = 'source-in';
    b.g.fillStyle = '#ff8f45';
    b.g.fillRect(0, 0, S, S);
    soft.push(a.c);
    glow.push(b.c);
  }
  puffCache = { soft, glow };
  return puffCache;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  grow: number;
  age: number;
  life: number;
  alpha: number;
  v: number;
}

interface Plume {
  sea: boolean;
}

const SEA: Plume = { sea: true };
const VAC: Plume = { sea: false };

/**
 * One engine plume along local +y from (0, 0). `w` = nozzle-cluster width,
 * `len` = visible length (already cut at the ground), `expand` = how far the
 * plume balloons as the air thins (1 at sea level).
 *
 * Layers, back to front: a soft glow around the nozzles, a turbulent outer
 * sheath (three lobes that flicker independently, so the edge churns instead
 * of pulsing as one shape), the orange body, individual engine jets merging
 * just below the bells, the white-hot core and the Mach diamonds.
 */
function drawPlume(
  ctx: CanvasRenderingContext2D,
  w: number,
  len: number,
  fullLen: number,
  I: number,
  expand: number,
  t: number,
  kind: Plume
): void {
  if (I <= 0.01 || len <= 1) return;
  const flick = 0.93 + 0.045 * Math.sin(t * 53) + 0.025 * Math.sin(t * 137 + 1.3);
  const L = Math.min(len, fullLen * flick);
  const cut = len < fullLen * flick;
  const wEnd = w * (0.9 + 0.9 * (expand - 1));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Nozzle glow.
  const gr0 = ctx.createRadialGradient(0, w * 0.1, 0, 0, w * 0.1, w * 1.1);
  if (kind.sea) {
    gr0.addColorStop(0, 'rgba(255, 220, 170, 0.55)');
    gr0.addColorStop(1, 'rgba(255, 140, 60, 0)');
  } else {
    gr0.addColorStop(0, 'rgba(225, 220, 255, 0.45)');
    gr0.addColorStop(1, 'rgba(150, 140, 255, 0)');
  }
  ctx.globalAlpha = I;
  ctx.fillStyle = gr0;
  ctx.fillRect(-w * 1.2, -w, w * 2.4, w * 2.3);

  // Turbulent outer sheath.
  for (let k = 0; k < 3; k++) {
    const ph = k * 2.1;
    const wob = 1 + 0.09 * Math.sin(t * (23 + k * 7) + ph) + 0.05 * Math.sin(t * (61 + k * 11) + ph * 2);
    const lk = L * (0.86 + 0.12 * k) * (cut ? 1 : 0.97 + 0.05 * Math.sin(t * (41 + k * 5) + ph));
    const sway = w * 0.12 * Math.sin(t * (17 + k * 3) + ph);
    ctx.globalAlpha = I * (kind.sea ? 0.26 : 0.18);
    const gr = ctx.createLinearGradient(0, 0, 0, lk);
    if (kind.sea) {
      gr.addColorStop(0, 'rgba(255, 175, 95, 0.95)');
      gr.addColorStop(0.3, 'rgba(255, 125, 55, 0.6)');
      gr.addColorStop(0.75, 'rgba(200, 75, 60, 0.2)');
      gr.addColorStop(1, 'rgba(150, 60, 80, 0)');
    } else {
      gr.addColorStop(0, 'rgba(205, 195, 255, 0.85)');
      gr.addColorStop(0.4, 'rgba(145, 135, 240, 0.35)');
      gr.addColorStop(1, 'rgba(120, 110, 220, 0)');
    }
    ctx.fillStyle = gr;
    const we = wEnd * wob;
    ctx.beginPath();
    ctx.moveTo(-w * 0.55, 0);
    ctx.bezierCurveTo(-we * 1.25, lk * 0.28, -we * 1.05, lk * 0.72, sway, lk);
    ctx.bezierCurveTo(we * 1.05, lk * 0.72, we * 1.25, lk * 0.28, w * 0.55, 0);
    ctx.closePath();
    ctx.fill();
  }

  // Body.
  ctx.globalAlpha = I * 0.9;
  let gr = ctx.createLinearGradient(0, 0, 0, L * 0.85);
  if (kind.sea) {
    gr.addColorStop(0, 'rgba(255, 246, 225, 1)');
    gr.addColorStop(0.18, 'rgba(255, 214, 150, 0.95)');
    gr.addColorStop(0.55, 'rgba(255, 150, 70, 0.55)');
    gr.addColorStop(1, 'rgba(255, 110, 50, 0)');
  } else {
    gr.addColorStop(0, 'rgba(245, 242, 255, 0.95)');
    gr.addColorStop(0.3, 'rgba(190, 180, 255, 0.5)');
    gr.addColorStop(1, 'rgba(150, 140, 255, 0)');
  }
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.moveTo(-w * 0.46, 0);
  ctx.quadraticCurveTo(-wEnd * 0.7, L * 0.45, 0, L * 0.85);
  ctx.quadraticCurveTo(wEnd * 0.7, L * 0.45, w * 0.46, 0);
  ctx.closePath();
  ctx.fill();

  // Individual engine jets fanning out of the cluster and merging below it.
  const jets = kind.sea ? 7 : 3;
  const jl = w * (kind.sea ? 0.95 : 0.8);
  for (let k = 0; k < jets; k++) {
    const f = k / (jets - 1) - 0.5;
    const jx = f * w * 0.78;
    const splay = f * 0.35 * expand;
    const jw = w * (kind.sea ? 0.075 : 0.13);
    const lj = jl * (0.9 + 0.1 * Math.sin(t * 71 + k * 1.7));
    ctx.globalAlpha = I * 0.8;
    const jg = ctx.createLinearGradient(0, 0, 0, lj);
    jg.addColorStop(0, 'rgba(255, 255, 255, 1)');
    jg.addColorStop(0.5, kind.sea ? 'rgba(255, 235, 195, 0.6)' : 'rgba(230, 228, 255, 0.5)');
    jg.addColorStop(1, 'rgba(255, 220, 170, 0)');
    ctx.fillStyle = jg;
    ctx.beginPath();
    ctx.moveTo(jx - jw, 0);
    ctx.quadraticCurveTo(jx - jw * 1.2 + splay * lj * 0.5, lj * 0.5, jx + splay * lj, lj);
    ctx.quadraticCurveTo(jx + jw * 1.2 + splay * lj * 0.5, lj * 0.5, jx + jw, 0);
    ctx.closePath();
    ctx.fill();
  }

  // White-hot core.
  ctx.globalAlpha = I;
  gr = ctx.createLinearGradient(0, 0, 0, L * 0.34);
  gr.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gr.addColorStop(1, kind.sea ? 'rgba(255, 236, 200, 0)' : 'rgba(235, 230, 255, 0)');
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.moveTo(-w * 0.34, 0);
  ctx.quadraticCurveTo(-w * 0.2, L * 0.2, 0, L * 0.34);
  ctx.quadraticCurveTo(w * 0.2, L * 0.2, w * 0.34, 0);
  ctx.closePath();
  ctx.fill();

  // Mach diamonds: crisp at sea level, gone as the plume balloons.
  const dia = kind.sea ? clamp01(2.2 - expand * 1.2) : 0;
  if (dia > 0.02) {
    const step = w * 0.62;
    for (let i = 0; i < 6; i++) {
      const y = w * 0.5 + i * step;
      if (y > L * 0.8) break;
      const a = I * dia * 0.7 * (1 - i / 6);
      // Soft halo, then a crisp diamond.
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = '#ffd9a8';
      ctx.beginPath();
      ctx.ellipse(0, y, w * 0.26 * (1 - i * 0.08), w * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fff7e8';
      const dw = w * 0.15 * (1 - i * 0.08);
      const dh = w * 0.27;
      ctx.beginPath();
      ctx.moveTo(0, y - dh);
      ctx.quadraticCurveTo(dw * 0.35, y - dh * 0.35, dw, y);
      ctx.quadraticCurveTo(dw * 0.35, y + dh * 0.35, 0, y + dh);
      ctx.quadraticCurveTo(-dw * 0.35, y + dh * 0.35, -dw, y);
      ctx.quadraticCurveTo(-dw * 0.35, y - dh * 0.35, 0, y - dh);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Frost flakes shaken off the tanks at ignition and liftoff. */
interface Flake {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  sz: number;
}

/** Separated booster; x, y is its middle so it turns about its own center. */
interface Boost {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ang: number;
  ang0: number;
  age: number;
  /** 0 = flight, 1 = landing burn, 2 = final creep into the arms, 3 = caught. */
  phase: 0 | 1 | 2 | 3;
  /** Descent lean from the steering (rad), eased. */
  steer: number;
  burnAt: number;
  /** Fall speed when the landing burn lit (sets the 13 -> 3 engine switch). */
  vIgn: number;
  closeAt: number;
  caughtAt: number;
  /** Visual engine levels: boostback, landing, share on the 3 center engines, bell heat. */
  bb: number;
  land: number;
  few: number;
  heat: number;
  /** Unstepped time carried to the next frame. */
  carry: number;
}

export class StarshipLaunch {
  /** Scene origin (world): pad center on the ground line. */
  private readonly ox: number;
  private readonly oy: number;
  private readonly s: number;
  private readonly H: number;
  private readonly W: number;
  private readonly B: number;
  private readonly L: number;
  private readonly OLM: number;
  private readonly dir: number;
  private readonly towerX: number;
  private readonly towerH: number;
  private readonly aStack: number;
  /** Gravity for the booster's return and its terminal fall speed (u/s², u/s). */
  private readonly g: number;
  private readonly vt: number;
  /** Chopsticks: tower face x, arm length and the arms' top y (u). */
  private readonly faceX: number;
  private readonly armLen: number;
  private readonly armY: number;
  /** Booster middle when held in the arms, where the final creep starts, and its speed. */
  private readonly yCatch: number;
  private readonly yHover: number;
  private readonly vEnd: number;
  private age = 0;
  /** Age at which the whole scene starts fading out (-1 = not yet). */
  private sceneOut = -1;
  /** Base of the stack (then of the Ship after staging), u; heading from +up. */
  private x = 0;
  private y: number;
  private ang = 0;
  private v = 0;
  private staged = false;
  private boost: Boost | null = null;
  private puffs: Puff[] = [];
  private flakes: Flake[] = [];
  private puffCarry = 0;
  private flakeCarry = 0;
  private rand: () => number;
  private sprites: {
    booster: Sprite | null;
    ship: Sprite | null;
    tower: Sprite | null;
    mount: Sprite | null;
  };

  /**
   * `cx`, `bottom` = world x of the view center and y of its bottom edge;
   * `viewW`/`viewH` in screen px. `seed` makes peers fly the same profile.
   */
  constructor(cx: number, bottom: number, viewW: number, viewH: number, zoom: number, seed: number) {
    this.s = 1 / zoom;
    this.rand = mulberry32(seed);
    this.dir = this.rand() < 0.5 ? -1 : 1;
    this.H = Math.max(200, Math.min(560, viewH * 0.42));
    this.W = this.H / ASPECT;
    this.B = this.H * BOOSTER_FRAC;
    this.L = this.H - this.B;
    this.OLM = this.H * OLM_FRAC;
    // Pad and tower centered together (the tower stands on the -dir side),
    // clear of the bottom toolbar. The ascent is near-vertical, so the stack
    // stays in view instead of leaning across it.
    this.ox = cx + this.dir * Math.min(viewW * 0.12, this.W * 1.2) * this.s;
    this.oy = bottom - Math.max(110, viewH * 0.14) * this.s;
    this.y = -this.OLM;
    const gap = this.W * 1.15;
    this.towerX = -this.dir * (this.W / 2 + gap + this.W * 0.65);
    this.towerH = this.OLM + this.H + this.W * 0.6;
    this.faceX = -this.dir * (this.W / 2 + gap);
    this.armLen = gap + this.W * 1.05;
    // Caught a little above the mount, pins resting on the arms.
    this.yCatch = -(this.OLM + this.W * 0.55 + this.B / 2);
    this.yHover = this.yCatch - this.W * 0.3;
    this.vEnd = this.W * 0.38;
    this.armY = this.yCatch - this.B / 2 + boosterPinY(this.W, this.B) + this.W * 0.05;
    // Rise about a third of the view by staging, so separation plays on screen.
    this.aStack = (2 * viewH * 0.34) / (SEP * SEP);
    // The stack climbs at ~0.3 g net, so g is a few times its acceleration.
    this.g = this.aStack * 3.2;
    this.vt = viewH * 0.36;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const R = Math.max(1, Math.min(2.5 * dpr, 4096 / this.H));
    this.sprites = {
      booster: boosterSprite(this.W, this.B, R),
      ship: shipSprite(this.W, this.L, R),
      tower: towerSprite(this.W, this.towerH, R),
      mount: mountSprite(this.W, this.OLM, R),
    };
  }

  get alive(): boolean {
    return this.sceneOut < 0 || this.age < this.sceneOut + SCENE_FADE;
  }

  /** Engine intensity of the 33-engine booster cluster. */
  private boosterThrust(): number {
    const a = this.age;
    if (a < IGNITE) return 0;
    // Staggered startup: flickers up over ~0.6 s.
    const start = smooth((a - IGNITE) / 0.7) * (a < IGNITE + 0.7 ? 0.8 + 0.2 * Math.sin(a * 47) : 1);
    const tl = a - LIFTOFF;
    const cutoff = 1 - smooth((tl - SEP + 0.15) / 0.3);
    return start * cutoff;
  }

  private shipThrust(): number {
    const tl = this.age - LIFTOFF;
    // Hot staging: the Ship lights while still sitting on the ring.
    return smooth((tl - SEP + 0.3) / 0.3) * (1 - smooth((tl - SHIP_FADE_AT) / SHIP_FADE));
  }

  /**
   * Heading from vertical: straight up past the tower, a small pitch kick,
   * then a slow gravity turn (about 7 degrees at staging, 21 by the Ship's
   * fade). Seen from the pad a real ascent stays close to upright this long.
   */
  private pitch(tl: number): number {
    return (
      this.dir *
      (0.03 * smooth((tl - 1.2) / 1.2) + 0.12 * smooth((tl - 2) / 5.5) + 0.22 * smooth((tl - SEP) / 6))
    );
  }

  update(dt: number): void {
    this.age += dt;
    const tl = this.age - LIFTOFF;
    if (tl > 0) {
      this.ang = this.pitch(tl);
      this.v += (this.staged ? this.aStack * 1.5 : this.aStack) * dt;
      this.x += Math.sin(this.ang) * this.v * dt;
      this.y -= Math.cos(this.ang) * this.v * dt;
    }
    if (!this.staged && tl >= SEP) {
      this.staged = true;
      const vx = Math.sin(this.ang) * this.v;
      const vy = -Math.cos(this.ang) * this.v;
      this.boost = {
        x: this.x + (Math.sin(this.ang) * this.B) / 2,
        y: this.y - (Math.cos(this.ang) * this.B) / 2,
        vx: vx * 0.92,
        vy: vy * 0.92,
        ang: this.ang,
        ang0: this.ang,
        age: 0,
        phase: 0,
        steer: 0,
        burnAt: 0,
        vIgn: 1,
        closeAt: 0,
        caughtAt: 0,
        bb: 0,
        land: 0,
        few: 0,
        heat: 1,
        carry: 0,
      };
      // Ship base now sits where the ring was.
      this.x += Math.sin(this.ang) * this.B;
      this.y -= Math.cos(this.ang) * this.B;
    }
    const b = this.boost;
    if (b) {
      b.carry += dt;
      while (b.carry >= STEP) {
        b.carry -= STEP;
        this.stepBooster(b, STEP);
      }
      this.emitBoosterGas(b, dt);
    }
    this.emitSteam(dt);
    this.emitFlakes(dt);
    let w = 0;
    for (const p of this.puffs) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const d = Math.exp(-1.25 * dt);
      p.vx *= d;
      p.vy = p.vy * d - 9 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Stay above the ground line.
      if (p.y > -p.r * 0.35) p.y = -p.r * 0.35;
      this.puffs[w++] = p;
    }
    this.puffs.length = w;
    w = 0;
    const fd = Math.exp(-2.2 * dt);
    for (const f of this.flakes) {
      f.age += dt;
      if (f.age >= f.life || f.y > 0) continue;
      f.vx *= fd;
      f.vy = f.vy * fd + this.g * 0.8 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      this.flakes[w++] = f;
    }
    this.flakes.length = w;
    if (this.sceneOut < 0) {
      const caught = b !== null && b.phase === 3 && b.age - b.caughtAt > HOLD;
      if (caught || this.age > HARD_END) this.sceneOut = this.age;
    }
  }

  /**
   * One fixed step of the booster's return. Attitude is scripted through the
   * flips and handed to the descent steering after the second one; position
   * is integrated under gravity, drag and the burns.
   */
  private stepBooster(b: Boost, h: number): void {
    b.age += h;
    const g = this.g;
    const aNet = g * 2.6;
    const k1 = smooth((b.age - B_FLIP1[0]) / (B_FLIP1[1] - B_FLIP1[0]));
    const k2 = smooth((b.age - B_FLIP2[0]) / (B_FLIP2[1] - B_FLIP2[0]));
    // Boostback attitude: nose back toward the pad, engines downrange.
    const a1 = b.ang0 + (-this.dir * 1.25 - b.ang0) * k1;

    // Phase changes: light the landing burn once stopping at the hover point
    // needs ~60% of its authority; creep once there; caught at the arms.
    if (b.phase === 0 && b.age > B_FLIP2[1] - 0.3 && b.vy > 0) {
      const dh = this.yHover - b.y;
      const req = dh > 0 ? (b.vy * b.vy - this.vEnd * this.vEnd) / (2 * dh) : Infinity;
      if (req >= 0.62 * aNet) {
        b.phase = 1;
        b.burnAt = b.age;
        b.vIgn = Math.max(b.vy, 1);
      }
    }
    if (b.phase === 1 && b.y >= this.yHover) {
      b.phase = 2;
      b.closeAt = b.age;
    }
    if (b.phase === 2 && b.y >= this.yCatch) {
      b.phase = 3;
      b.caughtAt = b.age;
      b.y = this.yCatch;
    }

    // Steering toward the catch point: grid fins in the fall, engine gimbal in
    // the burn. The body leans a little into the correction.
    let axCmd = 0;
    if (b.phase < 2) {
      const lim = g * 0.3;
      axCmd = Math.max(-lim, Math.min(lim, 1.3 * -b.x - 2.2 * b.vx)) * k2;
    }
    const lean = b.phase >= 2 ? 0 : Math.max(-0.14, Math.min(0.14, (axCmd / g) * 0.5));
    b.steer += (lean - b.steer) * (1 - Math.exp(-h / 0.3));
    b.ang = a1 + (b.steer - a1) * k2;

    const ease = (cur: number, to: number, tau: number) => cur + (to - cur) * (1 - Math.exp(-h / tau));
    b.bb = 0;
    if (b.phase === 0) {
      let ax = axCmd;
      let ay = g;
      const sp = Math.hypot(b.vx, b.vy);
      const cd = g / (this.vt * this.vt);
      ax -= cd * b.vx * sp;
      ay -= cd * b.vy * sp;
      // Boostback: thrust along the body, sized to send it back over the pad.
      const env = this.boostbackEnv(b.age);
      if (env > 0) {
        const sinA = Math.sin(b.ang);
        const want = (-b.x / 3.4 - b.vx) / 0.3;
        const Tmax = g * 2.4;
        const T = Math.abs(sinA) > 0.2 ? Math.max(0, Math.min(Tmax, want / sinA)) : 0;
        ax += sinA * T * env;
        ay -= Math.cos(b.ang) * T * env;
        b.bb = env * (0.6 + 0.4 * (T / Tmax));
      }
      b.vx += ax * h;
      b.vy += ay * h;
      b.x += b.vx * h;
      b.y += b.vy * h;
    } else if (b.phase === 1) {
      const dh = Math.max(this.yHover - b.y, this.W * 0.02);
      const req = Math.max(0, (b.vy * b.vy - this.vEnd * this.vEnd) / (2 * dh));
      const decel = Math.min(req, aNet * 1.6);
      const r = smooth((b.age - b.burnAt) / 0.18);
      b.vx += axCmd * h;
      b.vy += (g - r * (g + decel)) * h;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.land = r * Math.max(0.45, Math.min(1, (g + decel) / (g + aNet)));
      b.few = ease(b.few, b.vy < 0.4 * b.vIgn ? 1 : 0, 0.12);
    } else if (b.phase === 2) {
      // Hover-slow descent through the open arms, drifting onto the pad axis.
      b.vx = 0;
      b.vy = this.vEnd;
      b.x = ease(b.x, 0, 0.2);
      b.y += b.vy * h;
      b.land = ease(b.land, 0.5, 0.15);
      b.few = ease(b.few, 1, 0.12);
    } else {
      b.vx = 0;
      b.vy = 0;
      b.x = 0;
      b.y = this.yCatch;
      // Engine cutoff as the pins settle on the arms.
      b.land *= Math.exp(-h / 0.1);
    }
    const eng = Math.max(1 - smooth(b.age / 0.35), this.flipEnv(b.age), b.bb, b.land);
    b.heat = Math.max(eng, b.heat * Math.exp(-h / 1.8));
  }

  /** Cold-gas puffs while it turns, and tank venting once it is caught. */
  private emitBoosterGas(b: Boost, dt: number): void {
    const nx = Math.sin(b.ang);
    const ny = -Math.cos(b.ang);
    const top = this.B * 0.47;
    const turning = (b.age > B_FLIP1[0] && b.age < B_FLIP1[1] - 0.2) || (b.age > B_FLIP2[0] && b.age < B_FLIP2[1] - 0.2);
    if (turning && this.rand() < dt * 10) {
      const side = this.rand() < 0.5 ? -1 : 1;
      this.addPuff({
        x: b.x + nx * top,
        y: b.y + ny * top,
        vx: -ny * side * 60 + b.vx * 0.5,
        vy: nx * side * 60 + b.vy * 0.5,
        r: this.W * 0.22,
        grow: this.W * 0.8,
        age: 0,
        life: 0.7,
        alpha: 0.4,
        v: 0,
      });
    }
    if (b.phase === 3 && b.age - b.caughtAt < 1.8 && this.rand() < dt * 12) {
      const side = this.rand() < 0.5 ? -1 : 1;
      const up = this.rand() < 0.6;
      this.addPuff({
        x: b.x + side * this.W * 0.5,
        y: up ? b.y - top * 0.95 : b.y + this.B * 0.5,
        vx: side * this.W * (1.2 + this.rand() * 1.4),
        vy: -this.W * this.rand() * 0.6,
        r: this.W * 0.25,
        grow: this.W * (1.2 + this.rand() * 0.8),
        age: 0,
        life: 1.4 + this.rand() * 0.8,
        alpha: 0.3,
        v: (this.rand() * 3) | 0,
      });
    }
  }

  private boostbackEnv(age: number): number {
    return smooth((age - B_BOOSTBACK[0]) / 0.2) * (1 - smooth((age - B_BOOSTBACK[1] + 0.2) / 0.2));
  }

  /** The 3 center engines stay lit through the first flip and steer it. */
  private flipEnv(age: number): number {
    return smooth((age - 0.15) / 0.15) * (1 - smooth((age - B_FLIP1[1] + 0.1) / 0.2));
  }

  private landLen(b: Boost): number {
    return this.H * (0.42 - 0.14 * b.few);
  }

  /** Booster base (u) and how far along its plume the mount table is. */
  private landHit(b: Boost): { x: number; y: number; dist: number } {
    const c = Math.cos(b.ang);
    const bx = b.x - (Math.sin(b.ang) * this.B) / 2;
    const by = b.y + (c * this.B) / 2;
    return { x: bx, y: by, dist: Math.max(0, (-this.OLM - by) / Math.max(0.2, c)) };
  }

  /** Where the active plume meets the ground or the mount (u), and how hard (0..1). */
  private splash(): { x: number; y: number; k: number } {
    if (!this.staged) {
      const I = this.boosterThrust();
      const c = Math.cos(this.ang);
      const dist = -this.y / Math.max(0.2, c);
      const k = I * clamp01(1 - dist / this.plumeLen());
      return { x: this.x - Math.sin(this.ang) * dist, y: 0, k };
    }
    const b = this.boost;
    if (!b || b.land < 0.01) return { x: 0, y: -this.OLM, k: 0 };
    const hit = this.landHit(b);
    const k = b.land * clamp01(1 - hit.dist / this.landLen(b));
    return { x: hit.x - Math.sin(b.ang) * hit.dist, y: -this.OLM, k };
  }

  private plumeLen(): number {
    return this.H * 0.62 * (1 + this.altitude() * 0.55);
  }

  /** 0 on the pad, ~1 around staging. */
  private altitude(): number {
    return clamp01((-this.y - this.OLM) / (this.H * 1.3));
  }

  private emitSteam(dt: number): void {
    const sp = this.splash();
    const rate = this.age < IGNITE ? 0 : 95 * sp.k;
    this.puffCarry += dt * rate;
    while (this.puffCarry >= 1) {
      this.puffCarry -= 1;
      const side = this.rand() < 0.5 ? -1 : 1;
      const fast = this.rand();
      const r0 = this.H * (0.035 + this.rand() * 0.05);
      this.addPuff({
        x: sp.x + side * this.rand() * this.W * 0.9,
        y: sp.y - this.rand() * this.H * 0.03,
        vx: side * (0.25 + fast * 1.25) * this.H,
        vy: -(0.02 + this.rand() * 0.18) * this.H * (1 - fast * 0.6),
        r: r0,
        grow: r0 * (2 + this.rand() * 2.2),
        age: 0,
        life: 4.5 + this.rand() * 3.5,
        alpha: 0.38 + this.rand() * 0.22,
        v: (this.rand() * 3) | 0,
      });
    }
  }

  /** Ice shaken off the frosted tanks by the engines, then left behind at liftoff. */
  private emitFlakes(dt: number): void {
    const a = this.age;
    const env = smooth((a - IGNITE - 0.3) / 0.4) * (1 - smooth((a - LIFTOFF - 1.5) / 1.5));
    if (env <= 0 || this.staged) return;
    this.flakeCarry += dt * 70 * env;
    const c = Math.cos(this.ang);
    const sn = Math.sin(this.ang);
    while (this.flakeCarry >= 1) {
      this.flakeCarry -= 1;
      const side = this.rand() < 0.5 ? -1 : 1;
      const lx = side * this.W * (0.3 + 0.2 * this.rand());
      const ly = -this.B * (0.12 + 0.8 * this.rand());
      if (this.flakes.length >= MAX_FLAKES) this.flakes.shift();
      this.flakes.push({
        x: this.x + lx * c - ly * sn,
        y: this.y + lx * sn + ly * c,
        vx: sn * this.v * 0.6 + side * this.W * (0.4 + this.rand() * 1.2),
        vy: -c * this.v * 0.6 + this.W * this.rand() * 0.5,
        age: 0,
        life: 1.1 + this.rand() * 1.1,
        sz: this.W * (0.025 + this.rand() * 0.045),
      });
    }
  }

  private addPuff(p: Puff): void {
    if (this.puffs.length >= MAX_PUFFS) this.puffs.shift();
    this.puffs.push(p);
  }

  /** 1 = swung wide open, 0 = closed around the booster. */
  private armsOpen(): number {
    const b = this.boost;
    if (!b || b.phase < 2) return 1;
    return 1 - smooth((b.age - b.closeAt) / ARMS_CLOSE);
  }

  /** Arms and booster sag and settle on the arm shock absorbers after the catch. */
  private bounce(): number {
    const b = this.boost;
    if (!b || b.phase < 3) return 0;
    const k = b.age - b.caughtAt;
    return this.W * 0.09 * Math.exp(-4.5 * k) * Math.sin(14 * k);
  }

  /**
   * The chopstick carriage on the tower face and one arm. The arms swing in
   * the horizontal plane, so open arms point toward and away from the viewer
   * and look short; closed, they reach across the booster. The near arm draws
   * over the booster, the far one behind it.
   */
  private drawArm(ctx: CanvasRenderingContext2D, front: boolean): void {
    const W = this.W;
    const d = this.dir;
    const x0 = this.faceX;
    const sag = this.bounce();
    if (!front) {
      ctx.fillStyle = '#1e1f24';
      ctx.fillRect(Math.min(x0, x0 - d * W * 0.6), this.armY - W * 0.5 + sag * 0.6, W * 0.6, W * 0.95);
      ctx.fillStyle = 'rgba(150, 154, 160, 0.3)';
      ctx.fillRect(Math.min(x0, x0 - d * W * 0.6), this.armY - W * 0.5 + sag * 0.6, W * 0.6, W * 0.03);
    }
    const reach = this.armLen * Math.cos(this.armsOpen() * 1.2);
    const T = W * (front ? 0.17 : 0.15);
    const y = this.armY + sag + (front ? 0 : -W * 0.04);
    const tip = x0 + d * reach;
    ctx.fillStyle = front ? '#27292e' : '#18191d';
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(tip, y + T * 0.1);
    ctx.lineTo(tip, y + T * 0.75);
    ctx.lineTo(x0, y + T * 1.2);
    ctx.closePath();
    ctx.fill();
    // Truss web and the top chord the pins land on.
    ctx.strokeStyle = front ? 'rgba(150, 155, 162, 0.42)' : 'rgba(110, 114, 120, 0.28)';
    ctx.lineWidth = W * 0.02;
    ctx.beginPath();
    const n = Math.max(2, Math.round(reach / (W * 0.3)));
    for (let i = 0; i < n; i++) {
      const xa = x0 + (d * reach * i) / n;
      const xb = x0 + (d * reach * (i + 1)) / n;
      ctx.moveTo(xa, y + T * 0.2);
      ctx.lineTo(xb, y + T * 0.75);
    }
    ctx.stroke();
    ctx.fillStyle = front ? 'rgba(195, 199, 205, 0.4)' : 'rgba(150, 154, 160, 0.2)';
    ctx.fillRect(Math.min(x0, tip), y, reach, W * 0.025);
  }

  /**
   * Condensation around the stack through transonic / max-Q: a collar that
   * hugs the Ship's barrel and flares back, and a fainter one at the interstage.
   */
  private drawVaporCone(ctx: CanvasRenderingContext2D, k: number, t: number): void {
    const W = this.W;
    const collar = (y0: number, len: number, w0: number, w1: number, a: number) => {
      const gr = ctx.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, `rgba(238, 241, 246, ${0.55 * a})`);
      gr.addColorStop(0.3, `rgba(226, 230, 237, ${0.3 * a})`);
      gr.addColorStop(1, 'rgba(220, 225, 232, 0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(-w0, y0);
      ctx.bezierCurveTo(-w0 * 1.6, y0 + len * 0.35, -w1, y0 + len * 0.7, -w1 * 0.9, y0 + len);
      ctx.lineTo(w1 * 0.9, y0 + len);
      ctx.bezierCurveTo(w1, y0 + len * 0.7, w0 * 1.6, y0 + len * 0.35, w0, y0);
      ctx.closePath();
      ctx.fill();
    };
    const fl = 0.85 + 0.1 * Math.sin(t * 31) + 0.05 * Math.sin(t * 73);
    collar(-this.B - this.L * 0.62, W * 3.6, W * 0.5, W * 1.45, k * fl);
    collar(-this.B + W * 0.1, W * 2.4, W * 0.52, W * 1.2, k * 0.55 * fl);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const s = this.s;
    const a = this.age;
    const out = this.sceneOut < 0 ? 0 : smooth((a - this.sceneOut) / SCENE_FADE);
    const scene = smooth(a / FADE_IN) * (1 - out);
    const I = this.boosterThrust();
    const sp = this.splash();
    const t = a;
    const W = this.W;
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(s, s);

    // Ground: a hairline horizon fading out to the sides, the pad slab, and
    // the glow where the plume hits.
    if (scene > 0) {
      const span = this.H * 2.4;
      const gl = ctx.createLinearGradient(-span, 0, span, 0);
      gl.addColorStop(0, 'rgba(169, 175, 185, 0)');
      gl.addColorStop(0.5, 'rgba(169, 175, 185, 0.34)');
      gl.addColorStop(1, 'rgba(169, 175, 185, 0)');
      ctx.globalAlpha = scene;
      ctx.fillStyle = gl;
      ctx.fillRect(-span, 0, span * 2, 1);
      ctx.fillStyle = 'rgba(22, 23, 26, 0.95)';
      ctx.fillRect(-this.H * 0.42, 0, this.H * 0.84, this.H * 0.014);
    }
    const lit = Math.max(sp.k, I * (1 - this.altitude()));
    if (lit > 0.01) {
      const rg = this.H * 0.75;
      const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, rg);
      g.addColorStop(0, 'rgba(255, 170, 90, 0.5)');
      g.addColorStop(0.3, 'rgba(255, 130, 60, 0.2)');
      g.addColorStop(1, 'rgba(255, 110, 50, 0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = lit * scene;
      ctx.fillStyle = g;
      ctx.fillRect(sp.x - rg, sp.y - rg, rg * 2, rg - sp.y + this.H * 0.02);
      ctx.restore();
    }

    // Tower (+ aviation light), the far chopstick and the launch mount.
    const tw = this.sprites.tower;
    if (tw && scene > 0) {
      ctx.save();
      ctx.globalAlpha = scene;
      ctx.translate(this.towerX, 0);
      // Sprite is authored with the stack on +x; mirror when the tower is on the right.
      if (this.dir < 0) ctx.scale(-1, 1);
      ctx.drawImage(tw.c, -tw.ax, -tw.h, tw.w, tw.h);
      ctx.restore();
      const blink = Math.sin(t * Math.PI * 2 * 0.8) > 0.55 ? 1 : 0.15;
      ctx.globalAlpha = scene * blink;
      ctx.fillStyle = '#ff5f6d';
      ctx.beginPath();
      ctx.arc(this.towerX, -this.towerH - W * 0.9 * 0.95, W * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
    if (scene > 0) {
      ctx.globalAlpha = scene;
      this.drawArm(ctx, false);
    }
    const mt = this.sprites.mount;
    if (mt && scene > 0) {
      ctx.globalAlpha = scene;
      ctx.drawImage(mt.c, -mt.ax, -mt.h, mt.w, mt.h);
    }
    ctx.globalAlpha = 1;

    // Separated booster: plumes first so the hull sits on the nozzle glow.
    const b = this.boost;
    if (b) {
      ctx.save();
      ctx.translate(b.x, b.y + this.bounce());
      ctx.rotate(b.ang);
      // Sprite and plumes are anchored at the base; b.x, b.y is the middle.
      ctx.translate(0, this.B / 2);
      // Tail-off of the main burn right after separation.
      const tail = 1 - smooth(b.age / 0.35);
      if (tail > 0.01) drawPlume(ctx, W * 0.9, this.H * 0.5, this.H * 0.5, tail * scene, 2.2, t, SEA);
      // Flip on the 3 center engines, gimbaled to start and then stop the turn.
      const flip = this.flipEnv(b.age);
      if (flip > 0.01) {
        const k = clamp01((b.age - B_FLIP1[0]) / (B_FLIP1[1] - B_FLIP1[0]));
        const turn = Math.sign(-this.dir * 1.25 - b.ang0);
        ctx.save();
        ctx.rotate(-0.12 * turn * (1 - 2 * k));
        drawPlume(ctx, W * 0.3, this.H * 0.2, this.H * 0.2, flip * 0.7 * scene, 2.4, t + 1.7, SEA);
        ctx.restore();
      }
      // Boostback on 13 engines, in thin air.
      if (b.bb > 0.01) drawPlume(ctx, W * 0.62, this.H * 0.42, this.H * 0.42, b.bb * scene, 2.4, t + 3.1, SEA);
      // Landing burn: 13 engines, then the center 3; cut where it hits the mount.
      if (b.land > 0.01) {
        const full = this.landLen(b);
        const dist = this.landHit(b).dist;
        drawPlume(ctx, W * (0.62 - 0.32 * b.few), Math.min(full, dist), full, b.land * scene, 1.15, t + 7.3, SEA);
      }
      const bs = this.sprites.booster;
      if (bs) {
        ctx.globalAlpha = scene;
        ctx.drawImage(bs.c, -bs.ax, -bs.ay, bs.w, bs.h);
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // Bells still glowing dull red once the engines are off.
      const eng = Math.max(tail, flip, b.bb, b.land);
      const glow = Math.max(0, b.heat - eng);
      if (glow > 0.01) {
        const rg = W * 0.7;
        const gg = ctx.createRadialGradient(0, W * 0.2, 0, 0, W * 0.2, rg);
        gg.addColorStop(0, 'rgba(255, 110, 50, 0.55)');
        gg.addColorStop(1, 'rgba(200, 50, 30, 0)');
        ctx.globalAlpha = glow * scene;
        ctx.fillStyle = gg;
        ctx.fillRect(-rg, W * 0.2 - rg, rg * 2, rg * 2);
      }
      // Hot staging: the Ship's engines blast the top of the ring.
      const scorch = 1 - smooth(b.age / 0.8);
      if (scorch > 0.01) {
        const rg = W * 0.95;
        const gg = ctx.createRadialGradient(0, -this.B, 0, 0, -this.B, rg);
        gg.addColorStop(0, 'rgba(255, 200, 130, 0.7)');
        gg.addColorStop(1, 'rgba(255, 120, 50, 0)');
        ctx.globalAlpha = scorch * scene;
        ctx.fillStyle = gg;
        ctx.fillRect(-rg, -this.B - rg, rg * 2, rg * 2);
      }
      ctx.restore();
      ctx.restore();
    }
    if (scene > 0) {
      ctx.globalAlpha = scene;
      this.drawArm(ctx, true);
      ctx.globalAlpha = 1;
    }

    // Stack (or Ship alone after staging).
    const shipI = this.shipThrust();
    const tl = a - LIFTOFF;
    const shipFade = 1 - smooth((tl - SHIP_FADE_AT) / SHIP_FADE);
    if (shipFade > 0) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.ang);
      ctx.globalAlpha = shipFade * scene;
      const bs = this.sprites.booster;
      const ss = this.sprites.ship;
      const shipBase = this.staged ? 0 : -this.B;
      if (!this.staged && bs) ctx.drawImage(bs.c, -bs.ax, -bs.ay, bs.w, bs.h);
      if (ss) ctx.drawImage(ss.c, -ss.ax, shipBase - ss.ay, ss.w, ss.h);
      // Warm plume light on the lower hull.
      if (!this.staged && I > 0.01) {
        const lg = ctx.createLinearGradient(0, 0, 0, -this.B * 0.4);
        lg.addColorStop(0, 'rgba(255, 150, 70, 0.4)');
        lg.addColorStop(1, 'rgba(255, 150, 70, 0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha *= I;
        ctx.fillStyle = lg;
        ctx.fillRect(-W / 2, -this.B * 0.4, W, this.B * 0.4);
        ctx.restore();
      }
      // Vapor cone through max-Q.
      const vc = this.staged || tl < 3.9 || tl > 5.9 ? 0 : Math.pow(Math.sin((Math.PI * (tl - 3.9)) / 2), 2);
      if (vc > 0.01) {
        ctx.save();
        ctx.globalAlpha *= 0.9;
        this.drawVaporCone(ctx, vc, t);
        ctx.restore();
      }
      // Booster plume, cut where it meets the ground.
      if (!this.staged && I > 0.01) {
        const c = Math.cos(this.ang);
        const toGround = -this.y / Math.max(0.2, c);
        const full = this.plumeLen();
        drawPlume(ctx, W * 0.94, Math.min(full, toGround), full, I * scene, 1 + this.altitude() * 1.1, t, SEA);
      }
      // Ship engines: vacuum plume off the Ship's base (under the ring before separation).
      if (shipI > 0.01) {
        ctx.save();
        ctx.translate(0, shipBase);
        const sepAge = tl - SEP;
        if (sepAge < 0.25) {
          // Hot staging: the plume vents out sideways through the ring.
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = shipI * (1 - smooth(sepAge / 0.25)) * 0.9 * scene;
          for (const side of [-1, 1]) {
            const jg = ctx.createLinearGradient(0, 0, side * W * 1.6, 0);
            jg.addColorStop(0, 'rgba(255, 230, 190, 1)');
            jg.addColorStop(0.4, 'rgba(255, 150, 70, 0.7)');
            jg.addColorStop(1, 'rgba(255, 110, 50, 0)');
            ctx.fillStyle = jg;
            ctx.beginPath();
            ctx.moveTo(side * W * 0.45, -W * 0.05);
            ctx.lineTo(side * W * 1.7, -W * 0.45);
            ctx.lineTo(side * W * 1.7, W * 0.55);
            ctx.lineTo(side * W * 0.45, W * 0.2);
            ctx.closePath();
            ctx.fill();
          }
          ctx.restore();
        }
        if (this.staged) drawPlume(ctx, W * 0.72, this.H * 0.5, this.H * 0.5, shipI * scene, 2.1, t, VAC);
        ctx.restore();
      }
      ctx.restore();
    }

    // Frost flakes.
    if (this.flakes.length) {
      ctx.fillStyle = 'rgb(232, 236, 241)';
      for (const f of this.flakes) {
        const k = f.age / f.life;
        ctx.globalAlpha = 0.75 * (1 - k) * scene;
        ctx.fillRect(f.x - f.sz / 2, f.y - f.sz / 2, f.sz, f.sz * 0.7);
      }
      ctx.globalAlpha = 1;
    }

    // Steam cloud over the pad, lit orange near the plume.
    const ps = puffSprites();
    if (ps && this.puffs.length) {
      for (const p of this.puffs) {
        const k = p.age / p.life;
        const al = p.alpha * Math.min(1, k / 0.08) * Math.pow(1 - k, 1.3) * scene;
        const r = p.r + (p.grow - p.r) * (1 - Math.pow(1 - k, 2));
        ctx.globalAlpha = al;
        ctx.drawImage(ps.soft[p.v], p.x - r, p.y - r, r * 2, r * 2);
      }
      if (lit > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const reach = this.H * 0.6;
        for (const p of this.puffs) {
          const d = Math.hypot(p.x - sp.x, p.y - sp.y) / reach;
          if (d >= 1) continue;
          const k = p.age / p.life;
          const r = p.r + (p.grow - p.r) * (1 - Math.pow(1 - k, 2));
          ctx.globalAlpha = lit * (1 - d) * (1 - d) * 0.75 * (1 - k) * scene;
          ctx.drawImage(ps.glow[p.v], p.x - r, p.y - r, r * 2, r * 2);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    // Staging flash.
    const sepAge = tl - SEP + 0.3;
    if (sepAge > 0 && sepAge < 0.7) {
      const f = Math.sin((sepAge / 0.7) * Math.PI);
      const fx = this.staged ? this.x : this.x + Math.sin(this.ang) * this.B;
      const fy = this.staged ? this.y : this.y - Math.cos(this.ang) * this.B;
      const rf = W * 3.2;
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, rf);
      g.addColorStop(0, 'rgba(255, 244, 225, 0.9)');
      g.addColorStop(0.25, 'rgba(255, 180, 100, 0.45)');
      g.addColorStop(1, 'rgba(255, 140, 60, 0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = f * scene;
      ctx.fillStyle = g;
      ctx.fillRect(fx - rf, fy - rf, rf * 2, rf * 2);
      ctx.restore();
    }
    ctx.restore();
  }
}
