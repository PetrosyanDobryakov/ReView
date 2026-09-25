import { ORBIT_COLORS } from '../core/orbit';
import type { ShapeView } from '../core/shapes';
import { StarshipLaunch } from './starship';

/**
 * Orbit board particles, all in world space:
 * - `sprinkle`: the pen charts a constellation (stars beside the stroke joined
 *   by self-drawing hairlines) with a little fine dust;
 * - `burnUp`: a deleted / erased object breaks into embers that drift off,
 *   cooling from its own color through plume orange (re-entry);
 * - `spark`: a few glints off the corners when an object appears;
 * - `launch`: the rotate-knob easter egg — a two-stage rocket lifts off the
 *   knob, drops its booster, and the upper stage deploys a payload bloom.
 * Sizes and speeds are authored in screen px and converted with the zoom at
 * emission, so effects look the same at any zoom. Hard caps keep a big delete
 * or a long stroke cheap.
 */

type Kind = 'star' | 'ember' | 'flame' | 'vac' | 'smoke';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds lived / total. */
  age: number;
  life: number;
  /** Screen px at emission zoom, stored in world units. */
  size: number;
  color: string;
  kind: Kind;
  /** Per-particle phase for twinkle. */
  phase: number;
}

interface Rocket {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Heading, 0 = straight up (world −y), positive tilts right. */
  ang: number;
  /** Final pitch-over the ascent eases toward. */
  pitch: number;
  age: number;
  /** World units per screen px at launch. */
  s: number;
  /** Seconds before this rocket lights (staggered salvos). */
  delay: number;
  staged: boolean;
  deployed: boolean;
  emit: number;
}

/** Spent first stage; x, y is its middle so it turns about its own center. */
interface Booster {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ang: number;
  /** Angular velocity (rad/s) of the attitude spring. */
  av: number;
  /** -1 / 1: side the boostback leans the engines toward. */
  side: number;
  age: number;
  s: number;
  emit: number;
  puff: number;
}

