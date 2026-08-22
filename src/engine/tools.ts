import type { Engine } from './Engine';
import * as store from '../core/store';
import { COLORS } from '../core/shapes';
import { drawPenStroke, intersects, normalizeBox, pointInShape } from '../core/shapes';
import type { ShapeBox, ShapeView } from '../core/shapes';
import { effectivePen, settings } from '../core/settings';

export type ToolId = 'select' | 'lasso' | 'pan' | 'pen' | 'rect' | 'ellipse' | 'sticky' | 'text' | 'arrow' | 'eraser';

export interface PointerInfo {
  screen: { x: number; y: number };
  world: { x: number; y: number };
  shift: boolean;
}

export abstract class Tool {
  abstract readonly id: ToolId;
  cursor = 'crosshair';
  onHover(_engine: Engine, _p: PointerInfo): void {}
  onDown(_engine: Engine, _p: PointerInfo): void {}
  onMove(_engine: Engine, _p: PointerInfo): void {}
  onUp(_engine: Engine, _p: PointerInfo): void {}
  cancel(_engine: Engine): void {}
  render(_engine: Engine, _ctx: CanvasRenderingContext2D): void {}
}

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type HandleId = (typeof HANDLES)[number];

const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

export class SelectTool extends Tool {
  readonly id = 'select';
  cursor = 'default';
  private mode: 'idle' | 'move' | 'marquee' = 'idle';
  private resizing: { shapeId: string; handle: HandleId } | null = null;
  private start = { x: 0, y: 0 };
  private moved = 0;
  private originals = new Map<string, ShapeView>();
  private marquee: ShapeBox | null = null;

  onHover(engine: Engine, p: PointerInfo): void {
    if (this.mode !== 'idle') return;
    const h = engine.hitHandle(p.screen.x, p.screen.y);
    if (h) {
      engine.setCursor(HANDLE_CURSORS[h.handle]);
      return;
    }
    engine.setCursor(engine.hitTest(p.world.x, p.world.y) ? 'move' : 'default');
  }

  onDown(engine: Engine, p: PointerInfo): void {
    this.start = p.world;
    this.moved = 0;
    this.mode = 'idle';
    this.marquee = null;
    this.originals.clear();
    const h = engine.hitHandle(p.screen.x, p.screen.y);
    if (h) {
      this.resizing = h;
      const v = engine.views.get(h.shapeId);
      if (v) this.originals.set(h.shapeId, { ...v, points: v.points ? [...v.points] : undefined });
      return;
    }
    const hit = engine.hitTest(p.world.x, p.world.y);
    if (hit) {
      if (p.shift && engine.selection.has(hit)) {
        engine.setSelection([...engine.selection].filter((id) => id !== hit));
      } else if (!p.shift && !engine.selection.has(hit)) {
        engine.setSelection([hit]);
      }
      for (const id of engine.selection) {
        const v = engine.views.get(id);
        if (v) this.originals.set(id, { ...v, points: v.points ? [...v.points] : undefined });
      }
      if (engine.selection.has(hit) && !this.originals.get(hit)?.locked) this.mode = 'move';
    } else {
      this.mode = 'marquee';
      this.marquee = { x: p.world.x, y: p.world.y, w: 0, h: 0 };
    }
  }

