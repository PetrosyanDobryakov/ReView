import type { Engine } from './Engine';
import * as store from '../core/store';
import { COLORS, portPos, readableTextOn, withAlpha, type PortId } from '../core/shapes';
import { drawPenStroke, intersects, normalizeBox, pointInShape } from '../core/shapes';
import type { ShapeBox, ShapeView } from '../core/shapes';
import { effectivePen, settings, updateTextSettings } from '../core/settings';

export type ToolId =
  | 'select'
  | 'lasso'
  | 'pan'
  | 'pen'
  | 'rect'
  | 'ellipse'
  | 'sticky'
  | 'text'
  | 'arrow'
  | 'eraser'
  | 'graph'
  | 'diamond'
  | 'frame'
  | 'triangle'
  | 'parallelogram'
  | 'hexagon'
  | 'cylinder'
  | 'terminator'
  | 'subroutine'
  | 'display';

export interface PointerInfo {
  screen: { x: number; y: number };
  world: { x: number; y: number };
  shift: boolean;
  alt?: boolean;
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
      } else if (p.shift) {
        engine.setSelection([...engine.selection, hit]);
      } else if (!engine.selection.has(hit)) {
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
      let dx = p.world.x - this.start.x;
      let dy = p.world.y - this.start.y;
      let guides: import('../core/align').AlignGuide[] = [];
      if (!p.alt) {
        const snapped = engine.computeSnapForMove(this.originals, dx, dy);
        dx = snapped.dx;
        dy = snapped.dy;
        guides = snapped.guides;
        engine.setSnapGuides(guides);
      } else {
        engine.clearSnapGuides();
      }
      const patches: Array<[string, Partial<ShapeView>]> = [];
      for (const [id, o] of this.originals) {
        if (o.locked) continue;
        if (o.points) {
          patches.push([id, { x: o.x + dx, y: o.y + dy, points: o.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) }]);
        } else {
          patches.push([id, { x: o.x + dx, y: o.y + dy }]);
        }
      }
      // also move connected arrows
      const movedIds = new Set(patches.map(([id]) => id));
      for (const [aid, av] of engine.views) {
        if (av.type !== 'arrow' || !av.fromId || !av.toId) continue;
        if (!movedIds.has(av.fromId) && !movedIds.has(av.toId)) continue;
        if (movedIds.has(aid)) continue;
        const from = engine.views.get(av.fromId);
        const to = engine.views.get(av.toId);
        if (!from || !to) continue;
        const fromOrig = this.originals.get(av.fromId);
        const toOrig = this.originals.get(av.toId);
        const fx = fromOrig ? fromOrig.x + dx : from.x;
        const fy = fromOrig ? fromOrig.y + dy : from.y;
        const tx = toOrig ? toOrig.x + dx : to.x;
        const ty = toOrig ? toOrig.y + dy : to.y;
        const fromBox = { ...from, x: fx, y: fy } as ShapeView;
        const toBox = { ...to, x: tx, y: ty } as ShapeView;
        const a = portPos(fromBox, (av.fromPort as PortId) || 'e', 0);
        const b = portPos(toBox, (av.toPort as PortId) || 'w', 0);
        const pad = 6;
        const minX = Math.min(a.x, b.x) - pad;
        const minY = Math.min(a.y, b.y) - pad;
        const maxX = Math.max(a.x, b.x) + pad;
        const maxY = Math.max(a.y, b.y) + pad;
        patches.push([aid, { x: minX, y: minY, w: maxX - minX, h: maxY - minY, points: [a.x, a.y, b.x, b.y] }]);
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
          if (!store.isOnActivePage(id)) continue;
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
    engine.clearSnapGuides();
  }

  cancel(engine: Engine): void {
    this.mode = 'idle';
    this.resizing = null;
    this.marquee = null;
    this.originals.clear();
    engine.clearSnapGuides();
  }

  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.marquee) return;
    const s = 1 / engine.camera.zoom;
    ctx.save();
    ctx.fillStyle = withAlpha(COLORS.selection, 0.12);
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
    if (orig.type === 'text') {
      const base = orig.fontSize ?? 18;
      const sx = orig.w > 0 ? w / orig.w : 1;
      const sy = orig.h > 0 ? h / orig.h : sx;
      const s = Math.max(0.15, Math.min(10, (sx + sy) / 2));
      const fontSize = Math.max(4, Math.round(base * s));
      const applied = base > 0 ? fontSize / base : s;
      let nx = orig.x;
      let ny = orig.y;
      const nw = orig.w * applied;
      const nh = orig.h * applied;
      if (r.handle.includes('w')) nx = orig.x + orig.w - nw;
      if (r.handle.includes('n')) ny = orig.y + orig.h - nh;
      store.patchShape(r.shapeId, { x: nx, y: ny, w: nw, h: nh, fontSize });
      return;
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
  abstract readonly shapeType: 'rect' | 'ellipse' | 'sticky' | 'graph' | 'diamond' | 'frame' | 'triangle' | 'parallelogram' | 'hexagon' | 'cylinder' | 'terminator' | 'subroutine' | 'display';
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
    if (this.shapeType === 'graph') engine.openGraphEditor(id);
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
    }
    const fill = settings.shape.fill === COLORS.fill ? COLORS.sticky : settings.shape.fill;
    const stroke = settings.shape.stroke === COLORS.stroke ? COLORS.stickyStroke : settings.shape.stroke;
    const id = store.addShape({
      type: 'sticky',
      ...box,
      fill,
      stroke,
      strokeWidth: 2,
      textColor: '#3a2f00',
    });
    this.start = null;
    this.cur = null;
    engine.openTextEditor(id);
    engine.setTool('select');
  }

  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.cur) return;
    const box = normalizeBox(this.start, this.cur);
    const s = 1 / engine.camera.zoom;
    const fill = settings.shape.fill === COLORS.fill ? COLORS.sticky : settings.shape.fill;
    ctx.save();
    ctx.strokeStyle = COLORS.selection;
    ctx.fillStyle = fill + '55';
    ctx.lineWidth = 1.5 * s;
    ctx.setLineDash([4 * s, 4 * s]);
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, 8);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export class GraphTool extends BoxTool {
  readonly id = 'graph';
  readonly shapeType = 'graph';
  readonly defaultW = 380;
  readonly defaultH = 280;
}

