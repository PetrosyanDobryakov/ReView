import { useEffect, useRef } from 'react';
import { orbitView } from '../core/orbit';

/**
 * Orbit deep-space backdrop under the transparent board canvas. Four parallax
 * star layers and the sky behind them (galactic band, dust lanes, faint haze)
 * follow the board camera (see `orbitView`) in screen px with their own depth;
 * the sky also drifts on the wall clock. Offsets persist across remounts, so
 * nothing jumps. A dim work light follows the pointer and the edges fall off
 * into the void. On Home the field drifts.
 *
 * Stars are plain and static: pin-sharp point spread in device pixels,
 * heavy-tailed magnitudes (mostly faint, few bright), gray-to-white only, no
 * halo and no twinkle.
 *
 * Cost control: the soft sky renders at quarter size, stars at a capped full
 * size. Stars and sky are cached in a float buffer; the pointer light, vignette
 * and dither are a cheap fullscreen composite, so a moving cursor does not rerun
 * the star or nebula shaders. The field repaints on camera / warp change,
 * otherwise ~10fps for the nebula drift (the same clock as an idle view).
 * Paused when hidden or covered by solid paper. Reduced motion freezes time and
 * paints only on change.
 */

/**
 * Parallax depth per layer: 0 = infinitely far, 1 = glued to the board.
 * `bright` scales the heavy-tailed magnitude curve: far layers are dust, only the
 * nearest layer carries the few bright stars.
 */
const LAYERS = [
  { depth: 0.04, cell: 24, density: 0.5, bright: 0.45, seed: 5.7 },
  { depth: 0.12, cell: 54, density: 0.42, bright: 0.75, seed: 11.3 },
  { depth: 0.3, cell: 118, density: 0.34, bright: 1.0, seed: 47.9 },
  { depth: 0.55, cell: 230, density: 0.26, bright: 1.25, seed: 83.1 },
] as const;
/** Sky (band, dust, haze) breathes a little with zoom. */
const NEBULA_ZOOM = 0.03;
/** Sky parallax: slides this share of the on-screen pan, like the far star layers. */
const NEBULA_DEPTH = 0.1;
/** Cloud drift in sky units per second, driven by the wall clock. */
const NEBULA_DRIFT = { x: 1.2, y: 0.4 };
/** Galactic band repeat distance on the nebula layer. */
const BAND_PERIOD = 6000;
/** Hash lattice period in cells; offsets wrap at `cell * PERIOD` to keep float precision. */
const PERIOD = 512;
const MAX_PIXELS = 2_400_000;
/** Idle repaint interval: only the nebula drift moves while idle. */
const IDLE_FRAME_MS = 100;
const HOME_DRIFT = { x: 6, y: 2.5 };
/** Warp jump length (Home <-> board, see navTransition) and when it peaks (0..1). */
const WARP_MS = 1000;
const WARP_PEAK = 0.3;
/**
 * Range (sky units) a jump re-rolls the cloud / band offset across: several
 * band periods and far past the cloud features, so every arrival looks new.
 */
const SKY_RESEED_SPAN = 60_000;

/** Warp strength over the jump: fast surge in, long ease back out. */
function warpEnvelope(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  if (u < WARP_PEAK) {
    const k = u / WARP_PEAK;
    return k * k;
  }
  const k = (u - WARP_PEAK) / (1 - WARP_PEAK);
  return 1 - k * k * (3 - 2 * k);
}
/**
 * The sky (base, band, dust, haze) is soft, so it renders into a buffer at
 * 1/NEBULA_DIV of CSS size and is upscaled. The fbm there is the expensive
 * part; at full resolution a zoom on a modest GPU drops to a few frames and
 * the clouds visibly jump.
 */
const NEBULA_DIV = 4;

/**
 * Star layer offsets (x, y per layer) plus the sky offset (last pair) live at
 * module scope and in sessionStorage, so a remount or reload of the backdrop
 * (Home <-> board, hot reload) resumes the same sky instead of snapping back
 * to the origin.
 */