  onMove(engine: Engine, p: PointerInfo): void {
    this.moved = Math.max(
      this.moved,
      Math.hypot(p.world.x - this.start.x, p.world.y - this.start.y) * engine.camera.zoom
    );
    if (this.mode === 'move') {
      const dx = p.world.x - this.start.x;
      const dy = p.world.y - this.start.y;
      const patches: Array<[string, Partial<ShapeView>]> = [];
      for (const [id, o] of this.originals) {
        if (o.locked) continue;
        if (o.points) {
          patches.push([id, { x: o.x + dx, y: o.y + dy, points: o.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) }]);
        } else {
          patches.push([id, { x: o.x + dx, y: o.y + dy }]);
        }
      }
      if (patches.length) store.patchShapes(patches);
    } else if (this.mode === 'marquee' && this.marquee) {
      this.marquee = normalizeBox(this.start, p.world);
    } else if (this.resizing) {
      this.resize(engine, p);
    }
  }
  onUp(engine: Engine, p: PointerInfo): void {
    if (this.mode === 'marquee' && this.marquee) {
      if (this.moved > 3) {
        const ids: string[] = [];
        for (const id of engine.grid.query(this.marquee)) {
          const v = engine.views.get(id);
          if (v && intersects(v, this.marquee)) ids.push(id);
        }
        engine.setSelection(p.shift ? [...new Set([...engine.selection, ...ids])] : ids);
      } else if (!p.shift) {
        engine.setSelection([]);
      }
    }
    this.mode = 'idle';
    this.resizing = null;
    this.marquee = null;
    this.originals.clear();
  }

  cancel(_engine: Engine): void {
    this.mode = 'idle';
    this.resizing = null;
    this.marquee = null;
    this.originals.clear();
  }

  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.marquee) return;
    const s = 1 / engine.camera.zoom;
    ctx.save();
    ctx.fillStyle = 'rgba(124, 140, 255, 0.12)';
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.rect(this.marquee.x, this.marquee.y, this.marquee.w, this.marquee.h);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private resize(engine: Engine, p: PointerInfo): void {
    const r = this.resizing;
    if (!r) return;
    const orig = this.originals.get(r.shapeId);
    if (!orig || orig.locked) return;
    const dx = p.world.x - this.start.x;
    const dy = p.world.y - this.start.y;
    const MIN = 8 / engine.camera.zoom;
    let x = orig.x;
    let y = orig.y;
    let w = orig.w;
    let h = orig.h;
    if (r.handle.includes('e')) w = Math.max(MIN, orig.w + dx);
    if (r.handle.includes('w')) {
      w = Math.max(MIN, orig.w - dx);
      x = orig.x + orig.w - w;
    }
    if (r.handle.includes('s')) h = Math.max(MIN, orig.h + dy);
    if (r.handle.includes('n')) {
      h = Math.max(MIN, orig.h - dy);
      y = orig.y + orig.h - h;
    }
    if (orig.type === 'image') {
      const corner = r.handle === 'nw' || r.handle === 'ne' || r.handle === 'se' || r.handle === 'sw';
      if (corner && orig.h > 0) {
        h = w / (orig.w / orig.h);
        if (r.handle.includes('n')) y = orig.y + orig.h - h;
      }
    }
    if (orig.points) {
      const sx = orig.w > 0 ? w / orig.w : 1;
      const sy = orig.h > 0 ? h / orig.h : 1;
      const points: number[] = [];
      for (let i = 0; i < orig.points.length; i += 2) {
        points.push(x + (orig.points[i] - orig.x) * sx, y + (orig.points[i + 1] - orig.y) * sy);
      }
      store.patchShape(r.shapeId, { x, y, w, h, points });
    } else {
      store.patchShape(r.shapeId, { x, y, w, h });
    }
  }
}

export class PanTool extends Tool {
  readonly id = 'pan';
  cursor = 'grab';
  private last: { x: number; y: number } | null = null;

  onHover(engine: Engine): void {
    engine.setCursor(this.last ? 'grabbing' : 'grab');
  }

  onDown(engine: Engine): void {
    this.last = null;
    engine.camera.instant = true;
    engine.setCursor('grabbing');
  }

  onMove(engine: Engine, p: PointerInfo): void {
    if (this.last) engine.camera.panBy(p.screen.x - this.last.x, p.screen.y - this.last.y);
    this.last = { x: p.screen.x, y: p.screen.y };
  }

  onUp(engine: Engine): void {
    this.last = null;
    engine.camera.instant = false;
    engine.setCursor('grab');
  }

  render(): void {}
}

export class PenTool extends Tool {
  readonly id = 'pen';
  cursor = 'crosshair';
  private pts: number[] = [];
  private last: { x: number; y: number } | null = null;
  private active = false;
  private shift = false;

  onDown(_engine: Engine, p: PointerInfo): void {
    this.pts = [p.world.x, p.world.y];
    this.last = p.world;
    this.active = true;
    this.shift = p.shift;
  }

