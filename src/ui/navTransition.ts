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
 * Uses the View Transition API when available (void aperture iris);
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

  if (prefersReduce() || !isOrbitChrome() || !canViewTransition()) {
    if (typeof to === 'number') navigate(to);
    else navigate(to, opts);
    return;
  }

  document.documentElement.dataset.orbitNav = '1';
  try {
    const vt = document.startViewTransition(go);
    void vt.finished.finally(() => {
      delete document.documentElement.dataset.orbitNav;
    });
  } catch {
    delete document.documentElement.dataset.orbitNav;
    go();
  }
}
