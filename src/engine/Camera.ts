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
  }

  panBy(dx: number, dy: number): void {
    this.tx -= dx / this.zoom;
    this.ty -= dy / this.zoom;
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
}