  onMove(engine: Engine, p: PointerInfo): void {
    if (!this.active) return;
    this.shift = p.shift;
    if (this.shift) {
      this.last = p.world;
      return;
    }
    this.last = p.world;
    const n = this.pts.length;
    if (n >= 2 && Math.hypot(p.world.x - this.pts[n - 2], p.world.y - this.pts[n - 1]) < 2 / engine.camera.zoom) return;
    this.pts.push(p.world.x, p.world.y);
  }

  onUp(_engine: Engine): void {
    if (!this.active) return;
    this.active = false;
    const shift = this.shift;
    this.shift = false;
    const points = shift ? this.straightPoints() : this.pts;
    if (points.length < 4) {
      this.pts = [];
      this.last = null;
      return;
    }
    const pen = effectivePen();
    const pad = pen.width / 2 + 2;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
      minX = Math.min(minX, points[i]);
      maxX = Math.max(maxX, points[i]);
      minY = Math.min(minY, points[i + 1]);
      maxY = Math.max(maxY, points[i + 1]);
    }
    store.addShape({
      type: 'pen',
      x: minX - pad,
      y: minY - pad,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2,
      fill: 'transparent',
      stroke: pen.color,
      strokeWidth: pen.width,
      alpha: pen.alpha,
      points,
    });
    this.pts = [];
    this.last = null;
  }

  cancel(_engine: Engine): void {
    this.active = false;
    this.pts = [];
    this.last = null;
  }

  render(_engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.active || this.pts.length < 2 || !this.last) return;
    const pen = effectivePen();
    const points = this.shift ? this.straightPoints() : this.pts;
    if (points.length < 2) return;
    drawPenStroke(ctx, points, pen.width, pen.color, pen.alpha * 0.9);
  }

  private straightPoints(): number[] {
    const ax = this.pts[0];
    const ay = this.pts[1];
    const bx = this.last?.x ?? ax;
    const by = this.last?.y ?? ay;
    const end = snapStraightEnd(ax, ay, bx, by);
    return [ax, ay, end.x, end.y];
  }
}

export function snapStraightEnd(x0: number, y0: number, x1: number, y1: number): { x: number; y: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return { x: x1, y: y1 };
  const ang = Math.atan2(dy, dx);
  const rounded = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  if (Math.abs(ang - rounded) < 0.07) {
    return { x: x0 + Math.cos(rounded) * len, y: y0 + Math.sin(rounded) * len };
  }
  return { x: x1, y: y1 };
}

abstract class BoxTool extends Tool {
  abstract readonly shapeType: 'rect' | 'ellipse' | 'sticky';
  abstract readonly defaultW: number;
  abstract readonly defaultH: number;
  protected start: { x: number; y: number } | null = null;
  protected cur: { x: number; y: number } | null = null;
  protected movedScreen = 0;

  onDown(_engine: Engine, p: PointerInfo): void {
    this.start = p.world;
    this.cur = p.world;
    this.movedScreen = 0;
  }

  onMove(engine: Engine, p: PointerInfo): void {
    if (!this.start) return;
    this.movedScreen = Math.max(
      this.movedScreen,
      Math.hypot(p.world.x - this.start.x, p.world.y - this.start.y) * engine.camera.zoom
    );
    this.cur = p.world;
  }

  onUp(engine: Engine, p: PointerInfo): void {
    if (!this.start || !this.cur) return;
    let box: ShapeBox;
    if (this.movedScreen < 3) {
      box = {
        x: p.world.x - this.defaultW / 2,
        y: p.world.y - this.defaultH / 2,
        w: this.defaultW,
        h: this.defaultH,
      };
    } else {
      box = normalizeBox(this.start, this.cur);
      if (p.shift) {
        const s = Math.max(box.w, box.h);
        box.w = s;
        box.h = s;
      }
    }
    const id = store.addShape({
      type: this.shapeType,
      ...box,
      fill: settings.shape.fill,
      stroke: settings.shape.stroke,
      strokeWidth: 2,
    });
    this.start = null;
    this.cur = null;
    if (this.shapeType === 'sticky') engine.openTextEditor(id);
    engine.setTool('select');
  }