export class DiamondTool extends BoxTool {
  readonly id = 'diamond';
  readonly shapeType = 'diamond';
  readonly defaultW = 140;
  readonly defaultH = 100;
  onUp(engine: Engine, p: PointerInfo): void {
    if (!this.start || !this.cur) return;
    let box: ShapeBox;
    if (this.movedScreen < 3) {
      box = { x: p.world.x - this.defaultW / 2, y: p.world.y - this.defaultH / 2, w: this.defaultW, h: this.defaultH };
    } else {
      box = normalizeBox(this.start, this.cur);
    }
    const id = store.addShape({ type: this.shapeType, ...box, fill: settings.shape.fill, stroke: settings.shape.stroke, strokeWidth: 2 });
    this.start = null;
    this.cur = null;
    engine.openTextEditor(id);
    engine.setTool('select');
  }
  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.cur) return;
    const box = normalizeBox(this.start, this.cur);
    const s = 1 / engine.camera.zoom;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    ctx.save();
    ctx.strokeStyle = COLORS.selection;
    ctx.fillStyle = settings.shape.fill + '22';
    ctx.lineWidth = 1.5 * s;
    ctx.setLineDash([4 * s, 4 * s]);
    ctx.beginPath();
    ctx.moveTo(cx, box.y);
    ctx.lineTo(box.x + box.w, cy);
    ctx.lineTo(cx, box.y + box.h);
    ctx.lineTo(box.x, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export class FrameTool extends BoxTool {
  readonly id = 'frame';
  readonly shapeType = 'frame';
  readonly defaultW = 420;
  readonly defaultH = 300;
  cancel(_engine: Engine): void {
    this.start = null;
    this.cur = null;
  }
  onUp(engine: Engine, p: PointerInfo): void {
    if (!this.start || !this.cur) return;
    let box: ShapeBox;
    if (this.movedScreen < 3) {
      box = { x: p.world.x - this.defaultW / 2, y: p.world.y - this.defaultH / 2, w: this.defaultW, h: this.defaultH };
    } else {
      box = normalizeBox(this.start, this.cur);
    }
    const id = store.addShape({ type: this.shapeType, ...box, fill: 'rgba(255,255,255,0.06)', stroke: settings.shape.stroke, strokeWidth: 2, text: 'Схема' });
    this.start = null;
    this.cur = null;
    engine.openTextEditor(id);
    engine.setTool('select');
  }
  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.cur) return;
    const box = normalizeBox(this.start, this.cur);
    const s = 1 / engine.camera.zoom;
    ctx.save();
    ctx.strokeStyle = COLORS.selection;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1.5 * s;
    ctx.setLineDash([8 * s, 6 * s]);
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, 8);
    ctx.fill();
    ctx.stroke();
    // header hint
    ctx.fillStyle = 'rgba(236,234,228,0.09)';
    ctx.fillRect(box.x, box.y, box.w, 18);
    ctx.restore();
  }
}

