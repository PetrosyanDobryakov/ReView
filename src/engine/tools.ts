import type { Engine } from './Engine';
import * as store from '../core/store';
import { COLORS, portPos, readableTextOn, displayInk, withAlpha, hasFill, type PortId, arrowBendSign } from '../core/shapes';
import { drawPenStroke, containedIn, intersects, normalizeBox, pointInShape, pressureVaries } from '../core/shapes';
import type { ShapeBox, ShapeView } from '../core/shapes';
import { isOrbitPaper } from '../core/orbit';
import { ORBIT_DRAW, shouldUseOrbitDraw } from '../core/orbitDraw';
import { effectivePen, RECT_CORNER_RADIUS, settings, shapeFillValue, updateTextSettings } from '../core/settings';
import { readPrefs } from '../core/prefs';
import { readLocale } from '../core/locale';
import { t } from '../ui/i18n';
import { recognizeStroke } from '../core/recognize';
import { degToRad, reanchorRotatedResize, rotatePointsAround, rotatedAabb, shapeRotation, snapRotationDeg } from '../core/transform';
import { publishDraft, publishErasePreview } from '../net';

/** Square a drag box around the original anchor (handles upward / leftward Shift draws). */
function squareFromAnchor(start: { x: number; y: number }, cur: { x: number; y: number }): ShapeBox {
  const dx = cur.x - start.x;
  const dy = cur.y - start.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: dx < 0 ? start.x - side : start.x,
    y: dy < 0 ? start.y - side : start.y,
    w: side,
    h: side,
  };
}

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
  pressure?: number;
  /** `pen` / `touch` / `mouse` — only stylus gets variable-width strokes. */
  pointerType?: string;
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

/** Screen-space ring order (45° steps, clockwise from east). */
const HANDLE_RING: HandleId[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];

function rotatedHandleCursor(handle: HandleId, rotDeg: number): string {
  const idx = HANDLE_RING.indexOf(handle);
  if (idx < 0) return HANDLE_CURSORS[handle];
  const steps = ((Math.round(rotDeg / 45) % 8) + 8) % 8;
  return HANDLE_CURSORS[HANDLE_RING[(idx + steps) % 8]];
}

export class SelectTool extends Tool {
  readonly id = 'select';
  cursor = 'default';
  private mode: 'idle' | 'move' | 'marquee' | 'rotate' = 'idle';
  private resizing: { shapeId: string; handle: HandleId } | null = null;
  private start = { x: 0, y: 0 };
  private moved = 0;
  private originals = new Map<string, ShapeView>();
  /** annotations riding on a moved image, snapshotted at drag start */
  private stuck = new Map<string, ShapeView>();
  private marquee: ShapeBox | null = null;
  private rotateStartAngle = 0;
  private rotateOrigDeg = 0;

  onHover(engine: Engine, p: PointerInfo): void {
    if (this.mode !== 'idle') return;
    if (engine.hitRotateHandle(p.screen.x, p.screen.y)) {
      engine.setCursor('grab');
      return;
    }
    const h = engine.hitHandle(p.screen.x, p.screen.y);
    if (h) {
      const v = engine.views.get(h.shapeId);
      engine.setCursor(rotatedHandleCursor(h.handle, shapeRotation(v ?? {})));
      return;
    }
    const port = engine.hitPort(p.screen.x, p.screen.y);
    if (port && engine.selection.has(port.shapeId)) {
      engine.setCursor('crosshair');
      return;
    }
    engine.setCursor(engine.hitTest(p.world.x, p.world.y) ? 'move' : engine.toolCursor());
  }

