import { useEffect, useRef } from 'react';

type Star = { x: number; y: number; z: number; bright: number; hot: boolean };
type Spark = { x: number; life: number; max: number; vx: number };

/**
 * Orbit atmosphere — Full Stack remaster of the Futuristic Hero DNA:
 * black void, multi-depth star field, orbital rings, crimson scan + afterglow,
 * pointer parallax, occasional scan sparks. Palette locked: black / white / crimson.
 */
export function OrbitAtmosphere() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const reduceMq = matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let alive = true;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let pointerX = 0.5;
    let pointerY = 0.5;
    let targetX = 0.5;
    let targetY = 0.5;
    let stars: Star[] = [];
    let sparks: Spark[] = [];
    let lastSpark = 0;
    let visible = !document.hidden;

    const rebuild = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const area = w * h;
      const count = Math.min(420, Math.max(160, Math.floor(area / 5500)));
      stars = [];
      for (let i = 0; i < count; i++) {
        const n = frac(Math.sin(i * 12.9898 + 78.233) * 43758.5453);
        const n2 = frac(Math.sin(i * 39.346 + 11.135) * 22578.1459);
        stars.push({
          x: n * w,
          y: n2 * h,
          z: 0.25 + frac(Math.sin(i * 7.1 + 3.3) * 9123.4) * 0.75,
          bright: 0.2 + n * 0.8,
          hot: n2 > 0.88,
        });
      }
    };

    const onMove = (e: PointerEvent) => {
      targetX = e.clientX / Math.max(1, w);
      targetY = e.clientY / Math.max(1, h);
    };

    const onVis = () => {
      visible = !document.hidden;
      if (visible && alive) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(paint);
      }
    };

    const paint = (now: number) => {
      if (!alive) return;
      if (!visible) {
        raf = 0;
        return;
      }

      const reduce = reduceMq.matches;
      const t = now * 0.001;

      // Scan pacing — slightly faster than before, with a soft afterglow lag.
      const scan = reduce ? 0.42 : Math.sin(t * 0.48) * 0.5 + 0.5;
      const scanY = scan * h;
      const afterY = reduce ? scanY : (Math.sin(t * 0.48 - 0.55) * 0.5 + 0.5) * h;
      const band = Math.max(32, h * 0.05);

      pointerX += (targetX - pointerX) * 0.055;
      pointerY += (targetY - pointerY) * 0.055;
      const px = (pointerX - 0.5) * 2;
      const py = (pointerY - 0.5) * 2;

      // Void base with faint crimson core glow (center biased).
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);

      const core = ctx.createRadialGradient(
        w * (0.5 + px * 0.04),
        h * (0.42 + py * 0.03),
        0,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.7
      );
      core.addColorStop(0, 'rgba(255, 20, 20, 0.055)');
      core.addColorStop(0.35, 'rgba(255, 0, 0, 0.02)');
      core.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = core;
      ctx.fillRect(0, 0, w, h);

      // Orbital rings (screen-space ellipses) with parallax.
      if (!reduce) {
        ctx.save();
        ctx.translate(w * 0.5 + px * 28, h * 0.48 + py * 18);
        ctx.rotate(t * 0.04);
        for (let i = 0; i < 4; i++) {
          const rw = w * (0.18 + i * 0.14);
          const rh = h * (0.1 + i * 0.08);
          const a = 0.055 + i * 0.018;
          ctx.strokeStyle = `rgba(255, ${40 + i * 20}, ${40 + i * 15}, ${a})`;
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.ellipse(0, 0, rw, rh, i * 0.2, 0, Math.PI * 2);
          ctx.stroke();
          // Arc highlight chasing along the ring
          const start = (t * (0.3 + i * 0.08) + i) % (Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 110, 110, ${0.22 + i * 0.03})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(0, 0, rw, rh, i * 0.2, start, start + 0.55);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        ctx.save();
        ctx.translate(w * 0.5, h * 0.48);
        ctx.strokeStyle = 'rgba(255, 50, 50, 0.1)';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 0.32, h * 0.18, 0.15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Afterglow trail behind the scan.
      if (!reduce) {
        const trail = ctx.createLinearGradient(0, afterY - band * 5, 0, afterY + band * 2);
        trail.addColorStop(0, 'rgba(255, 0, 0, 0)');
        trail.addColorStop(0.55, 'rgba(255, 0, 0, 0.025)');
        trail.addColorStop(0.85, 'rgba(255, 30, 30, 0.06)');
        trail.addColorStop(1, 'rgba(255, 0, 0, 0)');
        ctx.fillStyle = trail;
        ctx.fillRect(0, 0, w, h);
      }

      // Primary scan bloom.
      const bloom = ctx.createLinearGradient(0, scanY - band * 4.5, 0, scanY + band * 4.5);
      bloom.addColorStop(0, 'rgba(255, 0, 0, 0)');
      bloom.addColorStop(0.42, 'rgba(255, 0, 0, 0.04)');
      bloom.addColorStop(0.5, 'rgba(255, 45, 45, 0.12)');
      bloom.addColorStop(0.58, 'rgba(255, 0, 0, 0.04)');
      bloom.addColorStop(1, 'rgba(255, 0, 0, 0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, w, h);

      // Hot scan core + hairline.
      const line = ctx.createLinearGradient(0, scanY - band * 0.55, 0, scanY + band * 0.55);
      line.addColorStop(0, 'rgba(255, 0, 0, 0)');
      line.addColorStop(0.5, 'rgba(255, 90, 90, 0.32)');
      line.addColorStop(1, 'rgba(255, 0, 0, 0)');
      ctx.fillStyle = line;
      ctx.fillRect(0, scanY - band * 0.55, w, band);
      ctx.fillStyle = 'rgba(255, 180, 180, 0.45)';
      ctx.fillRect(0, scanY - 0.5, w, 1);

      // Depth stars with parallax + scan excitation.
      for (const s of stars) {
        const depth = s.z;
        const x = s.x + px * 22 * depth;
        const y = s.y + py * 14 * depth;
        const dist = Math.abs(y - scanY);
        const flow = Math.max(0, 1 - dist / (band * 2.4));
        const twinkle = reduce ? 1 : 0.7 + 0.3 * Math.sin(t * (1.2 + depth) + s.x * 0.01);
        const a = s.bright * (0.02 + flow * 0.5) * twinkle * (0.4 + depth * 0.6);
        if (a < 0.02) continue;
        const r = (0.7 + flow * 1.4) * (0.5 + depth * 0.7);
        if (s.hot) {
          ctx.fillStyle = `rgba(255, ${Math.floor(40 + flow * 80)}, ${Math.floor(40 + flow * 50)}, ${Math.min(0.7, a * 1.4)})`;
        } else {
          ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.55, a)})`;
        }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (flow > 0.55) {
          ctx.fillStyle = `rgba(255, 80, 80, ${flow * 0.12})`;
          ctx.beginPath();
          ctx.arc(x, y, r * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Scan sparks — rare crimson motes ejected along the band.
      if (!reduce && now - lastSpark > 380 && Math.random() < 0.35) {
        lastSpark = now;
        const n = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          sparks.push({
            x: Math.random() * w,
            life: 0,
            max: 0.35 + Math.random() * 0.55,
            vx: (Math.random() - 0.5) * 40,
          });
        }
        if (sparks.length > 40) sparks = sparks.slice(-40);
      }
      if (!reduce && sparks.length) {
        const next: Spark[] = [];
        for (const sp of sparks) {
          sp.life += 0.016;
          if (sp.life >= sp.max) continue;
          const u = sp.life / sp.max;
          const sy = scanY + (u - 0.15) * 28;
          const sx = sp.x + sp.vx * u;
          const a = (1 - u) * 0.55;
          ctx.fillStyle = `rgba(255, ${Math.floor(80 + (1 - u) * 100)}, ${Math.floor(80 + (1 - u) * 60)}, ${a})`;
          ctx.beginPath();
          ctx.arc(sx, sy, 1.2 + (1 - u) * 1.8, 0, Math.PI * 2);
          ctx.fill();
          next.push(sp);
        }
        sparks = next;
      }

      // Horizontal beam remnants (quantum/beams inspiration, crimson only).
      if (!reduce) {
        for (let i = 0; i < 3; i++) {
          const by = ((Math.sin(t * 0.15 + i * 2.1) * 0.5 + 0.5) * 0.7 + 0.15) * h;
          const ba = 0.015 + 0.01 * Math.sin(t * 0.4 + i);
          const bg = ctx.createLinearGradient(0, by - 8, 0, by + 8);
          bg.addColorStop(0, 'rgba(255, 0, 0, 0)');
          bg.addColorStop(0.5, `rgba(255, 40, 40, ${ba})`);
          bg.addColorStop(1, 'rgba(255, 0, 0, 0)');
          ctx.fillStyle = bg;
          ctx.fillRect(0, by - 8, w, 16);
        }
      }

      // Vignette — deep void edges.
      const vig = ctx.createRadialGradient(w * 0.5, h * 0.5, h * 0.2, w * 0.5, h * 0.5, h * 0.95);
      vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vig.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      // CSS var for chrome sheen keyed to pointer (consumed by Orbit CSS).
      document.documentElement.style.setProperty('--orbit-px', String(pointerX));
      document.documentElement.style.setProperty('--orbit-py', String(pointerY));
      document.documentElement.style.setProperty('--orbit-scan', String(scan));

      raf = requestAnimationFrame(paint);
    };

    rebuild();
    paint(performance.now());
    window.addEventListener('resize', rebuild);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', rebuild);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
      document.documentElement.style.removeProperty('--orbit-px');
      document.documentElement.style.removeProperty('--orbit-py');
      document.documentElement.style.removeProperty('--orbit-scan');
    };
  }, []);

  return <canvas ref={ref} className="orbit-atmosphere" aria-hidden="true" />;
}

function frac(n: number): number {
  return n - Math.floor(n);
}
