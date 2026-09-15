/** Place a `zoom: var(--ui-scale)` portal from a trigger's visual (getBoundingClientRect) box. */

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
  const visualLeft = opts.align === 'right' ? trigger.right - scaledWidth : trigger.left;
  const visualRightBound = opts.viewport.width - scaledWidth - 8 * scale;
  const clampedVisualLeft = Math.min(Math.max(8 * scale, visualLeft), visualRightBound);
  const visualBelow = trigger.bottom + gap;
  const visualAbove = trigger.top - gap - scaledHeight;
  const flip =
    visualBelow + scaledHeight > opts.viewport.height - 8 * scale && visualAbove >= 8 * scale;
  const visualTop = Math.max(8 * scale, flip ? visualAbove : visualBelow);
  return { left: clampedVisualLeft / scale, top: visualTop / scale };
}