  onDown(engine: Engine, p: PointerInfo): void {
    this.start = p.world;
    this.moved = 0;
    this.mode = 'idle';
    this.marquee = null;
    this.originals.clear();
    this.stuck.clear();
    store.beginGesture();
    const rotHit = engine.hitRotateHandle(p.screen.x, p.screen.y);
    if (rotHit) {
      const v = engine.views.get(rotHit);
      if (v && !v.locked) {
        this.mode = 'rotate';
        this.originals.set(rotHit, { ...v, points: v.points ? [...v.points] : undefined });
        const c = { x: v.x + v.w / 2, y: v.y + v.h / 2 };
        this.rotateStartAngle = Math.atan2(p.world.y - c.y, p.world.x - c.x);
        this.rotateOrigDeg = shapeRotation(v);
        engine.setSelection([rotHit]);
        return;
      }
    }
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
    if (this.mode === 'rotate') {
      const [id, o] = [...this.originals.entries()][0] ?? [];
      if (!id || !o) return;
      const c = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
      const ang = Math.atan2(p.world.y - c.y, p.world.x - c.x);
      let deg = this.rotateOrigDeg + ((ang - this.rotateStartAngle) * 180) / Math.PI;
      // Soft H/V magnet when prefs.rotateSnap is on; Shift = free.
      deg = snapRotationDeg(deg, Boolean(p.shift) || !readPrefs().rotateSnap);
      if (o.type === 'pen' || o.type === 'arrow') {
        // Bake rotation into points; keep AABB rebuilt from points.
        const delta = deg - this.rotateOrigDeg;
        const pts = rotatePointsAround(o.points ?? [], c.x, c.y, delta);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < pts.length; i += 2) {
          minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
          minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]);
        }
        const pad = (o.strokeWidth ?? 2) / 2 + 2;
        store.patchShape(id, {
          points: pts,
          x: minX - pad,
          y: minY - pad,
          w: maxX - minX + pad * 2,
          h: maxY - minY + pad * 2,
          rotation: 0,
        });
      } else {
        store.patchShape(id, { rotation: deg });
      }
      return;
    }
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
        // Local-space polylines: translation is x/y only (no points rewrite).
        patches.push([id, { x: o.x + dx, y: o.y + dy }]);
      }
      // also move connected arrows
      const movedIds = new Set(patches.map(([id]) => id));
      // annotations (text/sticky/pen) sitting on a moved image stick to it
      for (const [, o] of this.originals) {
        if (o.type !== 'image') continue;
        for (const [sid, sv] of engine.views) {
          if (movedIds.has(sid) || this.originals.has(sid)) continue;
          if (sv.locked) continue;
          if (sv.type !== 'text' && sv.type !== 'sticky' && sv.type !== 'pen') continue;
          // snapshot at drag start; containment is checked against that snapshot
          let base = this.stuck.get(sid);
          if (!base) {
            if (!containedIn(sv, o)) continue;
            base = { ...sv, points: sv.points ? [...sv.points] : undefined };
            this.stuck.set(sid, base);
          }
          patches.push([sid, { x: base.x + dx, y: base.y + dy }]);
          movedIds.add(sid);
        }
      }
      // frames carry contained shapes with them
      for (const [, o] of this.originals) {
        if (o.type !== 'frame') continue;
        for (const [sid, sv] of engine.views) {
          if (movedIds.has(sid) || this.originals.has(sid)) continue;
          if (sv.locked) continue;
          let base = this.stuck.get(sid);
          if (!base) {
            if (!containedIn(sv, o)) continue;
            base = { ...sv, points: sv.points ? [...sv.points] : undefined };
            this.stuck.set(sid, base);
          }
          patches.push([sid, { x: base.x + dx, y: base.y + dy }]);
          movedIds.add(sid);
        }
      }
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
          if (!v) continue;
          const b = v.type === 'arrow' ? v : rotatedAabb(v);
          if (intersects(b, this.marquee)) ids.push(id);
        }
        engine.setSelection(p.shift ? [...new Set([...engine.selection, ...ids])] : ids);
      } else if (!p.shift) {
        engine.setSelection([]);
      }
    }
    if (this.resizing) {
      engine.updateConnectedArrows(new Set([this.resizing.shapeId]));
    }
    this.mode = 'idle';
    this.resizing = null;
    this.marquee = null;
    this.originals.clear();
    this.stuck.clear();
    engine.clearSnapGuides();
    store.endGesture();
  }

  cancel(engine: Engine): void {
    if (this.originals.size) {
      const patches: Array<[string, Partial<ShapeView>]> = [];
      for (const [id, o] of this.originals) {
        patches.push([
          id,
          {
            x: o.x,
            y: o.y,
            w: o.w,
            h: o.h,
            points: o.points ? [...o.points] : undefined,
            fontSize: o.fontSize,
            rotation: o.rotation,
          },
        ]);
      }
      for (const [id, o] of this.stuck) {
        patches.push([
          id,
          {
            x: o.x,
            y: o.y,
            w: o.w,
            h: o.h,
            points: o.points ? [...o.points] : undefined,
            rotation: o.rotation,
          },
        ]);
      }
      if (patches.length) store.patchShapes(patches);
    }
    this.mode = 'idle';
    this.resizing = null;
    this.marquee = null;
    this.originals.clear();
    this.stuck.clear();
    engine.clearSnapGuides();
    store.endGesture();
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
    let dx = p.world.x - this.start.x;
    let dy = p.world.y - this.start.y;
    const rot = shapeRotation(orig);
    if (rot) {
      const rad = -degToRad(rot);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      dx = lx;
      dy = ly;
    }
    // Edge-based resize so dragging past the opposite side mirrors (flips) the shape.
    const MIN = 1 / Math.max(engine.camera.zoom, 0.01);
    let left = orig.x;
    let right = orig.x + orig.w;
    let top = orig.y;
    let bottom = orig.y + orig.h;
    if (r.handle.includes('e')) right = orig.x + orig.w + dx;
    if (r.handle.includes('w')) left = orig.x + dx;
    if (r.handle.includes('s')) bottom = orig.y + orig.h + dy;
    if (r.handle.includes('n')) top = orig.y + dy;

    let x = Math.min(left, right);
    let y = Math.min(top, bottom);
    let w = Math.abs(right - left);
    let h = Math.abs(bottom - top);
    if (w < MIN) {
      w = MIN;
      x = (left + right) / 2 - w / 2;
    }
    if (h < MIN) {
      h = MIN;
      y = (top + bottom) / 2 - h / 2;
    }

    if (orig.type === 'image') {
      const corner = r.handle === 'nw' || r.handle === 'ne' || r.handle === 'se' || r.handle === 'sw';
      if (corner && orig.w > 0 && orig.h > 0) {
        const aspect = orig.w / orig.h;
        // Drive from the axis with larger movement so vertical corner drags work.
        if (Math.abs(right - left) * orig.h >= Math.abs(bottom - top) * orig.w) {
          h = w / aspect;
        } else {
          w = h * aspect;
        }
        w = Math.max(MIN, w);
        h = Math.max(MIN, h);
        // Keep the opposite corner anchored after aspect lock.
        if (r.handle.includes('w')) x = Math.max(left, right) - w;
        else x = Math.min(left, right);
        if (r.handle.includes('n')) y = Math.max(top, bottom) - h;
        else y = Math.min(top, bottom);
        // Keep signed edges aligned with the aspect-corrected box for reanchor.
        if (right >= left) {
          left = x;
          right = x + w;
        } else {
          right = x;
          left = x + w;
        }
        if (bottom >= top) {
          top = y;
          bottom = y + h;
        } else {
          bottom = y;
          top = y + h;
        }
      }
    }
    if (orig.type === 'text') {
      const corner = r.handle === 'nw' || r.handle === 'ne' || r.handle === 'se' || r.handle === 'sw';
      if (corner) {
        // corner handles scale the font (and the frame with it)
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
        const anchored = reanchorRotatedResize(
          orig,
          { x: nx, y: ny, w: nw, h: nh },
          r.handle,
          {
            left: r.handle.includes('w') ? nx : orig.x,
            right: r.handle.includes('w') ? nx + nw : orig.x + nw,
            top: r.handle.includes('n') ? ny : orig.y,
            bottom: r.handle.includes('n') ? ny + nh : orig.y + nh,
          }
        );
        store.patchShape(r.shapeId, { x: anchored.x, y: anchored.y, w: nw, h: nh, fontSize });
        return;
      }
      // edge handles: E/W change wrap width; N/S keep wrap width and pad height
      const fontSize = orig.fontSize ?? 18;
      const wrapW = r.handle === 'n' || r.handle === 's' ? orig.w : Math.max(w, fontSize * 2);
      const measured = engine.measureTextWrapped(orig.text ?? '', fontSize, wrapW, {
        bold: orig.bold,
        italic: orig.italic,
      });
      if (r.handle === 'e' || r.handle === 'w') {
        const anchored = reanchorRotatedResize(orig, { x, y: orig.y, w: wrapW, h: measured.h }, r.handle, {
          left,
          right: left + wrapW,
          top: orig.y,
          bottom: orig.y + measured.h,
        });
        store.patchShape(r.shapeId, { x: anchored.x, y: anchored.y, w: wrapW, h: measured.h });
        return;
      }
      const pad = Math.max(0, h - measured.h);
      let ny = orig.y;
      if (r.handle === 'n') ny = orig.y + orig.h - (measured.h + pad);
      const textH = measured.h + pad;
      const anchored = reanchorRotatedResize(orig, { x: orig.x, y: ny, w: orig.w, h: textH }, r.handle, {
        left: orig.x,
        right: orig.x + orig.w,
        top: ny,
        bottom: ny + textH,
      });
      store.patchShape(r.shapeId, { x: anchored.x, y: anchored.y, w: orig.w, h: textH });
      return;
    }
    {
      const anchored = reanchorRotatedResize(orig, { x, y, w, h }, r.handle, { left, right, top, bottom });
      x = anchored.x;
      y = anchored.y;
    }
    if (orig.points) {
      // Signed scales from the live edges so crossing the opposite side flips geometry.
      const sx = orig.w !== 0 ? (right - left) / orig.w : 1;
      const sy = orig.h !== 0 ? (bottom - top) / orig.h : 1;
      const points: number[] = [];
      for (let i = 0; i < orig.points.length; i += 2) {
        points.push(left + (orig.points[i] - orig.x) * sx, top + (orig.points[i + 1] - orig.y) * sy);
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

  onDown(engine: Engine, p: PointerInfo): void {
    this.last = { x: p.screen.x, y: p.screen.y };
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
  private pressures: number[] = [];
  private last: { x: number; y: number } | null = null;
  private active = false;
  private shift = false;
  /** Stylus only — mouse pressure is a flat 0.5 and must not force the ribbon path. */
  private capturePressure = false;

  onDown(_engine: Engine, p: PointerInfo): void {
    this.pts = [p.world.x, p.world.y];
    this.capturePressure = p.pointerType === 'pen';
    this.pressures = this.capturePressure ? [clampPressure(p.pressure)] : [];
    this.last = p.world;
    this.active = true;
    this.shift = p.shift;
    store.beginGesture();
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
    if (this.capturePressure) this.pressures.push(clampPressure(p.pressure));
    const pen = effectivePen();
    publishDraft({
      kind: 'pen',
      points: this.pts,
      stroke: pen.color,
      strokeWidth: pen.width,
      alpha: pen.alpha,
    });
  }

  onUp(_engine: Engine): void {
    if (!this.active) return;
    this.active = false;
    publishDraft(null);
    const shift = this.shift;
    this.shift = false;
    const points = shift ? this.straightPoints() : this.pts;
    const pressures = this.capturePressure
      ? shift
        ? [this.pressures[0] ?? 0.5, this.pressures.at(-1) ?? 0.5]
        : this.pressures
      : [];
    if (points.length < 2) {
      this.pts = [];
      this.pressures = [];
      this.capturePressure = false;
      this.last = null;
      store.endGesture();
      return;
    }

    // Shape recognition (prefs): snap neat strokes to geometry.
    if (!shift && readPrefs().recognizeShapes) {
      const guess = recognizeStroke(points);
      if (guess) {
        const pen = effectivePen();
        if (guess.kind === 'rect' || guess.kind === 'ellipse') {
          store.addShape({
            type: guess.kind,
            x: guess.x,
            y: guess.y,
            w: guess.w,
            h: guess.h,
            fill: shapeFillValue(),
            stroke: pen.color,
            strokeWidth: Math.max(settings.shape.strokeWidth, pen.width),
            ...(guess.kind === 'rect'
              ? { cornerRadius: settings.shape.rounded ? RECT_CORNER_RADIUS : 0 }
              : {}),
          });
          this.pts = [];
          this.pressures = [];
          this.capturePressure = false;
          this.last = null;
          store.endGesture();
          return;
        }
        if (guess.kind === 'line' || guess.kind === 'arrow') {
          const pad = 6;
          const minX = Math.min(guess.x0, guess.x1) - pad;
          const minY = Math.min(guess.y0, guess.y1) - pad;
          const maxX = Math.max(guess.x0, guess.x1) + pad;
          const maxY = Math.max(guess.y0, guess.y1) + pad;
          store.addShape({
            type: 'arrow',
            x: minX,
            y: minY,
            w: maxX - minX,
            h: maxY - minY,
            fill: 'transparent',
            stroke: pen.color,
            strokeWidth: Math.max(settings.shape.strokeWidth, pen.width),
            arrowHead: settings.shape.arrowHead,
            points: [guess.x0, guess.y0, guess.x1, guess.y1],
          });
          this.pts = [];
          this.pressures = [];
          this.capturePressure = false;
          this.last = null;
          store.endGesture();
          return;
        }
      }
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
    const slice = pressures.slice(0, points.length / 2);
    const hasPressure = pressureVaries(slice, points.length / 2);
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
      pressures: hasPressure ? slice : undefined,
    });
    this.pts = [];
    this.pressures = [];
    this.capturePressure = false;
    this.last = null;
    store.endGesture();
  }

  cancel(_engine: Engine): void {
    this.active = false;
    this.pts = [];
    this.pressures = [];
    this.capturePressure = false;
    this.last = null;
    publishDraft(null);
    store.endGesture();
  }

  render(_engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.active || this.pts.length < 2 || !this.last) return;
    const pen = effectivePen();
    const points = this.shift ? this.straightPoints() : this.pts;
    if (points.length < 2) return;
    const bg = store.viewPaperBg();
    drawPenStroke(
      ctx,
      points,
      pen.width,
      displayInk(pen.color, bg),
      pen.alpha * 0.9,
      this.shift || !this.capturePressure ? undefined : this.pressures,
      { bloom: shouldUseOrbitDraw(bg) }
    );
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

function clampPressure(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return 0.5;
  return Math.min(1, Math.max(0.05, raw));
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
  protected shift = false;

  onDown(_engine: Engine, p: PointerInfo): void {
    this.start = p.world;
    this.cur = p.world;
    this.movedScreen = 0;
    this.shift = p.shift;
  }

  onMove(engine: Engine, p: PointerInfo): void {
    if (!this.start) return;
    this.movedScreen = Math.max(
      this.movedScreen,
      Math.hypot(p.world.x - this.start.x, p.world.y - this.start.y) * engine.camera.zoom
    );
    this.cur = p.world;
    this.shift = p.shift;
  }

  onUp(engine: Engine, p: PointerInfo): void {
    if (!this.start || !this.cur) return;
    this.shift = p.shift;
    let box: ShapeBox;
    if (this.movedScreen < 3) {
      box = {
        x: p.world.x - this.defaultW / 2,
        y: p.world.y - this.defaultH / 2,
        w: this.defaultW,
        h: this.defaultH,
      };
    } else if (this.shift) {
      box = squareFromAnchor(this.start, this.cur);
    } else {
      box = normalizeBox(this.start, this.cur);
    }
    const id = store.addShape({
      type: this.shapeType,
      ...box,
      fill: shapeFillValue(),
      stroke: settings.shape.stroke,
      strokeWidth: settings.shape.strokeWidth,
      ...(this.shapeType === 'rect'
        ? { cornerRadius: settings.shape.rounded ? RECT_CORNER_RADIUS : 0 }
        : {}),
    });
    this.start = null;
    this.cur = null;
    this.shift = false;
    if (this.shapeType === 'sticky') engine.openTextEditor(id);
    if (this.shapeType === 'graph') engine.openGraphEditor(id);
  }

  cancel(_engine: Engine): void {
    this.start = null;
    this.cur = null;
    this.shift = false;
  }

  protected previewBox(): ShapeBox | null {
    if (!this.start || !this.cur) return null;
    return this.shift ? squareFromAnchor(this.start, this.cur) : normalizeBox(this.start, this.cur);
  }

  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    const drawBox = this.previewBox();
    if (!drawBox) return;
    const s = 1 / engine.camera.zoom;
    const fill = shapeFillValue();
    ctx.save();
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1.5 * s;
    ctx.setLineDash([4 * s, 4 * s]);
    ctx.beginPath();
    if (this.shapeType === 'ellipse') {
      ctx.ellipse(drawBox.x + drawBox.w / 2, drawBox.y + drawBox.h / 2, drawBox.w / 2, drawBox.h / 2, 0, 0, Math.PI * 2);
    } else if (this.shapeType === 'rect') {
      const rr = settings.shape.rounded ? RECT_CORNER_RADIUS : 0;
      if (rr > 0) ctx.roundRect(drawBox.x, drawBox.y, drawBox.w, drawBox.h, rr);
      else ctx.rect(drawBox.x, drawBox.y, drawBox.w, drawBox.h);
    } else {
      ctx.roundRect(drawBox.x, drawBox.y, drawBox.w, drawBox.h, 6);
    }
    if (hasFill(fill)) {
      ctx.fillStyle = fill.length === 7 ? fill + '22' : withAlpha(fill, 0.13);
      ctx.fill();
    }
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
    const id = store.addShape({
      type: 'sticky',
      ...box,
      // Always store classic sticky colors — Orbit remaps at draw time.
      fill: COLORS.sticky,
      stroke: COLORS.stickyStroke,
      strokeWidth: 2,
      textColor: '#3a2f00',
    });
    this.start = null;
    this.cur = null;
    engine.openTextEditor(id);
  }

  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.cur) return;
    const box = normalizeBox(this.start, this.cur);
    const s = 1 / engine.camera.zoom;
    const orbit = isOrbitPaper(store.viewPaperBg());
    const fill = orbit ? ORBIT_DRAW.sticky : COLORS.sticky;
    ctx.save();
    ctx.strokeStyle = COLORS.selection;
    ctx.fillStyle = fill + '88';
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
  readonly defaultW = 420;
  readonly defaultH = 300;

  onUp(engine: Engine, p: PointerInfo): void {
    if (!this.start || !this.cur) return;
    this.shift = p.shift;
    let box: ShapeBox;
    if (this.movedScreen < 3) {
      box = {
        x: p.world.x - this.defaultW / 2,
        y: p.world.y - this.defaultH / 2,
        w: this.defaultW,
        h: this.defaultH,
      };
    } else if (this.shift) {
      box = squareFromAnchor(this.start, this.cur);
    } else {
      box = normalizeBox(this.start, this.cur);
    }
    const id = store.addShape({
      type: 'graph',
      ...box,
      fill: 'transparent',
      stroke: settings.shape.stroke,
      strokeWidth: 2.25,
      expr: 'sin(x)',
    });
    this.start = null;
    this.cur = null;
    this.shift = false;
    engine.openGraphEditor(id);
  }

  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    const drawBox = this.previewBox();
    if (!drawBox) return;
    const s = 1 / engine.camera.zoom;
    ctx.save();
    ctx.strokeStyle = settings.shape.stroke;
    ctx.fillStyle = 'transparent';
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.5 * s;
    ctx.setLineDash([5 * s, 4 * s]);
    ctx.beginPath();
    ctx.roundRect(drawBox.x, drawBox.y, drawBox.w, drawBox.h, 10);
    ctx.stroke();
    // Mini axes hint
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(drawBox.x + 16 * s, drawBox.y + drawBox.h - 16 * s);
    ctx.lineTo(drawBox.x + drawBox.w - 12 * s, drawBox.y + drawBox.h - 16 * s);
    ctx.moveTo(drawBox.x + 16 * s, drawBox.y + drawBox.h - 16 * s);
    ctx.lineTo(drawBox.x + 16 * s, drawBox.y + 12 * s);
    ctx.stroke();
    ctx.restore();
  }
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
    this.shift = p.shift;
    let box: ShapeBox;
    if (this.movedScreen < 3) {
      box = { x: p.world.x - this.defaultW / 2, y: p.world.y - this.defaultH / 2, w: this.defaultW, h: this.defaultH };
    } else if (this.shift) {
      box = squareFromAnchor(this.start, this.cur);
    } else {
      box = normalizeBox(this.start, this.cur);
    }
    const id = store.addShape({ type: this.shapeType, ...box, fill: 'rgba(255,255,255,0.06)', stroke: settings.shape.stroke, strokeWidth: 2, text: t(readLocale(), 'frameDefault') });
    this.start = null;
    this.cur = null;
    this.shift = false;
    engine.openTextEditor(id);
  }
  render(engine: Engine, ctx: CanvasRenderingContext2D): void {
    const box = this.previewBox();
    if (!box) return;
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
    this.start = null; this.cur = null; engine.openTextEditor(id);
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
    this.start = null; this.cur = null; engine.openTextEditor(id);
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
    this.start = null; this.cur = null; engine.openTextEditor(id);
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
    this.start = null; this.cur = null; engine.openTextEditor(id);
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
  onUp(engine: Engine, p: PointerInfo): void { if (!this.start || !this.cur) return; let box: ShapeBox; if (this.movedScreen < 3) box = { x: p.world.x - this.defaultW/2, y: p.world.y - this.defaultH/2, w: this.defaultW, h: this.defaultH }; else box = normalizeBox(this.start, this.cur); const id = store.addShape({ type: this.shapeType, ...box, fill: settings.shape.fill, stroke: settings.shape.stroke, strokeWidth: 2 }); this.start=null; this.cur=null; engine.openTextEditor(id); }
  render(engine: Engine, ctx: CanvasRenderingContext2D): void { if (!this.start || !this.cur) return; const box = normalizeBox(this.start, this.cur); const s=1/engine.camera.zoom; const r=box.h/2; ctx.save(); ctx.strokeStyle=COLORS.selection; ctx.fillStyle=settings.shape.fill+'22'; ctx.lineWidth=1.5*s; ctx.setLineDash([4*s,4*s]); ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, r); ctx.fill(); ctx.stroke(); ctx.restore(); }
}
export class SubroutineTool extends BoxTool {
  readonly id = 'subroutine'; readonly shapeType = 'subroutine'; readonly defaultW = 160; readonly defaultH = 80;
  onUp(engine: Engine, p: PointerInfo): void { if (!this.start || !this.cur) return; let box: ShapeBox; if (this.movedScreen < 3) box = { x: p.world.x - this.defaultW/2, y: p.world.y - this.defaultH/2, w: this.defaultW, h: this.defaultH }; else box = normalizeBox(this.start, this.cur); const id = store.addShape({ type: this.shapeType, ...box, fill: settings.shape.fill, stroke: settings.shape.stroke, strokeWidth: 2 }); this.start=null; this.cur=null; engine.openTextEditor(id); }
  render(engine: Engine, ctx: CanvasRenderingContext2D): void { if (!this.start || !this.cur) return; const box = normalizeBox(this.start, this.cur); const s=1/engine.camera.zoom; ctx.save(); ctx.strokeStyle=COLORS.selection; ctx.fillStyle=settings.shape.fill+'22'; ctx.lineWidth=1.5*s; ctx.setLineDash([4*s,4*s]); ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, 6); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(box.x+8, box.y); ctx.lineTo(box.x+8, box.y+box.h); ctx.moveTo(box.x+box.w-8, box.y); ctx.lineTo(box.x+box.w-8, box.y+box.h); ctx.stroke(); ctx.restore(); }
}
export class DisplayTool extends BoxTool {
  readonly id = 'display'; readonly shapeType = 'display'; readonly defaultW = 150; readonly defaultH = 80;
  onUp(engine: Engine, p: PointerInfo): void { if (!this.start || !this.cur) return; let box: ShapeBox; if (this.movedScreen < 3) box = { x: p.world.x - this.defaultW/2, y: p.world.y - this.defaultH/2, w: this.defaultW, h: this.defaultH }; else box = normalizeBox(this.start, this.cur); const id = store.addShape({ type: this.shapeType, ...box, fill: settings.shape.fill, stroke: settings.shape.stroke, strokeWidth: 2 }); this.start=null; this.cur=null; engine.openTextEditor(id); }
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
      strokeWidth: settings.shape.strokeWidth,
      arrowHead: settings.shape.arrowHead,
      points: [this.start.x, this.start.y, end.x, end.y],
    });
    this.start = null;
    this.cur = null;
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
    const bend = Math.min(30, len * 0.15) * arrowBendSign(dx, dy);
    const cx = mx + nx * bend * 0.5, cy = my + ny * bend * 0.5;
    const ang = Math.atan2(by - cy, bx - cx);
    const head = settings.shape.arrowHead;
    const ink = displayInk(settings.shape.stroke, store.viewPaperBg());
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = settings.shape.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx, cy, bx, by);
    ctx.stroke();
    ctx.shadowColor = 'transparent';
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
    const bg = store.viewPaperBg();
    // With adapt-on, keep the authored pick; viewers remap. With adapt-off, force contrast now.
    const color = readPrefs().adaptInkToPaper ? settings.text.color : readableTextOn(settings.text.color, bg);
    if (color !== settings.text.color) updateTextSettings({ color });
    engine.openTextEditorAt(at.x, at.y, settings.text.size, color);
  }

  cancel(_engine: Engine): void {
    this.down = null;
  }
}

