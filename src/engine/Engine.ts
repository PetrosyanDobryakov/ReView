import * as Y from 'yjs';
import { Camera } from './Camera';
import { Grid } from './Grid';
import * as store from '../core/store';
import { COLORS, SHAPE_FONT, STICKY_FONT, TEXT_FONT, boardFont, containedIn, withAlpha } from '../core/shapes';
import {
  drawPenStroke,
  drawShape,
  getImage,
  onImageLoad,
  pointInShape,
  readableTextOn,
  displayInk,
  themeFor,
  intersects,
  normalizeBox,
} from '../core/shapes';
import { measureMixedLine } from '../core/shapes';
import { onFormulaLoad } from '../core/formula';
import { t } from '../ui/i18n';
import { readLocale } from '../core/locale';
import type { ShapeBox, ShapeView } from '../core/shapes';
import { HANDLES, Tools, pointInPolygon } from './tools';
import type { HandleId, PointerInfo, Tool, ToolId } from './tools';
import type { PeerCursor } from '../core/store';
import { computeSnap, groupBox, type AlignGuide, type AlignKind, alignViews } from '../core/align';
import { portPos, portDir, PORTS, type PortId } from '../core/shapes';
import { getToolBinds, getColorBinds } from '../core/keybindings';
import { updatePenSettings, updateShapeSettings } from '../core/settings';
import { cursorCssForTool, clearToolCursorCache } from './toolCursors';
import { onPrefsChange, readPrefs } from '../core/prefs';

const CROP_CURSORS: Record<HandleId, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};
import { settings } from '../core/settings';

export interface EditTarget {
  id: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number;
  color: string;
  type: string | null;
  centered: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  textAlign: 'left' | 'center' | 'right';
  highlight: boolean;
}

export interface GraphEditTarget {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  expr: string;
}

export interface EngineEvents {
  onSelection?: (ids: string[]) => void;
  onStats?: (stats: { zoom: number; shapes: number }) => void;
  onEditText?: (target: EditTarget) => void;
  onEditGraph?: (target: GraphEditTarget) => void;
  onTool?: (id: ToolId) => void;
  onError?: (message: string) => void;
  onCrop?: (active: boolean) => void;
  onContextMenu?: (menu: { x: number; y: number; shapeId: string | null; type: string | null; locked: boolean }) => void;
  onInfo?: (info: { title: string; lines: string[] } | null) => void;
  onExportRegion?: (rect: ShapeBox | null) => void;
}

const TOOL_KEYS_FALLBACK: Record<string, ToolId> = {
  KeyV: 'select',
  KeyH: 'pan',
  KeyP: 'pen',
  KeyR: 'rect',
  KeyO: 'ellipse',
  KeyL: 'arrow',
  KeyS: 'sticky',
  KeyG: 'graph',
  KeyT: 'text',
  KeyE: 'eraser',
};

const PAPER_MS = 280;

function parseHex(color: string): [number, number, number] | null {
  const raw = color.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(raw)) return null;
  return [parseInt(raw.slice(1, 3), 16), parseInt(raw.slice(3, 5), 16), parseInt(raw.slice(5, 7), 16)];
}