  cancel(_engine: Engine): void {
    this.start = null;
    this.cur = null;
  }

  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.cur) return;
    const box = normalizeBox(this.start, this.cur);
    const s = 1 / engine.camera.zoom;
    ctx.save();
    ctx.strokeStyle = COLORS.selection;
    ctx.fillStyle = settings.shape.fill + '22';
    ctx.lineWidth = 1.5 * s;
    ctx.setLineDash([4 * s, 4 * s]);
    ctx.beginPath();
    if (this.shapeType === 'ellipse') {
      ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
    } else {
      ctx.roundRect(box.x, box.y, box.w, box.h, 6);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export class RectTool extends BoxTool {
  readonly id = 'rect';
  readonly shapeType = 'rect';
  readonly defaultW = 120;
  readonly defaultH = 80;
}

export class EllipseTool extends BoxTool {
  readonly id = 'ellipse';
  readonly shapeType = 'ellipse';
  readonly defaultW = 120;
  readonly defaultH = 80;
}

export class StickyTool extends BoxTool {
  readonly id = 'sticky';
  readonly shapeType = 'sticky';
  readonly defaultW = 180;
  readonly defaultH = 120;
}

export class ArrowTool extends Tool {
  readonly id = 'arrow';
  cursor = 'crosshair';
  private start: { x: number; y: number } | null = null;
  private cur: { x: number; y: number } | null = null;
  private shift = false;

  onDown(_engine: Engine, p: PointerInfo): void {
    this.start = p.world;
    this.cur = p.world;
    this.shift = p.shift;
  }

  onMove(_engine: Engine, p: PointerInfo): void {
    if (!this.start) return;
    this.cur = p.world;
    this.shift = p.shift;
  }

  onUp(engine: Engine, p: PointerInfo): void {
    if (!this.start || !this.cur) return;
    this.shift = p.shift;
    const end = this.snappedEnd();
    if (Math.hypot(end.x - this.start.x, end.y - this.start.y) < 3 / engine.camera.zoom) {
      this.start = null;
      this.cur = null;
      return;
    }
    const pad = 6;
    const minX = Math.min(this.start.x, end.x) - pad;
    const minY = Math.min(this.start.y, end.y) - pad;
    const maxX = Math.max(this.start.x, end.x) + pad;
    const maxY = Math.max(this.start.y, end.y) + pad;
    store.addShape({
      type: 'arrow',
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      fill: 'transparent',
      stroke: settings.shape.stroke,
      strokeWidth: 2,
      points: [this.start.x, this.start.y, end.x, end.y],
    });
    this.start = null;
    this.cur = null;
    engine.setTool('select');
  }

  cancel(_engine: Engine): void {
    this.start = null;
    this.cur = null;
  }

  render(_engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.cur) return;
    const end = this.snappedEnd();
    ctx.save();
    ctx.strokeStyle = settings.shape.stroke;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(this.start.x, this.start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    const angle = Math.atan2(end.y - this.start.y, end.x - this.start.x);
    const head = 10;
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - head * Math.cos(angle - 0.42), end.y - head * Math.sin(angle - 0.42));
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - head * Math.cos(angle + 0.42), end.y - head * Math.sin(angle + 0.42));
    ctx.stroke();
    ctx.restore();
  }

  private snappedEnd(): { x: number; y: number } {
    if (!this.start || !this.cur) return { x: 0, y: 0 };
    if (!this.shift) return this.cur;
    return snapStraightEnd(this.start.x, this.start.y, this.cur.x, this.cur.y);
  }
}

export class TextTool extends Tool {
  readonly id = 'text';
  cursor = 'text';

  onDown(engine: Engine, p: PointerInfo): void {
    engine.openTextEditorAt(p.world.x, p.world.y, settings.text.size, settings.text.color);
  }
}

function circleHitsShape(cx: number, cy: number, r: number, v: ShapeView): boolean {
  if (pointInShape(v, cx, cy)) return true;
  const nx = Math.max(v.x, Math.min(cx, v.x + v.w));
  const ny = Math.max(v.y, Math.min(cy, v.y + v.h));
  return Math.hypot(cx - nx, cy - ny) <= r;
}