export class TriangleTool extends BoxTool {
  readonly id = 'triangle';
  readonly shapeType = 'triangle';
  readonly defaultW = 140;
  readonly defaultH = 110;
  onUp(engine: Engine, p: PointerInfo): void {
    if (!this.start || !this.cur) return;
    let box: ShapeBox;
    if (this.movedScreen < 3) box = { x: p.world.x - this.defaultW / 2, y: p.world.y - this.defaultH / 2, w: this.defaultW, h: this.defaultH };
    else box = normalizeBox(this.start, this.cur);
    const id = store.addShape({ type: this.shapeType, ...box, fill: settings.shape.fill, stroke: settings.shape.stroke, strokeWidth: 2 });
    this.start = null; this.cur = null; engine.openTextEditor(id); engine.setTool('select');
  }
  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.cur) return;
    const box = normalizeBox(this.start, this.cur);
    const s = 1 / engine.camera.zoom;
    ctx.save(); ctx.strokeStyle = COLORS.selection; ctx.fillStyle = settings.shape.fill + '22'; ctx.lineWidth = 1.5 * s; ctx.setLineDash([4*s,4*s]);
    ctx.beginPath(); ctx.moveTo(box.x+box.w/2, box.y); ctx.lineTo(box.x, box.y+box.h); ctx.lineTo(box.x+box.w, box.y+box.h); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
}

export class ParallelogramTool extends BoxTool {
  readonly id = 'parallelogram';
  readonly shapeType = 'parallelogram';
  readonly defaultW = 160;
  readonly defaultH = 90;
  onUp(engine: Engine, p: PointerInfo): void {
    if (!this.start || !this.cur) return;
    let box: ShapeBox;
    if (this.movedScreen < 3) box = { x: p.world.x - this.defaultW / 2, y: p.world.y - this.defaultH / 2, w: this.defaultW, h: this.defaultH };
    else box = normalizeBox(this.start, this.cur);
    const id = store.addShape({ type: this.shapeType, ...box, fill: settings.shape.fill, stroke: settings.shape.stroke, strokeWidth: 2 });
    this.start = null; this.cur = null; engine.openTextEditor(id); engine.setTool('select');
  }
  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.cur) return;
    const box = normalizeBox(this.start, this.cur);
    const s = 1 / engine.camera.zoom; const skew = box.w*0.2;
    ctx.save(); ctx.strokeStyle = COLORS.selection; ctx.fillStyle = settings.shape.fill + '22'; ctx.lineWidth = 1.5*s; ctx.setLineDash([4*s,4*s]);
    ctx.beginPath(); ctx.moveTo(box.x+skew, box.y); ctx.lineTo(box.x+box.w, box.y); ctx.lineTo(box.x+box.w-skew, box.y+box.h); ctx.lineTo(box.x, box.y+box.h); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
}

export class HexagonTool extends BoxTool {
  readonly id = 'hexagon';
  readonly shapeType = 'hexagon';
  readonly defaultW = 150;
  readonly defaultH = 100;
  onUp(engine: Engine, p: PointerInfo): void {
    if (!this.start || !this.cur) return;
    let box: ShapeBox;
    if (this.movedScreen < 3) box = { x: p.world.x - this.defaultW / 2, y: p.world.y - this.defaultH / 2, w: this.defaultW, h: this.defaultH };
    else box = normalizeBox(this.start, this.cur);
    const id = store.addShape({ type: this.shapeType, ...box, fill: settings.shape.fill, stroke: settings.shape.stroke, strokeWidth: 2 });
    this.start = null; this.cur = null; engine.openTextEditor(id); engine.setTool('select');
  }
  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.cur) return;
    const box = normalizeBox(this.start, this.cur);
    const s = 1 / engine.camera.zoom; const cy = box.y+box.h/2;
    ctx.save(); ctx.strokeStyle = COLORS.selection; ctx.fillStyle = settings.shape.fill + '22'; ctx.lineWidth = 1.5*s; ctx.setLineDash([4*s,4*s]);
    ctx.beginPath(); ctx.moveTo(box.x+box.w*0.25, box.y); ctx.lineTo(box.x+box.w*0.75, box.y); ctx.lineTo(box.x+box.w, cy); ctx.lineTo(box.x+box.w*0.75, box.y+box.h); ctx.lineTo(box.x+box.w*0.25, box.y+box.h); ctx.lineTo(box.x, cy); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
}