function mixHex(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) return to;
  const u = 1 - (1 - t) * (1 - t) * (1 - t);
  const ch = (x: number, y: number) => Math.round(x + (y - x) * u);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(ch(a[0], b[0]))}${hex(ch(a[1], b[1]))}${hex(ch(a[2], b[2]))}`;
}

const HANDLE_POS: Record<HandleId, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

export class Engine {
  readonly camera = new Camera();
  readonly grid = new Grid();
  readonly tools = new Tools();
  readonly views = new Map<string, ShapeView>();
  readonly selection = new Set<string>();
  events: EngineEvents = {};
  editing = false;
  editId: string | null = null;
  remotePeers: PeerCursor[] = [];

  setPeers(peers: PeerCursor[]): void {
    this.remotePeers = peers;
    this.dirty = true;
  }

  private active: ToolId = 'select';
  private override: ToolId | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private resizer: ResizeObserver;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private rafId = 0;
  private lastT = 0;
  private lastCam = { x: 0, y: 0, z: 1 };
  private dirty = true;
  private paperFrom = '';
  private paperTo = '';
  private paperFill = '';
  private paperT0 = 0;
  private pointerDown = false;
  private panDrag = false;
  private lastStats = '';
  private dragTool: Tool;
  private offImageLoad: () => void = () => {};
  private offFormulaLoad: () => void = () => {};
  private offPrefs: () => void = () => {};
  private erasing = new Set<string>();
  private partialErase = new Map<string, Set<number>>();
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: { dist: number; mid: { x: number; y: number } } | null = null;
  private crop: {
    id: string;
    box: ShapeBox;
    full: ShapeBox;
    mode: 'idle' | 'move' | HandleId;
    start: { x: number; y: number };
    origBox: ShapeBox;
  } | null = null;
  private panStart = { x: 0, y: 0 };
  private reduceMotion = false;
  private exportPick = false;
  private exportRect: ShapeBox | null = null;
  private exportAnchor: { x: number; y: number } | null = null;
  private snapGuides: AlignGuide[] = [];
  private connecting: { fromId: string; fromPort: PortId; cur: { x: number; y: number } } | null = null;
  private hoverPort: { shapeId: string; port: PortId } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
    this.resizer = new ResizeObserver(this.resize);
    this.resizer.observe(canvas);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('dblclick', this.onDblClick);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('paste', this.onPaste);
    // File drops are owned by App (images + PDF/TXT) so we don't double-insert.
    store.board.observe(this.onStore);
    store.meta.observe(this.onMeta);
    store.order.observe(this.onOrder);
    store.ensureOrder();
    this.offImageLoad = onImageLoad(() => {
      this.dirty = true;
    });
    this.offFormulaLoad = onFormulaLoad(() => {
      this.dirty = true;
    });
    this.loadActivePage();
    this.dragTool = this.tool;
    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(prefers-reduced-motion: reduce)');
      this.reduceMotion = mq.matches;
      mq.addEventListener('change', (e) => {
        this.reduceMotion = e.matches;
      });
    }
    this.offPrefs = onPrefsChange(() => {
      clearToolCursorCache();
      this.setCursor(this.toolCursor());
      this.dirty = true;
    });
    this.rafId = requestAnimationFrame(this.loop);
  }

  private loadActivePage(): void {
    store.ensureOrder();
    for (const [key, m] of store.board) {
      if (!store.isOnActivePage(key)) continue;
      const v = { ...store.readShape(m), id: key };
      this.views.set(key, v);
      this.grid.upsert(key, v);
      this.attachShape(key, m);
    }
  }

  resetToPage(): void {
    for (const un of this.shapeObs.values()) un.un();
    this.shapeObs.clear();
    this.views.clear();
    this.grid.rebuild([]);
    this.selection.clear();
    this.erasing.clear();
    this.partialErase.clear();
    this.snapGuides = [];
    this.events.onSelection?.([]);
    this.loadActivePage();
    this.dirty = true;
  }

  contentBox(): ShapeBox | null {
    return this.boundsOf([...this.views.keys()]);
  }

  selectionBounds(): ShapeBox | null {
    return this.boundsOf([...this.selection]);
  }

  private boundsOf(ids: string[]): ShapeBox | null {
    let box: ShapeBox | null = null;
    for (const id of ids) {
      const v = this.views.get(id);
      if (!v) continue;
      box = box
        ? {
            x: Math.min(box.x, v.x),
            y: Math.min(box.y, v.y),
            w: Math.max(box.x + box.w, v.x + v.w) - Math.min(box.x, v.x),
            h: Math.max(box.y + box.h, v.y + v.h) - Math.min(box.y, v.y),
          }
        : { x: v.x, y: v.y, w: v.w, h: v.h };
    }
    return box;
  }

  beginExportPick(): void {
    this.exportPick = true;
    this.exportRect = null;
    this.exportAnchor = null;
    this.setCursor('crosshair');
    this.dirty = true;
  }

  cancelExportPick(): void {
    this.exportPick = false;
    this.exportRect = null;
    this.exportAnchor = null;
    this.setCursor(this.toolCursor());
    this.dirty = true;
  }

  exportCanvas(
    box: ShapeBox,
    opts: { scale: number; format: 'png' | 'jpeg'; quality?: number; background: string | null }
  ): HTMLCanvasElement | null {
    if (box.w <= 0 || box.h <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(box.w * opts.scale));
    canvas.height = Math.max(1, Math.round(box.h * opts.scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(opts.scale, 0, 0, opts.scale, -box.x * opts.scale, -box.y * opts.scale);
    const theme = themeFor(store.viewPaperBg());
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    const ord = store.order;
    for (let i = 0; i < ord.length; i++) {
      const id = ord.get(i);
      if (!store.isOnActivePage(id)) continue;
      const v = this.views.get(id);
      if (!v || !intersects(v, box)) continue;
      drawShape(ctx, v, theme.text, store.viewPaperBg());
    }
    return canvas;
  }

  exportBlob(
    box: ShapeBox,
    opts: { scale: number; format: 'png' | 'jpeg'; quality?: number; background: string | null }
  ): Promise<{ blob: Blob; width: number; height: number } | null> {
    const canvas = this.exportCanvas(box, opts);
    if (!canvas) return Promise.resolve(null);
    const mime = opts.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob ? { blob, width: canvas.width, height: canvas.height } : null),
        mime,
        opts.quality
      );
    });
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.resizer.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('dblclick', this.onDblClick);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('paste', this.onPaste);
    store.board.unobserve(this.onStore);
    store.meta.unobserve(this.onMeta);
    store.order.unobserve(this.onOrder);
    this.offImageLoad();
    this.offFormulaLoad();
    this.offPrefs();
    for (const un of this.shapeObs.values()) un.un();
    this.shapeObs.clear();
  }

  get tool() {
    return this.tools.get(this.override ?? this.active);
  }

  /** Resolved CSS cursor for the active tool (icon cursors respect Advanced scale). */
  toolCursor(): string {
    return cursorCssForTool(this.tool.id) ?? this.tool.cursor;
  }

  setTool(id: ToolId): void {
    this.active = id;
    this.override = null;
    this.setCursor(this.toolCursor());
    this.events.onTool?.(id);
    this.dirty = true;
  }

  setCursor(cursor: string): void {
    this.canvas.style.cursor = cursor;
  }

  setDirty(): void {
    this.dirty = true;
  }

  setSelection(ids: string[]): void {
    this.selection.clear();
    for (const id of ids) {
      if (this.views.has(id)) this.selection.add(id);
    }
    this.dirty = true;
    this.events.onSelection?.([...this.selection]);
  }

  selectedViews(): ShapeView[] {
    const out: ShapeView[] = [];
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (v) out.push(v);
    }
    return out;
  }

  hitTest(x: number, y: number): string | null {
    const box = { x: x - 1, y: y - 1, w: 2, h: 2 };
    const candidates = this.grid.query(box);
    const ord = store.order;
    for (let i = ord.length - 1; i >= 0; i--) {
      const id = ord.get(i);
      if (!candidates.has(id)) continue;
      if (!store.isOnActivePage(id)) continue;
      const v = this.views.get(id);
      if (v && pointInShape(v, x, y)) return id;
    }
    return null;
  }

  hitHandle(sx: number, sy: number): { shapeId: string; handle: HandleId } | null {
    const z = this.camera.zoom;
    const ox = this.w / 2 - this.camera.x * z;
    const oy = this.h / 2 - this.camera.y * z;
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v || v.locked) continue;
      for (const handle of HANDLES) {
        const [fx, fy] = HANDLE_POS[handle];
        const hx = (v.x + fx * v.w) * z + ox;
        const hy = (v.y + fy * v.h) * z + oy;
        if (Math.hypot(hx - sx, hy - sy) <= 9) {
          return { shapeId: id, handle };
        }
      }
    }
    return null;
  }

  hitPort(sx: number, sy: number): { shapeId: string; port: PortId } | null {
    const z = this.camera.zoom;
    const ox = this.w / 2 - this.camera.x * z;
    const oy = this.h / 2 - this.camera.y * z;
    /** Sit outside resize handles so connect ≠ resize. */
    const off = 18 / z;
    const candidates: string[] = [...this.selection, ...[...this.views.keys()].filter((k) => !this.selection.has(k))];
    let best: { shapeId: string; port: PortId; dist: number } | null = null;
    for (const id of candidates) {
      const v = this.views.get(id);
      if (!v || v.locked) continue;
      if (v.type === 'pen' || v.type === 'arrow') continue;
      for (const port of PORTS) {
        const p = portPos(v, port, off);
        const hx = p.x * z + ox;
        const hy = p.y * z + oy;
        const d = Math.hypot(hx - sx, hy - sy);
        if (d <= 16 && (!best || d < best.dist)) best = { shapeId: id, port, dist: d };
      }
    }
    return best ? { shapeId: best.shapeId, port: best.port } : null;
  }

  getPortWorldPos(shapeId: string, port: PortId): { x: number; y: number } | null {
    const v = this.views.get(shapeId);
    if (!v) return null;
    return portPos(v, port, 18 / this.camera.zoom);
  }

  updateConnectedArrows(movedIds: Set<string>): void {
    const off = 8 / this.camera.zoom;
    const patches: Array<[string, Partial<ShapeView>]> = [];
    for (const [id, v] of this.views) {
      if (v.type !== 'arrow' || !v.fromId || !v.toId) continue;
      if (!movedIds.has(v.fromId) && !movedIds.has(v.toId)) continue;
      const from = this.views.get(v.fromId);
      const to = this.views.get(v.toId);
      if (!from || !to) continue;
      const fromPort = (v.fromPort as PortId) || 'e';
      const toPort = (v.toPort as PortId) || 'w';
      const a = portPos(from, fromPort, off);
      const b = portPos(to, toPort, off);
      const pad = 6;
      const minX = Math.min(a.x, b.x) - pad;
      const minY = Math.min(a.y, b.y) - pad;
      const maxX = Math.max(a.x, b.x) + pad;
      const maxY = Math.max(a.y, b.y) + pad;
      patches.push([id, { x: minX, y: minY, w: maxX - minX, h: maxY - minY, points: [a.x, a.y, b.x, b.y] }]);
    }
    if (patches.length) store.patchShapes(patches);
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    const z = this.camera.zoom;
    return {
      x: (x - this.camera.x) * z + this.w / 2,
      y: (y - this.camera.y) * z + this.h / 2,
    };
  }

  translateSelection(dx: number, dy: number): void {
    if (!this.selection.size) return;
    const patches: Array<[string, Partial<ShapeView>]> = [];
    const moved = new Set<string>();
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v || v.locked) continue;
      moved.add(id);
      if (v.points) {
        patches.push([
          id,
          { x: v.x + dx, y: v.y + dy, points: v.points.map((val, i) => val + (i % 2 === 0 ? dx : dy)) },
        ]);
      } else {
        patches.push([id, { x: v.x + dx, y: v.y + dy }]);
      }
    }
    // update connected arrows
    for (const [aid, av] of this.views) {
      if (av.type !== 'arrow' || !av.fromId || !av.toId) continue;
      if (!moved.has(av.fromId) && !moved.has(av.toId)) continue;
      // skip if arrow itself is being moved
      if (moved.has(aid)) continue;
      const from = this.views.get(av.fromId);
      const to = this.views.get(av.toId);
      if (!from || !to) continue;
      const fx = moved.has(av.fromId) ? from.x + dx : from.x;
      const fy = moved.has(av.fromId) ? from.y + dy : from.y;
      const tx = moved.has(av.toId) ? to.x + dx : to.x;
      const ty = moved.has(av.toId) ? to.y + dy : to.y;
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
  }

  clearSnapGuides(): void {
    if (this.snapGuides.length) {
      this.snapGuides = [];
      this.dirty = true;
    }
  }

  computeSnapForMove(
    originals: Map<string, ShapeView>,
    dx: number,
    dy: number
  ): { dx: number; dy: number; guides: AlignGuide[] } {
    const movingViews: ShapeView[] = [];
    for (const v of originals.values()) {
      if (v.locked) continue;
      movingViews.push(v);
    }
    const box = groupBox(movingViews);
    if (!box) return { dx, dy, guides: [] };
    const movedBox: ShapeBox = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
    const otherBoxes: ShapeBox[] = [];
    for (const [id, v] of this.views) {
      if (originals.has(id)) continue;
      otherBoxes.push({ x: v.x, y: v.y, w: v.w, h: v.h });
    }
    const threshold = 8 / this.camera.zoom;
    const res = computeSnap(movedBox, otherBoxes, threshold);
    // res.dx is delta to add to movedBox to snap, so final dx = dx + res.dx
    return { dx: dx + res.dx, dy: dy + res.dy, guides: res.guides };
  }

  setSnapGuides(guides: AlignGuide[]): void {
    this.snapGuides = guides;
    this.dirty = true;
  }

  alignSelection(kind: AlignKind): void {
    if (!this.selection.size) return;
    const selected = [...this.selection].map((id) => this.views.get(id)).filter(Boolean) as ShapeView[];
    const unlocked = selected.filter((v) => !v.locked);
    if (!unlocked.length) return;
    // others = all views not in selection, or if single selection and kind aligns to others' union, use others
    // if multiple selection and align to each other, others = [] means align within group? But spec says "относительно других объектов"
    // So for single or multi, align to union of unselected shapes
    const others = [...this.views.values()].filter((v) => !this.selection.has(v.id));
    let patches: Array<[string, Partial<ShapeView>]> = [];
    if (kind === 'centerH' || kind === 'centerV' || kind === 'left' || kind === 'right' || kind === 'top' || kind === 'bottom') {
      if (others.length) {
        patches = alignViews(unlocked, others, kind);
      } else {
        // no others — align within selection? do nothing
        return;
      }
    } else if (kind === 'distributeH' || kind === 'distributeV') {
      patches = alignViews(unlocked, [], kind);
    }
    if (patches.length) store.patchShapes(patches);
  }

  private unlockedIds(): string[] {
    return [...this.selection].filter((id) => !this.views.get(id)?.locked);
  }

  deleteSelection(): void {
    const ids = this.unlockedIds();
    if (!ids.length) return;
    store.removeShapes(ids);
  }

  private clipboard: ShapeView[] = [];
  private pasteN = 0;

  copySelection(): void {
    this.clipboard = [];
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (v) this.clipboard.push(structuredClone(v));
    }
    this.pasteN = 0;
  }

  cutSelection(): void {
    this.copySelection();
    this.deleteSelection();
  }

  pasteSelection(): void {
    if (!this.clipboard.length) return;
    this.pasteN += 1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const v of this.clipboard) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x + v.w);
      maxY = Math.max(maxY, v.y + v.h);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const drift = (((this.pasteN - 1) % 8) * 24) / this.camera.zoom;
    const dx = this.camera.x - cx + drift;
    const dy = this.camera.y - cy + drift;
    const ids: string[] = [];
    for (const v of this.clipboard) {
      ids.push(
        store.addShape({
          ...v,
          id: undefined,
          x: v.x + dx,
          y: v.y + dy,
          points: v.points ? v.points.map((p, i) => p + (i % 2 === 0 ? dx : dy)) : undefined,
        })
      );
    }
    this.setSelection(ids);
    this.setTool('select');
  }

  duplicateSelection(): void {
    if (!this.selection.size) return;
    const off = 40 / this.camera.zoom;
    const ids: string[] = [];
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v) continue;
      ids.push(
        store.addShape({
          ...v,
          id: undefined,
          x: v.x + off,
          y: v.y + off,
          points: v.points ? v.points.map((p) => p + off) : undefined,
        })
      );
    }
    this.setSelection(ids);
    this.setTool('select');
  }

  bringFront(): void {
    if (!this.selection.size) return;
    store.moveOrderToFront([...this.selection]);
    this.dirty = true;
  }

  sendBack(): void {
    if (!this.selection.size) return;
    store.moveOrderToBack([...this.selection]);
    this.dirty = true;
  }

  toggleLockSelection(): void {
    if (!this.selection.size) return;
    let anyUnlocked = false;
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (v && !v.locked) anyUnlocked = true;
    }
    // any unlocked shape in the selection → lock everything, otherwise unlock
    const locked = anyUnlocked;
    const patches: Array<[string, Partial<ShapeView>]> = [];
    for (const id of this.selection) patches.push([id, { locked }]);
    store.patchShapes(patches);
  }

  private selectionCanvas(ids: string[]): HTMLCanvasElement | null {
    // include annotations that sit on top of selected images
    const all = [...ids];
    for (const id of ids) {
      const v = this.views.get(id);
      if (v?.type !== 'image') continue;
      for (const a of this.annotationsOn(v)) {
        if (!all.includes(a.id)) all.push(a.id);
      }
    }
    ids = all;
    let box: ShapeBox | null = null;
    for (const id of ids) {
      const v = this.views.get(id);
      if (!v) continue;
      box = box
        ? {
            x: Math.min(box.x, v.x),
            y: Math.min(box.y, v.y),
            w: Math.max(box.x + box.w, v.x + v.w) - Math.min(box.x, v.x),
            h: Math.max(box.y + box.h, v.y + v.h) - Math.min(box.y, v.y),
          }
        : { x: v.x, y: v.y, w: v.w, h: v.h };
    }
    if (!box) return null;
    const pad = 8;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(box.w + pad * 2));
    canvas.height = Math.max(1, Math.round(box.h + pad * 2));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = store.viewPaperBg();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(-box.x + pad, -box.y + pad);
    const theme = themeFor(store.viewPaperBg());
    const set = new Set(ids);
    // keep board z-order so annotations land on top of the image
    const ord = store.order;
    for (let i = 0; i < ord.length; i++) {
      const id = ord.get(i);
      if (!set.has(id)) continue;
      const v = this.views.get(id);
      if (v) drawShape(ctx, v, theme.text, store.viewPaperBg());
    }
    return canvas;
  }

  /** Text/sticky/pen annotations sitting fully inside the image bounds. */
  annotationsOn(v: ShapeView): ShapeView[] {
    const out: ShapeView[] = [];
    for (const [sid, sv] of this.views) {
      if (sid === v.id || sv.locked) continue;
      if (sv.type !== 'text' && sv.type !== 'sticky' && sv.type !== 'pen') continue;
      if (!store.isOnActivePage(sid)) continue;
      if (containedIn(sv, v)) out.push(sv);
    }
    return out;
  }

  private async copyAsImage(ids: string[]): Promise<void> {
    let dataUrl: string | null = null;
    if (ids.length === 1) {
      const v = this.views.get(ids[0]);
      // raw fast path only when nothing is drawn on top of the image
      if (v && v.type === 'image' && v.src && v.cropW === undefined && v.cropH === undefined && this.annotationsOn(v).length === 0) {
        dataUrl = v.src;
      }
    }
    if (!dataUrl) {
      const canvas = this.selectionCanvas(ids);
      if (canvas) dataUrl = canvas.toDataURL('image/png');
    }
    if (!dataUrl) return;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'review.png';
      a.click();
    }
  }

  copySelectionAsImage(): void {
    if (!this.selection.size) return;
    void this.copyAsImage([...this.selection]);
  }

  downloadSelection(): void {
    if (!this.selection.size) return;
    const ids = [...this.selection];
    const v = this.views.get(ids[0]);
    // Raw src only when a lone image has no annotations; otherwise bake the canvas
    // (same path as copy-as-image) so pens/stickies/text on the photo are included.
    if (
      ids.length === 1 &&
      v?.type === 'image' &&
      v.src &&
      v.cropW === undefined &&
      v.cropH === undefined &&
      this.annotationsOn(v).length === 0
    ) {
      const a = document.createElement('a');
      a.href = v.src;
      a.download = 'review-image.png';
      a.click();
      return;
    }
    const canvas = this.selectionCanvas(ids);
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'review.png';
    a.click();
  }

  scaleSelectionToOriginal(): void {
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v || v.type !== 'image') continue;
      const img = getImage(v.src ?? '');
      if (!img || !img.complete || !img.naturalWidth) continue;
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      store.patchShape(id, {
        x: cx - img.naturalWidth / 2,
        y: cy - img.naturalHeight / 2,
        w: img.naturalWidth,
        h: img.naturalHeight,
      });
    }
  }

  exportCsvSelection(): void {
    if (this.selection.size !== 1) return;
    const v = this.views.get([...this.selection][0]);
    const pts = v?.points;
    if (!v || !pts) return;
    const rows = ['x,y'];
    for (let i = 0; i < pts.length; i += 2) rows.push(`${pts[i]},${pts[i + 1]}`);
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'review-stroke.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  shapeInfo(id: string): { title: string; lines: string[] } | null {
    const v = this.views.get(id);
    if (!v) return null;
    const locale = readLocale();
    const typeKey = (
      {
        rect: 'infoRect',
        ellipse: 'infoEllipse',
        sticky: 'infoSticky',
        text: 'infoText',
        pen: 'infoPen',
        doc: 'infoDoc',
        arrow: 'infoArrow',
        image: 'infoImage',
        graph: 'infoGraph',
        diamond: 'infoDiamond',
        frame: 'infoFrame',
        triangle: 'infoTriangle',
        parallelogram: 'infoParallelogram',
        hexagon: 'infoHexagon',
        cylinder: 'infoCylinder',
        terminator: 'infoTerminator',
        subroutine: 'infoSubroutine',
        display: 'infoDisplay',
      } as const
    )[v.type] as unknown as string ?? 'infoRect';
    const lines = [
      `${t(locale, 'infoSize')}: ${Math.round(v.w)} × ${Math.round(v.h)}`,
      `${t(locale, 'infoPos')}: ${Math.round(v.x)}, ${Math.round(v.y)}`,
    ];
    if (v.points) lines.push(`${t(locale, 'infoPoints')}: ${v.points.length / 2}`);
    if (v.type === 'image') {
      const img = getImage(v.src ?? '');
      if (img && img.complete && img.naturalWidth) {
        lines.push(`${t(locale, 'infoPixels')}: ${img.naturalWidth} × ${img.naturalHeight}`);
      }
    }
    if (v.locked) lines.push(t(locale, 'infoLocked'));
    return { title: t(locale, typeKey as unknown as import('../ui/i18n').MessageKey), lines };
  }

  zoomBy(factor: number): void {
    this.camera.zoomAt(this.w / 2, this.h / 2, this.w / 2, this.h / 2, factor);
  }

  insertImageFile(file: File, at?: { x: number; y: number }): void {
    const locale = readLocale();
    if (!file.type.startsWith('image/')) {
      this.events.onError?.(t(locale, 'imageFailed'));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.events.onError?.(t(locale, 'imageTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => this.events.onError?.(t(locale, 'imageFailed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => this.events.onError?.(t(locale, 'imageFailed'));
      img.onload = () => {
        const maxStore = 1600;
        const storeScale = Math.min(1, maxStore / Math.max(img.naturalWidth, img.naturalHeight));
        const sw = Math.max(1, Math.round(img.naturalWidth * storeScale));
        const sh = Math.max(1, Math.round(img.naturalHeight * storeScale));
        const scratch = document.createElement('canvas');
        scratch.width = sw;
        scratch.height = sh;
        const sctx = scratch.getContext('2d');
        if (!sctx) return;
        sctx.drawImage(img, 0, 0, sw, sh);
        const jpeg = file.type === 'image/jpeg' || file.type === 'image/jpg' || file.type === 'image/webp';
        const src = jpeg ? scratch.toDataURL('image/jpeg', 0.85) : scratch.toDataURL('image/png');
        const maxShow = 600;
        const showScale = Math.min(1, maxShow / Math.max(sw, sh));
        const w = Math.max(1, sw * showScale);
        const h = Math.max(1, sh * showScale);
        const pos =
          at ?? this.camera.screenToWorld(this.w / 2, this.h / 2, this.w / 2, this.h / 2);
        const id = store.addShape({
          type: 'image',
          x: pos.x - w / 2,
          y: pos.y - h / 2,
          w,
          h,
          fill: 'transparent',
          stroke: 'transparent',
          strokeWidth: 0,
          src,
        });
        this.setSelection([id]);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  hasImageSelection(): boolean {
    if (this.selection.size !== 1) return false;
    const v = this.views.get([...this.selection][0]);
    return Boolean(v && v.type === 'image' && !v.locked);
  }

  addDocument(pages: string[], ratio: number, at?: { x: number; y: number }): string | null {
    if (!pages.length) return null;
    const maxShow = 560;
    const w = maxShow;
    const h = Math.round(maxShow / (ratio || 0.707));
    const pos = at ?? this.camera.screenToWorld(this.w / 2, this.h / 2, this.w / 2, this.h / 2);
    const id = store.addShape({
      type: 'doc',
      x: pos.x - w / 2,
      y: pos.y - h / 2,
      w,
      h,
      fill: 'transparent',
      stroke: 'transparent',
      strokeWidth: 0,
      pages,
      page: 0,
    });
    this.setSelection([id]);
    return id;
  }

  private selectedDoc(): ShapeView | null {
    if (this.selection.size !== 1) return null;
    const v = this.views.get([...this.selection][0]);
    return v && v.type === 'doc' && (v.pages?.length ?? 0) > 1 ? v : null;
  }

  /** Screen-space page-flip arrow zones for the selected doc. */
  private docArrowZones(v: ShapeView): Array<{ side: 'prev' | 'next'; x: number; y: number }> {
    const z = this.camera.zoom;
    const ox = this.w / 2 - this.camera.x * z;
    const oy = this.h / 2 - this.camera.y * z;
    const left = v.x * z + ox;
    const right = (v.x + v.w) * z + ox;
    const cy = (v.y + v.h / 2) * z + oy;
    const off = 26;
    return [
      { side: 'prev', x: left - off, y: cy },
      { side: 'next', x: right + off, y: cy },
    ];
  }

  private docArrowRadius(): number {
    return 15;
  }

  private drawDocControls(ctx: CanvasRenderingContext2D): void {
    const v = this.selectedDoc();
    if (!v || this.editing) return;
    const zones = this.docArrowZones(v);
    const r = this.docArrowRadius();
    ctx.save();
    // zones are computed in screen space; drop the camera transform
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const zone of zones) {
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, r, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.selection;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      if (zone.side === 'prev') {
        ctx.moveTo(zone.x + 3, zone.y - 6);
        ctx.lineTo(zone.x - 4, zone.y);
        ctx.lineTo(zone.x + 3, zone.y + 6);
      } else {
        ctx.moveTo(zone.x - 3, zone.y - 6);
        ctx.lineTo(zone.x + 4, zone.y);
        ctx.lineTo(zone.x - 3, zone.y + 6);
      }
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    const page = (v.page ?? 0) + 1;
    const total = v.pages?.length ?? 0;
    ctx.font = '12px "Space Grotesk", Onest, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const label = `${page} / ${total}`;
    const tw = ctx.measureText(label).width;
    const z = this.camera.zoom;
    const lx = (v.x + v.w / 2) * z + (this.w / 2 - this.camera.x * z);
    const ly = (v.y + v.h) * z + (this.h / 2 - this.camera.y * z) + 8;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(lx - tw / 2 - 8, ly, tw + 16, 20, 10);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, lx, ly + 4);
    ctx.restore();
  }

  /** Returns true if the pointer press hit a doc page arrow (and handled it). */
  private tryDocArrow(sx: number, sy: number): boolean {
    const v = this.selectedDoc();
    if (!v) return false;
    const r = this.docArrowRadius() + 4;
    for (const zone of this.docArrowZones(v)) {
      if (Math.hypot(sx - zone.x, sy - zone.y) <= r) {
        const pages = v.pages?.length ?? 0;
        const cur = v.page ?? 0;
        const next = zone.side === 'prev' ? Math.max(0, cur - 1) : Math.min(pages - 1, cur + 1);
        if (next !== cur) store.patchShape(v.id, { page: next });
        this.dirty = true;
        return true;
      }
    }
    return false;
  }

  startCropSelected(): void {
    if (this.selection.size !== 1) return;
    const id = [...this.selection][0];
    const v = this.views.get(id);
    if (!v || v.type !== 'image' || v.locked) return;
    const f = { x: v.cropX ?? 0, y: v.cropY ?? 0, w: v.cropW ?? 1, h: v.cropH ?? 1 };
    const fullW = v.w / f.w;
    const fullH = v.h / f.h;
    const fullX = v.x - (f.x / f.w) * v.w;
    const fullY = v.y - (f.y / f.h) * v.h;
    this.crop = {
      id,
      box: { x: v.x, y: v.y, w: v.w, h: v.h },
      full: { x: fullX, y: fullY, w: fullW, h: fullH },
      mode: 'idle',
      start: { x: 0, y: 0 },
      origBox: { x: v.x, y: v.y, w: v.w, h: v.h },
    };
    this.setCursor('default');
    this.events.onCrop?.(true);
    this.dirty = true;
  }

  cancelCrop(): void {
    this.crop = null;
    this.setCursor(this.toolCursor());
    this.events.onCrop?.(false);
    this.dirty = true;
  }

  applyCrop(): void {
    const c = this.crop;
    if (!c) return;
    if (c.box.w < 1 || c.box.h < 1) {
      this.cancelCrop();
      return;
    }
    const cropX = (c.box.x - c.full.x) / c.full.w;
    const cropY = (c.box.y - c.full.y) / c.full.h;
    const cropW = c.box.w / c.full.w;
    const cropH = c.box.h / c.full.h;
    store.patchShape(c.id, {
      x: c.box.x,
      y: c.box.y,
      w: c.box.w,
      h: c.box.h,
      cropX,
      cropY,
      cropW,
      cropH,
    });
    this.crop = null;
    this.setCursor(this.toolCursor());
    this.events.onCrop?.(false);
    this.dirty = true;
  }

  resetCropSelected(): void {
    if (!this.selection.size) return;
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v || v.type !== 'image' || v.locked) continue;
      if (v.cropW === undefined && v.cropH === undefined) continue;
      const f = { x: v.cropX ?? 0, y: v.cropY ?? 0, w: v.cropW ?? 1, h: v.cropH ?? 1 };
      const w = v.w / f.w;
      const h = v.h / f.h;
      const x = v.x - (f.x / f.w) * v.w;
      const y = v.y - (f.y / f.h) * v.h;
      store.patchShape(id, { x, y, w, h });
      store.clearShapeKeys(id, ['cropX', 'cropY', 'cropW', 'cropH']);
    }
    this.dirty = true;
  }

  private onPaste = (e: ClipboardEvent): void => {
    if (this.editing) return;
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            this.insertImageFile(file);
            return;
          }
        }
      }
    }
    e.preventDefault();
    this.pasteSelection();
  };

  private async pasteFromClipboard(): Promise<void> {
    if (this.clipboard.length) {
      this.pasteSelection();
      return;
    }
    try {
      const items = await Promise.race([
        navigator.clipboard.read(),
        new Promise<ClipboardItem[] | null>((resolve) => setTimeout(() => resolve(null), 150)),
      ]);
      if (items) {
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith('image/'));
          if (type) {
            const blob = await item.getType(type);
            this.insertImageFile(new File([blob], 'clipboard.png', { type }));
            return;
          }
        }
      }
    } catch {
      /* no permission or not a secure context — use internal buffer */
    }
    this.pasteSelection();
  }

  resetZoom(): void {
    this.camera.setZoom(1);
  }

  fitContent(): void {
    let box: ShapeBox | null = null;
    for (const v of this.views.values()) {
      box = box
        ? {
            x: Math.min(box.x, v.x),
            y: Math.min(box.y, v.y),
            w: Math.max(box.x + box.w, v.x + v.w) - Math.min(box.x, v.x),
            h: Math.max(box.y + box.h, v.y + v.h) - Math.min(box.y, v.y),
          }
        : { x: v.x, y: v.y, w: v.w, h: v.h };
    }
    const target = box ?? { x: -600, y: -400, w: 1200, h: 800 };
    this.camera.fitView(
      { x: target.x - 60, y: target.y - 60, w: target.w + 120, h: target.h + 120 },
      this.w,
      this.h,
      80
    );
    this.dirty = true;
  }

  openTextEditor(id: string): void {
    const v = this.views.get(id);
    if (!v || v.locked || v.type === 'pen' || v.type === 'arrow') return;
    const centered = v.type === 'rect' || v.type === 'ellipse' || v.type === 'diamond' || v.type === 'triangle' || v.type === 'parallelogram' || v.type === 'hexagon' || v.type === 'cylinder' || v.type === 'terminator' || v.type === 'subroutine' || v.type === 'display';
    const bg = store.viewPaperBg();
    let color: string;
    if (v.type === 'sticky') {
      color = v.textColor ?? '#3a2f00';
    } else if (v.type === 'text') {
      color = v.textColor ?? themeFor(bg).text;
    } else {
      color = v.textColor ?? themeFor(bg).text;
    }
    this.editing = true;
    this.editId = id;
    this.events.onEditText?.({
      id,
      x: v.x,
      y: v.y,
      w: v.w,
      h: v.h,
      text: v.text ?? '',
      fontSize:
        v.fontSize ?? (v.type === 'sticky' ? STICKY_FONT : v.type === 'rect' || v.type === 'ellipse' ? SHAPE_FONT : TEXT_FONT),
      color,
      type: v.type,
      centered,
      bold: !!v.bold,
      italic: !!v.italic,
      underline: !!v.underline,
      strike: !!v.strike,
      textAlign: v.textAlign ?? (centered ? 'center' : 'left'),
      highlight: !!v.highlight,
    });
  }

  openTextEditorAt(x: number, y: number, fontSize: number, color: string): void {
    const bg = store.viewPaperBg();
    const { adaptInkToPaper } = readPrefs();
    const editorColor = adaptInkToPaper ? color : readableTextOn(color, bg);
    const fmt = settings.text;
    this.editing = true;
    this.editId = null;
    this.events.onEditText?.({
      id: null,
      x,
      y,
      w: 240,
      h: 30,
      text: '',
      fontSize,
      color: editorColor,
      type: 'text',
      centered: false,
      bold: fmt.bold,
      italic: fmt.italic,
      underline: fmt.underline,
      strike: fmt.strike,
      textAlign: fmt.align,
      highlight: fmt.highlight,
    });
  }

  cancelTextEdit(): void {
    this.editing = false;
    this.editId = null;
  }

  openGraphEditor(id: string): void {
    const v = this.views.get(id);
    if (!v || v.type !== 'graph') return;
    this.editing = true;
    this.events.onEditGraph?.({
      id,
      x: v.x,
      y: v.y,
      w: v.w,
      h: v.h,
      expr: v.expr ?? 'sin(x)',
    });
  }

  commitGraph(id: string, expr: string): void {
    this.editing = false;
    store.patchShape(id, { expr: expr.trim() || 'sin(x)' });
    this.dirty = true;
  }

  commitGraphPreview(id: string, expr: string): void {
    store.patchShape(id, { expr: expr.trim() || 'sin(x)' });
    this.dirty = true;
  }

  cancelGraphEditor(): void {
    this.editing = false;
  }

  commitText(id: string | null, text: string, target: EditTarget): void {
    this.editing = false;
    this.editId = null;
    const bg = store.viewPaperBg();
    const color =
      target.type === 'text' && !readPrefs().adaptInkToPaper
        ? readableTextOn(target.color, bg)
        : target.color;
    if (id === null) {
      const trimmed = text.trim();
      if (!trimmed) return;
      const newId = store.addShape({
        type: 'text',
        x: target.x,
        y: target.y,
        w: 0,
        h: 0,
        fill: 'transparent',
        stroke: 'transparent',
        strokeWidth: 0,
        text: trimmed,
        fontSize: target.fontSize,
        textColor: color,
        bold: target.bold || undefined,
        italic: target.italic || undefined,
        underline: target.underline || undefined,
        strike: target.strike || undefined,
        textAlign: target.textAlign !== 'left' ? target.textAlign : undefined,
        highlight: target.highlight || undefined,
      });
      const size = this.measureText(trimmed, target.fontSize, target);
      store.patchShape(newId, { w: size.w, h: size.h });
      this.setSelection([]);
      this.setTool('select');
    } else {
      const v = this.views.get(id);
      if (!v) return;
      if (!text.trim() && v.type === 'text') {
        store.removeShapes([id]);
        this.setSelection([]);
        return;
      }
      const patch: Partial<ShapeView> = {
        text,
        textColor: color,
        bold: target.bold,
        italic: target.italic,
        underline: target.underline,
        strike: target.strike,
        textAlign: target.textAlign,
        highlight: target.highlight,
      };
      if (v.type === 'text') {
        // keep the user's frame width; recompute height from wrapped lines
        const size = this.measureTextWrapped(
          text,
          v.fontSize ?? TEXT_FONT,
          Math.max(v.w, (v.fontSize ?? TEXT_FONT) * 2),
          { bold: target.bold, italic: target.italic }
        );
        patch.w = Math.max(v.w, size.w);
        patch.h = size.h;
      }
      store.patchShape(id, patch);
    }
    this.dirty = true;
  }

  measureText(
    text: string,
    fontSize: number,
    fmt: { bold?: boolean; italic?: boolean } = {}
  ): { w: number; h: number } {
    this.ctx.font = boardFont(fontSize, fmt);
    const lines = text.split('\n');
    let maxW = 0;
    for (const line of lines) {
      maxW = Math.max(maxW, measureMixedLine(this.ctx, line, fontSize));
    }
    return { w: maxW + 4, h: lines.length * fontSize * 1.3 };
  }

  /** Height of `text` when wrapped to `maxW`, plus the widest wrapped line. */
  measureTextWrapped(
    text: string,
    fontSize: number,
    maxW: number,
    fmt: { bold?: boolean; italic?: boolean } = {}
  ): { w: number; h: number } {
    this.ctx.font = boardFont(fontSize, fmt);
    const lines: string[] = [];
    for (const raw of text.split('\n')) {
      if (!raw) {
        lines.push('');
        continue;
      }
      let line = '';
      for (const word of raw.split(/\s+/)) {
        const test = line ? line + ' ' + word : word;
        if (line && measureMixedLine(this.ctx, test, fontSize) > maxW) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
    }
    let w = 0;
    for (const line of lines) w = Math.max(w, measureMixedLine(this.ctx, line, fontSize));
    return { w: w + 4, h: lines.length * fontSize * 1.3 };
  }

  /** World point under a client (viewport) coordinate — used by App file drops. */
  worldAtClient(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return this.camera.screenToWorld(clientX - rect.left, clientY - rect.top, this.w / 2, this.h / 2);
  }

  private onMeta = (): void => {
    this.dirty = true;
  };

  private onOrder = (): void => {
    this.dirty = true;
  };

  private onStore = (ev: Y.YMapEvent<Y.Map<unknown>>): void => {
    const deleted: string[] = [];
    ev.changes.keys.forEach((change, key) => {
      if (change.action === 'delete') {
        this.detachShape(key);
        this.views.delete(key);
        this.grid.remove(key);
        if (this.selection.delete(key)) this.events.onSelection?.([...this.selection]);
        deleted.push(key);
      } else if (store.isOnActivePage(key)) {
        const m = store.board.get(key);
        if (m) {
          const v = { ...store.readShape(m), id: key };
          // for connected arrows, recompute points from current port positions if needed
          if (v.type === 'arrow' && v.fromId && v.toId) {
            const from = this.views.get(v.fromId) ?? (store.board.has(v.fromId) ? store.readShape(store.board.get(v.fromId)!) : null);
            const to = this.views.get(v.toId) ?? (store.board.has(v.toId) ? store.readShape(store.board.get(v.toId)!) : null);
            // if we have both endpoints, ensure points reflect port positions (in case observer fired before move)
            if (from && to) {
              const a = portPos(from as ShapeView, (v.fromPort as PortId) || 'e', 0);
              const b = portPos(to as ShapeView, (v.toPort as PortId) || 'w', 0);
              // keep stored points in sync if needed (will be patched via updateConnectedArrows on move, but ensure here)
              v.points = [a.x, a.y, b.x, b.y];
              const pad = 6; const minX = Math.min(a.x, b.x) - pad; const minY = Math.min(a.y, b.y) - pad; const maxX = Math.max(a.x, b.x) + pad; const maxY = Math.max(a.y, b.y) + pad;
              v.x = minX; v.y = minY; v.w = maxX - minX; v.h = maxY - minY;
            }
          }
          this.views.set(key, v);
          this.grid.upsert(key, v);
          this.attachShape(key, m);
        }
      }
    });
    if (deleted.length) {
      const toDelete: string[] = [];
      for (const [aid, av] of this.views) {
        if (av.type === 'arrow' && ((av.fromId && deleted.includes(av.fromId)) || (av.toId && deleted.includes(av.toId!)))) toDelete.push(aid);
      }
      if (toDelete.length) store.removeShapes(toDelete);
    }
    this.dirty = true;
  };

  private shapeObs = new Map<string, { un: () => void; m: Y.Map<unknown> }>();

  private attachShape(key: string, m: Y.Map<unknown>): void {
    const existing = this.shapeObs.get(key);
    if (existing && existing.m === m) return;
    this.detachShape(key);
    const cb = () => {
      const v = { ...store.readShape(m), id: key };
      this.views.set(key, v);
      this.grid.upsert(key, v);
      this.dirty = true;
    };
    m.observe(cb);
    this.shapeObs.set(key, { un: () => m.unobserve(cb), m });
  }

  private detachShape(key: string): void {
    const existing = this.shapeObs.get(key);
    if (existing) {
      existing.un();
      this.shapeObs.delete(key);
    }
  }

  private resize = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.dirty = true;
  };

  private pointerInfo(e: PointerEvent | MouseEvent): PointerInfo {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return {
      screen: { x: sx, y: sy },
      world: this.camera.screenToWorld(sx, sy, this.w / 2, this.h / 2),
      shift: e.shiftKey,
      alt: (e as PointerEvent).altKey ?? (e as MouseEvent).altKey ?? false,
    };
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size >= 2) {
      this.cancelToolDrag();
      this.pointerDown = false;
      this.updateGesture();
      return;
    }
    this.pointerDown = true;
    if (this.exportPick) {
      if (e.button === 0) {
        const p = this.pointerInfo(e);
        this.exportAnchor = p.world;
        this.exportRect = { x: p.world.x, y: p.world.y, w: 0, h: 0 };
      }
      return;
    }
    if (this.crop) {
      const p = this.pointerInfo(e);
      const grabbed = this.cropHitHandle(p.screen.x, p.screen.y);
      const f = this.crop.full;
      const farOutside =
        !grabbed &&
        e.button === 0 &&
        (p.world.x < f.x || p.world.x > f.x + f.w || p.world.y < f.y || p.world.y > f.y + f.h);
      if (farOutside) {
        this.applyCrop();
        return;
      }
      this.cropPointerDown(e);
      return;
    }
    if (e.button === 1 || e.button === 2) {
      this.panDrag = true;
      this.panStart = { x: e.clientX, y: e.clientY };
      this.camera.instant = true;
      this.setCursor('grabbing');
      e.preventDefault();
      return;
    }
    if (this.editing) return;
    try {
      const info = this.pointerInfo(e);
      if (e.button === 0 && this.tryDocArrow(info.screen.x, info.screen.y)) return;
      // Resize wins over connect when both sit near the same edge.
      const onHandle = this.hitHandle(info.screen.x, info.screen.y);
      if (!onHandle) {
        const portHit = this.hitPort(info.screen.x, info.screen.y);
        if (portHit && this.selection.has(portHit.shapeId) && e.button === 0) {
          this.connecting = { fromId: portHit.shapeId, fromPort: portHit.port, cur: info.world };
          this.hoverPort = null;
          this.setCursor('crosshair');
          this.dirty = true;
          return;
        }
      }
      let target = this.tool;
      if (target.id !== 'select' && target.id !== 'pan' && target.id !== 'pen' && target.id !== 'eraser') {
        if (this.hitTest(info.world.x, info.world.y)) target = this.tools.select;
      }
      this.dragTool = target;
      target.onDown(this, info);
    } catch (err) {
      console.error('[review] pointerdown error:', err);
      this.events.onError?.(err instanceof Error ? err.message : String(err));
    }
    this.dirty = true;
  };

  private onPointerLeave = (): void => {
    store.sendCursor(null);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    if (this.pointers.size >= 2 && this.gesture) {
      this.updateGesture();
      return;
    }
    store.sendCursor(this.pointerInfo(e).world);
    if (this.exportPick) {
      if (this.exportAnchor) {
        const p = this.pointerInfo(e);
        this.exportRect = normalizeBox(this.exportAnchor, p.world);
        this.dirty = true;
      }
      return;
    }
    if (this.crop) {
      this.cropPointerMove(e);
      if (!this.pointerDown) {
        const p = this.pointerInfo(e);
        const h = this.cropHitHandle(p.screen.x, p.screen.y);
        if (h) {
          this.setCursor(CROP_CURSORS[h]);
        } else {
          const c = this.crop;
          const inside =
            p.world.x >= c.box.x &&
            p.world.x <= c.box.x + c.box.w &&
            p.world.y >= c.box.y &&
            p.world.y <= c.box.y + c.box.h;
          this.setCursor(inside ? 'move' : 'default');
        }
      }
      return;
    }
    if (this.connecting) {
      const info = this.pointerInfo(e);
      this.connecting.cur = info.world;
      const hp = this.hitPort(info.screen.x, info.screen.y);
      if (hp && hp.shapeId !== this.connecting.fromId) this.hoverPort = hp;
      else if (hp && hp.shapeId === this.connecting.fromId) this.hoverPort = null;
      else {
        const hit = this.hitTest(info.world.x, info.world.y);
        if (hit && hit !== this.connecting.fromId) {
          const v = this.views.get(hit);
          if (v) {
            let best: PortId | null = null;
            let bestD = Infinity;
            for (const port of PORTS) {
              const pp = portPos(v, port, 0);
              const d = Math.hypot(pp.x - info.world.x, pp.y - info.world.y);
              if (d < bestD) { bestD = d; best = port; }
            }
            if (best && bestD < 40 / this.camera.zoom) this.hoverPort = { shapeId: hit, port: best };
            else this.hoverPort = null;
          } else this.hoverPort = null;
        } else this.hoverPort = null;
      }
      this.dirty = true;
      return;
    }
    if (this.panDrag) {
      this.camera.panBy(e.movementX, e.movementY);
      return;
    }
    if (!this.pointerDown && !this.connecting && this.selection.size) {
      const info = this.pointerInfo(e);
      if (this.hitHandle(info.screen.x, info.screen.y)) {
        if (this.hoverPort) {
          this.hoverPort = null;
          this.dirty = true;
        }
      } else {
        const hp = this.hitPort(info.screen.x, info.screen.y);
        if (hp && this.selection.has(hp.shapeId)) {
          if (!this.hoverPort || this.hoverPort.shapeId !== hp.shapeId || this.hoverPort.port !== hp.port) {
            this.hoverPort = hp;
            this.setCursor('crosshair');
            this.dirty = true;
          }
        } else if (this.hoverPort) {
          this.hoverPort = null;
          this.setCursor(this.toolCursor());
          this.dirty = true;
        }
      }
    }
    if (this.editing) return;
    try {
      const p = this.pointerInfo(e);
      if (this.pointerDown) this.dragTool.onMove(this, p);
      else this.tool.onHover(this, p);
    } catch (err) {
      console.error('[review] pointermove error:', err);
      this.events.onError?.(err instanceof Error ? err.message : String(err));
    }
    if (this.pointerDown || this.panDrag || this.crop || this.gesture) this.dirty = true;
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.gesture = null;
    this.pointerDown = false;
    if (this.connecting) {
      const info = this.pointerInfo(e);
      const target = this.hoverPort || this.hitPort(info.screen.x, info.screen.y);
      let toId: string | null = null;
      let toPort: PortId | null = null;
      if (target && target.shapeId !== this.connecting.fromId) {
        toId = target.shapeId;
        toPort = target.port;
      } else {
        const hit = this.hitTest(info.world.x, info.world.y);
        if (hit && hit !== this.connecting.fromId) {
          const v = this.views.get(hit);
          if (v) {
            let best: PortId | null = null;
            let bestD = Infinity;
            for (const port of PORTS) {
              const pp = portPos(v, port, 0);
              const d = Math.hypot(pp.x - info.world.x, pp.y - info.world.y);
              if (d < bestD) { bestD = d; best = port; }
            }
            if (best) { toId = hit; toPort = best; }
          }
        }
      }
      const fromId = this.connecting.fromId;
      const fromPort = this.connecting.fromPort;
      if (toId && toPort) {
        const fromV = this.views.get(fromId);
        const toV = this.views.get(toId);
        if (fromV && toV) {
          const a = portPos(fromV, fromPort, 0);
          const b = portPos(toV, toPort, 0);
          const pad = 6; const minX = Math.min(a.x, b.x) - pad; const minY = Math.min(a.y, b.y) - pad; const maxX = Math.max(a.x, b.x) + pad; const maxY = Math.max(a.y, b.y) + pad;
          const id = store.addShape({ type: 'arrow', x: minX, y: minY, w: maxX - minX, h: maxY - minY, fill: 'transparent', stroke: settings.shape.stroke, strokeWidth: 2, points: [a.x, a.y, b.x, b.y], fromId, fromPort, toId, toPort } as ShapeView);
          this.setSelection([id]);
        }
      } else {
        const fromV = this.views.get(fromId);
        if (fromV) {
          const a = portPos(fromV, fromPort, 0);
          const b = info.world;
          const pad = 6; const minX = Math.min(a.x, b.x) - pad; const minY = Math.min(a.y, b.y) - pad; const maxX = Math.max(a.x, b.x) + pad; const maxY = Math.max(a.y, b.y) + pad;
          const id = store.addShape({ type: 'arrow', x: minX, y: minY, w: maxX - minX, h: maxY - minY, fill: 'transparent', stroke: settings.shape.stroke, strokeWidth: 2, points: [a.x, a.y, b.x, b.y] } as ShapeView);
          this.setSelection([id]);
        }
      }
      this.connecting = null;
      this.hoverPort = null;
      this.setCursor(this.toolCursor());
      this.dirty = true;
      return;
    }
    if (this.exportPick) {
      const rect = this.exportRect;
      const min = 6 / this.camera.zoom;
      this.exportAnchor = null;
      if (rect && (rect.w < min || rect.h < min)) {
        this.cancelExportPick();
        return;
      }
      this.exportPick = false;
      this.setCursor(this.toolCursor());
      this.dirty = true;
      this.events.onExportRegion?.(rect);
      return;
    }
    if (this.crop) {
      this.cropPointerUp();
      return;
    }
    if (this.panDrag) {
      this.panDrag = false;
      this.camera.instant = false;
      this.setCursor(this.toolCursor());
      if (
        e.button === 2 &&
        Math.hypot(e.clientX - this.panStart.x, e.clientY - this.panStart.y) < 5 &&
        !this.editing
      ) {
        this.openContextMenu(e);
      }
      return;
    }
    if (this.editing) return;
    try {
      this.dragTool.onUp(this, this.pointerInfo(e));
    } catch (err) {
      console.error('[review] pointerup error:', err);
      this.events.onError?.(err instanceof Error ? err.message : String(err));
    }
    this.dirty = true;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    this.camera.zoomAt(sx, sy, this.w / 2, this.h / 2, Math.exp(-e.deltaY * 0.0022));
    this.dirty = true;
  };

  private onDblClick = (e: MouseEvent): void => {
    if (this.editing) return;
    const p = this.pointerInfo(e);
    const id = this.hitTest(p.world.x, p.world.y);
    // Empty board: no free-text spawn. Place text with the Text tool only.
    if (!id) return;
    const type = this.views.get(id)?.type;
    if (type === 'image') {
      this.setSelection([id]);
      this.startCropSelected();
      return;
    }
    if (type === 'graph') {
      this.openGraphEditor(id);
      return;
    }
    const TEXT_TYPES = new Set([
      'text',
      'sticky',
      'rect',
      'ellipse',
      'diamond',
      'frame',
      'triangle',
      'parallelogram',
      'hexagon',
      'cylinder',
      'terminator',
      'subroutine',
      'display',
    ]);
    if (type && TEXT_TYPES.has(type)) this.openTextEditor(id);
  };

  private cancelToolDrag(): void {
    this.dragTool.cancel(this);
  }

  private updateGesture(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const rect = this.canvas.getBoundingClientRect();
    const mx = mid.x - rect.left;
    const my = mid.y - rect.top;
    if (this.gesture) {
      if (this.gesture.dist > 1 && dist > 1) {
        this.camera.zoomAt(mx, my, this.w / 2, this.h / 2, dist / this.gesture.dist);
      }
      this.camera.panBy(mid.x - this.gesture.mid.x, mid.y - this.gesture.mid.y);
    }
    this.gesture = { dist, mid };
    this.dirty = true;
  }

  setErasePreview(whole: Set<string>, partial: Map<string, Set<number>>): void {
    this.erasing = whole;
    this.partialErase = partial;
    this.dirty = true;
  }

  commitErase(): void {
    if (settings.eraser.mode === 'partial') this.applyPartialErase();
    else if (this.erasing.size) store.removeShapes([...this.erasing]);
    this.erasing = new Set();
    this.partialErase = new Map();
    this.dirty = true;
  }

  private applyPartialErase(): void {
    if (!this.partialErase.size && !this.erasing.size) return;
    store.transact(() => {
      for (const id of this.erasing) {
        if (store.board.has(id)) store.removeShapes([id]);
      }
      for (const [id, indices] of this.partialErase) {
        const m = store.board.get(id);
        if (!m) continue;
        const v = store.readShape(m);
        const pts = v.points ?? [];
        if (pts.length < 4) {
          store.removeShapes([id]);
          continue;
        }
        const segments: number[][] = [];
        let cur: number[] = [];
        for (let i = 0; i < pts.length; i += 2) {
          if (indices.has(i / 2)) {
            if (cur.length >= 4) segments.push(cur);
            cur = [];
          } else {
            cur.push(pts[i], pts[i + 1]);
          }
        }
        if (cur.length >= 4) segments.push(cur);
        if (!segments.length) {
          store.removeShapes([id]);
          continue;
        }
        const style = {
          fill: 'transparent',
          stroke: v.stroke,
          strokeWidth: v.strokeWidth,
          alpha: v.alpha,
        };
        store.patchShape(id, { points: segments[0], ...this.penBox(segments[0], v.strokeWidth) });
        for (let s = 1; s < segments.length; s++) {
          store.addShape({
            type: 'pen',
            ...style,
            points: segments[s],
            ...this.penBox(segments[s], v.strokeWidth),
          });
        }
      }
    });
  }

  private penBox(points: number[], width: number): ShapeBox {
    const pad = width / 2 + 2;
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
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }

  selectByPolygon(pts: Array<{ x: number; y: number }>): string[] {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const ids: string[] = [];
    for (const id of this.grid.query({ x: minX, y: minY, w: maxX - minX, h: maxY - minY })) {
      if (!store.isOnActivePage(id)) continue;
      const v = this.views.get(id);
      if (v && pointInPolygon(v.x + v.w / 2, v.y + v.h / 2, pts)) ids.push(id);
    }
    return ids;
  }

  private cropPointerDown(e: PointerEvent): void {
    const c = this.crop;
    if (!c) return;
    const p = this.pointerInfo(e);
    const h = this.cropHitHandle(p.screen.x, p.screen.y);
    if (h) {
      c.mode = h;
    } else if (p.world.x >= c.box.x && p.world.x <= c.box.x + c.box.w && p.world.y >= c.box.y && p.world.y <= c.box.y + c.box.h) {
      c.mode = 'move';
    } else {
      return;
    }
    c.start = p.world;
    c.origBox = { ...c.box };
    this.dirty = true;
  }

  private cropPointerMove(e: PointerEvent): void {
    const c = this.crop;
    if (!c || c.mode === 'idle') return;
    const p = this.pointerInfo(e);
    const minX = c.full.x;
    const minY = c.full.y;
    const maxX = c.full.x + c.full.w;
    const maxY = c.full.y + c.full.h;
    const minSize = 8 / this.camera.zoom;
    if (c.mode === 'move') {
      const dx = p.world.x - c.start.x;
      const dy = p.world.y - c.start.y;
      let x = c.origBox.x + dx;
      let y = c.origBox.y + dy;
      x = Math.max(minX, Math.min(x, maxX - c.origBox.w));
      y = Math.max(minY, Math.min(y, maxY - c.origBox.h));
      c.box = { x, y, w: c.origBox.w, h: c.origBox.h };
    } else {
      const dx = p.world.x - c.start.x;
      const dy = p.world.y - c.start.y;
      let x = c.origBox.x;
      let y = c.origBox.y;
      let w = c.origBox.w;
      let h = c.origBox.h;
      if (c.mode.includes('e')) w = Math.max(minSize, Math.min(c.origBox.w + dx, maxX - x));
      if (c.mode.includes('w')) {
        w = Math.max(minSize, Math.min(c.origBox.w - dx, maxX - minX));
        x = Math.min(c.origBox.x + c.origBox.w - minSize, c.origBox.x + c.origBox.w - w);
      }
      if (c.mode.includes('s')) h = Math.max(minSize, Math.min(c.origBox.h + dy, maxY - y));
      if (c.mode.includes('n')) {
        h = Math.max(minSize, Math.min(c.origBox.h - dy, maxY - minY));
        y = Math.min(c.origBox.y + c.origBox.h - minSize, c.origBox.y + c.origBox.h - h);
      }
      if (x < minX) {
        w = Math.max(minSize, w - (minX - x));
        x = minX;
      }
      if (y < minY) {
        h = Math.max(minSize, h - (minY - y));
        y = minY;
      }
      c.box = { x, y, w, h };
    }
    this.dirty = true;
  }

  private cropPointerUp(): void {
    const c = this.crop;
    if (c) c.mode = 'idle';
    this.dirty = true;
  }

  private cropHitHandle(sx: number, sy: number): HandleId | null {
    const c = this.crop;
    if (!c) return null;
    const z = this.camera.zoom;
    const ox = this.w / 2 - this.camera.x * z;
    const oy = this.h / 2 - this.camera.y * z;
    let best: HandleId | null = null;
    let bestD = Infinity;
    for (const handle of HANDLES) {
      const [fx, fy] = HANDLE_POS[handle];
      const hx = (c.box.x + fx * c.box.w) * z + ox;
      const hy = (c.box.y + fy * c.box.h) * z + oy;
      const d = Math.hypot(hx - sx, hy - sy);
      if (d < bestD) {
        bestD = d;
        best = handle;
      }
    }
    if (bestD <= 22) return best;
    const bx = c.box.x * z + ox;
    const by = c.box.y * z + oy;
    const bw = c.box.w * z;
    const bh = c.box.h * z;
    const nearL = Math.abs(sx - bx) <= 16;
    const nearR = Math.abs(sx - (bx + bw)) <= 16;
    const nearT = Math.abs(sy - by) <= 16;
    const nearB = Math.abs(sy - (by + bh)) <= 16;
    let h = '';
    if (nearT) h += 'n';
    else if (nearB) h += 's';
    if (nearL) h += 'w';
    else if (nearR) h += 'e';
    return (h || null) as HandleId | null;
  }

  private drawCropOverlay(ctx: CanvasRenderingContext2D): void {
    const c = this.crop;
    if (!c) return;
    const v = this.views.get(c.id);
    if (!v) return;
    const s = 1 / this.camera.zoom;
    ctx.save();
    const img = getImage(v.src ?? '');
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.globalAlpha = 0.35;
      ctx.drawImage(img, c.full.x, c.full.y, c.full.w, c.full.h);
      ctx.globalAlpha = 1;
      const fx = ((v.x - c.full.x) / c.full.w) * img.naturalWidth;
      const fy = ((v.y - c.full.y) / c.full.h) * img.naturalHeight;
      const fw = (v.w / c.full.w) * img.naturalWidth;
      const fh = (v.h / c.full.h) * img.naturalHeight;
      if (fw > 0 && fh > 0) {
        ctx.drawImage(img, fx, fy, fw, fh, v.x, v.y, v.w, v.h);
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(c.full.x, c.full.y, c.full.w, c.box.y - c.full.y);
    ctx.fillRect(c.full.x, c.box.y + c.box.h, c.full.w, c.full.y + c.full.h - c.box.y - c.box.h);
    ctx.fillRect(c.full.x, c.box.y, c.box.x - c.full.x, c.box.h);
    ctx.fillRect(c.box.x + c.box.w, c.box.y, c.full.x + c.full.w - c.box.x - c.box.w, c.box.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    for (let i = 1; i <= 2; i++) {
      ctx.moveTo(c.box.x + (c.box.w * i) / 3, c.box.y);
      ctx.lineTo(c.box.x + (c.box.w * i) / 3, c.box.y + c.box.h);
      ctx.moveTo(c.box.x, c.box.y + (c.box.h * i) / 3);
      ctx.lineTo(c.box.x + c.box.w, c.box.y + (c.box.h * i) / 3);
    }
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * s;
    ctx.setLineDash([10 * s, 7 * s]);
    ctx.strokeRect(c.box.x, c.box.y, c.box.w, c.box.h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1.5 * s;
    const hr = 4.5 * s;
    for (const [fx, fy] of Object.values(HANDLE_POS)) {
      const hx = c.box.x + fx * c.box.w;
      const hy = c.box.y + fy * c.box.h;
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private openContextMenu(e: PointerEvent): void {
    const p = this.pointerInfo(e);
    const id = this.hitTest(p.world.x, p.world.y);
    const sp = this.worldToScreen(p.world.x, p.world.y);
    if (id) {
      if (!this.selection.has(id)) this.setSelection([id]);
      const v = this.views.get(id);
      this.events.onContextMenu?.({
        x: sp.x,
        y: sp.y,
        shapeId: id,
        type: v?.type ?? null,
        locked: v?.locked ?? false,
      });
    } else {
      this.events.onContextMenu?.({ x: sp.x, y: sp.y, shapeId: null, type: null, locked: false });
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
    }
    if (document.querySelector('.sheet-root:not(.is-leaving), .ctx-menu, .info-modal')) return;
    if (this.crop) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelCrop();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.applyCrop();
      }
      return;
    }
    if (this.editing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === ' ') {
      if (target instanceof HTMLElement && target.closest('button, [role="switch"]')) return;
      e.preventDefault();
      if (!this.override) {
        this.override = 'pan';
        this.setCursor(this.toolCursor());
      }
      return;
    }
    if (e.key === 'Escape') {
      this.setSelection([]);
      return;
    }
    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) store.undoManager.redo();
      else store.undoManager.undo();
      return;
    }
    if (mod && e.code === 'KeyY') {
      e.preventDefault();
      store.undoManager.redo();
      return;
    }
    if (mod && e.code === 'KeyA') {
      e.preventDefault();
      this.setSelection([...this.views.keys()]);
      return;
    }
    if (mod && e.code === 'KeyC') {
      e.preventDefault();
      if (e.shiftKey) this.copySelectionAsImage();
      else this.copySelection();
      return;
    }
    if (mod && e.code === 'KeyV') {
      e.preventDefault();
      void this.pasteFromClipboard();
      return;
    }
    if (mod && e.shiftKey && e.code === 'KeyL') {
      e.preventDefault();
      this.toggleLockSelection();
      return;
    }
    if (mod && e.code === 'KeyX') {
      e.preventDefault();
      this.cutSelection();
      return;
    }
    if (mod && e.code === 'KeyD') {
      e.preventDefault();
      this.duplicateSelection();
      return;
    }
    if (mod && (e.code === 'Equal' || e.code === 'NumpadAdd')) {
      e.preventDefault();
      this.zoomBy(1.2);
      return;
    }
    if (mod && (e.code === 'Minus' || e.code === 'NumpadSubtract')) {
      e.preventDefault();
      this.zoomBy(1 / 1.2);
      return;
    }
    if (mod && (e.code === 'Digit0' || e.code === 'Numpad0')) {
      e.preventDefault();
      this.resetZoom();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selection.size) {
        e.preventDefault();
        this.deleteSelection();
      }
      return;
    }
    if (e.key === 'Enter' && this.selection.size === 1) {
      this.openTextEditor([...this.selection][0]);
      return;
    }
    if (e.key.startsWith('Arrow') && this.selection.size) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      this.translateSelection(dx, dy);
      return;
    }
    if (!mod && !e.altKey) {
      const toolBinds = getToolBinds();
      for (const [tool, bind] of Object.entries(toolBinds) as Array<[ToolId, string]>) {
        if (bind === e.code) {
          this.setTool(tool);
          return;
        }
      }
      const t = TOOL_KEYS_FALLBACK[e.code];
      if (t) {
        this.setTool(t);
        return;
      }
      // color binds — 1..8 etc
      const colorBinds = getColorBinds();
      for (const [color, bind] of Object.entries(colorBinds)) {
        if (bind === e.code) {
          updatePenSettings({ color });
          updateShapeSettings({ stroke: color, fill: color });
          // also patch selected shapes
          const patches: Array<[string, Partial<import('../core/shapes').ShapeView>]> = [];
          for (const id of this.selection) {
            const v = this.views.get(id);
            if (!v || v.locked) continue;
            if (v.type === 'pen') patches.push([id, { stroke: color }]);
            else if (['rect','ellipse','diamond','frame','triangle','parallelogram','hexagon','cylinder','terminator','subroutine','display'].includes(v.type)) patches.push([id, { fill: color, stroke: color }]);
            else if (v.type === 'sticky') patches.push([id, { fill: color }]);
          }
          if (patches.length) store.patchShapes(patches);
          return;
        }
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ' && this.override === 'pan') {
      this.override = null;
      this.setCursor(this.toolCursor());
    }
  };

  private loop = (t: number): void => {
    try {
      const dt = Math.min((t - this.lastT) / 1000 || 0.016, 0.05);
      this.lastT = t;
      this.camera.update(dt);
      const moved =
        Math.abs(this.camera.x - this.lastCam.x) > 0.0005 ||
        Math.abs(this.camera.y - this.lastCam.y) > 0.0005 ||
        Math.abs(this.camera.zoom - this.lastCam.z) > 0.00001;
      if (moved || this.dirty) this.render();
      this.emitStats();
    } catch (err) {
      console.error('[review] render loop error:', err);
      this.events.onError?.(err instanceof Error ? err.message : String(err));
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  private render(): void {
    // order is global across pages, views is per-page — don't auto-ensure here
    // ensureOrder is handled on sync/board events; avoid spurious resize
    const { ctx, dpr, w, h } = this;
    const { x: cx, y: cy, zoom: z } = this.camera;
    const target = store.viewPaperBg();
    if (!this.paperTo) {
      this.paperFrom = target;
      this.paperTo = target;
      this.paperFill = target;
    } else if (target !== this.paperTo) {
      this.paperFrom = this.paperFill || this.paperTo;
      this.paperTo = target;
      this.paperT0 = performance.now();
      clearToolCursorCache();
      this.setCursor(this.toolCursor());
    }
    const reduce = this.reduceMotion;
    const u = reduce ? 1 : Math.min(1, (performance.now() - this.paperT0) / PAPER_MS);
    this.paperFill = u >= 1 ? this.paperTo : mixHex(this.paperFrom, this.paperTo, u);
    const theme = themeFor(this.paperFill);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.paperFill;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(z, z);
    ctx.translate(-cx, -cy);
    if (store.metaGrid()) this.drawGrid(ctx, theme.grid);
    const vis: ShapeBox = { x: cx - w / 2 / z, y: cy - h / 2 / z, w: w / z, h: h / z };
    const visible = this.grid.query(vis);
    const draw = (v: ShapeView) => {
      // hide canvas text of the shape being edited — the overlay renders it
      const hideText = this.editing && this.editId === v.id;
      const partial = this.partialErase.get(v.id);
      if (partial && partial.size) {
        const pts = v.points ?? [];
        const filtered: number[] = [];
        for (let i = 0; i < pts.length; i += 2) {
          if (!partial.has(i / 2)) filtered.push(pts[i], pts[i + 1]);
        }
        if (filtered.length >= 2) {
          drawPenStroke(
            ctx,
            filtered,
            v.strokeWidth,
            displayInk(v.stroke, store.viewPaperBg()),
            v.alpha ?? 1
          );
        }
        return;
      }
      if (this.erasing.has(v.id)) {
        ctx.save();
        ctx.globalAlpha = 0.32;
        drawShape(ctx, v, theme.text, store.viewPaperBg(), hideText);
        ctx.restore();
        // ponytail: highlight erasing target — red dashed frame + tint so whole-erase is obvious
        ctx.save();
        ctx.strokeStyle = '#c96a62';
        ctx.lineWidth = 2.2 * (1 / this.camera.zoom);
        ctx.setLineDash([7 / this.camera.zoom, 5 / this.camera.zoom]);
        ctx.strokeRect(v.x - 3 / this.camera.zoom, v.y - 3 / this.camera.zoom, v.w + 6 / this.camera.zoom, v.h + 6 / this.camera.zoom);
        ctx.fillStyle = 'rgba(201,106,98,0.14)';
        ctx.fillRect(v.x - 3 / this.camera.zoom, v.y - 3 / this.camera.zoom, v.w + 6 / this.camera.zoom, v.h + 6 / this.camera.zoom);
        ctx.restore();
      } else {
        drawShape(ctx, v, theme.text, store.viewPaperBg(), hideText);
      }
    };
    const ord = store.order;
    for (let i = 0; i < ord.length; i++) {
      const id = ord.get(i);
      if (!visible.has(id) || !store.isOnActivePage(id)) continue;
      const v = this.views.get(id);
      if (v && v.alpha !== undefined && v.alpha < 1) draw(v);
    }
    for (let i = 0; i < ord.length; i++) {
      const id = ord.get(i);
      if (!visible.has(id) || !store.isOnActivePage(id)) continue;
      const v = this.views.get(id);
      if (v && (v.alpha === undefined || v.alpha >= 1)) draw(v);
    }
    this.drawSelection(ctx);
    this.drawAlignGuides(ctx);
    this.drawPorts(ctx);
    this.drawDocControls(ctx);
    this.drawConnecting(ctx);
    this.tool.render(this, ctx);
    this.drawPeers(ctx);
    if (this.crop) this.drawCropOverlay(ctx);
    if (this.exportPick && this.exportRect) {
      const s = 1 / this.camera.zoom;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      const r = this.exportRect;
      const BIG = 1e6;
      ctx.fillRect(r.x - BIG, r.y - BIG, BIG, r.h + 2 * BIG);
      ctx.fillRect(r.x + r.w, r.y - BIG, BIG, r.h + 2 * BIG);
      ctx.fillRect(r.x - BIG, r.y - BIG, r.w + 2 * BIG, BIG);
      ctx.fillRect(r.x - BIG, r.y + r.h, r.w + 2 * BIG, BIG);
      ctx.strokeStyle = COLORS.selection;
      ctx.lineWidth = 2 * s;
      ctx.setLineDash([8 * s, 6 * s]);
      ctx.strokeRect(this.exportRect.x, this.exportRect.y, this.exportRect.w, this.exportRect.h);
      ctx.restore();
    }
    ctx.restore();
    this.lastCam = { x: cx, y: cy, z };
    this.dirty = u < 1;
  }

  private drawPeers(ctx: CanvasRenderingContext2D): void {
    if (!this.remotePeers.length) return;
    const s = 1 / this.camera.zoom;
    for (const peer of this.remotePeers) {
      if (peer.x === null || peer.y === null) continue;
      ctx.save();
      ctx.fillStyle = peer.color;
      ctx.beginPath();
      ctx.moveTo(peer.x, peer.y);
      ctx.lineTo(peer.x + 13 * s, peer.y + 4.5 * s);
      ctx.lineTo(peer.x + 7.5 * s, peer.y + 7.5 * s);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1 * s;
      ctx.stroke();
      ctx.font = `${13 * s}px 'Segoe UI', system-ui, sans-serif`;
      const label = peer.name;
      const tw = ctx.measureText(label).width;
      ctx.beginPath();
      ctx.roundRect(peer.x + 14 * s, peer.y - 22 * s, tw + 12 * s, 19 * s, 5 * s);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, peer.x + 20 * s, peer.y - 12 * s);
      ctx.restore();
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D, color: string): void {
    const { x: cx, y: cy, zoom: z } = this.camera;
    const w = this.w / z;
    const h = this.h / z;
    const x0 = cx - w / 2;
    const y0 = cy - h / 2;
    let step = 50;
    while (step * z < 48) step *= 5;
    while (step * z > 240) step /= 5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    for (let x = Math.floor(x0 / step) * step; x <= x0 + w; x += step) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 + h);
    }
    for (let y = Math.floor(y0 / step) * step; y <= y0 + h; y += step) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + w, y);
    }
    ctx.stroke();
  }

  private drawSelection(ctx: CanvasRenderingContext2D): void {
    if (this.editing) return;
    if (this.active !== 'select' && this.override !== 'select') return;
    const s = 1 / this.camera.zoom;
    const pad = 2 * s;
    const line = 1.5 * s;
    const hr = 4.25 * s;
    ctx.save();
    ctx.lineJoin = 'round';
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v) continue;
      const x = v.x - pad;
      const y = v.y - pad;
      const w = v.w + pad * 2;
      const h = v.h + pad * 2;
      // Underlay so the accent ring reads on light fills and dark paper alike.
      ctx.strokeStyle = 'rgba(28, 28, 26, 0.5)';
      ctx.lineWidth = line + 1.25 * s;
      ctx.strokeRect(x, y, w, h);
      ctx.strokeStyle = COLORS.selection;
      ctx.lineWidth = line;
      ctx.strokeRect(x, y, w, h);

      if (this.selection.size === 1 && !v.locked) {
        for (const [fx, fy] of Object.values(HANDLE_POS)) {
          const hx = v.x + fx * v.w;
          const hy = v.y + fy * v.h;
          ctx.beginPath();
          ctx.arc(hx, hy, hr, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = COLORS.selection;
          ctx.lineWidth = 1.5 * s;
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  private drawAlignGuides(ctx: CanvasRenderingContext2D): void {
    if (!this.snapGuides.length) return;
    const s = 1 / this.camera.zoom;
    ctx.save();
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1 * s;
    ctx.setLineDash([4 * s, 4 * s]);
    for (const g of this.snapGuides) {
      ctx.beginPath();
      if (g.orientation === 'v') {
        ctx.moveTo(g.pos, g.a0);
        ctx.lineTo(g.pos, g.a1);
      } else {
        ctx.moveTo(g.a0, g.pos);
        ctx.lineTo(g.a1, g.pos);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // small dots at ends
    ctx.fillStyle = COLORS.selection;
    for (const g of this.snapGuides) {
      ctx.beginPath();
      if (g.orientation === 'v') {
        ctx.arc(g.pos, g.a0, 2 * s, 0, Math.PI * 2);
        ctx.arc(g.pos, g.a1, 2 * s, 0, Math.PI * 2);
      } else {
        ctx.arc(g.a0, g.pos, 2 * s, 0, Math.PI * 2);
        ctx.arc(g.a1, g.pos, 2 * s, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPorts(ctx: CanvasRenderingContext2D): void {
    if (this.editing) return;
    const s = 1 / this.camera.zoom;
    const connectingActive = !!this.connecting;
    let showFor: string[] = [];
    if (connectingActive) {
      for (const [id, v] of this.views) {
        if (v.locked || v.type === 'pen' || v.type === 'arrow') continue;
        if (!store.isOnActivePage(id)) continue;
        showFor.push(id);
      }
    } else {
      // Idle selection: only the ring + resize handles. Ports bloom when the
      // pointer reaches the outer connect ring (hitPort), so chrome stays calm.
      if (!this.hoverPort || !this.selection.has(this.hoverPort.shapeId)) return;
      if (this.active !== 'select' && this.override !== 'select') return;
      showFor = [this.hoverPort.shapeId];
    }
    const off = 18 * s;
    for (const id of showFor) {
      const v = this.views.get(id);
      if (!v || v.locked) continue;
      if (v.type === 'pen' || v.type === 'arrow') continue;
      for (const port of PORTS) {
        const p = portPos(v, port, off);
        const isHover = this.hoverPort?.shapeId === id && this.hoverPort?.port === port;
        const isFrom = this.connecting?.fromId === id && this.connecting?.fromPort === port;
        const hot = isHover || isFrom;
        ctx.save();
        ctx.fillStyle = hot ? '#ffffff' : COLORS.selection;
        ctx.strokeStyle = hot ? COLORS.selection : 'rgba(255,255,255,0.92)';
        ctx.lineWidth = 1.35 * s;
        const r = connectingActive ? (hot ? 5.5 * s : 4.25 * s) : hot ? 4.75 * s : 3.75 * s;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawConnecting(ctx: CanvasRenderingContext2D): void {
    if (!this.connecting) return;
    const fromV = this.views.get(this.connecting.fromId);
    if (!fromV) return;
    const a = portPos(fromV, this.connecting.fromPort, 0);
    const b = this.connecting.cur;
    let bx = b.x, by = b.y;
    let toPort: PortId | null = null;
    if (this.hoverPort) {
      const hv = this.views.get(this.hoverPort.shapeId);
      if (hv) {
        const hp = portPos(hv, this.hoverPort.port, 0);
        bx = hp.x; by = hp.y;
        toPort = this.hoverPort.port;
      }
    }
    const s = 1 / this.camera.zoom;
    ctx.save();
    ctx.strokeStyle = COLORS.selection;
    ctx.fillStyle = COLORS.selection;
    ctx.lineWidth = 2 * s;
    ctx.setLineDash([6 * s, 4 * s]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 4 * s;
    const fromDir = portDir(this.connecting.fromPort);
    const dist = Math.hypot(bx - a.x, by - a.y);
    const off = Math.min(80, dist * 0.35);
    let c1x = a.x + fromDir.x * off, c1y = a.y + fromDir.y * off;
    let c2x = bx, c2y = by;
    let endAng = Math.atan2(by - a.y, bx - a.x);
    if (toPort) {
      const toDir = portDir(toPort);
      c2x = bx + toDir.x * off;
      c2y = by + toDir.y * off;
      endAng = Math.atan2(by - c2y, bx - c2x);
    } else {
      const mx = (a.x + bx) / 2, my = (a.y + by) / 2;
      const dx = bx - a.x, dy = by - a.y, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const bend = Math.min(30, len * 0.15);
      c1x = mx + nx * bend * 0.5; c1y = my + ny * bend * 0.5;
      c2x = c1x; c2y = c1y;
      endAng = Math.atan2(by - c1y, bx - c1x);
    }
    ctx.beginPath();
    if (toPort) ctx.bezierCurveTo(c1x, c1y, c2x, c2y, bx, by);
    else ctx.quadraticCurveTo(c1x, c1y, bx, by);
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.setLineDash([]);
    const head = 10 * s;
    const hx1f = bx - head * Math.cos(endAng - 0.42), hy1f = by - head * Math.sin(endAng - 0.42);
    const hx2f = bx - head * Math.cos(endAng + 0.42), hy2f = by - head * Math.sin(endAng + 0.42);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(hx1f, hy1f);
    ctx.lineTo(hx2f, hy2f);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (this.hoverPort) {
      const hv = this.views.get(this.hoverPort.shapeId);
      if (hv) {
        const hp = portPos(hv, this.hoverPort.port, 0);
        ctx.fillStyle = withAlpha(COLORS.selection, 0.25);
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, 10 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private emitStats(): void {
    const z = Math.round(this.camera.zoom * 100);
    const n = this.views.size;
    const key = z + ':' + n;
    if (key !== this.lastStats) {
      this.lastStats = key;
      this.events.onStats?.({ zoom: this.camera.zoom, shapes: n });
    }
  }
}
