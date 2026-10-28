import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import type { LocaleId } from '../core/locale';
import { hasFill } from '../core/shapes';
import { t } from './i18n';
import { Icon } from './icons';

const MAP_W = 200;
const MAP_H = 140;
const MAP_KEY = 'review-minimap-open';

/**
 * Board minimap (Holst-style): collapsed to a corner icon, expands to a
 * live overview. Simplified rects per shape, accent viewport frame.
 * Click/drag pans the camera (zoom untouched); wheel zooms like the board.
 */
export function MiniMap({ engine, locale }: { engine: Engine; locale: LocaleId }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(MAP_KEY) === '1';
    } catch {
      return false;
    }
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(MAP_KEY, open ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let accent = '#7c8cff';
    try {
      accent = getComputedStyle(document.documentElement).getPropertyValue('--chrome-accent').trim() || accent;
    } catch {
      /* ignore */
    }
    const tick = () => {
      raf = requestAnimationFrame(tick);
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const W = MAP_W;
        const H = MAP_H;
        if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
          canvas.width = Math.round(W * dpr);
          canvas.height = Math.round(H * dpr);
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const content = engine.contentBox();
        const box = content ?? { x: -600, y: -400, w: 1200, h: 800 };
        const pad = 24;
        const s = Math.min((W - 16) / (box.w + pad * 2), (H - 16) / (box.h + pad * 2));
        const ox = (W - box.w * s) / 2 - box.x * s;
        const oy = (H - box.h * s) / 2 - box.y * s;
        const toMap = (x: number, y: number) => ({ x: x * s + ox, y: y * s + oy });
        for (const v of engine.views.values()) {
          const p0 = toMap(v.x, v.y);
          const p1 = toMap(v.x + v.w, v.y + v.h);
          const w = Math.max(1.5, p1.x - p0.x);
          const h = Math.max(1.5, p1.y - p0.y);
          ctx.fillStyle =
            v.type === 'image' || v.type === 'video'
              ? 'rgba(77,171,247,0.8)'
              : v.type === 'audio'
                ? 'rgba(151,117,250,0.8)'
                : v.fill && hasFill(v.fill)
                  ? v.fill
                  : 'rgba(236,234,228,0.65)';
          ctx.fillRect(p0.x, p0.y, w, h);
        }
        // Viewport frame from the live camera.
        const vs = engine.viewportSize();
        const c0 = engine.camera.screenToWorld(0, 0, vs.w / 2, vs.h / 2);
        const c1 = engine.camera.screenToWorld(vs.w, vs.h, vs.w / 2, vs.h / 2);
        const q0 = toMap(c0.x, c0.y);
        const q1 = toMap(c1.x, c1.y);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(q0.x, q0.y, q1.x - q0.x, q1.y - q0.y);
      } catch {
        /* overlay never breaks paint */
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, open]);

  const jump = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const mx = ((clientX - r.left) / Math.max(1, r.width)) * MAP_W;
    const my = ((clientY - r.top) / Math.max(1, r.height)) * MAP_H;
    const content = engine.contentBox();
    const box = content ?? { x: -600, y: -400, w: 1200, h: 800 };
    const pad = 24;
    const s = Math.min((MAP_W - 16) / (box.w + pad * 2), (MAP_H - 16) / (box.h + pad * 2));
    const ox = (MAP_W - box.w * s) / 2 - box.x * s;
    const oy = (MAP_H - box.h * s) / 2 - box.y * s;
    engine.panCameraTo((mx - ox) / s, (my - oy) / s);
  };

  // Wheel zooms like the board (native listener — React wheel is passive).
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        engine.wheelZoom(e.clientX, e.clientY, e.deltaY !== 0 ? e.deltaY : e.deltaX);
      } catch {
        /* ignore */
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [engine, open]);

  return (
    <div
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {open ? (
        <canvas
          ref={canvasRef}
          style={{
            width: MAP_W,
            height: MAP_H,
            borderRadius: 12,
            border: '1px solid var(--chrome-border)',
            background: 'var(--chrome-panel)',
            boxShadow: 'var(--chrome-shadow, 0 8px 24px rgba(0,0,0,0.35))',
            pointerEvents: 'auto',
            cursor: 'crosshair',
            touchAction: 'none',
          }}
          onPointerDown={(e) => {
            dragRef.current = true;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            jump(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (dragRef.current) jump(e.clientX, e.clientY);
          }}
          onPointerUp={() => {
            dragRef.current = false;
          }}
        />
      ) : null}
      <button
        type="button"
        className={`icon-btn${open ? ' is-open' : ''}`}
        title={t(locale, 'minimap')}
        aria-label={t(locale, 'minimap')}
        aria-expanded={open}
        style={{ pointerEvents: 'auto' }}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="fit" />
      </button>
    </div>
  );
}
