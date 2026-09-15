/** Fail closed when the environment cannot rasterize (PDF/TXT import). */
export type Canvas2dHost = {
  getContext(contextId: '2d', options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null;
};

export function require2dContext(canvas: Canvas2dHost): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas context');
  return ctx;
}
