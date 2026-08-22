import * as Y from 'yjs';
import { Camera } from './Camera';
import { Grid } from './Grid';
import * as store from '../core/store';
import { COLORS, SHAPE_FONT, STICKY_FONT, TEXT_FONT } from '../core/shapes';
import { drawPenStroke, drawShape, getImage, onImageLoad, pointInShape, themeFor } from '../core/shapes';
import type { ShapeBox, ShapeView } from '../core/shapes';
import { HANDLES, Tools, pointInPolygon } from './tools';
import type { HandleId, PointerInfo, Tool, ToolId } from './tools';
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
}

export interface EngineEvents {
  onSelection?: (ids: string[]) => void;
  onStats?: (stats: { zoom: number; shapes: number }) => void;
  onEditText?: (target: EditTarget) => void;
  onTool?: (id: ToolId) => void;
  onError?: (message: string) => void;
  onCrop?: (active: boolean) => void;
  onContextMenu?: (menu: { x: number; y: number; shapeId: string | null; type: string | null; locked: boolean }) => void;
  onInfo?: (info: { title: string; lines: string[] } | null) => void;
}

const TOOL_KEYS: Record<string, ToolId> = {
  KeyV: 'select',
  KeyH: 'pan',
  KeyP: 'pen',
  KeyR: 'rect',
  KeyO: 'ellipse',
  KeyL: 'arrow',
  KeyS: 'sticky',
  KeyT: 'text',
  KeyE: 'eraser',
};

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
  private pointerDown = false;
  private panDrag = false;
  private lastStats = '';
  private dragTool: Tool;
  private offImageLoad: () => void = () => {};
  private erasing = new Set<string>();
  private partialErase = new Map<string, Set<number>>();
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: { dist: number; mid: { x: number; y: number } } | null = null;
  private crop: {
    id: string;
    box: ShapeBox;
    mode: 'idle' | 'move' | HandleId;
    start: { x: number; y: number };
    origBox: ShapeBox;
  } | null = null;
  private panStart = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    this.resizer = new ResizeObserver(this.resize);
    this.resizer.observe(canvas);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('dblclick', this.onDblClick);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('paste', this.onPaste);
    window.addEventListener('dragover', this.onDragOver);
    window.addEventListener('drop', this.onDrop);
    store.board.observe(this.onStore);
    store.meta.observe(this.onMeta);
    store.ensureOrder();
    this.offImageLoad = onImageLoad(() => {
      this.dirty = true;
    });
    for (const [key, m] of store.board) {
      const v = store.readShape(m);
      this.views.set(key, v);
      this.grid.upsert(key, v);
      this.attachShape(key, m);
    }
    this.dragTool = this.tool;
    this.rafId = requestAnimationFrame(this.loop);
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
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('paste', this.onPaste);
    window.removeEventListener('dragover', this.onDragOver);
    window.removeEventListener('drop', this.onDrop);
    store.board.unobserve(this.onStore);
    store.meta.unobserve(this.onMeta);
    this.offImageLoad();
    for (const un of this.shapeObs.values()) un.un();
    this.shapeObs.clear();
  }

  get tool() {
    return this.tools.get(this.override ?? this.active);
  }

  setTool(id: ToolId): void {
    this.active = id;
    this.override = null;
    this.setCursor(this.tool.cursor);
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

  hitTest(x: number, y: number): string | null {
    const box = { x: x - 1, y: y - 1, w: 2, h: 2 };
    const candidates = this.grid.query(box);
    const ord = store.order;
    for (let i = ord.length - 1; i >= 0; i--) {
      const id = ord.get(i);
      if (!candidates.has(id)) continue;
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
        if (Math.abs(hx - sx) <= 8 && Math.abs(hy - sy) <= 8) {
          return { shapeId: id, handle };
        }
      }
    }
    return null;
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
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v || v.locked) continue;
      if (v.points) {
        patches.push([
          id,
          { x: v.x + dx, y: v.y + dy, points: v.points.map((val, i) => val + (i % 2 === 0 ? dx : dy)) },
        ]);
      } else {
        patches.push([id, { x: v.x + dx, y: v.y + dy }]);
      }
    }
    store.patchShapes(patches);
  }

  deleteSelection(): void {
    if (!this.selection.size) return;
    store.removeShapes([...this.selection]);
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
    const off = (40 / this.camera.zoom) * this.pasteN;
    const ids: string[] = [];
    for (const v of this.clipboard) {
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
  }

  sendBack(): void {
    if (!this.selection.size) return;
    store.moveOrderToBack([...this.selection]);
  }

  toggleLockSelection(): void {
    if (!this.selection.size) return;
    let anyUnlocked = false;
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (v && !v.locked) anyUnlocked = true;
    }
    const locked = !anyUnlocked;
    const patches: Array<[string, Partial<ShapeView>]> = [];
    for (const id of this.selection) patches.push([id, { locked }]);
    store.patchShapes(patches);
  }

  private selectionCanvas(ids: string[]): HTMLCanvasElement | null {
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
    ctx.translate(-box.x + pad, -box.y + pad);
    const theme = themeFor(store.metaBg());
    for (const id of ids) {
      const v = this.views.get(id);
      if (v) drawShape(ctx, v, theme.text);
    }
    return canvas;
  }

  private async copyAsImage(ids: string[]): Promise<void> {
    let dataUrl: string | null = null;
    if (ids.length === 1) {
      const v = this.views.get(ids[0]);
      if (v && v.type === 'image' && v.src) dataUrl = v.src;
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
      a.download = 'doska.png';
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
    if (ids.length === 1 && v?.type === 'image' && v.src) {
      const a = document.createElement('a');
      a.href = v.src;
      a.download = 'doska-image.png';
      a.click();
      return;
    }
    const canvas = this.selectionCanvas(ids);
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'doska.png';
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
    a.download = 'doska-stroke.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  shapeInfo(id: string): { title: string; lines: string[] } | null {
    const v = this.views.get(id);
    if (!v) return null;
    const typeNames: Record<string, string> = {
      rect: 'Прямоугольник',
      ellipse: 'Эллипс',
      sticky: 'Стикер',
      text: 'Текст',
      pen: 'Линия',
      arrow: 'Стрелка',
      image: 'Картинка',
    };
    const lines = [
      `Размер: ${Math.round(v.w)} × ${Math.round(v.h)}`,
      `Позиция: ${Math.round(v.x)}, ${Math.round(v.y)}`,
    ];
    if (v.points) lines.push(`Точек: ${v.points.length / 2}`);
    if (v.type === 'image') {
      const img = getImage(v.src ?? '');
      if (img && img.complete && img.naturalWidth) {
        lines.push(`Пиксели: ${img.naturalWidth} × ${img.naturalHeight}`);
      }
    }
    if (v.locked) lines.push('Заблокировано');
    return { title: typeNames[v.type] ?? v.type, lines };
  }

  zoomBy(factor: number): void {
    this.camera.zoomAt(this.w / 2, this.h / 2, this.w / 2, this.h / 2, factor);
  }

  insertImageFile(file: File, at?: { x: number; y: number }): void {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const max = 600;
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, img.naturalWidth * scale);
        const h = Math.max(1, img.naturalHeight * scale);
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
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  hasImageSelection(): boolean {
    return this.selection.size === 1 && this.views.get([...this.selection][0])?.type === 'image';
  }

  startCropSelected(): void {
    if (this.selection.size !== 1) return;
    const id = [...this.selection][0];
    const v = this.views.get(id);
    if (!v || v.type !== 'image') return;
    this.crop = {
      id,
      box: { x: v.x, y: v.y, w: v.w, h: v.h },
      mode: 'idle',
      start: { x: 0, y: 0 },
      origBox: { x: v.x, y: v.y, w: v.w, h: v.h },
    };
    this.events.onCrop?.(true);
    this.dirty = true;
  }

  cancelCrop(): void {
    this.crop = null;
    this.events.onCrop?.(false);
    this.dirty = true;
  }

  applyCrop(): void {
    const c = this.crop;
    if (!c) return;
    const v = this.views.get(c.id);
    if (!v) return;
    const img = getImage(v.src ?? '');
    if (!img || !img.complete || !img.naturalWidth) return;
    const sx = ((c.box.x - v.x) / v.w) * img.naturalWidth;
    const sy = ((c.box.y - v.y) / v.h) * img.naturalHeight;
    const sw = (c.box.w / v.w) * img.naturalWidth;
    const sh = (c.box.h / v.h) * img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    const cctx = canvas.getContext('2d');
    if (!cctx) return;
    cctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/png');
    store.patchShape(c.id, { src: url, x: c.box.x, y: c.box.y, w: c.box.w, h: c.box.h });
    this.crop = null;
    this.events.onCrop?.(false);
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

  private onDragOver = (e: DragEvent): void => {
    e.preventDefault();
  };

  private onDrop = (e: DragEvent): void => {
    e.preventDefault();
    if (this.editing) return;
    const rect = this.canvas.getBoundingClientRect();
    const at = this.camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top, this.w / 2, this.h / 2);
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of files) {
      if (file.type.startsWith('image/')) this.insertImageFile(file, at);
    }
  };

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
    if (!v || v.type === 'pen' || v.type === 'arrow') return;
    this.editing = true;
    this.events.onEditText?.({
      id,
      x: v.x,
      y: v.y,
      w: v.w,
      h: v.h,
      text: v.text ?? '',
      fontSize:
        v.fontSize ?? (v.type === 'sticky' ? STICKY_FONT : v.type === 'rect' || v.type === 'ellipse' ? SHAPE_FONT : TEXT_FONT),
      color: v.textColor ?? themeFor(store.metaBg()).text,
    });
  }

  openTextEditorAt(x: number, y: number, fontSize: number, color: string): void {
    this.editing = true;
    this.events.onEditText?.({ id: null, x, y, w: 240, h: 30, text: '', fontSize, color });
  }

  cancelTextEdit(): void {
    this.editing = false;
  }

  commitText(id: string | null, text: string, target: EditTarget): void {
    this.editing = false;
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
        textColor: target.color,
      });
      const size = this.measureText(trimmed, target.fontSize);
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
      const patch: Partial<ShapeView> = { text };
      if (v.type === 'text') {
        const size = this.measureText(text, v.fontSize ?? TEXT_FONT);
        patch.w = size.w;
        patch.h = size.h;
      }
      if (v.type !== 'sticky') patch.textColor = target.color;
      store.patchShape(id, patch);
    }
    this.dirty = true;
  }

  measureText(text: string, fontSize: number): { w: number; h: number } {
    this.ctx.font = `${fontSize}px 'Segoe UI', system-ui, sans-serif`;
    const lines = text.split('\n');
    let maxW = 0;
    for (const line of lines) {
      maxW = Math.max(maxW, this.ctx.measureText(line).width);
    }
    return { w: maxW + 4, h: lines.length * fontSize * 1.3 };
  }

  private onMeta = (): void => {
    this.dirty = true;
  };

  private onStore = (ev: Y.YMapEvent<Y.Map<unknown>>): void => {
    ev.changes.keys.forEach((change, key) => {
      if (change.action === 'delete') {
        this.detachShape(key);
        this.views.delete(key);
        this.grid.remove(key);
        if (this.selection.delete(key)) this.events.onSelection?.([...this.selection]);
      } else {
        const m = store.board.get(key);
        if (m) {
          const v = store.readShape(m);
          this.views.set(key, v);
          this.grid.upsert(key, v);
          this.attachShape(key, m);
        }
      }
    });
    this.dirty = true;
  };

  private shapeObs = new Map<string, { un: () => void; m: Y.Map<unknown> }>();

  private attachShape(key: string, m: Y.Map<unknown>): void {
    const existing = this.shapeObs.get(key);
    if (existing && existing.m === m) return;
    this.detachShape(key);
    const cb = () => {
      const v = store.readShape(m);
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
    if (this.crop) {
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
      let target = this.tool;
      if (target.id !== 'select' && target.id !== 'pan' && target.id !== 'pen' && target.id !== 'eraser') {
        if (this.hitTest(info.world.x, info.world.y)) target = this.tools.select;
      }
      this.dragTool = target;
      target.onDown(this, info);
    } catch (err) {
      console.error('[doska] pointerdown error:', err);
      this.events.onError?.(err instanceof Error ? err.message : String(err));
    }
    this.dirty = true;
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
    if (this.crop) {
      this.cropPointerMove(e);
      return;
    }
    if (this.panDrag) {
      this.camera.panBy(e.movementX, e.movementY);
      return;
    }
    if (this.editing) return;
    try {
      const p = this.pointerInfo(e);
      if (this.pointerDown) this.dragTool.onMove(this, p);
      else this.tool.onHover(this, p);
    } catch (err) {
      console.error('[doska] pointermove error:', err);
      this.events.onError?.(err instanceof Error ? err.message : String(err));
    }
    this.dirty = true;
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.gesture = null;
    this.pointerDown = false;
    if (this.crop) {
      this.cropPointerUp();
      return;
    }
    if (this.panDrag) {
      this.panDrag = false;
      this.camera.instant = false;
      this.setCursor(this.tool.cursor);
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
      console.error('[doska] pointerup error:', err);
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
    if (id) {
      this.openTextEditor(id);
      return;
    }
    this.openTextEditorAt(p.world.x, p.world.y, settings.text.size, settings.text.color);
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
    const v = this.views.get(c.id);
    if (!v) return;
    const p = this.pointerInfo(e);
    const minX = v.x;
    const minY = v.y;
    const maxX = v.x + v.w;
    const maxY = v.y + v.h;
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
    for (const handle of HANDLES) {
      const [fx, fy] = HANDLE_POS[handle];
      const hx = (c.box.x + fx * c.box.w) * z + ox;
      const hy = (c.box.y + fy * c.box.h) * z + oy;
      if (Math.abs(hx - sx) <= 8 && Math.abs(hy - sy) <= 8) return handle;
    }
    return null;
  }

  private drawCropOverlay(ctx: CanvasRenderingContext2D): void {
    const c = this.crop;
    if (!c) return;
    const v = this.views.get(c.id);
    if (!v) return;
    const s = 1 / this.camera.zoom;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(v.x, v.y, v.w, c.box.y - v.y);
    ctx.fillRect(v.x, c.box.y + c.box.h, v.w, v.y + v.h - c.box.y - c.box.h);
    ctx.fillRect(v.x, c.box.y, c.box.x - v.x, c.box.h);
    ctx.fillRect(c.box.x + c.box.w, c.box.y, v.x + v.w - c.box.x - c.box.w, c.box.h);
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 2 * s;
    ctx.strokeRect(c.box.x, c.box.y, c.box.w, c.box.h);
    ctx.fillStyle = COLORS.selection;
    for (const [fx, fy] of Object.values(HANDLE_POS)) {
      ctx.fillRect(c.box.x + fx * c.box.w - 4.5 * s, c.box.y + fy * c.box.h - 4.5 * s, 9 * s, 9 * s);
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
      this.setSelection([id]);
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
      e.preventDefault();
      if (!this.override) {
        this.override = 'pan';
        this.setCursor(this.tool.cursor);
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
    if (!mod && !e.altKey && e.code.startsWith('Key')) {
      const t = TOOL_KEYS[e.code];
      if (t) this.setTool(t);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ' && this.override === 'pan') {
      this.override = null;
      this.setCursor(this.tool.cursor);
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
      console.error('[doska] render loop error:', err);
      this.events.onError?.(err instanceof Error ? err.message : String(err));
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  private render(): void {
    if (store.order.length !== this.views.size) store.ensureOrder();
    const { ctx, dpr, w, h } = this;
    const { x: cx, y: cy, zoom: z } = this.camera;
    const bg = store.metaBg();
    const theme = themeFor(bg);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(z, z);
    ctx.translate(-cx, -cy);
    if (store.metaGrid()) this.drawGrid(ctx, theme.grid);
    const vis: ShapeBox = { x: cx - w / 2 / z, y: cy - h / 2 / z, w: w / z, h: h / z };
    const visible = this.grid.query(vis);
    const draw = (v: ShapeView) => {
      const partial = this.partialErase.get(v.id);
      if (partial && partial.size) {
        const pts = v.points ?? [];
        const filtered: number[] = [];
        for (let i = 0; i < pts.length; i += 2) {
          if (!partial.has(i / 2)) filtered.push(pts[i], pts[i + 1]);
        }
        if (filtered.length >= 2) drawPenStroke(ctx, filtered, v.strokeWidth, v.stroke, v.alpha ?? 1);
        return;
      }
      if (this.erasing.has(v.id)) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        drawShape(ctx, v, theme.text);
        ctx.restore();
      } else {
        drawShape(ctx, v, theme.text);
      }
    };
    const ord = store.order;
    for (let i = 0; i < ord.length; i++) {
      const id = ord.get(i);
      if (!visible.has(id)) continue;
      const v = this.views.get(id);
      if (v && v.alpha !== undefined && v.alpha < 1) draw(v);
    }
    for (let i = 0; i < ord.length; i++) {
      const id = ord.get(i);
      if (!visible.has(id)) continue;
      const v = this.views.get(id);
      if (v && (v.alpha === undefined || v.alpha >= 1)) draw(v);
    }
    this.drawSelection(ctx);
    this.tool.render(this, ctx);
    if (this.crop) this.drawCropOverlay(ctx);
    ctx.restore();
    this.lastCam = { x: cx, y: cy, z };
    this.dirty = false;
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
    ctx.save();
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 2 * s;
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v) continue;
      ctx.strokeRect(v.x - 4 * s, v.y - 4 * s, v.w + 8 * s, v.h + 8 * s);
      if (this.selection.size === 1) {
        ctx.fillStyle = COLORS.selection;
        for (const [fx, fy] of Object.values(HANDLE_POS)) {
          ctx.fillRect(v.x + fx * v.w - 4.5 * s, v.y + fy * v.h - 4.5 * s, 9 * s, 9 * s);
        }
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
