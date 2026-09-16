/**
 * Phone / tablet pointer environment helpers.
 * Coarse = finger-primary (or no-hover) devices; fine = mouse / precise stylus UI.
 */

let cachedCoarse: boolean | null = null;
let mq: MediaQueryList | null = null;

function readCoarse(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return (
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(hover: none)').matches
    );
  } catch {
    return false;
  }
}

/** Live coarse-pointer / no-hover detection (cached + media-query listener). */
export function isCoarsePointer(): boolean {
  if (cachedCoarse !== null) return cachedCoarse;
  cachedCoarse = readCoarse();
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !mq) {
    try {
      mq = window.matchMedia('(pointer: coarse), (hover: none)');
      const sync = () => {
        cachedCoarse = readCoarse();
      };
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', sync);
      else if (typeof mq.addListener === 'function') mq.addListener(sync);
    } catch {
      /* ignore */
    }
  }
  return cachedCoarse;
}

/** @internal tests — force coarse/fine without matchMedia. */
export function __setCoarsePointerForTests(value: boolean | null): void {
  cachedCoarse = value;
}

/** Screen-px hit radius for resize handles. */
export function handleHitRadius(): number {
  return isCoarsePointer() ? 24 : 9;
}

/** Screen-px hit radius for the rotate knob. */
export function rotateHitRadius(): number {
  return isCoarsePointer() ? 28 : 14;
}

/** Screen-px hit radius for connect ports. */
export function portHitRadius(): number {
  return isCoarsePointer() ? 24 : 16;
}

/** Screen-px drag threshold before marquee / move / draw commits as a drag. */
export function dragThresholdPx(): number {
  return isCoarsePointer() ? 10 : 3;
}

/** Visual handle disc radius multiplier (world, via `s = 1/zoom`). */
export function handleDrawRadiusScale(): number {
  return isCoarsePointer() ? 6.5 : 4.25;
}

export type ViewportBox = { left: number; top: number; width: number; height: number };

/** Prefer `visualViewport` so iOS keyboard / URL bar shrinks the usable rect. */
export function visualViewportBox(): ViewportBox {
  if (typeof window === 'undefined') return { left: 0, top: 0, width: 0, height: 0 };
  const vv = window.visualViewport;
  if (vv) {
    return {
      left: vv.offsetLeft,
      top: vv.offsetTop,
      width: vv.width,
      height: vv.height,
    };
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

/** Clamp a screen-space rect into the visual viewport with a margin. */
export function clampToVisualViewport(
  left: number,
  top: number,
  width: number,
  height: number,
  margin = 8
): { left: number; top: number } {
  const vv = visualViewportBox();
  const maxL = vv.left + vv.width - width - margin;
  const maxT = vv.top + vv.height - height - margin;
  return {
    left: Math.min(Math.max(vv.left + margin, left), Math.max(vv.left + margin, maxL)),
    top: Math.min(Math.max(vv.top + margin, top), Math.max(vv.top + margin, maxT)),
  };
}

/** Share a URL when the Web Share API is available; otherwise return false. */
export async function shareUrl(url: string, title = 'ReView'): Promise<boolean> {
  try {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share !== 'function') return false;
    await nav.share({ url, title });
    return true;
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return false;
    return false;
  }
}
