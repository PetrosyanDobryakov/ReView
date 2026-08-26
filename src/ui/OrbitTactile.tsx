import { useEffect } from 'react';

const INTERACTIVE =
  'button, a, [role="button"], [role="switch"], [role="menuitem"], [role="option"], [role="tab"], .board-row, .theme-card, .bg-card, .tool-btn, .icon-btn, .style-btn, .sheet-switch, .home-team-btn, .ctx-item, .menu-item, input[type="checkbox"], input[type="radio"], select, summary';

function isOrbitChrome(): boolean {
  return document.documentElement.dataset.chromeTheme === 'orbit';
}

function prefersReduce(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    /* ignore */
  }
}

function pulseTarget(el: HTMLElement): void {
  el.classList.remove('orbit-tactile-pulse');
  // force reflow so the animation can restart
  void el.offsetWidth;
  el.classList.add('orbit-tactile-pulse');
  window.setTimeout(() => el.classList.remove('orbit-tactile-pulse'), 320);
}

function findInteractive(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const hit = target.closest(INTERACTIVE);
  return hit instanceof HTMLElement ? hit : null;
}

/**
 * Orbit-only tactile layer: press pulse + optional device vibrate on any UI action.
 * Mount once while chromeTheme === 'orbit'. Honors prefers-reduced-motion (no pulse/vibrate).
 */
export function OrbitTactile() {
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!isOrbitChrome() || prefersReduce()) return;
      if (e.button !== 0 && e.pointerType !== 'touch') return;
      const el = findInteractive(e.target);
      if (!el || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return;

      pulseTarget(el);

      const role = el.getAttribute('role');
      const isToggle =
        role === 'switch' ||
        el.classList.contains('sheet-switch') ||
        el.getAttribute('aria-pressed') != null ||
        el.tagName === 'INPUT';

      // Short tick for taps; slightly richer for toggles.
      vibrate(isToggle ? [8, 24, 12] : 10);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isOrbitChrome() || prefersReduce()) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = findInteractive(e.target);
      if (!el) return;
      pulseTarget(el);
      vibrate(8);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  return null;
}