const MAX_PARTICLES = 1400;
const DRAG = 2.4;
/** Screen px of pen travel per star thrown off the pen. */
const STAR_EVERY = 16;
/** Launch timeline (seconds after ignition). */
const LIFTOFF_HOLD = 0.35;
const STAGE_SEP = 1.9;
const DEPLOY = 3.1;
const ROCKET_END = 4.6;
/** The upper stage fades out over this last stretch. */
const ROCKET_FADE = 0.9;
const BOOSTER_LIFE = 3;
/** Booster timeline (seconds after separation). */
const BOOSTBACK = [0.35, 1.15] as const;
const ENTRY_BURN = [1.75, 2.15] as const;
const LEGS_OUT = 2.1;
/** Booster body half length (local units) and its engine end. */
const BOOSTER_HALF = 7;
/** Screen px/s² of ascent acceleration. */
const THRUST = 130;
/** Rocket hardware drawing scale (local units are ~screen px). */
const ROCKET_SCALE = 1.4;

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function isHex(c: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(c);
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

export class OrbitFx {
  private parts: Particle[] = [];
  private rockets: Rocket[] = [];
  private boosters: Booster[] = [];
  private ship: StarshipLaunch | null = null;
  /** Distance (screen px) carried between pen moves so emission follows speed. */
  private sprinkleCarry = 0;

  get alive(): boolean {
    return this.parts.length > 0 || this.rockets.length > 0 || this.boosters.length > 0 || this.ship !== null;
  }

  get starshipLive(): boolean {
    return this.ship !== null;
  }

  /**
   * Frenzy finale: a Starship launch from a pad near the bottom of the view.
   * `cx`/`bottom` = world x of the view center and y of its bottom edge;
   * `viewW`/`viewH` in screen px; `seed` keeps the profile identical for peers.
   */
  starship(cx: number, bottom: number, viewW: number, viewH: number, zoom: number, seed: number): void {
    this.ship = new StarshipLaunch(cx, bottom, viewW, viewH, zoom, seed);
  }

  private updateShip(dt: number): void {
    const sh = this.ship;
    if (!sh) return;
    sh.update(dt);
    if (!sh.alive) this.ship = null;
  }

  private push(p: Particle): void {
    if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
    this.parts.push(p);
  }

  /**
   * Pen moved from (x0,y0) to (x1,y1) in world units. Stars are thrown off the
   * line: one per ~16 screen px, sideways and a little backwards, slowing on
   * drag. Minimal: small solid white dots that shrink away.
   */
  sprinkle(x0: number, y0: number, x1: number, y1: number, zoom: number, _color: string): void {
    const s = 1 / zoom;
    const dx = x1 - x0;
    const dy = y1 - y0;
    this.sprinkleCarry += Math.hypot(dx, dy) * zoom;
    const n = Math.min(2, Math.floor(this.sprinkleCarry / STAR_EVERY));
    if (n <= 0) return;
    this.sprinkleCarry -= n * STAR_EVERY;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    for (let i = 0; i < n; i++) {
      const k = Math.random();
      const side = Math.random() < 0.5 ? -1 : 1;
      const spread = rand(18, 60);
      const back = rand(4, 24);
      this.push(
        makeStar(
          x0 + dx * k,
          y0 + dy * k,
          (-uy * side * spread - ux * back + rand(-8, 8)) * s,
          (ux * side * spread - uy * back + rand(-8, 8)) * s,
          s
        )
      );
    }
  }

  resetSprinkle(): void {
    this.sprinkleCarry = 0;
  }

  /** Break a removed object into embers along its outline / ink. */
  burnUp(v: ShapeView, zoom: number): void {
    const s = 1 / zoom;
    const onScreenArea = Math.max(1, v.w * zoom) * Math.max(1, v.h * zoom);
    const budget = Math.max(10, Math.min(70, Math.round(Math.sqrt(onScreenArea) / 3)));
    const base = isHex(v.stroke) ? v.stroke : isHex(v.fill) ? v.fill : ORBIT_COLORS.white;
    const pts = v.type === 'pen' && v.points && v.points.length >= 2 ? v.points : null;
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;
    // Slow shared drift so the debris reads as one object leaving, not a pop.
    const driftX = rand(-12, 12);
    const driftY = rand(-34, -18);
    for (let i = 0; i < budget; i++) {
      let x: number;
      let y: number;
      if (pts) {
        const j = Math.floor(Math.random() * (pts.length / 2)) * 2;
        x = pts[j];
        y = pts[j + 1];
      } else {
        x = v.x + Math.random() * v.w;
        y = v.y + Math.random() * v.h;
      }
      const ox = x - cx;
      const oy = y - cy;
      const ol = Math.hypot(ox, oy) || 1;
      const out = rand(8, 40);
      this.push({
        x,
        y,
        vx: ((ox / ol) * out + driftX + rand(-10, 10)) * s,
        vy: ((oy / ol) * out + driftY + rand(-10, 10)) * s,
        age: 0,
        life: rand(0.55, 1.1),
        size: rand(1.8, 3.6) * s,
        color: Math.random() < 0.3 ? ORBIT_COLORS.merlin : base,
        kind: 'ember',
        phase: 0,
      });
    }
  }

  /** New object: one quiet glint off each corner. */
  spark(v: ShapeView, zoom: number): void {
    const s = 1 / zoom;
    const corners = [
      [v.x, v.y, -1, -1],
      [v.x + v.w, v.y, 1, -1],
      [v.x + v.w, v.y + v.h, 1, 1],
      [v.x, v.y + v.h, -1, 1],
    ] as const;
    for (const [x, y, sx, sy] of corners) {
      this.push(makeStar(x, y, sx * rand(10, 26) * s, sy * rand(10, 26) * s, s, undefined, rand(0.5, 0.8)));
    }
  }

  /**
   * Rotate-knob easter egg: `power` rockets (streaks climb 1..6) lift off from
   * (x, y) in a staggered salvo. `seed` keeps trajectories identical for peers.
   */
  launch(x: number, y: number, zoom: number, power: number, seed?: number): void {
    const s = 1 / zoom;
    const r = mulberry32(seed ?? ((Math.random() * 0xffffffff) >>> 0));
    const count = Math.max(1, Math.min(6, Math.round(power)));
    for (let i = 0; i < count; i++) {
      const spread = count === 1 ? 0 : i / (count - 1) - 0.5;
      const pitchSide = spread === 0 ? (r() < 0.5 ? -1 : 1) : Math.sign(spread);
      this.rockets.push({
        x: x + spread * 34 * s,
        y,
        vx: 0,
        vy: 0,
        ang: 0,
        pitch: pitchSide * (0.12 + r() * 0.22),
        age: 0,
        s,
        delay: i * 0.14 + r() * 0.05,
        staged: false,
        deployed: false,
        emit: 0,
      });
    }
    if (this.rockets.length > 12) this.rockets.splice(0, this.rockets.length - 12);
  }

  update(dt: number): void {
    this.updateRockets(dt);
    this.updateShip(dt);
    if (!this.parts.length) return;
    const damp = Math.exp(-DRAG * dt);
    let w = 0;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const d = p.kind === 'smoke' ? Math.exp(-3.2 * dt) : damp;
      p.vx *= d;
      p.vy *= d;
      this.parts[w++] = p;
    }
    this.parts.length = w;
  }

  private updateRockets(dt: number): void {
    let w = 0;
    for (const rk of this.rockets) {
      if (rk.delay > 0) {
        rk.delay -= dt;
        if (rk.delay <= 0) this.padCloud(rk);
        this.rockets[w++] = rk;
        continue;
      }
      rk.age += dt;
      if (rk.age >= ROCKET_END) continue;
      const s = rk.s;
      if (rk.age > LIFTOFF_HOLD) {
        // Gravity turn: pitch over gradually as speed builds.
        const k = Math.min(1, (rk.age - LIFTOFF_HOLD) / 2);
        rk.ang = rk.pitch * k * k;
        const a = THRUST * (rk.staged ? 1.25 : 1) * s;
        rk.vx += Math.sin(rk.ang) * a * dt;
        rk.vy -= Math.cos(rk.ang) * a * dt;
      }
      rk.x += rk.vx * dt;
      rk.y += rk.vy * dt;

      if (!rk.staged && rk.age >= STAGE_SEP) {
        rk.staged = true;
        const k = BOOSTER_HALF * ROCKET_SCALE * s;
        this.boosters.push({
          x: rk.x - Math.sin(rk.ang) * k,
          y: rk.y + Math.cos(rk.ang) * k,
          vx: rk.vx * 0.9,
          vy: rk.vy * 0.9,
          ang: rk.ang,
          av: 0,
          side: rk.vx >= 0 ? 1 : -1,
          age: 0,
          s,
          emit: 0,
          puff: 0,
        });
        // Separation puff.
        for (let i = 0; i < 10; i++) {
          const a = rand(0, Math.PI * 2);
          const v = rand(20, 60);
          this.push({
            x: rk.x,
            y: rk.y,
            vx: Math.cos(a) * v * s + rk.vx * 0.5,
            vy: Math.sin(a) * v * s + rk.vy * 0.5,
            age: 0,
            life: rand(0.3, 0.6),
            size: rand(2, 4) * s,
            color: ORBIT_COLORS.white,
            kind: 'smoke',
            phase: 0,
          });
        }
      }
      if (!rk.deployed && rk.age >= DEPLOY) {
        rk.deployed = true;
        this.deployBloom(rk);
      }

      // Exhaust at the engine bell.
      const nx = Math.sin(rk.ang);
      const ny = -Math.cos(rk.ang);
      const tail = (rk.staged ? 6 : 16) * ROCKET_SCALE * s;
      const ex = rk.x - nx * tail;
      const ey = rk.y - ny * tail;
      rk.emit += dt * (rk.staged ? 50 : 90);
      while (rk.emit >= 1) {
        rk.emit -= 1;
        const back = rand(60, 140);
        const side = rand(-18, 18);
        if (rk.staged) {
          this.push({
            x: ex,
            y: ey,
            vx: (-nx * back + ny * side * 0.3) * s + rk.vx * 0.2,
            vy: (-ny * back - nx * side * 0.3) * s + rk.vy * 0.2,
            age: 0,
            life: rand(0.18, 0.35),
            size: rand(1.4, 2.4) * s,
            color: ORBIT_COLORS.dragon,
            kind: 'vac',
            phase: 0,
          });
        } else {
          this.push({
            x: ex,
            y: ey,
            vx: (-nx * back + ny * side) * s + rk.vx * 0.15,
            vy: (-ny * back - nx * side) * s + rk.vy * 0.15,
            age: 0,
            life: rand(0.14, 0.3),
            size: rand(1.4, 2.6) * s,
            color: ORBIT_COLORS.white,
            kind: 'flame',
            phase: 0,
          });
          if (Math.random() < 0.45) {
            this.push({
              x: ex,
              y: ey,
              vx: (-nx * back * 0.35 + ny * side * 1.6) * s,
              vy: (-ny * back * 0.35 - nx * side * 1.6) * s,
              age: 0,
              life: rand(0.8, 1.6),
              size: rand(3, 6) * s,
              color: '#8A8F99',
              kind: 'smoke',
              phase: 0,
            });
          }
        }
      }
      this.rockets[w++] = rk;
    }
    this.rockets.length = w;

    let b = 0;
    for (const bs of this.boosters) {
      bs.age += dt;
      if (bs.age >= BOOSTER_LIFE) continue;
      const s = bs.s;
      const t = bs.age;
      const boostback = t >= BOOSTBACK[0] && t < BOOSTBACK[1];
      const entry = t >= ENTRY_BURN[0] && t < ENTRY_BURN[1];
      // Attitude: a damped spring, never a free spin. Cold gas leans the
      // engines toward the direction of travel for the boostback, then brings
      // the stage upright, engines down, for the fall.
      const target = t < BOOSTBACK[1] + 0.1 ? -bs.side * 0.75 : 0;
      const stiff = 16;
      bs.av += (-(bs.ang - target) * stiff - bs.av * 2 * Math.sqrt(stiff)) * dt;
      bs.ang += bs.av * dt;
      // Gravity, a little air drag, and the burns (thrust along the body,
      // away from the engines).
      let ax = 0;
      let ay = 150 * s;
      if (boostback || entry) {
        const thrust = (boostback ? 230 : 330) * s;
        ax += Math.sin(bs.ang) * thrust;
        ay -= Math.cos(bs.ang) * thrust;
      }
      bs.vx += ax * dt;
      bs.vy += ay * dt;
      const drag = Math.exp(-0.35 * dt);
      bs.vx *= drag;
      bs.vy *= drag;
      bs.x += bs.vx * dt;
      bs.y += bs.vy * dt;

      const k = BOOSTER_HALF * ROCKET_SCALE * s;
      const sin = Math.sin(bs.ang);
      const cos = Math.cos(bs.ang);
      // Cold-gas puffs from the top while it turns.
      bs.puff += dt * 16;
      while (bs.puff >= 1) {
        bs.puff -= 1;
        if (Math.abs(bs.av) < 0.15 && t > 0.3) continue;
        const side = bs.av > 0 ? -1 : 1;
        this.push({
          x: bs.x + sin * k * 0.9,
          y: bs.y - cos * k * 0.9,
          vx: cos * side * rand(25, 45) * s + bs.vx * 0.6,
          vy: sin * side * rand(25, 45) * s + bs.vy * 0.6,
          age: 0,
          life: rand(0.2, 0.35),
          size: rand(1, 1.8) * s,
          color: ORBIT_COLORS.white,
          kind: 'smoke',
          phase: 0,
        });
      }
      // Engine sparks during the burns.
      if (boostback || entry) {
        bs.emit += dt * 60;
        while (bs.emit >= 1) {
          bs.emit -= 1;
          const out = rand(60, 120);
          const spread = rand(-12, 12);
          this.push({
            x: bs.x - sin * k,
            y: bs.y + cos * k,
            vx: (-sin * out + cos * spread) * s + bs.vx * 0.5,
            vy: (cos * out + sin * spread) * s + bs.vy * 0.5,
            age: 0,
            life: rand(0.12, 0.24),
            size: rand(1.2, 2.2) * s,
            color: ORBIT_COLORS.white,
            kind: 'flame',
            phase: 0,
          });
        }
      }
      this.boosters[b++] = bs;
    }
    this.boosters.length = b;
  }

  /** Ground cloud rolling out sideways from the pad at ignition. */
  private padCloud(rk: Rocket): void {
    const s = rk.s;
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1;
      this.push({
        x: rk.x + side * rand(0, 6) * s,
        y: rk.y + rand(-2, 3) * s,
        vx: side * rand(30, 110) * s,
        vy: rand(-18, 6) * s,
        age: 0,
        life: rand(0.9, 1.7),
        size: rand(3, 7) * s,
        color: '#9CA1AB',
        kind: 'smoke',
        phase: 0,
      });
    }
  }

  /** Payload deploy: a ring of glints opening around the upper stage. */
  private deployBloom(rk: Rocket): void {
    const s = rk.s;
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.1, 0.1);
      const v = rand(40, 75);
      const st = makeStar(
        rk.x,
        rk.y,
        Math.cos(a) * v * s + rk.vx * 0.3,
        Math.sin(a) * v * s + rk.vy * 0.3,
        s,
        undefined,
        rand(1.6, 2.4)
      );
      this.push(st);
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.alive) return;
    ctx.save();
    // The Starship scene sits behind the small rockets and board particles.
    this.ship?.draw(ctx);
    // Smoke next so flames sit on top of it.
    for (const p of this.parts) {
      if (p.kind !== 'smoke') continue;
      const t = p.age / p.life;
      ctx.globalAlpha = 0.22 * (1 - t) * Math.min(1, t * 8);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 + 2.2 * t), 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of this.parts) {
      const t = p.age / p.life;
      switch (p.kind) {
        case 'smoke':
          break;
        case 'star': {
          // Fully opaque: pops in, then shrinks away (no fade, no glow).
          const grow = Math.min(1, t / 0.1);
          const r = p.size * grow * Math.pow(1 - t, 0.8);
          drawStarPoint(ctx, p.x, p.y, r, p.color);
          break;
        }
        case 'ember': {
          // Own color -> plume orange -> abort red, shrinking, fading.
          ctx.globalAlpha = Math.max(0, 1 - t * t) * 0.9;
          ctx.fillStyle = t < 0.35 ? p.color : t < 0.7 ? ORBIT_COLORS.merlin : ORBIT_COLORS.abort;
          const r = p.size * (1 - t * 0.7);
          ctx.fillRect(p.x - r / 2, p.y - r / 2, r, r);
          break;
        }
        case 'flame': {
          // Cools smoothly from a white-hot core through amber to deep orange.
          ctx.globalAlpha = (1 - t) * (1 - t) * 0.85;
          ctx.fillStyle = flameColor(t);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'vac': {
          ctx.globalAlpha = (1 - t) * 0.7;
          ctx.fillStyle = t < 0.3 ? '#DCE7FA' : p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
    for (const bs of this.boosters) {
      ctx.globalAlpha = Math.max(0, Math.min(1, (BOOSTER_LIFE - bs.age) / 0.6));
      drawBooster(ctx, bs);
    }
    for (const rk of this.rockets) {
      if (rk.delay > 0) continue;
      const fade = rk.age > ROCKET_END - ROCKET_FADE ? (ROCKET_END - rk.age) / ROCKET_FADE : 1;
      ctx.globalAlpha = Math.max(0, fade);
      drawRocket(ctx, rk.x, rk.y, rk.ang, rk.s, rk.staged, rk.age);
    }
    ctx.restore();
  }
}

/**
 * A star particle. Size is heavy-tailed (mostly small, few larger); white
 * unless `tint` is given.
 */
function makeStar(
  x: number,
  y: number,
  vx: number,
  vy: number,
  s: number,
  tint?: string,
  life?: number
): Particle {
  const mag = Math.pow(Math.random(), 2.2);
  return {
    x,
    y,
    vx,
    vy,
    age: 0,
    life: life ?? rand(0.5, 1.05),
    size: (1 + 1.1 * mag) * s,
    color: tint ?? ORBIT_COLORS.white,
    kind: 'star',
    phase: rand(0, Math.PI * 2),
  };
}

/** Solid star: one fully opaque dot, no halo or transparency. */
function drawStarPoint(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  if (r <= 0) return;
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.75, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Two-stage rocket, nose along heading `ang` (0 = up). `s` = world per screen px.
 * Booster + interstage + upper stage + fairing until staging, then the upper
 * stage alone with a vacuum-bell glow.
 */
function drawRocket(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  s: number,
  staged: boolean,
  age: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.scale(s * ROCKET_SCALE, s * ROCKET_SCALE);
  const w = 3.6;
  // Local frame: y up is negative. Origin sits at the stage-1 / stage-2 joint.
  if (!staged) {
    // Booster body with grid fins and landing legs folded.
    ctx.fillStyle = ORBIT_COLORS.white;
    ctx.fillRect(-w / 2, 0, w, 14);
    ctx.fillStyle = '#2A2A2E';
    ctx.fillRect(-w / 2, -1.2, w, 1.6);
    ctx.fillRect(-w / 2 - 1.2, 1, 1.2, 0.8);
    ctx.fillRect(w / 2, 1, 1.2, 0.8);
    ctx.fillStyle = '#C9CDD4';
    ctx.fillRect(-w / 2 - 0.8, 11.5, 0.8, 2.5);
    ctx.fillRect(w / 2, 11.5, 0.8, 2.5);
    // Engine section + nine-engine sea-level plume; it lights on the pad and
    // lengthens as the air thins.
    ctx.fillStyle = '#3A3B40';
    ctx.fillRect(-w / 2 + 0.2, 14, w - 0.4, 0.8);
    const ignite = Math.min(1, age / 0.25);
    const climb = Math.min(1, Math.max(0, age - LIFTOFF_HOLD) / 1.4);
    drawPlume(ctx, 14.8, w * 0.9, 16 + 14 * climb, age, ignite, false);
  } else {
    // Single vacuum engine: a big bell and a wide, faint plume.
    ctx.fillStyle = '#3A3B40';
    ctx.beginPath();
    ctx.moveTo(-0.7, 0);
    ctx.lineTo(0.7, 0);
    ctx.lineTo(1.3, 1.8);
    ctx.lineTo(-1.3, 1.8);
    ctx.closePath();
    ctx.fill();
    drawPlume(ctx, 1.8, 2.4, 22, age, 1, true);
  }
  // Upper stage + fairing.
  ctx.fillStyle = ORBIT_COLORS.white;
  ctx.fillRect(-w / 2, -6, w, 6);
  ctx.beginPath();
  ctx.moveTo(-w / 2 - 0.3, -6);
  ctx.lineTo(-w / 2 - 0.3, -8.5);
  ctx.quadraticCurveTo(-w / 2 - 0.3, -11.5, 0, -12.5);
  ctx.quadraticCurveTo(w / 2 + 0.3, -11.5, w / 2 + 0.3, -8.5);
  ctx.lineTo(w / 2 + 0.3, -6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Spent first stage, drawn about its center: interstage and grid fins up top,
 * engines at the bottom, legs folded until the landing approach. Lit burns
 * use the same plume as the ascent.
 */
function drawBooster(ctx: CanvasRenderingContext2D, bs: Booster): void {
  const t = bs.age;
  ctx.save();
  ctx.translate(bs.x, bs.y);
  ctx.rotate(bs.ang);
  ctx.scale(bs.s * ROCKET_SCALE, bs.s * ROCKET_SCALE);
  const w = 3.6;
  const h = BOOSTER_HALF;
  const burning = (t >= BOOSTBACK[0] && t < BOOSTBACK[1]) || (t >= ENTRY_BURN[0] && t < ENTRY_BURN[1]);
  if (burning) {
    const start = t < BOOSTBACK[1] ? BOOSTBACK[0] : ENTRY_BURN[0];
    const end = t < BOOSTBACK[1] ? BOOSTBACK[1] : ENTRY_BURN[1];
    const on = Math.min(1, (t - start) / 0.08, (end - t) / 0.08);
    drawPlume(ctx, h + 0.8, w * 0.7, 11, t, on, false);
  }
  ctx.fillStyle = '#D6D9DF';
  ctx.fillRect(-w / 2, -h, w, h * 2);
  // Soot from re-entry darkens the lower half.
  ctx.fillStyle = 'rgba(40, 40, 44, 0.35)';
  ctx.fillRect(-w / 2, 0, w, h);
  ctx.fillStyle = '#2A2A2E';
  ctx.fillRect(-w / 2, -h - 1.2, w, 1.6);
  ctx.fillStyle = '#3A3B40';
  ctx.fillRect(-w / 2 + 0.2, h, w - 0.4, 0.8);
  // Grid fins out.
  ctx.fillStyle = '#9CA1AB';
  ctx.fillRect(-w / 2 - 1.4, -h + 0.6, 1.4, 1);
  ctx.fillRect(w / 2, -h + 0.6, 1.4, 1);
  // Legs swing out on approach.
  const legs = Math.max(0, Math.min(1, (t - LEGS_OUT) / 0.3));
  const a = 0.08 + legs * 0.55;
  ctx.strokeStyle = '#C9CDD4';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-w / 2, h - 3);
  ctx.lineTo(-w / 2 - Math.sin(a) * 4, h - 3 + Math.cos(a) * 4);
  ctx.moveTo(w / 2, h - 3);
  ctx.lineTo(w / 2 + Math.sin(a) * 4, h - 3 + Math.cos(a) * 4);
  ctx.stroke();
  ctx.restore();
}

/** Flame particle color over its life (0..1): white-hot, amber, deep orange. */
function flameColor(t: number): string {
  const stops: Array<[number, number, number, number]> = [
    [0, 255, 246, 228],
    [0.3, 255, 196, 110],
    [0.65, 255, 138, 64],
    [1, 190, 72, 40],
  ];
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const [t0, r0, g0, b0] = stops[i];
  const [t1, r1, g1, b1] = stops[i + 1];
  const k = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
  return `rgb(${Math.round(r0 + (r1 - r0) * k)}, ${Math.round(g0 + (g1 - g0) * k)}, ${Math.round(b0 + (b1 - b0) * k)})`;
}

/**
 * Engine plume in the stage's local frame, starting at the nozzle exit `y0`
 * and pointing down (+y). Sea level: a tight white core with shock diamonds
 * inside an amber-to-orange sheath. Vacuum: a wide, faint, pale-blue bloom.
 * `power` (0..1) scales it for ignition / shutdown; flicker is two
 * incommensurate sines so it never visibly loops.
 */
function drawPlume(
  ctx: CanvasRenderingContext2D,
  y0: number,
  w: number,
  len: number,
  age: number,
  power: number,
  vacuum: boolean
): void {
  if (power <= 0.01) return;
  const flick = 1 + 0.07 * Math.sin(age * 53) + 0.05 * Math.sin(age * 97 + 1.3);
  const L = len * flick * (0.35 + 0.65 * power);
  const hw = w / 2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha *= Math.min(1, power * 1.4);
  if (vacuum) {
    const g = ctx.createLinearGradient(0, y0, 0, y0 + L);
    g.addColorStop(0, 'rgba(236, 242, 255, 0.75)');
    g.addColorStop(0.25, 'rgba(190, 210, 255, 0.35)');
    g.addColorStop(1, 'rgba(140, 170, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-hw * 0.55, y0);
    ctx.bezierCurveTo(-hw * 1.4, y0 + L * 0.3, -hw * 2.4, y0 + L * 0.7, -hw * 1.6, y0 + L);
    ctx.lineTo(hw * 1.6, y0 + L);
    ctx.bezierCurveTo(hw * 2.4, y0 + L * 0.7, hw * 1.4, y0 + L * 0.3, hw * 0.55, y0);
    ctx.closePath();
    ctx.fill();
    const c = ctx.createLinearGradient(0, y0, 0, y0 + L * 0.35);
    c.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    c.addColorStop(1, 'rgba(210, 225, 255, 0)');
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-hw * 0.5, y0);
    ctx.quadraticCurveTo(-hw * 0.7, y0 + L * 0.2, 0, y0 + L * 0.35);
    ctx.quadraticCurveTo(hw * 0.7, y0 + L * 0.2, hw * 0.5, y0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }
  // Outer sheath: widens just past the nozzle, then tapers to a ragged tip.
  const sway = Math.sin(age * 31) * 0.25;
  const outer = ctx.createLinearGradient(0, y0, 0, y0 + L);
  outer.addColorStop(0, 'rgba(255, 214, 150, 0.85)');
  outer.addColorStop(0.2, 'rgba(255, 160, 70, 0.6)');
  outer.addColorStop(0.6, 'rgba(235, 96, 36, 0.25)');
  outer.addColorStop(1, 'rgba(200, 60, 20, 0)');
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.moveTo(-hw, y0);
  ctx.bezierCurveTo(-hw * 1.5, y0 + L * 0.25, -hw * 1.1, y0 + L * 0.7, sway, y0 + L);
  ctx.bezierCurveTo(hw * 1.1, y0 + L * 0.7, hw * 1.5, y0 + L * 0.25, hw, y0);
  ctx.closePath();
  ctx.fill();
  // Inner core: white-hot, short.
  const cl = L * 0.5;
  const core = ctx.createLinearGradient(0, y0, 0, y0 + cl);
  core.addColorStop(0, 'rgba(255, 255, 255, 1)');
  core.addColorStop(0.45, 'rgba(255, 240, 205, 0.85)');
  core.addColorStop(1, 'rgba(255, 200, 120, 0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.moveTo(-hw * 0.7, y0);
  ctx.bezierCurveTo(-hw * 0.8, y0 + cl * 0.4, -hw * 0.35, y0 + cl * 0.8, 0, y0 + cl);
  ctx.bezierCurveTo(hw * 0.35, y0 + cl * 0.8, hw * 0.8, y0 + cl * 0.4, hw * 0.7, y0);
  ctx.closePath();
  ctx.fill();
  // Shock diamonds along the core.
  for (let i = 0; i < 3; i++) {
    const cy = y0 + L * (0.14 + i * 0.13);
    const r = hw * (0.42 - i * 0.1);
    ctx.fillStyle = `rgba(255, 252, 240, ${(0.6 - i * 0.16) * power})`;
    ctx.beginPath();
    ctx.moveTo(0, cy - r * 1.3);
    ctx.lineTo(r, cy);
    ctx.lineTo(0, cy + r * 1.3);
    ctx.lineTo(-r, cy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
