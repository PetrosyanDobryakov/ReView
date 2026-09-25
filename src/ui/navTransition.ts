import { flushSync } from 'react-dom';
import type { NavigateFunction, NavigateOptions, To } from 'react-router-dom';

function prefersReduce(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isOrbitChrome(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.chromeTheme === 'orbit';
}

function canViewTransition(): boolean {
  return typeof document !== 'undefined' && 'startViewTransition' in document;
}

/**
 * Orbit-themed home ↔ board navigation.
 * Uses the View Transition API when available (warp jump: the old view flies
 * past, the new one arrives out of the depth while the sky streaks);
 * otherwise falls back to an instant navigate.
 */
export function navigateThemed(
  navigate: NavigateFunction,
  to: To | number,
  opts?: NavigateOptions
): void {
  const go = () => {
    flushSync(() => {
      if (typeof to === 'number') navigate(to);
      else navigate(to, opts);
    });
  };

  // OrbitSpace jumps to a fresh patch of sky on every navigation: through warp
  // streaks when motion is allowed, instantly otherwise.
  if (isOrbitChrome()) window.dispatchEvent(new CustomEvent('review-orbit-warp'));

  if (prefersReduce() || !isOrbitChrome() || !canViewTransition()) {
    if (typeof to === 'number') navigate(to);
    else navigate(to, opts);
    return;
  }

  document.documentElement.dataset.orbitNav = '1';
  try {
    const vt = document.startViewTransition(go);
    // An aborted transition (hidden tab, overlapping navigation) rejects `ready`;
    // the navigation itself still happens, so the rejection is expected.
    vt.ready.catch(() => {});
    void vt.finished.catch(() => {}).finally(() => {
      delete document.documentElement.dataset.orbitNav;
    });
  } catch {
    delete document.documentElement.dataset.orbitNav;
    go();
  }
}
