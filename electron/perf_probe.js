// Injected when REVIEW_PERF is set (electron/main.cjs): frame pacing and paint
// cost, printed to the main process stdout as `PERF {...}` lines.
(() => {
  if (window.top !== window) return;
  const P = (window.__reviewPerf = { renders: [], orbits: [], render(ms) { this.renders.push(ms); }, orbit(ms) { this.orbits.push(ms); } });
  const log = (o) => console.log('PERF ' + JSON.stringify(o));
  let frames = [], last = 0, longTasks = 0, moves = 0, wheels = 0, longFrames = [];
  const tick = (t) => {
    if (last) {
      const d = t - last;
      frames.push(d);
      if (d > 50) longFrames.push(Math.round(d));
    }
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks += e.duration; }).observe({ entryTypes: ['longtask'] }); } catch {}
  addEventListener('pointermove', () => moves++, { capture: true, passive: true });
  addEventListener('wheel', () => wheels++, { capture: true, passive: true });
  const stat = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), q = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
    return { n: a.length, p50: q(0.5), p90: q(0.9), max: q(1) };
  };
  let path = location.pathname;
  setInterval(() => {
    if (location.pathname !== path) { log({ nav: location.pathname, from: path }); path = location.pathname; }
    const busy = moves || wheels || longFrames.length || P.renders.length > 5;
    if (busy) {
      log({
        path, frames: stat(frames), longFrames: longFrames.slice(0, 12), longTaskMs: Math.round(longTasks),
        render: stat(P.renders), orbit: stat(P.orbits), moves, wheels,
        orbitCanvas: !!document.querySelector('canvas.orbit-space, .orbit-space canvas, canvas[data-orbit]'),
        canvases: document.querySelectorAll('canvas').length,
      });
    }
    frames = []; longFrames = []; longTasks = 0; moves = 0; wheels = 0; P.renders = []; P.orbits = [];
  }, 1000);
  addEventListener('load', () => {
    let gl = '';
    try {
      const c = document.createElement('canvas').getContext('webgl');
      const ext = c && c.getExtension('WEBGL_debug_renderer_info');
      gl = c ? (ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER)) : 'no webgl';
    } catch (e) { gl = 'error ' + e; }
    log({ start: true, ua: navigator.userAgent, dpr: devicePixelRatio, w: innerWidth, h: innerHeight, gl, theme: document.documentElement.dataset.theme || null });
  });
})();