const SKY_KEY = 'review-orbit-sky';
const SKY_I = LAYERS.length * 2;
const skyOff = (() => {
  const off = new Float64Array(SKY_I + 2);
  try {
    const raw = JSON.parse(sessionStorage.getItem(SKY_KEY) || 'null');
    if (Array.isArray(raw) && raw.length === off.length && raw.every((v) => Number.isFinite(v))) off.set(raw);
  } catch {
    /* private mode / bad data: start at the origin */
  }
  return off;
})();

function saveSky(): void {
  try {
    sessionStorage.setItem(SKY_KEY, JSON.stringify(Array.from(skyOff)));
  } catch {
    /* ignore */
  }
}

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const NOISE = `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`;

/** Sky pass (low-res): base gradient, galactic band with dust lanes, haze. Alpha = band. */
const NEB_FRAG = `
precision highp float;
uniform vec2 uNebRes;
uniform vec2 uCss;
uniform vec2 uOffN;
uniform vec2 uBand;
uniform float uZoomN;
uniform float uWarp;
${NOISE}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(mod(i, ${PERIOD}.0));
  float b = hash21(mod(i + vec2(1.0, 0.0), ${PERIOD}.0));
  float c = hash21(mod(i + vec2(0.0, 1.0), ${PERIOD}.0));
  float d = hash21(mod(i + vec2(1.0, 1.0), ${PERIOD}.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec2(17.1, 9.4);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uNebRes;
  // CSS px from screen center, y down like the board.
  vec2 css = (uv - 0.5) * uCss;
  css.y = -css.y;
  // Warp jump: the sky surges toward the viewer and settles back.
  css *= 1.0 - 0.14 * uWarp;

  vec3 col = mix(vec3(0.02, 0.02, 0.023), vec3(0.01, 0.01, 0.012), uv.y);

  // Galactic band on the deepest layer: a soft diagonal glow with dust lanes,
  // plus a very faint neutral haze elsewhere.
  vec2 q = uOffN + css / uZoomN;
  // The band follows the sky parallax and repeats every ${BAND_PERIOD} units.
  float across = dot(uBand + css / uZoomN, vec2(0.52, 0.85)) + 180.0;
  across = mod(across + ${BAND_PERIOD / 2}.0, ${BAND_PERIOD}.0) - ${BAND_PERIOD / 2}.0;
  float band = exp(-pow(across / 380.0, 2.0));
  float dust = fbm(q * 0.0022 + 7.0);
  float lanes = smoothstep(0.45, 0.72, fbm(q * 0.004 + 31.0));
  vec3 milky = vec3(0.16, 0.16, 0.165) * band * (0.35 + 0.65 * dust) * (1.0 - 0.75 * lanes);
  col += milky * 0.7;
  float n = fbm(q * 0.0009);
  float m = fbm(q * 0.0005 + 23.0);
  vec3 tint = vec3(mix(0.1, 0.13, smoothstep(0.35, 0.75, m)));
  col += tint * smoothstep(0.45, 0.95, n) * 0.45;
  gl_FragColor = vec4(col, band);
}
`;

