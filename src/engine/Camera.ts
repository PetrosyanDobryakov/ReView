import type { ShapeBox } from '../core/shapes';

const SMOOTHING = 0.12;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  readonly minZoom = 0.1;
  readonly maxZoom = 4;
  instant = false;
  private tx = 0;
  private ty = 0;
  private tz = 1;

  update(dt: number): void {
    const k = this.instant ? 1 : 1 - Math.exp(-dt / SMOOTHING);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.zoom += (this.tz - this.zoom) * k;
    // Snap leftovers so the render loop stops thrashing after a pan/zoom settles.
    if (Math.abs(this.tx - this.x) < 0.02) this.x = this.tx;
    if (Math.abs(this.ty - this.y) < 0.02) this.y = this.ty;
    if (Math.abs(this.tz - this.zoom) < 0.00008) this.zoom = this.tz;
  }

  /** Pan in screen pixels — applied immediately (no ease) so trackpad/wheel feel 1:1. */
  panBy(dx: number, dy: number): void {
    const wx = dx / this.zoom;
    const wy = dy / this.zoom;
    this.tx -= wx;
    this.ty -= wy;
    this.x -= wx;
    this.y -= wy;
  }

  zoomAt(sx: number, sy: number, halfW: number, halfH: number, factor: number): void {
    const newZoom = clamp(this.tz * factor, this.minZoom, this.maxZoom);
    if (newZoom === this.tz) return;
    const wx = (sx - halfW) / this.tz + this.tx;
    const wy = (sy - halfH) / this.tz + this.ty;
    this.tz = newZoom;
    this.tx = wx - (sx - halfW) / newZoom;
    this.ty = wy - (sy - halfH) / newZoom;
  }

  setZoom(zoom: number): void {
    this.tz = clamp(zoom, this.minZoom, this.maxZoom);
  }

  fitView(box: ShapeBox, viewW: number, viewH: number, padding: number): void {
    const w = Math.max(box.w, 10);
    const h = Math.max(box.h, 10);
    const z = Math.min((viewW - padding * 2) / w, (viewH - padding * 2) / h);
    this.tz = clamp(z, this.minZoom, this.maxZoom);
    this.zoom = this.tz;
    this.tx = box.x + box.w / 2;
    this.ty = box.y + box.h / 2;
    this.x = this.tx;
    this.y = this.ty;
  }

  screenToWorld(sx: number, sy: number, halfW: number, halfH: number): { x: number; y: number } {
    return {
      x: (sx - halfW) / this.zoom + this.x,
      y: (sy - halfH) / this.zoom + this.y,
    };
  }

  /** Keep the viewport center near board content so panning cannot drift into empty space. */
  clampCenter(box: ShapeBox | null, viewW: number, viewH: number): void {
    if (!box || box.w <= 0 || box.h <= 0) return;
    const halfW = viewW / (2 * this.tz);
    const halfH = viewH / (2 * this.tz);
    const span = Math.max(box.w, box.h);
    // ~3 viewports of slack past content, scaled up on large boards.
    const margin = Math.max(halfW * 3, halfH * 3, span * 0.75, 2400);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    let minX = box.x - margin + halfW;
    let maxX = box.x + box.w + margin - halfW;
    let minY = box.y - margin + halfH;
    let maxY = box.y + box.h + margin - halfH;
    if (minX > maxX) minX = maxX = cx;
    if (minY > maxY) minY = maxY = cy;
    this.tx = clamp(this.tx, minX, maxX);
    this.ty = clamp(this.ty, minY, maxY);
    if (this.instant) {
      this.x = this.tx;
      this.y = this.ty;
    }
  }
}
