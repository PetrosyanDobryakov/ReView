/** Place a `zoom: var(--ui-scale)` portal from a trigger's visual (getBoundingClientRect) box. */

import { visualViewportBox } from '../core/pointerEnv';

export function zoomedPortalPosition(
  trigger: { left: number; right: number; top: number; bottom: number },
  opts: {
    width: number;
    estimatedHeight: number;
    align: 'left' | 'right';
    scale: number;
    viewport: { width: number; height: number };
  }
): { left: number; top: number } {
  const scale = opts.scale > 0 ? opts.scale : 1;
  const scaledWidth = opts.width * scale;
  const gap = 8 * scale;
  const scaledHeight = opts.estimatedHeight * scale;
  const vv = typeof window !== 'undefined' ? visualViewportBox() : null;
  const vpW = vv?.width ?? opts.viewport.width;
  const vpH = vv?.height ?? opts.viewport.height;
  const vpL = vv?.left ?? 0;
  const vpT = vv?.top ?? 0;
  const visualLeft = opts.align === 'right' ? trigger.right - scaledWidth : trigger.left;
  const visualRightBound = vpL + vpW - scaledWidth - 8 * scale;
  const clampedVisualLeft = Math.min(Math.max(vpL + 8 * scale, visualLeft), visualRightBound);
  const visualBelow = trigger.bottom + gap;
  const visualAbove = trigger.top - gap - scaledHeight;
  const flip =
    visualBelow + scaledHeight > vpT + vpH - 8 * scale && visualAbove >= vpT + 8 * scale;
  const visualTop = Math.max(vpT + 8 * scale, flip ? visualAbove : visualBelow);
  return { left: clampedVisualLeft / scale, top: visualTop / scale };
}