export class EraserTool extends Tool {
  readonly id = 'eraser';
  cursor = 'crosshair';
  private active = false;
  private pos: { x: number; y: number } | null = null;
  private wholeHits = new Set<string>();
  private partialHits = new Map<string, Set<number>>();

  onDown(engine: Engine, p: PointerInfo): void {
    this.active = true;
    this.pos = p.world;
    this.wholeHits.clear();
    this.partialHits.clear();
    this.eraseAt(engine, p.world);
  }

  onMove(engine: Engine, p: PointerInfo): void {
    if (!this.active) return;
    this.pos = p.world;
    this.eraseAt(engine, p.world);
  }

  onUp(engine: Engine): void {
    this.active = false;
    this.pos = null;
    engine.commitErase();
    this.wholeHits.clear();
    this.partialHits.clear();
  }

  cancel(engine: Engine): void {
    this.active = false;
    this.pos = null;
    this.wholeHits.clear();
    this.partialHits.clear();
    engine.setErasePreview(new Set(), new Map());
  }

  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.pos || !this.active) return;
    const r = settings.eraser.size;
    const s = 1 / engine.camera.zoom;
    ctx.save();
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 2 * s;
    ctx.setLineDash([4 * s, 3 * s]);
    ctx.beginPath();
    ctx.arc(this.pos.x, this.pos.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private eraseAt(engine: Engine, world: { x: number; y: number }): void {
    const r = settings.eraser.size + 10;
    const partial = settings.eraser.mode === 'partial';
    const box = { x: world.x - r, y: world.y - r, w: r * 2, h: r * 2 };
    for (const id of engine.grid.query(box)) {
      const v = engine.views.get(id);
      if (!v) continue;
      if (partial && v.type === 'pen' && v.points) {
        let idx = this.partialHits.get(id);
        if (!idx) {
          idx = new Set();
          this.partialHits.set(id, idx);
        }
        for (let i = 0; i < v.points.length; i += 2) {
          if (Math.hypot(v.points[i] - world.x, v.points[i + 1] - world.y) <= r) idx.add(i / 2);
        }
      } else if (!this.wholeHits.has(id) && circleHitsShape(world.x, world.y, r, v)) {
        this.wholeHits.add(id);
      }
    }
    engine.setErasePreview(this.wholeHits, this.partialHits);
  }
}

export function pointInPolygon(px: number, py: number, pts: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export class LassoTool extends Tool {
  readonly id = 'lasso';
  cursor = 'crosshair';
  private pts: Array<{ x: number; y: number }> = [];
  private active = false;

  onDown(_engine: Engine, p: PointerInfo): void {
    this.pts = [{ x: p.world.x, y: p.world.y }];
    this.active = true;
  }

  onMove(engine: Engine, p: PointerInfo): void {
    if (!this.active) return;
    const last = this.pts[this.pts.length - 1];
    if (Math.hypot(p.world.x - last.x, p.world.y - last.y) < 2 / engine.camera.zoom) return;
    this.pts.push({ x: p.world.x, y: p.world.y });
  }

  onUp(engine: Engine): void {
    if (!this.active) return;
    this.active = false;
    if (this.pts.length >= 3) {
      engine.setSelection(engine.selectByPolygon(this.pts));
    }
    this.pts = [];
    engine.setTool('select');
  }

  cancel(_engine: Engine): void {
    this.active = false;
    this.pts = [];
  }

  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.active || this.pts.length < 2) return;
    const s = 1 / engine.camera.zoom;
    ctx.save();
    ctx.fillStyle = 'rgba(124, 140, 255, 0.12)';
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(this.pts[0].x, this.pts[0].y);
    for (let i = 1; i < this.pts.length; i++) ctx.lineTo(this.pts[i].x, this.pts[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export class Tools {
  readonly select = new SelectTool();
  readonly lasso = new LassoTool();
  readonly pan = new PanTool();
  readonly pen = new PenTool();
  readonly rect = new RectTool();
  readonly ellipse = new EllipseTool();
  readonly sticky = new StickyTool();
  readonly text = new TextTool();
  readonly arrow = new ArrowTool();
  readonly eraser = new EraserTool();

  get(id: ToolId): Tool {
    return this[id];
  }
}