function circleHitsShape(cx: number, cy: number, r: number, v: ShapeView): boolean {
  if (pointInShape(v, cx, cy)) return true;
  // Avoid AABB false positives on non-rect shapes (triangle / diamond / hexagon corners).
  const precise = new Set([
    'ellipse',
    'diamond',
    'triangle',
    'parallelogram',
    'hexagon',
    'cylinder',
    'terminator',
    'display',
    'pen',
    'arrow',
  ]);
  if (precise.has(v.type)) {
    // Sample points on the eraser circle; hit if any lands inside the shape.
    const samples = 12;
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      if (pointInShape(v, cx + Math.cos(a) * r, cy + Math.sin(a) * r)) return true;
    }
    return false;
  }
  const nx = Math.max(v.x, Math.min(cx, v.x + v.w));
  const ny = Math.max(v.y, Math.min(cy, v.y + v.h));
  return Math.hypot(cx - nx, cy - ny) <= r;
}

/** Mark pen vertices near the eraser, including hits along open segments. */
function markPartialEraseHits(
  points: number[],
  world: { x: number; y: number },
  r: number,
  into: Set<number>
): void {
  if (points.length < 2) return;
  const r2 = r * r;
  for (let i = 0; i < points.length; i += 2) {
    const dx = points[i] - world.x;
    const dy = points[i + 1] - world.y;
    if (dx * dx + dy * dy <= r2) into.add(i / 2);
  }
  for (let i = 0; i < points.length - 2; i += 2) {
    const ax = points[i];
    const ay = points[i + 1];
    const bx = points[i + 2];
    const by = points[i + 3];
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    if (len2 < 0.001) continue;
    const t = Math.max(0, Math.min(1, ((world.x - ax) * abx + (world.y - ay) * aby) / len2));
    const px = ax + abx * t;
    const py = ay + aby * t;
    if ((px - world.x) * (px - world.x) + (py - world.y) * (py - world.y) > r2) continue;
    // Open-segment hit: drop both endpoints so the stroke actually opens a gap.
    into.add(i / 2);
    into.add(i / 2 + 1);
  }
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
    publishErasePreview(null);
    this.wholeHits.clear();
    this.partialHits.clear();
  }

  cancel(engine: Engine): void {
    this.active = false;
    this.pos = null;
    this.wholeHits.clear();
    this.partialHits.clear();
    engine.setErasePreview(new Set(), new Map());
    publishErasePreview(null);
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
    const r = settings.eraser.size;
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
        markPartialEraseHits(v.points, world, r, idx);
      } else if (!this.wholeHits.has(id) && circleHitsShape(world.x, world.y, r, v)) {
        this.wholeHits.add(id);
      }
    }
    engine.setErasePreview(this.wholeHits, this.partialHits);
    const partialMap: Record<string, number[]> = {};
    for (const [id, indices] of this.partialHits) {
      partialMap[id] = [...indices];
    }
    publishErasePreview({
      x: world.x,
      y: world.y,
      r,
      mode: settings.eraser.mode,
      whole: [...this.wholeHits],
      ...(Object.keys(partialMap).length ? { partial: partialMap } : {}),
    });
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