export class CylinderTool extends BoxTool {
  readonly id = 'cylinder';
  readonly shapeType = 'cylinder';
  readonly defaultW = 120;
  readonly defaultH = 140;
  onUp(engine: Engine, p: PointerInfo): void {
    if (!this.start || !this.cur) return;
    let box: ShapeBox;
    if (this.movedScreen < 3) box = { x: p.world.x - this.defaultW / 2, y: p.world.y - this.defaultH / 2, w: this.defaultW, h: this.defaultH };
    else box = normalizeBox(this.start, this.cur);
    const id = store.addShape({ type: this.shapeType, ...box, fill: settings.shape.fill, stroke: settings.shape.stroke, strokeWidth: 2 });
    this.start = null; this.cur = null; engine.openTextEditor(id); engine.setTool('select');
  }
  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.cur) return;
    const box = normalizeBox(this.start, this.cur);
    const s = 1 / engine.camera.zoom; const ry = Math.min(box.h*0.15, 18); const rx = box.w/2, cx = box.x+rx;
    ctx.save(); ctx.strokeStyle = COLORS.selection; ctx.fillStyle = settings.shape.fill + '22'; ctx.lineWidth = 1.5*s; ctx.setLineDash([4*s,4*s]);
    ctx.beginPath(); ctx.moveTo(box.x, box.y+ry); ctx.lineTo(box.x, box.y+box.h-ry); ctx.ellipse(cx, box.y+box.h-ry, rx, ry, 0,0,Math.PI); ctx.lineTo(box.x+box.w, box.y+ry); ctx.ellipse(cx, box.y+ry, rx, ry, 0,Math.PI,0); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, box.y+ry, rx, ry, 0,0,Math.PI*2); ctx.stroke(); ctx.restore();
  }
}