const STAR_LIB = `
// Monochrome: every star is a neutral gray-to-white point; only brightness varies.
vec3 starTint(float t) {
  return vec3(mix(0.62, 1.0, t));
}

vec3 stars(vec2 css, vec2 off, float zoom, float cell, float density, float bright, float seed) {
  vec2 p = off + css / zoom;
  vec2 id = mod(floor(p / cell), ${PERIOD}.0);
  float h = hash21(id + seed);
  if (h > density) return vec3(0.0);
  vec2 f = p - floor(p / cell) * cell;
  vec2 pos = (0.1 + 0.8 * vec2(hash21(id + seed * 1.7), hash21(id + seed * 2.3))) * cell;
  float dPx = length(f - pos) * zoom;
  // Heavy-tailed magnitudes: most stars sit near the visibility floor.
  float b = pow(hash21(id + seed * 3.1), 7.0) * bright;
  float amp = 0.05 + 0.85 * min(b, 1.0);
  // Point spread in device pixels, so stars stay pin-sharp at any DPR. No
  // halo, no twinkle: plain static points.
  float sigma = (0.5 + 0.25 * min(b, 1.0)) / uScale;
  float psf = exp(-(dPx * dPx) / (2.0 * sigma * sigma));
  // Fade a layer out once its cells shrink on screen (deep zoom-out).
  float fade = smoothstep(10.0, 36.0, cell * zoom);
  return starTint(hash21(id + seed * 5.9)) * psf * amp * fade;
}

// Warp streaks: each star smeared from its position toward the screen center
// by \`k\` of its distance (bright head, dimmer tail), capped at about one cell
// so the 3x3 neighborhood always contains the whole streak. Only runs while a
// warp jump is on.
vec3 starsWarp(vec2 css, vec2 off, float zoom, float cell, float density, float bright, float seed, float k) {
  vec2 p = off + css / zoom;
  vec2 base = floor(p / cell);
  vec3 acc = vec3(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = base + vec2(float(i), float(j));
      vec2 id = mod(c, ${PERIOD}.0);
      float h = hash21(id + seed);
      if (h > density) continue;
      vec2 pos = (0.1 + 0.8 * vec2(hash21(id + seed * 1.7), hash21(id + seed * 2.3))) * cell;
      vec2 s = (c * cell + pos - off) * zoom;
      float len = min(k * length(s), cell * zoom * 0.95);
      vec2 tail = s - normalize(s + 1e-4) * len;
      vec2 pa = css - tail;
      vec2 ba = s - tail;
      float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
      float d = length(pa - ba * t);
      float b = pow(hash21(id + seed * 3.1), 7.0) * bright;
      float amp = 0.12 + 0.85 * min(b, 1.0);
      float sigma = (0.55 + 0.25 * min(b, 1.0)) / uScale;
      float psf = exp(-(d * d) / (2.0 * sigma * sigma)) * mix(0.25, 1.0, t);
      acc += starTint(hash21(id + seed * 5.9)) * psf * amp;
    }
  }
  return acc * smoothstep(10.0, 36.0, cell * zoom);
}
`;

/**
 * `present` is the original full-screen pass (sky, pointer, stars, vignette, dither).
 * The cache path renders stars only into a float buffer; compose rebuilds the same
 * expression. Stars are stored /16 so a clamped float target still round-trips
 * (×16 is exact in fp32) while a pixel stays under 16.
 */
function skyShader(present: boolean): string {
  return `
precision highp float;
uniform vec2 uRes;
uniform float uScale;
uniform float uTime;
uniform sampler2D uNeb;
uniform vec2 uOff[${LAYERS.length}];
uniform float uZoom[${LAYERS.length}];
uniform float uCell[${LAYERS.length}];
uniform float uDensity[${LAYERS.length}];
uniform float uBright[${LAYERS.length}];
uniform float uSeed[${LAYERS.length}];
uniform float uDepth[${LAYERS.length}];
${present ? 'uniform vec3 uPointer;' : ''}
uniform float uWarp;
${NOISE}
${STAR_LIB}
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  // CSS px from screen center, y down like the board.
  vec2 css = (frag - 0.5 * uRes) / uScale;
  css.y = -css.y;

  vec4 sky = texture2D(uNeb, uv);
  vec3 col = vec3(0.0);
  ${
    present
      ? `// The clouds dip toward black at the warp peak so the swap to a new patch
  // of sky is never seen as a pop.
  col = sky.rgb * (1.0 - 0.85 * uWarp);

  // Faint work light around the pointer (does not touch the stars).
  if (uPointer.z > 0.0) {
    vec2 pd = (frag - uPointer.xy) / uScale;
    col += vec3(0.34, 0.34, 0.36) * exp(-dot(pd, pd) / (2.0 * 260.0 * 260.0)) * uPointer.z * 0.035;
  }`
      : ''
  }

  // Denser, brighter star population inside the band.
  float crowd = 1.0 + sky.a * 0.9;
  if (uWarp > 0.001) {
    for (int i = 0; i < ${LAYERS.length}; i++) {
      float k = uWarp * (0.12 + 0.6 * uDepth[i]);
      col += starsWarp(css, uOff[i], uZoom[i], uCell[i], uDensity[i] * crowd, uBright[i], uSeed[i], k) * (1.0 + 0.6 * uWarp);
    }
  } else {
    for (int i = 0; i < ${LAYERS.length}; i++) {
      col += stars(css, uOff[i], uZoom[i], uCell[i], uDensity[i] * crowd, uBright[i], uSeed[i]);
    }
  }

  ${
    present
      ? `// Edges fall into the void.
  vec2 v = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  col *= mix(1.0, 0.55, smoothstep(0.4, 1.1, length(v)));

  // Dither so the dark gradients do not band.
  col += (hash21(frag) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);`
      : `// Stars only. Sky, pointer, vignette and dither are applied in the compose pass
  // so a cursor move does not rerun this shader.
  gl_FragColor = vec4(col * (1.0 / 16.0), 1.0);`
  }
}
`;
}

