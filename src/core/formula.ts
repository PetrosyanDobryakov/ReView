// MathJax via the official browser bundle (es5/tex-svg-full.js).
// The npm "js" API uses CJS require() internally and breaks under Vite,
// so we load the self-contained UMD build lazily instead.
import texSvgUrl from 'mathjax-full/es5/tex-svg-full.js?url';

export interface FormulaMetrics {
  valid: boolean;
  wEx: number;
  hEx: number;
}

interface CachedSvg extends FormulaMetrics {
  svg: string;
}

const svgCache = new Map<string, CachedSvg>();
const imgCache = new Map<string, HTMLImageElement>();
const readyListeners = new Set<() => void>();

let mathJaxReady = false;
let loadPromise: Promise<void> | null = null;

function notifyReady(): void {
  for (const l of [...readyListeners]) l();
}

export function onFormulaLoad(cb: () => void): () => void {
  readyListeners.add(cb);
  return () => {
    readyListeners.delete(cb);
  };
}

function ensureMathJax(): void {
  if (mathJaxReady || loadPromise) return;
  loadPromise = new Promise((resolve) => {
    const w = window as unknown as { MathJax?: Record<string, unknown> };
    w.MathJax = {
      loader: { load: [] },
      startup: { typeset: false },
      tex: { inlineMath: [['$', '$']], packages: { '[+]': ['ams'] } },
      svg: { fontCache: 'none' },
    };
    const script = document.createElement('script');
    script.src = texSvgUrl;
    script.onload = () => {
      const done = () => {
        mathJaxReady = true;
        notifyReady();
        resolve();
      };
      const startup = (w.MathJax as { startup?: { promise?: Promise<unknown>; updateDocument?: () => void } }).startup;
      if (startup?.promise) startup.promise.then(done, done);
      else done();
    };
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

export function renderFormula(latex: string): CachedSvg {
  const hit = svgCache.get(latex);
  if (hit) return hit;
  ensureMathJax();
  let entry: CachedSvg;
  const w = window as unknown as { MathJax?: { tex2svg?: (s: string, o?: object) => Element } };
  const tex2svg = mathJaxReady ? w.MathJax?.tex2svg : undefined;
  try {
    if (!tex2svg) throw new Error('not ready');
    const container = tex2svg(latex, { display: false });
    const svgEl = container.querySelector('svg');
    if (!svgEl) throw new Error('no svg');
    const svg = new XMLSerializer().serializeToString(svgEl);
    const wEx = parseFloat(/width="([\d.-]+)ex"/.exec(svg)?.[1] ?? '1');
    const hEx = parseFloat(/height="([\d.-]+)ex"/.exec(svg)?.[1] ?? '1');
    entry = {
      svg,
      wEx: isFinite(wEx) && wEx > 0 ? wEx : 1,
      hEx: isFinite(hEx) && hEx > 0 ? hEx : 1,
      valid: true,
    };
  } catch {
    entry = { svg: '', wEx: 0, hEx: 0, valid: false };
  }
  if (svgCache.size > 300) svgCache.clear();
  svgCache.set(latex, entry);
  return entry;
}

export function formulaImage(
  latex: string,
  fontSize: number,
): { img: HTMLImageElement | null; w: number; h: number } {
  const r = renderFormula(latex);
  const k = fontSize / 2;
  const w = Math.max(1, Math.round(r.wEx * k));
  const h = Math.max(1, Math.round(r.hEx * k));
  if (!r.valid || !isFinite(w) || !isFinite(h)) return { img: null, w, h };
  const key = `${latex}@${w}x${h}`;
  const hit = imgCache.get(key);
  if (hit) return { img: hit.complete && hit.naturalWidth > 0 ? hit : null, w, h };
  const px = r.svg
    .replace(/width="[^"]+"/, `width="${w}"`)
    .replace(/height="[^"]+"/, `height="${h}"`);
  const img = new Image();
  img.onload = () => notifyReady();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(px);
  imgCache.set(key, img);
  return { img: null, w, h };
}