export class TerminatorTool extends BoxTool {
  readonly id = 'terminator'; readonly shapeType = 'terminator'; readonly defaultW = 140; readonly defaultH = 60;
  onUp(engine: Engine, p: PointerInfo): void { if (!this.start || !this.cur) return; let box: ShapeBox; if (this.movedScreen < 3) box = { x: p.world.x - this.defaultW/2, y: p.world.y - this.defaultH/2, w: this.defaultW, h: this.defaultH }; else box = normalizeBox(this.start, this.cur); const id = store.addShape({ type: this.shapeType, ...box, fill: settings.shape.fill, stroke: settings.shape.stroke, strokeWidth: 2 }); this.start=null; this.cur=null; engine.openTextEditor(id); engine.setTool('select'); }
  render(engine: Engine, ctx: CanvasRenderingContext2D): void { if (!this.start || !this.cur) return; const box = normalizeBox(this.start, this.cur); const s=1/engine.camera.zoom; const r=box.h/2; ctx.save(); ctx.strokeStyle=COLORS.selection; ctx.fillStyle=settings.shape.fill+'22'; ctx.lineWidth=1.5*s; ctx.setLineDash([4*s,4*s]); ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, r); ctx.fill(); ctx.stroke(); ctx.restore(); }
}
export class SubroutineTool extends BoxTool {
  readonly id = 'subroutine'; readonly shapeType = 'subroutine'; readonly defaultW = 160; readonly defaultH = 80;
  onUp(engine: Engine, p: PointerInfo): void { if (!this.start || !this.cur) return; let box: ShapeBox; if (this.movedScreen < 3) box = { x: p.world.x - this.defaultW/2, y: p.world.y - this.defaultH/2, w: this.defaultW, h: this.defaultH }; else box = normalizeBox(this.start, this.cur); const id = store.addShape({ type: this.shapeType, ...box, fill: settings.shape.fill, stroke: settings.shape.stroke, strokeWidth: 2 }); this.start=null; this.cur=null; engine.openTextEditor(id); engine.setTool('select'); }
  render(engine: Engine, ctx: CanvasRenderingContext2D): void { if (!this.start || !this.cur) return; const box = normalizeBox(this.start, this.cur); const s=1/engine.camera.zoom; ctx.save(); ctx.strokeStyle=COLORS.selection; ctx.fillStyle=settings.shape.fill+'22'; ctx.lineWidth=1.5*s; ctx.setLineDash([4*s,4*s]); ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, 6); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(box.x+8, box.y); ctx.lineTo(box.x+8, box.y+box.h); ctx.moveTo(box.x+box.w-8, box.y); ctx.lineTo(box.x+box.w-8, box.y+box.h); ctx.stroke(); ctx.restore(); }
}
export class DisplayTool extends BoxTool {
  readonly id = 'display'; readonly shapeType = 'display'; readonly defaultW = 150; readonly defaultH = 80;
  onUp(engine: Engine, p: PointerInfo): void { if (!this.start || !this.cur) return; let box: ShapeBox; if (this.movedScreen < 3) box = { x: p.world.x - this.defaultW/2, y: p.world.y - this.defaultH/2, w: this.defaultW, h: this.defaultH }; else box = normalizeBox(this.start, this.cur); const id = store.addShape({ type: this.shapeType, ...box, fill: settings.shape.fill, stroke: settings.shape.stroke, strokeWidth: 2 }); this.start=null; this.cur=null; engine.openTextEditor(id); engine.setTool('select'); }
  render(engine: Engine, ctx: CanvasRenderingContext2D): void { if (!this.start || !this.cur) return; const box = normalizeBox(this.start, this.cur); const s=1/engine.camera.zoom; ctx.save(); ctx.strokeStyle=COLORS.selection; ctx.fillStyle=settings.shape.fill+'22'; ctx.lineWidth=1.5*s; ctx.setLineDash([4*s,4*s]); ctx.beginPath(); ctx.moveTo(box.x, box.y); ctx.lineTo(box.x+box.w*0.85, box.y); ctx.lineTo(box.x+box.w, box.y+box.h/2); ctx.lineTo(box.x+box.w*0.85, box.y+box.h); ctx.lineTo(box.x, box.y+box.h); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
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
    const ax = this.start.x, ay = this.start.y, bx = end.x, by = end.y;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const bend = Math.min(30, len * 0.15);
    const cx = mx + nx * bend * 0.5, cy = my + ny * bend * 0.5;
    const ang = Math.atan2(by - cy, bx - cx);
    ctx.save();
    ctx.strokeStyle = settings.shape.stroke;
    ctx.fillStyle = settings.shape.stroke;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx, cy, bx, by);
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    const head = 10;
    const hx1 = bx - head * Math.cos(ang - 0.42), hy1 = by - head * Math.sin(ang - 0.42);
    const hx2 = bx - head * Math.cos(ang + 0.42), hy2 = by - head * Math.sin(ang + 0.42);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(hx1, hy1);
    ctx.lineTo(hx2, hy2);
    ctx.closePath();
    ctx.fill();
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
  private down: { x: number; y: number } | null = null;

  onDown(_engine: Engine, p: PointerInfo): void {
    this.down = p.world;
  }

  onUp(engine: Engine, p: PointerInfo): void {
    const at = this.down ?? p.world;
    this.down = null;
    const bg = store.metaBg();
    const color = readableTextOn(settings.text.color, bg);
    if (color !== settings.text.color) updateTextSettings({ color });
    engine.openTextEditorAt(at.x, at.y, settings.text.size, color);
  }

  cancel(_engine: Engine): void {
    this.down = null;
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
      if (!store.isOnActivePage(id)) continue;
      const v = engine.views.get(id);
      if (!v || v.locked) continue;
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
    ctx.fillStyle = withAlpha(COLORS.selection, 0.12);
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
  readonly graph = new GraphTool();
  readonly diamond = new DiamondTool();
  readonly frame = new FrameTool();
  readonly triangle = new TriangleTool();
  readonly parallelogram = new ParallelogramTool();
  readonly hexagon = new HexagonTool();
  readonly cylinder = new CylinderTool();
  readonly terminator = new TerminatorTool();
  readonly subroutine = new SubroutineTool();
  readonly display = new DisplayTool();
  readonly text = new TextTool();
  readonly arrow = new ArrowTool();
  readonly eraser = new EraserTool();

  get(id: ToolId): Tool {
    return this[id];
  }
}