/** Same tail as the full pass: sky, pointer light, cached stars, vignette, dither. */
const COMPOSE = `
precision highp float;
uniform vec2 uRes;
uniform float uScale;
uniform sampler2D uNeb;
uniform sampler2D uField;
uniform vec3 uPointer;
uniform float uWarp;
${NOISE}
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  vec4 sky = texture2D(uNeb, uv);
  vec3 col = sky.rgb * (1.0 - 0.85 * uWarp);
  if (uPointer.z > 0.0) {
    vec2 pd = (frag - uPointer.xy) / uScale;
    col += vec3(0.34, 0.34, 0.36) * exp(-dot(pd, pd) / (2.0 * 260.0 * 260.0)) * uPointer.z * 0.035;
  }
  col += texture2D(uField, uv).rgb * 16.0;
  vec2 v = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  col *= mix(1.0, 0.55, smoothstep(0.4, 1.1, length(v)));
  col += (hash21(frag) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[orbit] shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function wrap(v: number, period: number): number {
  return ((v % period) + period) % period;
}

function readCovered(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.orbitCovered === '1';
}

export function OrbitSpace() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'low-power',
    });
    if (!gl) return;

    const link = (frag: string): { prog: WebGLProgram; vs: WebGLShader; fs: WebGLShader } | null => {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
      const prog = gl.createProgram();
      if (!vs || !fs || !prog) return null;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, 'aPos');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn('[orbit] shader link failed:', gl.getProgramInfoLog(prog));
        return null;
      }
      return { prog, vs, fs };
    };
    const nebP = link(NEB_FRAG);
    const starP = link(skyShader(true));
    if (!nebP || !starP) return;

    // Float star cache: cursor motion composites the light without rerunning stars.
    // Fall back to the single full pass when a float color buffer is unavailable.
    const floatTexExt = gl.getExtension('OES_texture_float');
    const floatBufExt = gl.getExtension('WEBGL_color_buffer_float');
    let fieldTex: WebGLTexture | null = null;
    let fieldFb: WebGLFramebuffer | null = null;
    let useCache = Boolean(floatTexExt && floatBufExt);
    const fieldP = useCache ? link(skyShader(false)) : null;
    const composeP = useCache ? link(COMPOSE) : null;
    if (!fieldP || !composeP) useCache = false;
    if (useCache && fieldP && composeP) {
      fieldTex = gl.createTexture();
      fieldFb = gl.createFramebuffer();
      if (!fieldTex || !fieldFb) {
        useCache = false;
      } else {
        gl.bindTexture(gl.TEXTURE_2D, fieldTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.FLOAT, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fieldFb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);
        useCache = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Low-res sky target, linearly upscaled by the star pass.
    const nebTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, nebTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const nebFb = gl.createFramebuffer();
    let nebW = 1;
    let nebH = 1;

    const n = {
      res: gl.getUniformLocation(nebP.prog, 'uNebRes'),
      css: gl.getUniformLocation(nebP.prog, 'uCss'),
      offN: gl.getUniformLocation(nebP.prog, 'uOffN'),
      band: gl.getUniformLocation(nebP.prog, 'uBand'),
      zoomN: gl.getUniformLocation(nebP.prog, 'uZoomN'),
      warp: gl.getUniformLocation(nebP.prog, 'uWarp'),
    };
    const u = {
      res: gl.getUniformLocation(starP.prog, 'uRes'),
      scale: gl.getUniformLocation(starP.prog, 'uScale'),
      time: gl.getUniformLocation(starP.prog, 'uTime'),
      neb: gl.getUniformLocation(starP.prog, 'uNeb'),
      off: gl.getUniformLocation(starP.prog, 'uOff'),
      zoom: gl.getUniformLocation(starP.prog, 'uZoom'),
      cell: gl.getUniformLocation(starP.prog, 'uCell'),
      density: gl.getUniformLocation(starP.prog, 'uDensity'),
      bright: gl.getUniformLocation(starP.prog, 'uBright'),
      seed: gl.getUniformLocation(starP.prog, 'uSeed'),
      depth: gl.getUniformLocation(starP.prog, 'uDepth'),
      pointer: gl.getUniformLocation(starP.prog, 'uPointer'),
      warp: gl.getUniformLocation(starP.prog, 'uWarp'),
    };
    const fu = fieldP
      ? {
          res: gl.getUniformLocation(fieldP.prog, 'uRes'),
          scale: gl.getUniformLocation(fieldP.prog, 'uScale'),
          time: gl.getUniformLocation(fieldP.prog, 'uTime'),
          neb: gl.getUniformLocation(fieldP.prog, 'uNeb'),
          off: gl.getUniformLocation(fieldP.prog, 'uOff'),
          zoom: gl.getUniformLocation(fieldP.prog, 'uZoom'),
          cell: gl.getUniformLocation(fieldP.prog, 'uCell'),
          density: gl.getUniformLocation(fieldP.prog, 'uDensity'),
          bright: gl.getUniformLocation(fieldP.prog, 'uBright'),
          seed: gl.getUniformLocation(fieldP.prog, 'uSeed'),
          depth: gl.getUniformLocation(fieldP.prog, 'uDepth'),
          warp: gl.getUniformLocation(fieldP.prog, 'uWarp'),
        }
      : null;
    const cu = composeP
      ? {
          res: gl.getUniformLocation(composeP.prog, 'uRes'),
          scale: gl.getUniformLocation(composeP.prog, 'uScale'),
          neb: gl.getUniformLocation(composeP.prog, 'uNeb'),
          field: gl.getUniformLocation(composeP.prog, 'uField'),
          pointer: gl.getUniformLocation(composeP.prog, 'uPointer'),
          warp: gl.getUniformLocation(composeP.prog, 'uWarp'),
        }
      : null;

    const reduceMq = matchMedia('(prefers-reduced-motion: reduce)');
    let reduce = reduceMq.matches;
    let covered = readCovered();
    let visible = !document.hidden;

    let scale = 1;
    let cssSize: [number, number] = [1, 1];
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = window.innerWidth;
      const cssH = window.innerHeight;
      scale = Math.min(dpr, Math.sqrt(MAX_PIXELS / Math.max(1, cssW * cssH)));
      canvas.width = Math.max(1, Math.round(cssW * scale));
      canvas.height = Math.max(1, Math.round(cssH * scale));
      nebW = Math.max(1, Math.ceil(cssW / NEBULA_DIV));
      nebH = Math.max(1, Math.ceil(cssH / NEBULA_DIV));
      gl.bindTexture(gl.TEXTURE_2D, nebTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nebW, nebH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, nebFb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, nebTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (useCache && fieldTex && fieldFb) {
        gl.bindTexture(gl.TEXTURE_2D, fieldTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.FLOAT, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fieldFb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) useCache = false;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      cssSize = [cssW, cssH];
      fieldDirty = true;
    };

    // Layer offsets are integrated from camera deltas measured in SCREEN px, so
    // a layer always slides `depth` x the on-screen pan whatever the zoom.
    // (Integrating world deltas made the sky jump at low zoom: a zoom toward
    // the cursor at 10% moves the camera thousands of world units.) Switching
    // Home <-> board never jumps either.
    const layerOff = skyOff;
    const advance = (sx: number, sy: number, z: number) => {
      LAYERS.forEach((layer, i) => {
        const k = layer.depth / Math.pow(z, layer.depth);
        layerOff[i * 2] += sx * k;
        layerOff[i * 2 + 1] += sy * k;
      });
      const kn = NEBULA_DEPTH / Math.pow(z, NEBULA_ZOOM);
      layerOff[SKY_I] += sx * kn;
      layerOff[SKY_I + 1] += sy * kn;
    };
    // On top of the parallax, the cloud drift follows the wall clock, so it is
    // identical across remounts and reloads (a per-mount timer made the clouds
    // jump by hundreds of px whenever the backdrop remounted). Frozen under
    // reduced motion.
    const frozenAt = Date.now();
    let lastSave = 0;
    let lastLive = false;
    let lastX = 0;
    let lastY = 0;
    let zoom = 1;

    let pointerX = -1;
    let pointerY = -1;
    let pointerA = 0;
    let pointerTarget = 0;

    // Warp jump (Home <-> board): -1 when idle, else its start time.
    let warpT0 = -1;
    let warp = 0;
    let reseedPending = false;
    /** Jump every star layer and the clouds / band to a random spot in the field. */
    const reseedSky = () => {
      LAYERS.forEach((layer, i) => {
        const period = layer.cell * PERIOD;
        layerOff[i * 2] = Math.random() * period;
        layerOff[i * 2 + 1] = Math.random() * period;
      });
      // Random clouds, but nudge y so the galactic band (across = 0.52x + 0.85y
      // + 180, repeating every BAND_PERIOD) crosses the view within +-450 of
      // center: a fresh sky that is never an empty one.
      const x = Math.random() * SKY_RESEED_SPAN;
      const y0 = Math.random() * SKY_RESEED_SPAN;
      const want = -180 + (Math.random() - 0.5) * 900;
      const d = 0.52 * x + 0.85 * y0;
      const delta = (((want - d) % BAND_PERIOD) + BAND_PERIOD) % BAND_PERIOD;
      layerOff[SKY_I] = x;
      layerOff[SKY_I + 1] = y0 + delta / 0.85;
      saveSky();
      fieldDirty = true;
    };

    // Stars/sky vs pointer light. Light-only frames composite; they do not rerun stars.
    let fieldDirty = true;
    let lightDirty = true;
    let raf = 0;
    let lastField = 0;
    let lastT = performance.now();
    let clock = 0;

    const offs = new Float32Array(LAYERS.length * 2);
    const zooms = new Float32Array(LAYERS.length);
    const layerCells = LAYERS.map((l) => l.cell);
    const layerDensity = LAYERS.map((l) => l.density);
    const layerBright = LAYERS.map((l) => l.bright);
    const layerSeed = LAYERS.map((l) => l.seed);
    const layerDepth = LAYERS.map((l) => l.depth);
    const bindStars = (prog: WebGLProgram, loc: { cell: WebGLUniformLocation | null; density: WebGLUniformLocation | null; bright: WebGLUniformLocation | null; seed: WebGLUniformLocation | null; depth: WebGLUniformLocation | null; neb: WebGLUniformLocation | null }) => {
      gl.useProgram(prog);
      gl.uniform1fv(loc.cell, layerCells);
      gl.uniform1fv(loc.density, layerDensity);
      gl.uniform1fv(loc.bright, layerBright);
      gl.uniform1fv(loc.seed, layerSeed);
      gl.uniform1fv(loc.depth, layerDepth);
      gl.uniform1i(loc.neb, 0);
    };
    bindStars(starP.prog, u);
    if (useCache && fieldP && fu) bindStars(fieldP.prog, fu);
    if (useCache && composeP && cu) {
      gl.useProgram(composeP.prog);
      gl.uniform1i(cu.neb, 0);
      gl.uniform1i(cu.field, 1);
    }

    const paintNebula = (t: number, z: number) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, nebFb);
      gl.viewport(0, 0, nebW, nebH);
      gl.useProgram(nebP.prog);
      gl.uniform2f(n.res, nebW, nebH);
      gl.uniform2f(n.css, cssSize[0], cssSize[1]);
      // Nebula noise runs at 0.0011/unit; wrap well past its lattice period.
      const nPeriod = PERIOD / 0.0006;
      const wall = (reduce ? frozenAt : Date.now()) / 1000;
      const skyX = layerOff[SKY_I];
      const skyY = layerOff[SKY_I + 1];
      gl.uniform2f(n.offN, wrap(skyX + wall * NEBULA_DRIFT.x, nPeriod), wrap(skyY + wall * NEBULA_DRIFT.y, nPeriod));
      // The band slides with the parallax only (no drift); it repeats every
      // BAND_PERIOD so panning far always finds another one.
      gl.uniform2f(n.band, skyX, skyY);
      gl.uniform1f(n.zoomN, Math.pow(z, NEBULA_ZOOM));
      gl.uniform1f(n.warp, warp);
      if (t - lastSave > 1000) {
        lastSave = t;
        saveSky();
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const uploadStarView = (
      prog: WebGLProgram,
      loc: {
        res: WebGLUniformLocation | null;
        scale: WebGLUniformLocation | null;
        time: WebGLUniformLocation | null;
        off: WebGLUniformLocation | null;
        zoom: WebGLUniformLocation | null;
        warp: WebGLUniformLocation | null;
      }
    ) => {
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, nebTex);
      gl.uniform2f(loc.res, canvas.width, canvas.height);
      gl.uniform1f(loc.scale, scale);
      gl.uniform1f(loc.time, clock);
      gl.uniform2fv(loc.off, offs);
      gl.uniform1fv(loc.zoom, zooms);
      gl.uniform1f(loc.warp, warp);
    };

    const paintCompose = () => {
      if (!composeP || !cu || !fieldTex) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(composeP.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, nebTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fieldTex);
      gl.uniform2f(cu.res, canvas.width, canvas.height);
      gl.uniform1f(cu.scale, scale);
      gl.uniform1f(cu.warp, warp);
      gl.uniform3f(cu.pointer, pointerX * scale, canvas.height - pointerY * scale, pointerA);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const frame = (t: number) => {
      if (!visible || covered) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (t - lastT) / 1000);
      lastT = t;

      if (orbitView.live) {
        if (!lastLive) {
          lastX = orbitView.x;
          lastY = orbitView.y;
        }
        const dx = orbitView.x - lastX;
        const dy = orbitView.y - lastY;
        if (dx !== 0 || dy !== 0 || orbitView.zoom !== zoom) fieldDirty = true;
        advance(dx * orbitView.zoom, dy * orbitView.zoom, Math.max(0.01, orbitView.zoom));
        lastX = orbitView.x;
        lastY = orbitView.y;
        zoom = orbitView.zoom;
      } else if (!reduce) {
        advance(HOME_DRIFT.x * dt, HOME_DRIFT.y * dt, Math.max(0.01, zoom));
        if (zoom !== 1) {
          zoom += (1 - zoom) * Math.min(1, dt * 3);
          if (Math.abs(zoom - 1) < 0.002) zoom = 1;
          fieldDirty = true;
        }
      }
      lastLive = orbitView.live;

      if (pointerA !== pointerTarget) {
        const k = Math.min(1, dt * 6);
        pointerA += (pointerTarget - pointerA) * k;
        if (Math.abs(pointerA - pointerTarget) < 0.01) pointerA = pointerTarget;
        lightDirty = true;
      }

      if (warpT0 >= 0) {
        warp = warpEnvelope((t - warpT0) / WARP_MS);
        // Arrive somewhere new: swap the sky at the peak, hidden in the streaks.
        if (reseedPending && t - warpT0 >= WARP_MS * WARP_PEAK) {
          reseedPending = false;
          reseedSky();
        }
        if (t - warpT0 >= WARP_MS) {
          warpT0 = -1;
          warp = 0;
        }
        fieldDirty = true;
      }

      if (!reduce) clock += dt;
      // Field clock stays on the idle cadence. Pointer frames must not reset it,
      // or a moving cursor would freeze drift until the pointer stops.
      const idleDue = !reduce && t - lastField >= IDLE_FRAME_MS;
      if (idleDue) fieldDirty = true;
      if (!useCache && lightDirty) fieldDirty = true;
      if (!fieldDirty && !lightDirty) return;

      const z = Math.max(0.01, zoom);
      if (fieldDirty) {
        LAYERS.forEach((layer, i) => {
          const period = layer.cell * PERIOD;
          offs[i * 2] = wrap(layerOff[i * 2], period);
          offs[i * 2 + 1] = wrap(layerOff[i * 2 + 1], period);
          zooms[i] = Math.pow(z, layer.depth);
        });
        paintNebula(t, z);
        if (useCache && fieldP && fu && fieldFb) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fieldFb);
          gl.viewport(0, 0, canvas.width, canvas.height);
          uploadStarView(fieldP.prog, fu);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          paintCompose();
        } else {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, canvas.width, canvas.height);
          uploadStarView(starP.prog, u);
          gl.uniform3f(u.pointer, pointerX * scale, canvas.height - pointerY * scale, pointerA);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        fieldDirty = false;
        lightDirty = false;
        lastField = t;
        return;
      }

      paintCompose();
      lightDirty = false;
    };

    const ensure = () => {
      if (raf !== 0 || !visible || covered) return;
      raf = requestAnimationFrame(frame);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      pointerTarget = 1;
      if (e.clientX === pointerX && e.clientY === pointerY) return;
      pointerX = e.clientX;
      pointerY = e.clientY;
      lightDirty = true;
      ensure();
    };
    const onPointerOut = (e: PointerEvent) => {
      if (e.relatedTarget) return;
      pointerTarget = 0;
      ensure();
    };
    const onReduce = () => {
      reduce = reduceMq.matches;
      fieldDirty = true;
      ensure();
    };
    const onVis = () => {
      visible = !document.hidden;
      fieldDirty = true;
      ensure();
    };
    const onWarp = () => {
      fieldDirty = true;
      if (reduce) {
        reseedSky();
        ensure();
        return;
      }
      warpT0 = performance.now();
      reseedPending = true;
      ensure();
    };
    const onCover = () => {
      covered = readCovered();
      fieldDirty = true;
      ensure();
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      raf = 0;
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerout', onPointerOut);
    reduceMq.addEventListener('change', onReduce);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('review-orbit-cover', onCover);
    window.addEventListener('review-orbit-warp', onWarp);
    canvas.addEventListener('webglcontextlost', onLost);
    ensure();

    return () => {
      saveSky();
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerout', onPointerOut);
      reduceMq.removeEventListener('change', onReduce);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('review-orbit-cover', onCover);
      window.removeEventListener('review-orbit-warp', onWarp);
      canvas.removeEventListener('webglcontextlost', onLost);
      gl.deleteBuffer(buf);
      gl.deleteFramebuffer(nebFb);
      gl.deleteTexture(nebTex);
      if (fieldFb) gl.deleteFramebuffer(fieldFb);
      if (fieldTex) gl.deleteTexture(fieldTex);
      for (const p of [nebP, starP, fieldP, composeP]) {
        if (!p) continue;
        gl.deleteProgram(p.prog);
        gl.deleteShader(p.vs);
        gl.deleteShader(p.fs);
      }
    };
  }, []);

  return (
    <div className="orbit-space" aria-hidden="true">
      <canvas ref={canvasRef} className="orbit-space-canvas" />
    </div>
  );
}
