import * as Y from 'yjs';
import { Camera } from './Camera';
import { Grid } from './Grid';
import * as store from '../core/store';
import { COLORS, defaultFontSizeFor, docPageIndex, docPageStep, TABLE_FONT, TEXT_FONT, TEXT_LINE_HEIGHT, BOARD_TYPEFACE, boardFont, containedInShape, cropFractions, uncroppedBox, restoreUncroppedBox, withAlpha, frameHeaderHeight, frameTitleLine, tableCellStyle, TABLE_PILL_OUT, TABLE_PILL_R, TABLE_PILL_SPLIT, TEXT_TOOL_WRAP_W } from '../core/shapes';
import {
  drawPenStroke,
  drawShape,
  getImage,
  hasFill,
  onImageLoad,
  pointInShape,
  shapeLassoProbes,
  displayInk,
  readableTextOn,
  tableAxisIndex,
  tableCellAt,
  tableCellRect,
  tableGrid,
  hostRiderIds,
  themeFor,
  intersects,
  normalizeBox,
  measureMixedLine,
  arrowHitPolyline,
} from '../core/shapes';
import { localToWorld, rotatedAabb, withShapeRotation, worldToLocal, shapeRotation, degToRad, ROTATE_HANDLE_OFFSET_PX, rotateHandleLocal, rotateHandleOnBox, mapShapeThroughHostResize, mapShapeThroughLocalMap, reanchorCroppedBox } from '../core/transform';
import {
  ROTATE_CW_DISC_RADIUS_SCALE,
  ROTATE_CW_ICON_RADIUS_SCALE,
  strokeRotateCwIcon,
} from '../core/rotateIcon';
import { jpegToPdf, shapesToSvg } from '../core/exportVector';
import { onFormulaLoad } from '../core/formula';
import { shapesFromClipboardText } from '../core/clipboardShapes';
import { t } from '../ui/i18n';
import { readLocale } from '../core/locale';
import { splitStrokeByErasedIndices } from './strokeClip';
import type { ShapeBox, ShapeView } from '../core/shapes';
import { HANDLES, Tools, pointInPolygon, polylineHitsPolygon } from './tools';
import type { HandleId, PointerInfo, Tool, ToolId } from './tools';
import type { PeerCursor } from '../net';
import { sendCursor, publishTool, publishFocus, publishSelection } from '../net';
import { samePeerSelection } from '../net/peerSelection';
import type { PatchBatch } from '../core/writeGate';
import { ICON_PATHS, LASSO_HANDLE, type IconName } from '../ui/icons';
import {
  handleDrawRadiusScale,
  handleHitRadius,
  isCoarsePointer,
  portHitRadius,
  rotateHitRadius,
} from '../core/pointerEnv';
import { computeSnap, groupBox, visualBox, type AlignGuide, type AlignKind, alignViews } from '../core/align';
import { portPos, PORTS, EDGE_PORTS, type PortId, connectedArrowGeometry, worldPortDir, arrowBounds, withArrowVisualBounds } from '../core/shapes';
void PORTS;
import { getToolBinds, getColorBinds } from '../core/keybindings';
import { updatePenSettings, updateShapeSettings } from '../core/settings';
import { readPenSlots } from '../core/penColors';
import { cursorCssForTool, clearToolCursorCache } from './toolCursors';
import {
  aimPeerMotion,
  applyRealtimePeerPose,
  initPeerMotion,
  peerMotionShouldAnimate,
  pushPeerSample,
  snapPeerMotionToSample,
  stepPeerMotion,
  PEER_MOTION_HOLD_SEC,
  PEER_MOTION_REALTIME_HOLD_SEC,
  REALTIME_LEAD_SEC,
  type PeerMotionState,
} from '../core/peerMotion';
import { notePeerRenderDt } from '../net/hitchDebug';
import { onPrefsChange, readPrefs } from '../core/prefs';
import { ORBIT_PAPER } from '../core/orbit';
import { drawOrbitPaperField, drawOrbitPaperScreen, orbitGridColor, orbitPaperActive } from './orbitField';
import type { PeerDraft, PeerErasePreview } from '../net/types';

/** True when live draft geometry/style needs a repaint (tip can move at fixed vert count). */
function peerDraftPaintDirty(a: PeerDraft | null | undefined, b: PeerDraft | null | undefined): boolean {
  if (Boolean(a) !== Boolean(b)) return true;
  if (!a || !b) return false;
  if (a.stroke !== b.stroke || a.strokeWidth !== b.strokeWidth) return true;
  if ((a.alpha ?? 0.85) !== (b.alpha ?? 0.85)) return true;
  const ap = a.points;
  const bp = b.points;
  if (ap.length !== bp.length) return true;
  const n = ap.length;
  if (n >= 2 && (ap[n - 2] !== bp[n - 2] || ap[n - 1] !== bp[n - 1])) return true;
  if (n >= 4 && (ap[0] !== bp[0] || ap[1] !== bp[1])) return true;
  return false;
}

/** Cheap erase-preview equality — avoid JSON.stringify on the awareness hot path. */
function samePeerErasePreview(a: PeerErasePreview | null | undefined, b: PeerErasePreview | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.x !== b.x || a.y !== b.y || a.r !== b.r || a.mode !== b.mode) return false;
  if (a.whole.length !== b.whole.length) return false;
  for (let i = 0; i < a.whole.length; i++) {
    if (a.whole[i] !== b.whole[i]) return false;
  }
  const ap = a.partial ?? null;
  const bp = b.partial ?? null;
  if (ap === bp) return true;
  if (!ap || !bp) return !ap && !bp;
  const aKeys = Object.keys(ap);
  const bKeys = Object.keys(bp);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    const ai = ap[k];
    const bi = bp[k];
    if (!bi || ai.length !== bi.length) return false;
    for (let i = 0; i < ai.length; i++) {
      if (ai[i] !== bi[i]) return false;
    }
  }
  return true;
}

function isOrbitChromeLive(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.chromeTheme === 'orbit';
}
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

function peerToolOutline(paperBg: string): string {
  return themeFor(paperBg).text;
}

const PEER_TOOL_ICON: Record<string, IconName> = {
  select: 'select',
  lasso: 'lasso',
  pan: 'pan',
  pen: 'pen',
  eraser: 'eraser',
  rect: 'rect',
  ellipse: 'ellipse',
  sticky: 'sticky',
  text: 'text',
  arrow: 'arrow',
  graph: 'graph',
  calculator: 'calculator',
  diamond: 'diamond',
  frame: 'frame',
  triangle: 'triangle',
  parallelogram: 'parallelogram',
  hexagon: 'hexagon',
  cylinder: 'cylinder',
  terminator: 'terminator',
  subroutine: 'subroutine',
  display: 'display',
  table: 'table',
};

function peerToolIcon(tool: string | null | undefined): IconName {
  if (tool && PEER_TOOL_ICON[tool]) return PEER_TOOL_ICON[tool];
  return 'select';
}

/**
 * Peer cursor = their tool glyph.
 * Fill = peer color; outline = local paper theme (black on light / light on dark).
 * Open stroke icons (pan/hand, etc.) must not be filled — canvas fill() invents garbage regions.
 */
const peerPathCache = new Map<IconName, Path2D>();
let peerHandlePath: Path2D | null = null;

/** Icons that are line art only (same as UI `fill="none"`). */
const PEER_STROKE_ONLY = new Set<IconName>(['pan', 'text', 'arrow', 'graph', 'eraser']);

function peerPath(icon: IconName): Path2D {
  let p = peerPathCache.get(icon);
  if (!p) {
    p = new Path2D(ICON_PATHS[icon]);
    peerPathCache.set(icon, p);
  }
  return p;
}

function paintPeerToolGlyph(
  ctx: CanvasRenderingContext2D,
  icon: IconName,
  size: number,
  fill: string,
  outline: string,
  worldStroke: number
): void {
  ctx.save();
  ctx.translate(-size / 2, -size / 2);
  const scale = size / 24;
  ctx.scale(scale, scale);
  // Match toolbelt pan fit so the hand isn't clipped/odd in the 24² box.
  if (icon === 'pan') {
    ctx.translate(12, 12);
    ctx.scale(0.88, 0.88);
    ctx.translate(-13, -12.5);
  } else if (icon === 'pen') {
    ctx.translate(12, 12);
    ctx.scale(0.86, 0.86);
    ctx.translate(-12, -12);
  }
  const path = peerPath(icon);
  if (icon === 'lasso' && !peerHandlePath) peerHandlePath = new Path2D(LASSO_HANDLE);
  const handle = icon === 'lasso' ? peerHandlePath : null;
  const lw = worldStroke / scale;
  const strokeOnly = PEER_STROKE_ONLY.has(icon);
  // Pan uses a thinner stroke in the toolbelt; keep that proportion.
  const bodyMul = icon === 'pan' ? 0.85 : 1;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (strokeOnly) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = lw * 2.6 * bodyMul;
    ctx.stroke(path);
    if (handle) ctx.stroke(handle);
    ctx.strokeStyle = fill;
    ctx.lineWidth = lw * 1.35 * bodyMul;
    ctx.stroke(path);
    if (handle) ctx.stroke(handle);
  } else {
    ctx.strokeStyle = outline;
    ctx.lineWidth = lw * 2.15;
    ctx.stroke(path);
    if (handle) ctx.stroke(handle);

    ctx.fillStyle = fill;
    ctx.fill(path);

    ctx.strokeStyle = fill;
    ctx.lineWidth = lw;
    ctx.stroke(path);
    if (handle) ctx.stroke(handle);
  }

  ctx.restore();
}

import { settings } from '../core/settings';
import { htmlStoresRichMarkup, spansToPlain, htmlToSpans, parseStoredRich, sanitizeRichHtml, measureStyleFromSpans } from '../core/richText';
import { wrapLinesByWidth } from '../core/textLayout';

export interface EditTarget {
  id: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** Character-level HTML when the overlay has mixed formatting. */
  richHtml?: string;
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
  /** Table cell being edited (overlay covers one cell, commit writes cells[]). */
  tableCell?: { row: number; col: number };
  /** Degrees. Overlay rotates around the cell's world top-left. */
  rotation?: number;
}

export interface GraphEditTarget {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  expr: string;
}

export interface CalculatorEditTarget {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  rotation?: number;
}

export interface EngineEvents {
  onSelection?: (ids: string[]) => void;
  onStats?: (stats: { zoom: number; shapes: number }) => void;
  onEditText?: (target: EditTarget | null) => void;
  onEditGraph?: (target: GraphEditTarget | null) => void;
  onEditCalculator?: (target: CalculatorEditTarget | null) => void;
  /** Ask the host to commit the currently open text editor (editor is being replaced). */
  onRequestCommitText?: () => void;
  /** Ask the host to toggle the UI chrome (KeyH) — session-only, never persisted. */
  onToggleUi?: () => void;
  onTool?: (id: ToolId) => void;
  onError?: (message: string) => void;
  onToast?: (message: string) => void;
  onCrop?: (active: boolean) => void;
  onContextMenu?: (menu: { x: number; y: number; shapeId: string | null; type: string | null; locked: boolean }) => void;
  onInfo?: (info: { title: string; lines: string[] } | null) => void;
  onExportRegion?: (rect: ShapeBox | null) => void;
}

const TOOL_KEYS_FALLBACK: Record<string, ToolId> = {
  KeyV: 'select',
  KeyP: 'pen',
  KeyR: 'rect',
  KeyO: 'ellipse',
  KeyL: 'arrow',
  KeyS: 'sticky',
  KeyG: 'graph',
  KeyT: 'text',
  KeyE: 'eraser',
};

/** True when any binding (including empty) was set for this tool in stored binds. */
function toolBindExplicitlyCleared(tool: ToolId, binds: Record<ToolId, string>): boolean {
  return Object.prototype.hasOwnProperty.call(binds, tool) && !binds[tool];
}

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
  /** False after destroy — async image/paste must not write into the next board. */
  alive = true;
  /** Page the open overlay was started on (new text must not land after a page switch). */
  private editPageId: string | null = null;
  private graphEditId: string | null = null;
  private graphEditOrig = '';
  private calcEditId: string | null = null;
  remotePeers: PeerCursor[] = [];
  /**
   * Critically-damped peer cursor state (display pose + velocity + samples).
   * Purely local — awareness rate unchanged.
   */
  private peerLerp = new Map<number, PeerMotionState>();
  private peersAnimating = false;
  private frameDt = 1 / 60;
  /** Spring-follow remote cursors; default off = snap to latest awareness sample. */
  private smoothPeerCursors = false;
  /** Last edited cell per table (row/col ops + active-cell outline target it). */
  private tableActive = new Map<string, { r: number; c: number }>();

  setPeers(peers: PeerCursor[]): void {
    const prevById = new Map(this.remotePeers.map((p) => [p.id, p]));
    let shouldPaint = peers.length !== this.remotePeers.length;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const smooth = this.smoothPeerCursors && !this.reduceMotion;

    const live = new Set(peers.map((p) => p.id));
    for (const id of [...this.peerLerp.keys()]) {
      if (!live.has(id)) {
        this.peerLerp.delete(id);
        shouldPaint = true;
      }
    }

    for (const peer of peers) {
      const old = prevById.get(peer.id);
      if (
        !old ||
        old.color !== peer.color ||
        old.name !== peer.name ||
        old.tool !== peer.tool ||
        old.page !== peer.page ||
        old.viewing !== peer.viewing ||
        peerDraftPaintDirty(old.draft, peer.draft) ||
        !samePeerErasePreview(old.erasePreview, peer.erasePreview) ||
        old.focus !== peer.focus ||
        !samePeerSelection(old.selection, peer.selection)
      ) {
        shouldPaint = true;
      }
      if (peer.x === null || peer.y === null) {
        if (this.peerLerp.has(peer.id)) {
          this.peerLerp.delete(peer.id);
          shouldPaint = true;
        }
        continue;
      }
      const cur = this.peerLerp.get(peer.id);
      if (!cur) {
        const pos = initPeerMotion(peer.x, peer.y, now);
        this.peerLerp.set(peer.id, pos);
        shouldPaint = true;
      } else if (cur.tx !== peer.x || cur.ty !== peer.y) {
        pushPeerSample(cur, peer.x, peer.y, now);
        // Snap only on a fresh sample. Do not snap when tx is unchanged —
        // unrelated awareness emits would kill realtime dead-reckon between packets.
        if (!smooth) snapPeerMotionToSample(cur);
        shouldPaint = true;
      }
    }

    this.remotePeers = peers;
    if (shouldPaint) this.dirty = true;
  }

  private active: ToolId = 'select';
  private override: ToolId | null = null;
  /** True while Space is physically held — survives setTool so temp-pan stays armed. */
  private spaceHeld = false;
  /** Board drawing surface — overlays use this to distinguish canvas vs chrome hits. */
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private resizer: ResizeObserver;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private rafId = 0;
  private lastT = 0;
  private lastCam = { x: 0, y: 0, z: 1 };
  private dirty = true;
  /** Last Warp-cover signal sent to OrbitAtmosphere (board solid paper → pause). */
  private orbitWarpCovered: boolean | null = null;
  private paperFrom = '';
  private paperTo = '';
  private paperFill = '';
  private paperT0 = 0;
  private pointerDown = false;
  /** True only when this press called `dragTool.onDown` (chrome clicks must not fire onUp). */
  private toolArmed = false;
  private panDrag = false;
  private lastStats = '';
  private dragTool: Tool;
  private offImageLoad: () => void = () => {};
  private offFormulaLoad: () => void = () => {};
  private offPrefs: () => void = () => {};
  private erasing = new Set<string>();
  private partialErase = new Map<string, Set<number>>();
  private lastEraseAt: { x: number; y: number } | null = null;
  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private gesture: { dist: number; mid: { x: number; y: number } } | null = null;
  /** Stylus eraser tip (button 5) temporarily overrides the active tool via `override`. */
  private stylusEraserOverride = false;
  /** Touch long-press → context menu (desktop uses RMB). */
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressOrigin: { x: number; y: number; clientX: number; clientY: number } | null = null;
  private longPressFired = false;
  /** Touch double-tap → same as dblclick edit entry. */
  private lastTap: { t: number; x: number; y: number } | null = null;
  private suppressToolUp = false;
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
  private reduceMotionMq: MediaQueryList | null = null;
  private onReduceMotionChange = (e: MediaQueryListEvent) => {
    this.reduceMotion = e.matches;
  };
  private exportPick = false;
  private exportRect: ShapeBox | null = null;
  private exportAnchor: { x: number; y: number } | null = null;
  private snapGuides: AlignGuide[] = [];
  private connecting: { fromId: string; fromPort: PortId; cur: { x: number; y: number } } | null = null;
  private hoverPort: { shapeId: string; port: PortId } | null = null;
  // easter egg — confetti cannon from rotation handle triple click
  private confetti: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    color: string;
    w: number;
    h: number;
    rot: number;
    spin: number;
  }> = [];
  private easterRotateClicks = 0;
  private lastEasterTime = 0;

  private observedBoard: Y.Map<Y.Map<unknown>> | null = null;
  private observedMeta: Y.Map<unknown> | null = null;
  private observedOrder: Y.Array<string> | null = null;
  private offPageChange: () => void = () => {};
  private boundPageId: string | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true })!;
    this.resize();
    this.resizer = new ResizeObserver(this.resize);
    this.resizer.observe(canvas);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('dblclick', this.onDblClick);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('auxclick', this.onAuxClick);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('paste', this.onPaste);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    // File drops are owned by App (images + PDF/TXT) so we don't double-insert.
    this.bindStore();
    store.setLiveViewApplier((batch) => this.applyLivePatches(batch));
    this.offPageChange = store.onActivePageChange(() => {
      const page = store.currentPageId();
      if (page === this.boundPageId) return;
      this.boundPageId = page;
      this.resetToPage();
    });
    this.boundPageId = store.currentPageId();
    this.offImageLoad = onImageLoad(() => {
      this.dirty = true;
    });
    this.offFormulaLoad = onFormulaLoad(() => {
      this.remeasureTextShapes([...this.views.keys()]);
    });
    this.dragTool = this.tool;
    if (typeof matchMedia === 'function') {
      this.reduceMotionMq = matchMedia('(prefers-reduced-motion: reduce)');
      this.reduceMotion = this.reduceMotionMq.matches;
      this.reduceMotionMq.addEventListener('change', this.onReduceMotionChange);
    }
    this.smoothPeerCursors = readPrefs().smoothPeerCursors;
    this.offPrefs = onPrefsChange((prefs) => {
      const wasSmooth = this.smoothPeerCursors;
      this.smoothPeerCursors = prefs.smoothPeerCursors;
      // Leaving smooth mode: drop any spring lead so realtime starts on-sample.
      if (wasSmooth && !prefs.smoothPeerCursors) {
        for (const pos of this.peerLerp.values()) snapPeerMotionToSample(pos);
      }
      clearToolCursorCache();
      this.setCursor(this.toolCursor());
      this.dirty = true;
    });
    // Untouched calc bodies follow --chrome-panel; repaint when Customize theme flips.
    window.addEventListener('review-chrome-theme', this.onChromeTheme);
    // Solid (non-Orbit) paper fills the canvas opaquely — pause Warp while covered.
    {
      const paper = store.viewPaperBg();
      this.syncOrbitWarpCovered(!(orbitPaperActive(paper, paper) && isOrbitChromeLive()));
    }
    this.rafId = requestAnimationFrame(this.loop);
  }

  private onChromeTheme = (): void => {
    this.dirty = true;
  };

  /**
   * Tell OrbitAtmosphere when the board canvas fully covers Warp (solid paper).
   * Home has no Engine → attribute cleared on destroy so Warp keeps animating.
   * Orbit paper (`orbitLive`) leaves Warp visible — never pause then.
   */
  private syncOrbitWarpCovered(covered: boolean): void {
    if (this.orbitWarpCovered === covered) return;
    this.orbitWarpCovered = covered;
    if (typeof document === 'undefined') return;
    if (covered) document.documentElement.dataset.orbitWarpCovered = '1';
    else delete document.documentElement.dataset.orbitWarpCovered;
    window.dispatchEvent(new CustomEvent('review-orbit-warp-cover', { detail: { covered } }));
  }

  /** Watch the live store maps (rebind after initBoard replaces the Y.Doc). */
  bindStore(): void {
    if (this.observedBoard) {
      try {
        this.observedBoard.unobserve(this.onStore);
      } catch {
        /* gone */
      }
    }
    if (this.observedMeta) {
      try {
        this.observedMeta.unobserve(this.onMeta);
      } catch {
        /* gone */
      }
    }
    if (this.observedOrder) {
      try {
        this.observedOrder.unobserve(this.onOrder);
      } catch {
        /* gone */
      }
    }
    this.observedBoard = store.board;
    this.observedMeta = store.meta;
    this.observedOrder = store.order;
    store.board.observe(this.onStore);
    store.meta.observe(this.onMeta);
    store.order.observe(this.onOrder);
    store.ensureOrder();
    this.resetToPage();
  }

  /** No-op if already on the current maps; otherwise rebind (Strict Mode / HMR safety). */
  ensureStoreBound(): void {
    if (
      this.observedBoard === store.board &&
      this.observedMeta === store.meta &&
      this.observedOrder === store.order
    ) {
      return;
    }
    this.bindStore();
  }

  private spatialBox(v: ShapeView): ShapeBox {
    return visualBox(v);
  }

  private loadActivePage(): void {
    store.ensureOrder();
    for (const [key, m] of store.board) {
      if (!store.isOnActivePage(key)) continue;
      const v = { ...store.readShape(m), id: key };
      this.views.set(key, v);
      this.grid.upsert(key, this.spatialBox(v));
      this.attachShape(key, m);
    }
  }

  resetToPage(): void {
    this.cancelTransientUi();
    if (this.graphEditId) this.cancelGraphEditor();
    if (this.calcEditId) this.closeCalculator();
    else if (this.editing) this.events.onRequestCommitText?.();
    this.editing = false;
    this.editId = null;
    this.editPageId = null;
    this.events.onEditText?.(null);
    this.events.onEditGraph?.(null);
    this.events.onEditCalculator?.(null);
    this.boundPageId = store.currentPageId();
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
    this.rebakeConnectedArrows();
    this.dirty = true;
  }

  /** Upgrade legacy 4-point connected arrows so cubics follow rotated ports. */
  private rebakeConnectedArrows(): void {
    const hosts = new Set<string>();
    for (const v of this.views.values()) {
      if (v.type === 'arrow' && v.fromId && v.toId && (v.points?.length ?? 0) < 8) {
        hosts.add(v.fromId);
        hosts.add(v.toId);
      }
    }
    if (hosts.size) this.updateConnectedArrows(hosts);
  }

  contentBox(): ShapeBox | null {
    return this.boundsOf([...this.views.keys()]);
  }

  selectionBounds(): ShapeBox | null {
    return this.boundsOf([...this.selection]);
  }

  /** Selection plus glued riders — export must not clip notes that sit on a table. */
  selectionExportBounds(): ShapeBox | null {
    return this.boundsOf(this.selectionExportIds());
  }

  /** Selected shapes plus glued riders and joining connectors, in board z-order. */
  selectionExportIds(): string[] {
    return this.idsWithRidersInOrder(this.selection);
  }

  private boundsOf(ids: string[]): ShapeBox | null {
    let box: ShapeBox | null = null;
    for (const id of ids) {
      const v = this.views.get(id);
      if (!v) continue;
      const b = this.spatialBox(v);
      box = box
        ? {
            x: Math.min(box.x, b.x),
            y: Math.min(box.y, b.y),
            w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x),
            h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y),
          }
        : { ...b };
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
    opts: { scale: number; format: 'png' | 'jpeg'; quality?: number; background?: string | null; ids?: Iterable<string> }
  ): HTMLCanvasElement | null {
    if (box.w <= 0 || box.h <= 0) return null;
    const pad = 4;
    const exportBox = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
    const width = Math.max(1, Math.round(exportBox.w * opts.scale));
    const height = Math.max(1, Math.round(exportBox.h * opts.scale));
    // Soft-cap huge canvases — browsers throw / OOM past ~16k on a side.
    if (width > 8192 || height > 8192 || width * height > 64_000_000) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.setTransform(opts.scale, 0, 0, opts.scale, -exportBox.x * opts.scale, -exportBox.y * opts.scale);
      const paper = store.viewPaperBg();
      const theme = themeFor(paper);
      // `null` is a real request for alpha (ExportDialog Transparent). `??`
      // would treat that as missing and fill Orbit paper over the PNG.
      const bgFill =
        opts.background !== undefined
          ? opts.background
          : orbitPaperActive(paper, paper)
            ? ORBIT_PAPER
            : null;
      if (bgFill) {
        ctx.fillStyle = bgFill;
        ctx.fillRect(exportBox.x, exportBox.y, exportBox.w, exportBox.h);
      }
      for (const v of this.viewsInBox(box, opts.ids)) {
        try {
          drawShape(ctx, v, theme.text, paper);
        } catch (err) {
          // ponytail: one bad shape must not kill the whole export
          console.warn('[review] export skipped shape', v.id, v.type, err);
        }
      }
      return canvas;
    } catch {
      return null;
    }
  }

  private viewsInBox(box: ShapeBox, ids?: Iterable<string>): ShapeView[] {
    const pad = 4;
    const exportBox = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
    const allow = ids ? new Set(ids) : null;
    const out: ShapeView[] = [];
    const ord = store.order;
    for (let i = 0; i < ord.length; i++) {
      const id = ord.get(i);
      if (allow && !allow.has(id)) continue;
      if (!store.isOnActivePage(id)) continue;
      const v = this.views.get(id);
      if (!v) continue;
      if (!intersects(this.spatialBox(v), exportBox)) continue;
      out.push(v);
    }
    return out;
  }

  exportSvg(
    box: ShapeBox,
    opts: { background: string | null; ids?: Iterable<string> }
  ): { blob: Blob; width: number; height: number } | null {
    if (box.w <= 0 || box.h <= 0) return null;
    const views = this.viewsInBox(box, opts.ids);
    const { svg, width, height } = shapesToSvg(views, {
      background: opts.background,
      inkPaper: store.viewPaperBg(),
      pad: 4,
      clip: box,
    });
    return {
      blob: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      width,
      height,
    };
  }

  async exportPdf(
    box: ShapeBox,
    opts: { scale: number; quality?: number; background: string | null; ids?: Iterable<string> }
  ): Promise<{ blob: Blob; width: number; height: number } | null> {
    const raster = await this.exportBlob(box, {
      scale: opts.scale,
      format: 'jpeg',
      quality: opts.quality ?? 0.9,
      background: opts.background ?? '#ffffff',
      ids: opts.ids,
    });
    if (!raster) return null;
    const jpeg = new Uint8Array(await raster.blob.arrayBuffer());
    const pdf = jpegToPdf(jpeg, raster.width, raster.height);
    return {
      blob: new Blob([pdf], { type: 'application/pdf' }),
      width: raster.width,
      height: raster.height,
    };
  }

  exportBlob(
    box: ShapeBox,
    opts: { scale: number; format: 'png' | 'jpeg'; quality?: number; background: string | null; ids?: Iterable<string> }
  ): Promise<{ blob: Blob; width: number; height: number } | null> {
    const canvas = this.exportCanvas(box, opts);
    if (!canvas) return Promise.resolve(null);
    const mime = opts.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    return new Promise((resolve) => {
      try {
        canvas.toBlob(
          (blob) => resolve(blob ? { blob, width: canvas.width, height: canvas.height } : null),
          mime,
          opts.quality
        );
      } catch {
        resolve(null);
      }
    });
  }

  destroy(): void {
    this.alive = false;
    this.cancelTransientUi();
    this.syncOrbitWarpCovered(false);
    cancelAnimationFrame(this.rafId);
    this.resizer.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('dblclick', this.onDblClick);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('auxclick', this.onAuxClick);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('paste', this.onPaste);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (this.observedBoard) {
      try {
        this.observedBoard.unobserve(this.onStore);
      } catch {
        /* gone */
      }
    }
    if (this.observedMeta) {
      try {
        this.observedMeta.unobserve(this.onMeta);
      } catch {
        /* gone */
      }
    }
    if (this.observedOrder) {
      try {
        this.observedOrder.unobserve(this.onOrder);
      } catch {
        /* gone */
      }
    }
    this.observedBoard = null;
    this.observedMeta = null;
    this.observedOrder = null;
    store.setLiveViewApplier(null);
    this.offPageChange();
    this.offImageLoad();
    this.offFormulaLoad();
    this.offPrefs();
    window.removeEventListener('review-chrome-theme', this.onChromeTheme);
    this.reduceMotionMq?.removeEventListener('change', this.onReduceMotionChange);
    this.reduceMotionMq = null;
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
    // Keyboard / toolbar switches must abort an in-flight pointer gesture the
    // same way Escape does. Otherwise select-drag leaves an elevated
    // write-gate, and a half-drawn connector stays armed.
    // Crop and export-region pick are modal layers; leave those alone.
    if (this.pointerDown || this.connecting) this.abortPointerGesture();
    this.active = id;
    // Keep Space temp-pan armed across toolbar/keyboard tool swaps while Space
    // is still held; only clear the override when Space is up.
    this.override = this.spaceHeld ? 'pan' : null;
    // ponytail: drawing tools drop the selection — the frame hides off-select
    // anyway, and a stale selection would keep showing its style island with
    // no frame while the new tool's own panel stays hidden
    if (id !== 'select' && id !== 'pan' && id !== 'lasso' && this.selection.size) {
      this.setSelection([]);
    }
    this.setCursor(this.toolCursor());
    publishTool(id);
    this.events.onTool?.(id);
    this.dirty = true;
  }

  setCursor(cursor: string): void {
    this.canvas.style.cursor = cursor;
  }

  setDirty(): void {
    this.dirty = true;
  }

  /**
   * Instant local paint while writeGate coalesces Yjs commits.
   * When only x/y move, shift world-space points so pens stay under the cursor.
   */
  private applyLivePatches(batch: PatchBatch): void {
    if (!batch.length) return;
    for (const [id, patch] of batch) {
      const v = this.views.get(id);
      if (!v) continue;
      const nx = patch.x ?? v.x;
      const ny = patch.y ?? v.y;
      const next: ShapeView = { ...v, ...patch, x: nx, y: ny };
      if (v.points && patch.points === undefined && (nx !== v.x || ny !== v.y)) {
        const dx = nx - v.x;
        const dy = ny - v.y;
        next.points = v.points.map((p, i) => p + (i % 2 === 0 ? dx : dy));
      }
      this.views.set(id, next);
      this.grid.upsert(id, this.spatialBox(next));
    }
    this.dirty = true;
  }

  setSelection(ids: string[]): void {
    this.selection.clear();
    for (const id of ids) {
      if (this.views.has(id)) this.selection.add(id);
    }
    this.dirty = true;
    this.events.onSelection?.([...this.selection]);
    // Awareness only — peers see soft selection chrome; empty clears.
    publishSelection(this.selection.size ? [...this.selection] : null);
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

  /** Selected shape under a point — uses bounds, not stroke geometry (for context menu). */
  private hitSelectedBounds(x: number, y: number): string | null {
    if (!this.selection.size) return null;
    const pad = 4 / this.camera.zoom;
    const ord = store.order;
    for (let i = ord.length - 1; i >= 0; i--) {
      const id = ord.get(i);
      if (!this.selection.has(id)) continue;
      const v = this.views.get(id);
      if (!v) continue;
      const b = this.spatialBox(v);
      if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return id;
    }
    const box = this.selectionBounds();
    if (
      box &&
      x >= box.x - pad &&
      x <= box.x + box.w + pad &&
      y >= box.y - pad &&
      y <= box.y + box.h + pad
    ) {
      return [...this.selection][0] ?? null;
    }
    return null;
  }

  private clampCameraToContent(): void {
    this.camera.clampCenter(this.contentBox(), this.w, this.h);
  }

  hitHandle(sx: number, sy: number): { shapeId: string; handle: HandleId } | null {
    const z = this.camera.zoom;
    const ox = this.w / 2 - this.camera.x * z;
    const oy = this.h / 2 - this.camera.y * z;
    // ponytail: multi-select → one group bbox with 8 handles
    if (this.selection.size > 1) {
      const box = this.selectionBounds();
      if (box) {
        for (const handle of HANDLES) {
          const [fx, fy] = HANDLE_POS[handle];
          const hx = (box.x + fx * box.w) * z + ox;
          const hy = (box.y + fy * box.h) * z + oy;
          if (Math.hypot(hx - sx, hy - sy) <= handleHitRadius()) {
            return { shapeId: '__group__', handle };
          }
        }
      }
      // ponytail: per-member handles are not drawn for multi-select — letting
      // them hijack drags single-resizes one member (e.g. a frame inside the
      // group) while the user is moving the group.
      return null;
    }
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v || v.locked) continue;
      for (const handle of HANDLES) {
        const [fx, fy] = HANDLE_POS[handle];
        const world = localToWorld(v, fx * v.w, fy * v.h);
        const hx = world.x * z + ox;
        const hy = world.y * z + oy;
        if (Math.hypot(hx - sx, hy - sy) <= handleHitRadius()) {
          return { shapeId: id, handle };
        }
      }
    }
    return null;
  }

  /**
   * World-space center of the rotate knob for a hit id (`__group__` or shape id).
   * Same geometry as hit-test / paint — respect `rotateHandleTop` and shape rotation.
   * Confetti / celebrate effects should spawn from this point (or a pointer world fallback).
   */
  rotateHandleWorldPos(hitId: string): { x: number; y: number } | null {
    const s = ROTATE_HANDLE_OFFSET_PX / this.camera.zoom;
    const top = readPrefs().rotateHandleTop;
    if (hitId === '__group__') {
      const box = this.selectionBounds();
      if (!box) return null;
      return rotateHandleOnBox(box, s, top);
    }
    const v = this.views.get(hitId);
    if (!v) return null;
    const local = rotateHandleLocal(v.w, v.h, s, top);
    return localToWorld(v, local.x, local.y);
  }

  /** Screen hit-test for the rotation knob (single or group). */
  hitRotateHandle(sx: number, sy: number): string | null {
    const z = this.camera.zoom;
    const ox = this.w / 2 - this.camera.x * z;
    const oy = this.h / 2 - this.camera.y * z;
    if (this.selection.size > 1) {
      const box = this.selectionBounds();
      if (!box) return null;
      const hasUnlocked = [...this.selection].some((id) => !this.views.get(id)?.locked);
      if (!hasUnlocked) return null;
      const rp = this.rotateHandleWorldPos('__group__');
      if (!rp) return null;
      const hx = rp.x * z + ox;
      const hy = rp.y * z + oy;
      if (Math.hypot(hx - sx, hy - sy) <= rotateHitRadius()) return '__group__';
      return null;
    }
    if (this.selection.size !== 1) return null;
    const id = [...this.selection][0];
    const v = this.views.get(id);
    if (!v || v.locked) return null;
    const w = this.rotateHandleWorldPos(id);
    if (!w) return null;
    const hx = w.x * z + ox;
    const hy = w.y * z + oy;
    if (Math.hypot(hx - sx, hy - sy) <= rotateHitRadius()) return id;
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
      for (const port of EDGE_PORTS) {
        const p = portPos(v, port as PortId, off);
        const hx = p.x * z + ox;
        const hy = p.y * z + oy;
        const d = Math.hypot(hx - sx, hy - sy);
        if (d <= portHitRadius() && (!best || d < best.dist)) best = { shapeId: id, port: port as PortId, dist: d };
      }
    }
    return best ? { shapeId: best.shapeId, port: best.port } : null;
  }

  /**
   * Triple-press easter egg on the rotate knob.
   * `worldX`/`worldY` are board-space spawn origin (not screen). Callers should pass
   * `rotateHandleWorldPos(hitId)` so the burst tracks the control; pointer world is fine too.
   */
  handleRotateClick(worldX: number, worldY: number): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastEasterTime > 700) this.easterRotateClicks = 0;
    this.lastEasterTime = now;
    this.easterRotateClicks++;
    if (this.easterRotateClicks < 3) return;
    this.easterRotateClicks = 0;
    this.triggerConfetti(worldX, worldY);
  }

  /** Board-space paper confetti cannon at the rotate knob (replaces glow-orb fireworks). */
  private triggerConfetti(wx: number, wy: number): void {
    // Paper-like saturated bits that read on light/dark board chrome (no glow orbs).
    const colors = [
      '#e03131',
      '#f08c00',
      '#fab005',
      '#37b24d',
      '#1c7ed6',
      '#ae3ec9',
      '#f06595',
      '#212529',
      '#f8f9fa',
    ];
    const invZ = 1 / Math.max(this.camera.zoom, 0.05);
    const reduce = this.reduceMotion;
    const count = reduce ? 18 : 64;
    const cone = reduce ? 0.55 : 0.95; // radians half-angle around aim
    // Cannon always points world −y (screen up), not away-from-selection-center.
    const aim = -Math.PI / 2;
    for (let i = 0; i < count; i++) {
      const t = i / Math.max(count - 1, 1);
      const ang = aim + (t - 0.5) * 2 * cone + (Math.random() - 0.5) * 0.35;
      // Velocities in world units/sec; *invZ keeps on-screen kick zoom-stable (~800–1300 px/s snappy).
      const speed = (800 + Math.random() * 500) * invZ;
      const w = (6 + Math.random() * 10) * invZ;
      const h = (3 + Math.random() * 4.5) * invZ;
      this.confetti.push({
        x: wx + (Math.random() - 0.5) * 6 * invZ,
        y: wy + (Math.random() - 0.5) * 6 * invZ,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: 1,
        color: colors[i % colors.length],
        w,
        h,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 18,
      });
    }
    this.dirty = true;
  }

  private updateConfetti(dt: number): void {
    if (!this.confetti.length) return;
    const invZ = 1 / Math.max(this.camera.zoom, 0.05);
    // Low-ish g + strong vertical drag → snappy pop, then terminal float (not a slam).
    const g = 240 * invZ; // world units/s² ≈ 240 screen px/s²
    for (const p of this.confetti) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += g * dt;
      p.vx *= Math.pow(0.4, dt); // horizontal air drag
      p.vy *= Math.pow(0.28, dt); // kills ascent fast; ~110 px/s terminal fall
      p.rot += p.spin * dt;
      p.life -= dt * 0.32; // ~3.1s from life=1
    }
    this.confetti = this.confetti.filter((p) => p.life > 0);
    if (this.confetti.length) this.dirty = true;
  }

  private drawConfetti(ctx: CanvasRenderingContext2D): void {
    if (!this.confetti.length) return;
    ctx.save();
    ctx.shadowBlur = 0;
    for (const p of this.confetti) {
      const alpha = Math.max(0, Math.min(1, p.life));
      // Hold full opacity longer, then snap-fade so bits stay readable on chrome.
      ctx.save();
      ctx.globalAlpha = alpha > 0.25 ? 1 : alpha / 0.25;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    ctx.restore();
  }

  getPortWorldPos(shapeId: string, port: PortId): { x: number; y: number } | null {
    const v = this.views.get(shapeId);
    if (!v) return null;
    return portPos(v, port, 18 / this.camera.zoom);
  }

  updateConnectedArrows(movedIds: Set<string>): void {
    const patches: Array<[string, Partial<ShapeView>]> = [];
    for (const [id, v] of this.views) {
      if (v.type !== 'arrow' || !v.fromId || !v.toId) continue;
      if (!movedIds.has(v.fromId) && !movedIds.has(v.toId)) continue;
      const from = this.views.get(v.fromId);
      const to = this.views.get(v.toId);
      if (!from || !to) continue;
      const fromPort = (v.fromPort as PortId) || 'e';
      const toPort = (v.toPort as PortId) || 'w';
      patches.push([id, connectedArrowGeometry(from, to, fromPort, toPort, v)]);
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
    const unglue: string[] = [];
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v || v.locked) continue;
      if (v.type === 'arrow' && v.fromId && v.toId) continue;
      moved.add(id);
      patches.push([id, { x: v.x + dx, y: v.y + dy }]);
    }
    const riderIds = hostRiderIds([...this.views.values()], moved);
    for (const rid of riderIds) {
      const rv = this.views.get(rid);
      if (!rv || rv.locked || moved.has(rid)) continue;
      moved.add(rid);
      patches.push([rid, { x: rv.x + dx, y: rv.y + dy }]);
    }
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v || v.locked || v.type !== 'arrow' || !v.fromId || !v.toId) continue;
      if (moved.has(v.fromId) || moved.has(v.toId)) continue;
      unglue.push(id);
      moved.add(id);
      patches.push([id, { x: v.x + dx, y: v.y + dy }]);
    }
    for (const [aid, av] of this.views) {
      if (av.type !== 'arrow' || !av.fromId || !av.toId) continue;
      if (!moved.has(av.fromId) && !moved.has(av.toId)) continue;
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
      patches.push([aid, connectedArrowGeometry(fromBox, toBox, (av.fromPort as PortId) || 'e', (av.toPort as PortId) || 'w', av)]);
    }
    if (patches.length) store.patchShapes(patches);
    for (const id of unglue) store.clearShapeKeys(id, ['fromId', 'fromPort', 'toId', 'toPort']);
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
    const riderSkip = new Set(hostRiderIds([...this.views.values()], [...originals.keys()]));
    const otherBoxes: ShapeBox[] = [];
    for (const [id, v] of this.views) {
      if (originals.has(id) || riderSkip.has(id)) continue;
      otherBoxes.push(visualBox(v));
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
    const lockedIds = new Set(selected.filter((v) => v.locked).map((v) => v.id));
    // Multi-select aligns within the selection (locked members stay put as anchors).
    // Single unlocked shape aligns to other board shapes.
    const others =
      selected.length >= 2
        ? []
        : [...this.views.values()].filter((v) => !this.selection.has(v.id) && store.isOnActivePage(v.id));
    let patches: Array<[string, Partial<ShapeView>]> = [];
    if (kind === 'centerH' || kind === 'centerV' || kind === 'left' || kind === 'right' || kind === 'top' || kind === 'bottom') {
      if (selected.length >= 2) {
        patches = alignViews(selected, [], kind).filter(([id]) => !lockedIds.has(id));
      } else if (others.length) {
        patches = alignViews(unlocked, others, kind);
      } else {
        return;
      }
    } else if (kind === 'distributeH' || kind === 'distributeV') {
      patches = alignViews(unlocked, [], kind);
    }
    if (patches.length) {
      const claimed = new Set(patches.map(([id]) => id));
      const extra: Array<[string, Partial<ShapeView>]> = [];
      for (const [id, patch] of patches) {
        const host = this.views.get(id);
        if (!host) continue;
        const ddx = (patch.x ?? host.x) - host.x;
        const ddy = (patch.y ?? host.y) - host.y;
        if (!ddx && !ddy) continue;
        for (const rid of hostRiderIds([...this.views.values()], [id])) {
          if (claimed.has(rid)) continue;
          const rv = this.views.get(rid);
          if (!rv || rv.locked) continue;
          claimed.add(rid);
          extra.push([rid, { x: rv.x + ddx, y: rv.y + ddy }]);
        }
      }
      const batch = [...patches, ...extra];
      const moved = new Set<string>();
      const applied: Array<[string, Partial<ShapeView>]> = [];
      const unglue: string[] = [];
      for (const [id, patch] of batch) {
        const v = this.views.get(id);
        if (!v || v.locked) continue;
        if (v.type === 'arrow' && v.fromId && v.toId) continue;
        moved.add(id);
        applied.push([id, patch]);
      }
      for (const [id, patch] of batch) {
        const v = this.views.get(id);
        if (!v || v.locked || v.type !== 'arrow' || !v.fromId || !v.toId) continue;
        if (moved.has(v.fromId) || moved.has(v.toId)) continue;
        unglue.push(id);
        moved.add(id);
        applied.push([id, patch]);
      }
      if (applied.length) store.patchShapes(applied);
      for (const id of unglue) store.clearShapeKeys(id, ['fromId', 'fromPort', 'toId', 'toPort']);
      this.updateConnectedArrows(moved);
    }
  }

  private unlockedIds(): string[] {
    return [...this.selection].filter((id) => !this.views.get(id)?.locked);
  }

  deleteSelection(): void {
    const ids = this.unlockedIds();
    if (!ids.length) return;
    store.removeShapes(this.idsWithRidersInOrder(ids));
  }

  private clipboard: ShapeView[] = [];
  private pasteN = 0;
  private pasteAt: { x: number; y: number } | null = null;

  /** Clone clipboard shapes with remapped ids and connector endpoints. */
  private cloneShapes(source: ShapeView[], dx: number, dy: number, pageId?: string): string[] {
    const idMap = new Map<string, string>();
    const ids: string[] = [];
    for (const v of source) {
      const newKey = store.addShape(
        {
          ...v,
          id: undefined,
          x: v.x + dx,
          y: v.y + dy,
          points: v.points ? v.points.map((p, i) => p + (i % 2 === 0 ? dx : dy)) : undefined,
          fromId: undefined,
          fromPort: undefined,
          toId: undefined,
          toPort: undefined,
        },
        pageId
      );
      idMap.set(v.id, newKey);
      ids.push(newKey);
    }
    const patches: Array<[string, Partial<ShapeView>]> = [];
    for (let i = 0; i < source.length; i++) {
      const v = source[i];
      if (v.type !== 'arrow') continue;
      const fromId = v.fromId ? idMap.get(v.fromId) : undefined;
      const toId = v.toId ? idMap.get(v.toId) : undefined;
      if (!fromId || !toId) continue;
      patches.push([
        ids[i],
        {
          fromId,
          toId,
          fromPort: v.fromPort,
          toPort: v.toPort,
        },
      ]);
    }
    if (patches.length) store.patchShapes(patches);
    return ids;
  }

  copySelection(): void {
    this.clipboard = this.shapesForClipboardFrom(this.selection);
    this.pasteN = 0;
    this.writeClipboardMarker();
  }

  cutSelection(): void {
    const ids = this.unlockedIds();
    if (!ids.length) return;
    this.clipboard = this.shapesForClipboardFrom(ids);
    this.pasteN = 0;
    this.writeClipboardMarker();
    this.deleteSelection();
  }

  /** World point for the next paste (context-menu paste). */
  setPasteAnchor(pt: { x: number; y: number } | null): void {
    this.pasteAt = pt;
  }

  private consumePasteAnchor(): { x: number; y: number } | null {
    const a = this.pasteAt;
    this.pasteAt = null;
    return a;
  }

  private resolvePastePos(explicit?: { x: number; y: number }): { x: number; y: number } {
    return explicit ?? this.consumePasteAnchor() ?? { x: this.camera.x, y: this.camera.y };
  }

  private writeClipboardMarker(): void {
    try {
      const marker = JSON.stringify({ __reviewShapes: this.clipboard });
      navigator.clipboard?.writeText(marker).catch(() => {});
    } catch {}
  }

  pasteSelection(anchor?: { x: number; y: number }, pageId?: string): void {
    const pinned = anchor ?? this.consumePasteAnchor();
    if (!this.clipboard.length) return;
    this.pasteN += 1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const clipBox = groupBox(this.clipboard);
    if (clipBox) {
      minX = clipBox.x;
      minY = clipBox.y;
      maxX = clipBox.x + clipBox.w;
      maxY = clipBox.y + clipBox.h;
    } else {
      for (const v of this.clipboard) {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x + v.w);
        maxY = Math.max(maxY, v.y + v.h);
      }
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const at = pinned ?? { x: this.camera.x, y: this.camera.y };
    const drift = pinned ? 0 : (((this.pasteN - 1) % 8) * 24) / this.camera.zoom;
    const dx = at.x - cx + drift;
    const dy = at.y - cy + drift;
    const ids = this.cloneShapes(this.clipboard, dx, dy, pageId);
    this.setSelection(ids);
    this.setTool('select');
  }

  duplicateSelection(): void {
    if (!this.selection.size) return;
    const off = 40 / this.camera.zoom;
    const ids = this.cloneShapes(this.shapesForClipboard(), off, off);
    this.setSelection(ids);
    this.setTool('select');
  }

  /** Selected ids plus glued riders and connectors that join them, in board z-order. */
  private idsWithRidersInOrder(ids: Iterable<string>): string[] {
    const set = new Set(ids);
    if (!set.size) return [];
    for (const rid of hostRiderIds([...this.views.values()], set)) set.add(rid);
    for (const [id, v] of this.views) {
      if (v.type !== 'arrow' || set.has(id) || !v.fromId || !v.toId) continue;
      if (set.has(v.fromId) && set.has(v.toId)) set.add(id);
    }
    const out: string[] = [];
    const seen = new Set<string>();
    const ord = store.order;
    for (let i = 0; i < ord.length; i++) {
      const id = ord.get(i);
      if (!set.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    for (const id of set) {
      if (seen.has(id) || !this.views.has(id)) continue;
      out.push(id);
    }
    return out;
  }

  private shapesForClipboardFrom(ids: Iterable<string>): ShapeView[] {
    const out: ShapeView[] = [];
    for (const id of this.idsWithRidersInOrder(ids)) {
      const v = this.views.get(id);
      if (v) out.push(structuredClone(v));
    }
    return out;
  }

  /** Selected shapes plus glued riders and joining connectors, in board z-order. */
  private shapesForClipboard(): ShapeView[] {
    return this.shapesForClipboardFrom(this.selection);
  }

  bringFront(): void {
    const ids = this.idsWithRidersInOrder(this.selection);
    if (!ids.length) return;
    store.moveOrderToFront(ids);
    this.dirty = true;
  }

  sendBack(): void {
    const ids = this.idsWithRidersInOrder(this.selection);
    if (!ids.length) return;
    store.moveOrderToBack(ids);
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
    ids = this.idsWithRidersInOrder(ids);
    const box = this.boundsOf(ids);
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
      if (containedInShape(sv, v)) out.push(sv);
    }
    return out;
  }

  private async copyAsImage(ids: string[]): Promise<boolean> {
    let blob: Blob | null = null;
    if (ids.length === 1) {
      const v = this.views.get(ids[0]);
      if (v && v.type === 'image' && v.src && v.cropW === undefined && v.cropH === undefined && this.annotationsOn(v).length === 0) {
        try { blob = await (await fetch(v.src)).blob(); } catch {}
      }
    }
    if (!blob) {
      const canvas = this.selectionCanvas(ids);
      if (!canvas) return false;
      blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/png'));
      if (!blob) return false;
    }
    // modern clipboard (secure context + ClipboardItem) — use actual blob type
    try {
      const CI = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (navigator.clipboard && CI && (window.isSecureContext ?? true)) {
        const mime = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png';
        await navigator.clipboard.write([new CI({ [mime]: blob } as Record<string, Blob>)]);
        this.events.onToast?.(t(readLocale(), 'syncLanCopied'));
        return true;
      }
    } catch (e) {
      console.warn('[review] clipboard.write image failed', e);
    }
    // fallback: on http LAN ClipboardItem is blocked — execCommand gives HTML, not PNG → Discord/Preview won't see image
    if (!(window.isSecureContext ?? true)) {
      this.events.onToast?.('Копирование картинки доступно только по HTTPS — открой через localhost или скачай');
      return false;
    }
    try {
      const ok = await this.copyBlobViaExecCommand(blob);
      if (ok) {
        this.events.onToast?.(t(readLocale(), 'syncLanCopied'));
        return true;
      }
    } catch (e) {
      console.warn('[review] execCommand copy image failed', e);
    }
    this.events.onError?.(t(readLocale(), 'error') + ': clipboard');
    return false;
  }

  private async copyBlobViaExecCommand(blob: Blob): Promise<boolean> {
    const url = URL.createObjectURL(blob);
    try {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.style.position = 'fixed';
      div.style.left = '-9999px';
      div.style.top = '0';
      const img = document.createElement('img');
      img.src = url;
      // ensure image is loaded before copying
      if (!img.complete) {
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('img load')); });
      }
      div.appendChild(img);
      document.body.appendChild(div);
      const range = document.createRange();
      range.selectNodeContents(div);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      const ok = document.execCommand('copy');
      sel?.removeAllRanges();
      div.remove();
      return ok;
    } finally {
      URL.revokeObjectURL(url);
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
    const batch: Array<[string, Partial<ShapeView>]> = [];
    const touched = new Set<string>();
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v || v.type !== 'image') continue;
      const img = getImage(v.src ?? '');
      if (!img || !img.complete || !img.naturalWidth) continue;
      const f = cropFractions(v);
      const nw = img.naturalWidth * f.w;
      const nh = img.naturalHeight * f.h;
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      const orig = { x: v.x, y: v.y, w: v.w, h: v.h, rotation: v.rotation };
      const next = { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh, rotation: v.rotation };
      batch.push([id, { x: next.x, y: next.y, w: nw, h: nh }]);
      touched.add(id);
      for (const rid of hostRiderIds([...this.views.values()], [id])) {
        if (touched.has(rid)) continue;
        const rv = this.views.get(rid);
        if (!rv || rv.locked) continue;
        const mapped = mapShapeThroughHostResize(rv, orig, next, 1);
        if (!mapped) continue;
        touched.add(rid);
        batch.push([rid, mapped]);
      }
    }
    if (batch.length) store.patchShapes(batch);
    if (touched.size) this.updateConnectedArrows(touched);
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
        calculator: 'infoCalculator',
        table: 'infoTable',
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
    if (v.type === 'table') {
      const g = tableGrid(v);
      lines.push(`${g.cols} × ${g.rows}`);
    }
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

  insertImageFile(file: File, at?: { x: number; y: number }, pageId?: string): void {
    const locale = readLocale();
    if (!file.type.startsWith('image/')) {
      this.events.onError?.(t(locale, 'imageFailed'));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.events.onError?.(t(locale, 'imageTooLarge'));
      return;
    }
    const pos = this.resolvePastePos(at);
    const page = pageId ?? store.currentPageId();
    const boardId = store.getCurrentBoardId();
    const reader = new FileReader();
    reader.onerror = () => this.events.onError?.(t(locale, 'imageFailed'));
    reader.onload = () => {
      if (!this.alive || store.getCurrentBoardId() !== boardId) return;
      const img = new Image();
      img.onerror = () => this.events.onError?.(t(locale, 'imageFailed'));
      img.onload = () => {
        if (!this.alive || store.getCurrentBoardId() !== boardId) return;
        const maxStore = 1600;
        const storeScale = Math.min(1, maxStore / Math.max(img.naturalWidth, img.naturalHeight));
        const sw = Math.max(1, Math.round(img.naturalWidth * storeScale));
        const sh = Math.max(1, Math.round(img.naturalHeight * storeScale));
        const scratch = document.createElement('canvas');
        scratch.width = sw;
        scratch.height = sh;
        const sctx = scratch.getContext('2d');
        if (!sctx) {
          this.events.onError?.(t(locale, 'imageFailed'));
          return;
        }
        sctx.drawImage(img, 0, 0, sw, sh);
        const jpeg = file.type === 'image/jpeg' || file.type === 'image/jpg';
        const src = jpeg ? scratch.toDataURL('image/jpeg', 0.85) : scratch.toDataURL('image/png');
        const maxShow = 600;
        const showScale = Math.min(1, maxShow / Math.max(sw, sh));
        const w = Math.max(1, sw * showScale);
        const h = Math.max(1, sh * showScale);
        const id = store.addShape(
          {
            type: 'image',
            x: pos.x - w / 2,
            y: pos.y - h / 2,
            w,
            h,
            fill: 'transparent',
            stroke: 'transparent',
            strokeWidth: 0,
            src,
          },
          page
        );
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

  addDocument(pages: string[], ratio: number, at?: { x: number; y: number }, pageId?: string): string | null {
    if (!pages.length) return null;
    const maxShow = 560;
    const w = maxShow;
    const h = Math.round(maxShow / (ratio || 0.707));
    const pos = at ?? { x: this.camera.x, y: this.camera.y };
    const id = store.addShape(
      {
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
      },
      pageId
    );
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
    const off = 26 / z;
    const left = localToWorld(v, -off, v.h / 2);
    const right = localToWorld(v, v.w + off, v.h / 2);
    return [
      { side: 'prev', x: left.x * z + ox, y: left.y * z + oy },
      { side: 'next', x: right.x * z + ox, y: right.y * z + oy },
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
    const total = v.pages?.length ?? 0;
    const page = docPageIndex(v.page, total) + 1;
    ctx.font = '12px "Space Grotesk", Onest, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const label = `${page} / ${total}`;
    const tw = ctx.measureText(label).width;
    const z = this.camera.zoom;
    const bottom = localToWorld(v, v.w / 2, v.h);
    const lx = bottom.x * z + (this.w / 2 - this.camera.x * z);
    const ly = bottom.y * z + (this.h / 2 - this.camera.y * z) + 8;
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
        const next = docPageStep(v.page, pages, zone.side === 'prev' ? -1 : 1);
        if (next !== (v.page ?? 0)) store.patchShape(v.id, { page: next });
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
    const full = uncroppedBox(v);
    this.crop = {
      id,
      box: { x: v.x, y: v.y, w: v.w, h: v.h },
      full: { x: full.x, y: full.y, w: full.w, h: full.h },
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
    const v = this.views.get(c.id);
    if (!v || v.type !== 'image') {
      this.cancelCrop();
      return;
    }
    const placed = reanchorCroppedBox(v, c.box);
    const orig = { x: v.x, y: v.y, w: v.w, h: v.h, rotation: v.rotation };
    const next = { x: placed.x, y: placed.y, w: placed.w, h: placed.h, rotation: v.rotation };
    this.patchHostAndRiders(c.id, orig, next, {
      x: placed.x,
      y: placed.y,
      w: placed.w,
      h: placed.h,
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
    const touched: string[] = [];
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v || v.type !== 'image' || v.locked) continue;
      if (v.cropW === undefined && v.cropH === undefined) continue;
      const full = restoreUncroppedBox(v);
      const orig = { x: v.x, y: v.y, w: v.w, h: v.h, rotation: v.rotation };
      const next = { x: full.x, y: full.y, w: full.w, h: full.h, rotation: v.rotation };
      this.patchHostAndRiders(
        id,
        orig,
        next,
        { x: full.x, y: full.y, w: full.w, h: full.h },
        ['cropX', 'cropY', 'cropW', 'cropH']
      );
      touched.push(id);
    }
    if (touched.length) this.updateConnectedArrows(new Set(touched));
    this.dirty = true;
  }

  private patchHostAndRiders(
    id: string,
    orig: { x: number; y: number; w: number; h: number; rotation?: number },
    next: { x: number; y: number; w: number; h: number; rotation?: number },
    hostPatch: Partial<ShapeView>,
    clearHostKeys?: readonly string[]
  ): void {
    const batch: Array<[string, Partial<ShapeView>]> = [[id, hostPatch]];
    const touched = new Set([id]);
    for (const rid of hostRiderIds([...this.views.values()], [id])) {
      if (touched.has(rid)) continue;
      const rv = this.views.get(rid);
      if (!rv || rv.locked) continue;
      const mapped = mapShapeThroughHostResize(rv, orig, next, 1);
      if (!mapped) continue;
      touched.add(rid);
      batch.push([rid, rv.type === 'arrow' && mapped.points ? withArrowVisualBounds(rv, mapped) : mapped]);
    }
    if (clearHostKeys?.length) store.patchShapesClearingKeys(batch, [[id, clearHostKeys]]);
    else store.patchShapes(batch);
    this.updateConnectedArrows(touched);
  }

  private onPaste = (e: ClipboardEvent): void => {
    if (this.editing) return;
    const at = this.consumePasteAnchor() ?? undefined;
    const pageId = store.currentPageId();
    const boardId = store.getCurrentBoardId();
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            this.insertImageFile(file, at, pageId);
            return;
          }
        }
      }
      for (const item of items) {
        if (item.type === 'text/plain') {
          e.preventDefault();
          item.getAsString((text) => {
            if (!this.alive || store.getCurrentBoardId() !== boardId) return;
            const trimmed = text.replace(/\r\n/g, '\n').trim();
            if (!trimmed) {
              this.pasteSelection(at, pageId);
              return;
            }
            const fromMarker = shapesFromClipboardText(trimmed);
            if (fromMarker) {
              this.clipboard = fromMarker.map((v) => structuredClone(v as ShapeView));
              this.pasteSelection(at, pageId);
              return;
            }
            this.insertPlainText(trimmed, at, pageId);
          });
          return;
        }
      }
    }
    e.preventDefault();
    this.pasteSelection(at, pageId);
  };

  private insertPlainText(text: string, at?: { x: number; y: number }, pageId?: string): void {
    const fontSize = settings.text.size;
    const color = settings.text.color;
    const measured = this.measureTextWrapped(text, fontSize, TEXT_TOOL_WRAP_W, {
      bold: settings.text.bold,
      italic: settings.text.italic,
    });
    const pos = this.resolvePastePos(at);
    const id = store.addShape(
      {
        type: 'text',
        x: pos.x - measured.w / 2,
        y: pos.y - measured.h / 2,
        w: measured.w,
        h: measured.h,
        fill: 'transparent',
        stroke: 'transparent',
        strokeWidth: 0,
        text,
        fontSize,
        textColor: color,
        bold: settings.text.bold,
        italic: settings.text.italic,
        underline: settings.text.underline,
        strike: settings.text.strike,
        textAlign: settings.text.align,
        highlight: settings.text.highlight,
      },
      pageId
    );
    this.setSelection([id]);
    this.setTool('select');
  }

  async pasteFromClipboard(): Promise<void> {
    const at = this.consumePasteAnchor() ?? undefined;
    const pageId = store.currentPageId();
    const boardId = store.getCurrentBoardId();
    const stillHere = () => this.alive && store.getCurrentBoardId() === boardId;
    // ponytail: system clipboard wins — PrintScreen image, then a shape marker or
    // plain text, then the in-memory buffer (writeText can fail on http).
    try {
      const items = await Promise.race([
        (navigator.clipboard as unknown as { read?: () => Promise<ClipboardItem[]> }).read
          ? (navigator.clipboard as unknown as { read: () => Promise<ClipboardItem[]> }).read()
          : Promise.resolve(null as ClipboardItem[] | null),
        new Promise<ClipboardItem[] | null>((resolve) => setTimeout(() => resolve(null), 220)),
      ]);
      if (!stillHere()) return;
      if (items) {
        for (const item of items) {
          const type = [...item.types].find((t) => t.startsWith('image/'));
          if (type) {
            const blob = await item.getType(type);
            if (!stillHere()) return;
            this.insertImageFile(new File([blob], 'clipboard.png', { type }), at, pageId);
            return;
          }
        }
        for (const item of items) {
          if (![...item.types].includes('text/plain')) continue;
          const blob = await item.getType('text/plain');
          const trimmed = (await blob.text()).replace(/\r\n/g, '\n').trim();
          if (!stillHere()) return;
          if (!trimmed) continue;
          const fromMarker = shapesFromClipboardText(trimmed);
          if (fromMarker) {
            this.clipboard = fromMarker.map((v) => structuredClone(v as ShapeView));
            this.pasteSelection(at, pageId);
            return;
          }
          this.insertPlainText(trimmed, at, pageId);
          return;
        }
      }
    } catch {
      /* no permission or not a secure context — fall through to internal */
    }
    if (!stillHere()) return;
    if (this.clipboard.length) {
      this.pasteSelection(at, pageId);
      return;
    }
    try {
      const txt = await navigator.clipboard.readText();
      if (!stillHere()) return;
      const trimmed = txt.replace(/\r\n/g, '\n').trim();
      if (trimmed) {
        const fromMarker = shapesFromClipboardText(trimmed);
        if (fromMarker) {
          this.clipboard = fromMarker.map((v) => structuredClone(v as ShapeView));
          this.pasteSelection(at, pageId);
          return;
        }
        this.insertPlainText(trimmed, at, pageId);
        return;
      }
    } catch {}
    this.pasteSelection(at, pageId);
  }

  resetZoom(): void {
    this.camera.setZoom(1);
  }

  fitContent(): void {
    let box: ShapeBox | null = null;
    for (const v of this.views.values()) {
      const b = this.spatialBox(v);
      box = box
        ? {
            x: Math.min(box.x, b.x),
            y: Math.min(box.y, b.y),
            w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x),
            h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y),
          }
        : { ...b };
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
    if (!v || v.locked || v.type === 'pen' || v.type === 'arrow' || v.type === 'image' || v.type === 'doc' || v.type === 'graph' || v.type === 'calculator') return;
    // Tables edit one cell at a time — route to the cell editor.
    if (v.type === 'table') {
      const a = this.tableActive.get(id) ?? { r: 0, c: 0 };
      this.openTableCellEditor(id, a.r, a.c);
      return;
    }
    // ponytail: replacing the open editor (e.g. dblclick another sticky while
    // typing) must commit the current text first — otherwise the new target
    // overwrites the overlay content and typed text is lost without a commit.
    if (this.editing && this.editId !== id) this.events.onRequestCommitText?.();
    const centered = v.type === 'rect' || v.type === 'ellipse' || v.type === 'diamond' || v.type === 'triangle' || v.type === 'parallelogram' || v.type === 'hexagon' || v.type === 'cylinder' || v.type === 'terminator' || v.type === 'subroutine' || v.type === 'display' || v.type === 'frame';
    let color: string;
    if (v.type === 'sticky') {
      color = v.textColor ?? '#3a2f00';
    } else {
      // ponytail: stored color never mutates — TextOverlay will displayInk per viewer paper
      color = v.textColor ?? themeFor(store.viewPaperBg()).text;
    }
    const tl = localToWorld(v, 0, 0);
    this.editing = true;
    this.editId = id;
    this.editPageId = store.currentPageId();
    this.events.onEditText?.({
      id,
      x: tl.x,
      y: tl.y,
      w: v.w,
      h: v.type === 'frame' ? frameHeaderHeight(v.h) : v.h,
      text: v.type === 'frame' ? frameTitleLine(v.text) : (v.text ?? ''),
      richHtml: v.type === 'frame' ? undefined : v.richHtml,
      fontSize: v.fontSize ?? defaultFontSizeFor(v.type),
      color,
      type: v.type,
      centered,
      bold: !!v.bold,
      italic: !!v.italic,
      underline: !!v.underline,
      strike: !!v.strike,
      textAlign: v.textAlign ?? (v.type === 'frame' ? 'left' : centered ? 'center' : 'left'),
      highlight: !!v.highlight,
      rotation: shapeRotation(v),
    });
  }

  /** Open the text overlay over a single table cell (plain text). */
  openTableCellEditor(id: string, row: number, col: number): void {
    const v = this.views.get(id);
    if (!v || v.type !== 'table' || v.locked) return;
    // ponytail: same-table cell switch must commit the current cell first —
    // the editId guard below only fires across shapes, so check the cell too.
    if (this.editing && this.editId !== id) this.events.onRequestCommitText?.();
    else if (this.editing && this.editId === id) {
      const cur = this.tableActive.get(id);
      if (!cur || cur.r !== row || cur.c !== col) this.events.onRequestCommitText?.();
    }
    const grid = tableGrid(v);
    const r = Math.min(grid.rows - 1, Math.max(0, row));
    const c = Math.min(grid.cols - 1, Math.max(0, col));
    this.tableActive.set(id, { r, c });
    const rect = tableCellRect(v, r, c);
    const localX = rect.x - v.x;
    const localY = rect.y - v.y;
    const tl = localToWorld(v, localX, localY);
    const size = v.fontSize ?? TABLE_FONT;
    // ponytail: the overlay sits on the cell fill, not the board — contrast against it
    const paper = store.viewPaperBg();
    const base = v.textColor ?? themeFor(paper).text;
    const color = hasFill(v.fill) ? readableTextOn(base, v.fill) : base;
    const style = tableCellStyle(v, r, grid.header);
    this.editing = true;
    this.editId = id;
    this.editPageId = store.currentPageId();
    this.events.onEditText?.({
      id,
      x: tl.x,
      y: tl.y,
      w: rect.w,
      h: rect.h,
      text: grid.cells[r * grid.cols + c] ?? '',
      fontSize: size,
      color,
      type: 'table',
      centered: false,
      bold: style.bold,
      italic: style.italic,
      underline: style.underline,
      strike: style.strike,
      textAlign: style.textAlign,
      highlight: false,
      tableCell: { row: r, col: c },
      rotation: shapeRotation(v),
    });
  }

  /** Spreadsheet nav: Enter commits and moves down, Tab commits and moves right. */
  advanceTableCell(id: string, row: number, col: number, dir: 'down' | 'right'): void {
    const v = this.views.get(id);
    if (!v || v.type !== 'table') return;
    const grid = tableGrid(v);
    let r = row;
    let c = col;
    if (dir === 'down') r = (r + 1) % grid.rows;
    else {
      c += 1;
      if (c >= grid.cols) {
        c = 0;
        r = (r + 1) % grid.rows;
      }
    }
    this.openTableCellEditor(id, r, c);
  }

  /** Write overlay text into one cell (plain text, no rich markup). */
  commitTableCell(id: string, row: number, col: number, text: string): void {
    this.editing = false;
    this.editId = null;
    this.editPageId = null;
    const v = this.views.get(id);
    if (!v || v.type !== 'table') return;
    const grid = tableGrid(v);
    const r = Math.min(grid.rows - 1, Math.max(0, row));
    const c = Math.min(grid.cols - 1, Math.max(0, col));
    const cells = [...grid.cells];
    cells[r * grid.cols + c] = text.replace(/\n+$/, '');
    store.patchShape(id, { cols: grid.cols, rows: grid.rows, cells });
    this.dirty = true;
  }

  /** Active cell for row/col ops (clamped to the live grid). */
  tableActiveCell(id: string): { r: number; c: number } {
    const v = this.views.get(id);
    const grid = v && v.type === 'table' ? tableGrid(v) : { rows: 1, cols: 1 };
    const a = this.tableActive.get(id) ?? { r: grid.rows - 1, c: grid.cols - 1 };
    return {
      r: Math.min(grid.rows - 1, Math.max(0, a.r)),
      c: Math.min(grid.cols - 1, Math.max(0, a.c)),
    };
  }

  /** Remap glued riders through a table's old→new local frame, then patch the table. */
  private patchTableStructure(
    id: string,
    tablePatch: Partial<ShapeView>,
    mapLocal: (lx: number, ly: number) => { x: number; y: number }
  ): void {
    const v = this.views.get(id);
    if (!v || v.type !== 'table') return;
    const orig = { x: v.x, y: v.y, w: v.w, h: v.h, rotation: v.rotation };
    const next = {
      x: tablePatch.x ?? v.x,
      y: tablePatch.y ?? v.y,
      w: tablePatch.w ?? v.w,
      h: tablePatch.h ?? v.h,
      rotation: v.rotation,
    };
    const batch: Array<[string, Partial<ShapeView>]> = [[id, tablePatch]];
    const moved = new Set<string>([id]);
    for (const rid of hostRiderIds([...this.views.values()], [id])) {
      const rv = this.views.get(rid);
      if (!rv || rv.locked) continue;
      const mapped = mapShapeThroughLocalMap(rv, orig, next, mapLocal, 1);
      if (!mapped) continue;
      batch.push([rid, mapped]);
      moved.add(rid);
    }
    store.patchShapes(batch);
    this.updateConnectedArrows(moved);
    this.dirty = true;
  }

  /** Insert a row: the table grows by one donor-height row (no cell shrinking). */
  tableInsertRow(id: string, at?: number): void {
    const v = this.views.get(id);
    if (!v || v.type !== 'table' || v.locked) return;
    const grid = tableGrid(v);
    if (grid.rows >= 64) return;
    const row = Math.min(grid.rows, Math.max(0, at ?? Math.min(grid.rows, this.tableActiveCell(id).r + 1)));
    const donor = Math.min(row, grid.rows - 1);
    const donorH = grid.rowH[donor] * v.h;
    const cells = [...grid.cells];
    for (let i = 0; i < grid.cols; i++) cells.splice(row * grid.cols + i, 0, '');
    const abs = grid.rowH.map((f) => f * v.h);
    abs.splice(row, 0, donorH);
    const total = v.h + donorH;
    this.tableActive.set(id, { r: row, c: this.tableActiveCell(id).c });
    this.patchTableStructure(id, { rows: grid.rows + 1, cells, rowH: abs.map((a) => a / total), h: total }, (lx, ly) => {
      const idx = tableAxisIndex(grid.rowH, v.h ? ly / v.h : 0);
      return { x: lx, y: idx >= row ? ly + donorH : ly };
    });
  }

  /** Insert a column: the table grows by one donor-width column. */
  tableInsertCol(id: string, at?: number): void {
    const v = this.views.get(id);
    if (!v || v.type !== 'table' || v.locked) return;
    const grid = tableGrid(v);
    if (grid.cols >= 24) return;
    const col = Math.min(grid.cols, Math.max(0, at ?? Math.min(grid.cols, this.tableActiveCell(id).c + 1)));
    const donor = Math.min(col, grid.cols - 1);
    const donorW = grid.colW[donor] * v.w;
    const cells: string[] = [];
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) cells.push(grid.cells[r * grid.cols + c] ?? '');
      cells.splice(r * (grid.cols + 1) + col, 0, '');
    }
    const abs = grid.colW.map((f) => f * v.w);
    abs.splice(col, 0, donorW);
    const total = v.w + donorW;
    this.tableActive.set(id, { r: this.tableActiveCell(id).r, c: col });
    this.patchTableStructure(id, { cols: grid.cols + 1, cells, colW: abs.map((a) => a / total), w: total }, (lx, ly) => {
      const idx = tableAxisIndex(grid.colW, v.w ? lx / v.w : 0);
      return { x: idx >= col ? lx + donorW : lx, y: ly };
    });
  }

  /** Delete a row: the table shrinks by the removed height. */
  tableRemoveRow(id: string, at?: number): void {
    const v = this.views.get(id);
    if (!v || v.type !== 'table' || v.locked) return;
    const grid = tableGrid(v);
    if (grid.rows <= 1) return;
    const row = Math.min(grid.rows - 1, Math.max(0, at ?? this.tableActiveCell(id).r));
    const removedH = grid.rowH[row] * v.h;
    const cells = grid.cells.filter((_, i) => Math.floor(i / grid.cols) !== row);
    const total = Math.max(1, v.h - removedH);
    const fracs = grid.rowH
      .filter((_, i) => i !== row)
      .map((f) => (f * v.h) / total);
    this.tableActive.set(id, { r: Math.min(row, grid.rows - 2), c: this.tableActiveCell(id).c });
    this.patchTableStructure(id, { rows: grid.rows - 1, cells, rowH: fracs, h: total }, (lx, ly) => {
      const idx = tableAxisIndex(grid.rowH, v.h ? ly / v.h : 0);
      return { x: lx, y: idx > row ? ly - removedH : ly };
    });
  }

  /** Delete a column: the table shrinks by the removed width. */
  tableRemoveCol(id: string, at?: number): void {
    const v = this.views.get(id);
    if (!v || v.type !== 'table' || v.locked) return;
    const grid = tableGrid(v);
    if (grid.cols <= 1) return;
    const col = Math.min(grid.cols - 1, Math.max(0, at ?? this.tableActiveCell(id).c));
    const removedW = grid.colW[col] * v.w;
    const cells = grid.cells.filter((_, i) => i % grid.cols !== col);
    const total = Math.max(1, v.w - removedW);
    const fracs = grid.colW
      .filter((_, i) => i !== col)
      .map((f) => (f * v.w) / total);
    this.tableActive.set(id, { r: this.tableActiveCell(id).r, c: Math.min(col, grid.cols - 2) });
    this.patchTableStructure(id, { cols: grid.cols - 1, cells, colW: fracs, w: total }, (lx, ly) => {
      const idx = tableAxisIndex(grid.colW, v.w ? lx / v.w : 0);
      return { x: idx > col ? lx - removedW : lx, y: ly };
    });
  }

  tableToggleHeader(id: string): void {
    const v = this.views.get(id);
    if (!v || v.type !== 'table' || v.locked) return;
    store.patchShape(id, { header: tableGrid(v).header ? false : true });
    this.dirty = true;
  }

  /** [+]/[−] pills around the single selected table (push/pop row / column at the end). Local frame. */
  private tablePlusPills(
    v: ShapeView
  ): Array<{ kind: 'row' | 'col' | 'delRow' | 'delCol'; lx: number; ly: number; r: number }> {
    const s = 1 / this.camera.zoom;
    const out = TABLE_PILL_OUT * s;
    const split = TABLE_PILL_SPLIT * s;
    const r = TABLE_PILL_R * s;
    return [
      { kind: 'col', lx: v.w + out, ly: v.h / 2 - split, r },
      { kind: 'delCol', lx: v.w + out, ly: v.h / 2 + split, r },
      { kind: 'row', lx: v.w / 2 - split, ly: v.h + out, r },
      { kind: 'delRow', lx: v.w / 2 + split, ly: v.h + out, r },
    ];
  }

  /** Hit the selected table's [+]/[−] chrome (add must not share a disk with the east port). */
  hitTablePlus(wx: number, wy: number): { id: string; kind: 'row' | 'col' | 'delRow' | 'delCol' } | null {
    if (this.active !== 'select' || this.override) return null;
    if (this.selection.size !== 1) return null;
    const id = [...this.selection][0];
    const v = this.views.get(id);
    if (!v || v.type !== 'table' || v.locked) return null;
    const slop = 4 / this.camera.zoom;
    for (const p of this.tablePlusPills(v)) {
      const world = localToWorld(v, p.lx, p.ly);
      if (Math.hypot(wx - world.x, wy - world.y) <= p.r + slop) return { id, kind: p.kind };
    }
    return null;
  }

  /** Interior grid divider under the pointer (single selected table): { divider index }. */
  hitTableDivider(
    wx: number,
    wy: number
  ): { shapeId: string; kind: 'col' | 'row'; index: number } | null {
    if (this.editing || this.selection.size !== 1) return null;
    const id = [...this.selection][0];
    const v = this.views.get(id);
    if (!v || v.type !== 'table' || v.locked) return null;
    const g = tableGrid(v);
    const p = worldToLocal(v, wx, wy);
    const slop = 6 / this.camera.zoom;
    if (p.y < -slop || p.y > v.h + slop || p.x < -slop || p.x > v.w + slop) return null;
    let acc = 0;
    for (let i = 1; i < g.cols; i++) {
      acc += g.colW[i - 1]!;
      if (Math.abs(p.x - acc * v.w) <= slop) return { shapeId: id, kind: 'col', index: i };
    }
    acc = 0;
    for (let i = 1; i < g.rows; i++) {
      acc += g.rowH[i - 1]!;
      if (Math.abs(p.y - acc * v.h) <= slop) return { shapeId: id, kind: 'row', index: i };
    }
    return null;
  }

  openTextEditorAt(x: number, y: number, fontSize: number, color: string): void {
    // ponytail: never mutate stored color — editor shows displayInk via TextOverlay
    const editorColor = color;
    // ponytail: same replace-guard as openTextEditor — commit current text first.
    if (this.editing) this.events.onRequestCommitText?.();
    const fmt = settings.text;
    this.editing = true;
    this.editId = null;
    this.editPageId = store.currentPageId();
    this.events.onEditText?.({
      id: null,
      x,
      y,
      w: TEXT_TOOL_WRAP_W,
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
    const id = this.editId;
    this.editing = false;
    this.editId = null;
    this.editPageId = null;
    if (id) this.remeasureTextShapes([id]);
  }

  openGraphEditor(id: string): void {
    const v = this.views.get(id);
    if (!v || v.type !== 'graph' || v.locked) return;
    this.editing = true;
    this.graphEditId = id;
    this.graphEditOrig = v.expr ?? 'sin(x)';
    store.beginGesture();
    const bottomLeft = localToWorld(v, 0, v.h);
    this.events.onEditGraph?.({
      id,
      x: bottomLeft.x,
      y: bottomLeft.y,
      w: v.w,
      h: v.h,
      expr: v.expr ?? 'sin(x)',
    });
  }

  /** Write the locally previewed formula into the doc (export / clone / copy). */
  commitOpenGraphEditor(): boolean {
    const id = this.graphEditId;
    if (!id) return false;
    const live = this.views.get(id);
    this.commitGraph(id, live?.expr ?? this.graphEditOrig);
    this.events.onEditGraph?.(null);
    return true;
  }

  commitGraph(id: string, expr: string): void {
    if (this.graphEditId !== id) return;
    const live = this.views.get(id);
    this.editing = false;
    this.graphEditId = null;
    this.graphEditOrig = '';
    if (live && !live.locked) {
      store.patchShape(id, { expr: expr.trim() || 'sin(x)' });
    }
    store.endGesture();
    this.dirty = true;
  }

  commitGraphPreview(id: string, expr: string): void {
    if (this.graphEditId !== id) return;
    const live = this.views.get(id);
    if (!live || live.locked) return;
    // Local paint only — a doc write would be undoable and would leak a cancelled
    // formula back in on Ctrl+Z. Remotes see the curve on commit.
    this.views.set(id, { ...live, expr: expr.trim() || 'sin(x)' });
    this.dirty = true;
  }

  cancelGraphEditor(): void {
    if (this.graphEditId) {
      const live = this.views.get(this.graphEditId);
      if (live) this.views.set(this.graphEditId, { ...live, expr: this.graphEditOrig || 'sin(x)' });
    }
    this.graphEditId = null;
    this.graphEditOrig = '';
    this.editing = false;
    store.endGesture();
    this.dirty = true;
  }

  openCalculator(id: string): void {
    const v = this.views.get(id);
    if (!v || v.type !== 'calculator' || v.locked) return;
    if (this.graphEditId) this.cancelGraphEditor();
    if (this.editId) this.events.onRequestCommitText?.();
    if (this.calcEditId && this.calcEditId !== id) this.closeCalculator();
    this.editing = true;
    this.calcEditId = id;
    // Select + select-tool so resize/rotate handles are available under the
    // on-object keypad (matches “board object” geometry, not a modal dialog).
    this.setSelection([id]);
    if (this.active !== 'select' && this.active !== 'pan' && this.active !== 'lasso') {
      this.setTool('select');
    }
    store.beginGesture();
    publishFocus(id);
    this.emitCalculatorTarget(v);
    this.dirty = true;
  }

  private emitCalculatorTarget(v: ShapeView): void {
    this.events.onEditCalculator?.({
      id: v.id,
      x: v.x,
      y: v.y,
      w: v.w,
      h: v.h,
      fill: v.fill,
      stroke: v.stroke,
      strokeWidth: v.strokeWidth,
      rotation: shapeRotation(v) || undefined,
    });
  }

  /** True when the only open editor is the on-object calculator keypad. */
  private calcGeometryInteractive(): boolean {
    return Boolean(this.calcEditId && !this.editId && !this.graphEditId);
  }

  /** Keep overlay geometry in sync when the shape is moved/resized while open. */
  refreshCalculatorTarget(): void {
    if (!this.calcEditId) return;
    const v = this.views.get(this.calcEditId);
    if (!v || v.type !== 'calculator') {
      this.closeCalculator();
      return;
    }
    this.emitCalculatorTarget(v);
  }

  patchCalculator(id: string, patch: Partial<ShapeView>): void {
    if (this.calcEditId !== id) return;
    const live = this.views.get(id);
    if (!live || live.locked) return;
    store.patchShape(id, patch);
    this.dirty = true;
  }

  closeCalculator(): void {
    if (!this.calcEditId) return;
    this.calcEditId = null;
    this.editing = false;
    store.endGesture();
    publishFocus(null);
    this.events.onEditCalculator?.(null);
    this.dirty = true;
  }

  stampCalculatorResult(id: string, as: 'result' | 'expression'): void {
    const v = this.views.get(id);
    if (!v || v.type !== 'calculator' || v.locked) return;
    const display = (v.calcDisplay ?? '0').trim() || '0';
    const expr = (v.calcExpr ?? '').trim();
    const text =
      as === 'expression' && expr ? `${expr} = ${display}` : display;
    const gap = 24 / this.camera.zoom;
    // End the keypad session first so stamp is its own undo item and text
    // edit does not stack under a live calcEditId / dual overlay.
    if (this.calcEditId === id) this.closeCalculator();
    if (as === 'result') {
      const w = 160;
      const h = 100;
      const sid = store.addShape({
        type: 'sticky',
        x: v.x + v.w + gap,
        y: v.y,
        w,
        h,
        fill: COLORS.sticky,
        stroke: COLORS.stickyStroke,
        strokeWidth: 2,
        text,
        textColor: '#3a2f00',
        fontSize: defaultFontSizeFor('sticky'),
      });
      this.setSelection([sid]);
      this.setTool('select');
      this.openTextEditor(sid);
      this.events.onToast?.(t(readLocale(), 'calcStampResult'));
      return;
    }
    const fontSize = settings.text.size;
    const measured = this.measureTextWrapped(text, fontSize, TEXT_TOOL_WRAP_W, {
      bold: settings.text.bold,
      italic: settings.text.italic,
    });
    const tid = store.addShape({
      type: 'text',
      x: v.x,
      y: v.y + v.h + gap,
      w: measured.w,
      h: measured.h,
      fill: 'transparent',
      stroke: 'transparent',
      strokeWidth: 0,
      text,
      fontSize,
      textColor: settings.text.color,
      bold: settings.text.bold,
      italic: settings.text.italic,
      underline: settings.text.underline,
      strike: settings.text.strike,
      textAlign: settings.text.align,
      highlight: settings.text.highlight,
    });
    this.setSelection([tid]);
    this.setTool('select');
    this.events.onToast?.(t(readLocale(), 'calcStampExpr'));
  }

  copyCalculatorDisplay(id: string): void {
    const v = this.views.get(id);
    if (!v || v.type !== 'calculator') return;
    const text = (v.calcDisplay ?? '0').trim() || '0';
    void navigator.clipboard?.writeText(text).then(
      () => this.events.onToast?.(t(readLocale(), 'calcCopied')),
      () => this.events.onToast?.(t(readLocale(), 'calcCopyFailed'))
    );
  }

  commitText(id: string | null, text: string, target: EditTarget, richHtml?: string): void {
    if (target.tableCell && id) {
      this.commitTableCell(id, target.tableCell.row, target.tableCell.col, text);
      return;
    }
    this.editing = false;
    this.editId = null;
    const pageId = this.editPageId;
    this.editPageId = null;
    // ponytail: stored color never mutates — display adapts per viewer paper
    const color = target.color;
    const baseStyle = {
      bold: target.bold,
      italic: target.italic,
      underline: target.underline,
      strike: target.strike,
      highlight: target.highlight,
      color: color,
    };
    const cleanHtml = richHtml ? sanitizeRichHtml(richHtml) : undefined;
    const spans = cleanHtml ? htmlToSpans(cleanHtml) : parseStoredRich(text, undefined, baseStyle);
    const plain = spansToPlain(spans).replace(/\n+$/, '');
    const storeRich =
      cleanHtml && htmlStoresRichMarkup(cleanHtml, spans, baseStyle) ? cleanHtml : undefined;
    if (id === null) {
      const trimmed = plain.trim();
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
        richHtml: storeRich,
        fontSize: target.fontSize,
        textColor: color,
        bold: target.bold || undefined,
        italic: target.italic || undefined,
        underline: target.underline || undefined,
        strike: target.strike || undefined,
        textAlign: target.textAlign !== 'left' ? target.textAlign : undefined,
        highlight: target.highlight || undefined,
      }, pageId ?? undefined);
      const fontSize = target.fontSize ?? TEXT_FONT;
      const wrapW = Math.max(target.w || TEXT_TOOL_WRAP_W, fontSize * 2);
      const size = this.measureTextWrapped(trimmed, fontSize, wrapW, measureStyleFromSpans(spans, target));
      store.patchShape(newId, { w: size.w, h: size.h });
      this.setSelection([]);
    } else {
      const v = this.views.get(id);
      if (!v) return;
      if (!plain.trim() && v.type === 'text') {
        store.removeShapes([id]);
        this.setSelection([]);
        return;
      }
      const patch: Partial<ShapeView> = {
        text: v.type === 'frame' ? frameTitleLine(plain) : plain,
        richHtml: v.type === 'frame' ? '' : storeRich ?? '',
        // ponytail: persist the size the overlay edited with — shapes created
        // before fontSize existed (or imported) would otherwise drift from it.
        ...(target.fontSize !== undefined ? { fontSize: target.fontSize } : {}),
        textColor: color,
        bold: target.bold,
        italic: target.italic,
        underline: target.underline,
        strike: target.strike,
        textAlign: target.textAlign,
        highlight: target.highlight,
      };
      if (v.type === 'text') {
        // keep the user's frame width; recompute height from wrapped lines.
        // Keyboard B/I/U updates the HTML without flipping target.bold — wrap
        // from the rich spans so fully bolded text is not measured as regular.
        const fontSize = target.fontSize ?? v.fontSize ?? TEXT_FONT;
        const measure = measureStyleFromSpans(spans, target);
        const size = this.measureTextWrapped(
          plain,
          fontSize,
          Math.max(v.w, fontSize * 2),
          { bold: measure.bold, italic: measure.italic }
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
    return { w: maxW + 4, h: lines.length * fontSize * TEXT_LINE_HEIGHT };
  }

  /** Height of `text` when wrapped to `maxW`, plus the widest wrapped line. */
  measureTextWrapped(
    text: string,
    fontSize: number,
    maxW: number,
    fmt: { bold?: boolean; italic?: boolean } = {}
  ): { w: number; h: number } {
    this.ctx.font = boardFont(fontSize, fmt);
    const measure = (s: string) => measureMixedLine(this.ctx, s, fontSize);
    const lines = wrapLinesByWidth(text, maxW, measure);
    let w = 0;
    for (const line of lines) w = Math.max(w, measure(line));
    return { w: w + 4, h: Math.max(1, lines.length) * fontSize * TEXT_LINE_HEIGHT };
  }

  /** Reflow bounds after font / wrap changes on existing text shapes. */
  remeasureTextShapes(ids: string[], recordUndo = true): void {
    const patches: Array<[string, Partial<ShapeView>]> = [];
    for (const id of ids) {
      const v = this.views.get(id);
      if (!v || v.type !== 'text') continue;
      const fontSize = v.fontSize ?? TEXT_FONT;
      const spans = parseStoredRich(v.text ?? '', v.richHtml, {
        bold: v.bold,
        italic: v.italic,
        underline: v.underline,
        strike: v.strike,
        highlight: v.highlight,
        color: v.textColor,
      });
      const measure = measureStyleFromSpans(spans, v);
      const size = this.measureTextWrapped(v.text ?? '', fontSize, Math.max(v.w, fontSize * 2), {
        bold: measure.bold,
        italic: measure.italic,
      });
      const nextW = Math.max(v.w, size.w);
      const nextH = size.h;
      if (Math.abs(nextW - v.w) < 0.51 && Math.abs(nextH - v.h) < 0.51) continue;
      patches.push([id, { w: nextW, h: nextH }]);
    }
    if (patches.length) {
      if (recordUndo) store.patchShapes(patches);
      else store.patchShapesUntracked(patches);
    }
    this.dirty = true;
  }

  /** After undo/redo: reflow text to the restored font without adding another undo step. */
  remeasureAfterHistory(): void {
    this.remeasureTextShapes([...this.views.keys()], false);
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
          this.views.set(key, v);
          this.grid.upsert(key, this.spatialBox(v));
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

  /** Geometry-only keys — updating these must not poke React selection (StyleBar). */
  private static readonly GEOM_KEYS = new Set([
    'x',
    'y',
    'w',
    'h',
    'points',
    'pressures',
    'rotation',
    'fromId',
    'fromPort',
    'toId',
    'toPort',
  ]);

  private attachShape(key: string, m: Y.Map<unknown>): void {
    const existing = this.shapeObs.get(key);
    if (existing && existing.m === m) return;
    this.detachShape(key);
    const cb = (ev: Y.YMapEvent<unknown>) => {
      const v = { ...store.readShape(m), id: key };
      this.views.set(key, v);
      this.grid.upsert(key, this.spatialBox(v));
      this.dirty = true;
      if (!this.selection.has(key)) return;
      let styleish = false;
      const changed = ev?.keysChanged;
      if (!changed || changed.size === 0) {
        styleish = true;
      } else {
        changed.forEach((k) => {
          if (!Engine.GEOM_KEYS.has(k)) styleish = true;
        });
      }
      if (styleish) this.events.onSelection?.([...this.selection]);
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
    // Restore real device pixel ratio. `dpr = 1` (perf shortcut from 2026-08-30)
    // undersampled the backing store and produced crunchy / “CD pixel” aliasing,
    // especially when zoomed far out where strokes fall to sub-CSS-pixel sizes.
    // Soft-cap at 3 so extreme DPR phones do not explode GPU memory.
    const raw = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.dpr = Math.max(1, Math.min(3, raw));
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
      pressure: 'pressure' in e ? (e as PointerEvent).pressure : undefined,
      pointerType: 'pointerType' in e ? (e as PointerEvent).pointerType : 'mouse',
    };
  }

  private hasPenPointer(): boolean {
    for (const p of this.pointers.values()) if (p.type === 'pen') return true;
    return false;
  }

  private clearStylusEraserOverride(): void {
    if (!this.stylusEraserOverride) return;
    this.stylusEraserOverride = false;
    if (this.override === 'eraser') this.override = null;
    this.setCursor(this.toolCursor());
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressOrigin = null;
  }

  private armLongPress(e: PointerEvent): void {
    this.clearLongPress();
    if (e.pointerType !== 'touch' || e.button !== 0) return;
    this.longPressFired = false;
    this.longPressOrigin = { x: e.clientX, y: e.clientY, clientX: e.clientX, clientY: e.clientY };
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      if (!this.longPressOrigin || this.pointers.size !== 1 || this.editing) return;
      this.longPressFired = true;
      this.suppressToolUp = true;
      this.abortConnecting();
      if (this.pointerDown) {
        this.cancelToolDrag();
        this.pointerDown = false;
        this.toolArmed = false;
      }
      this.openContextMenuAt(this.longPressOrigin.clientX, this.longPressOrigin.clientY);
      this.longPressOrigin = null;
      this.lastTap = null;
      this.dirty = true;
    }, 500);
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.ensureStoreBound();
    const pType = e.pointerType || 'mouse';
    // Palm reject: ignore touch while a stylus contact is already active.
    if (pType === 'touch' && this.hasPenPointer()) {
      e.preventDefault();
      return;
    }
    // Stylus arrives while a non-pen contact is down — drop palm/finger contacts
    // so we do not cancel into pinch-zoom; abort the non-pen tool drag first.
    if (pType === 'pen' && this.pointers.size >= 1 && !this.hasPenPointer()) {
      this.clearLongPress();
      this.lastTap = null;
      this.abortConnecting();
      this.cancelToolDrag();
      this.pointerDown = false;
      this.toolArmed = false;
      this.pointers.clear();
      this.gesture = null;
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: pType });
    if (this.pointers.size >= 2) {
      this.clearLongPress();
      this.lastTap = null;
      // Never pinch-cancel an active stylus stroke (belt-and-suspenders vs palm filter).
      if (this.hasPenPointer()) {
        for (const [id, p] of [...this.pointers.entries()]) {
          if (p.type !== 'pen') this.pointers.delete(id);
        }
        if (this.pointers.size >= 2) {
          this.abortConnecting();
          this.cancelToolDrag();
          this.pointerDown = false;
          this.toolArmed = false;
          this.updateGesture();
          return;
        }
        // Single remaining pen — continue as a normal tool press below.
      } else {
        this.abortConnecting();
        this.cancelToolDrag();
        this.pointerDown = false;
        this.toolArmed = false;
        this.updateGesture();
        return;
      }
    }
    this.pointerDown = true;
    this.toolArmed = false;
    this.suppressToolUp = false;
    this.longPressFired = false;

    // Touch double-tap → edit (same as dblclick). Detect before arming tools.
    if (pType === 'touch' && e.button === 0 && this.lastTap && !this.editing) {
      const dt = performance.now() - this.lastTap.t;
      const dist = Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y);
      if (dt < 350 && dist < 28) {
        this.lastTap = null;
        this.clearLongPress();
        this.pointerDown = false;
        this.suppressToolUp = true;
        this.activateAtPoint(this.pointerInfo(e));
        this.dirty = true;
        return;
      }
    }

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
      const lp = this.cropWorldToBox(p.world.x, p.world.y);
      const eps = 1e-4;
      const farOutside =
        !grabbed &&
        e.button === 0 &&
        (lp.x < f.x - eps || lp.x > f.x + f.w + eps || lp.y < f.y - eps || lp.y > f.y + f.h + eps);
      if (farOutside) {
        this.cancelCrop();
        return;
      }
      this.cropPointerDown(e);
      return;
    }
    if (e.button === 1 || e.button === 2 || e.button === 4) {
      this.panDrag = true;
      this.panStart = { x: e.clientX, y: e.clientY };
      this.camera.instant = true;
      this.setCursor('grabbing');
      e.preventDefault();
      return;
    }
    // Stylus eraser tip (W3C button 5) — temporary eraser without setTool abort.
    if (pType === 'pen' && e.button === 5) {
      this.override = 'eraser';
      this.stylusEraserOverride = true;
      this.setCursor(this.toolCursor());
    }
    this.armLongPress(e);
    try {
      const info = this.pointerInfo(e);
      if (e.button === 0) {
        const plus = this.hitTablePlus(info.world.x, info.world.y);
        if (plus) {
          this.clearLongPress();
          if (this.editing) this.events.onRequestCommitText?.();
          const gv = this.views.get(plus.id);
          const grid = gv && gv.type === 'table' ? tableGrid(gv) : null;
          if (plus.kind === 'row') this.tableInsertRow(plus.id, grid ? grid.rows : undefined);
          else if (plus.kind === 'col') this.tableInsertCol(plus.id, grid ? grid.cols : undefined);
          else if (plus.kind === 'delRow') this.tableRemoveRow(plus.id, grid ? grid.rows - 1 : undefined);
          else this.tableRemoveCol(plus.id, grid ? grid.cols - 1 : undefined);
          this.pointerDown = false;
          this.dirty = true;
          return;
        }
      }
      if (this.editing) {
        // On-object calculator: allow select handles / rotate / move so the
        // frame can resize like other board shapes while the keypad is open.
        // Text/graph editors keep the hard lock (overlay is not the body).
        if (!this.calcGeometryInteractive()) {
          this.clearLongPress();
          return;
        }
        const onRotate = this.hitRotateHandle(info.screen.x, info.screen.y);
        const onHandle = onRotate ? null : this.hitHandle(info.screen.x, info.screen.y);
        const hit = this.hitTest(info.world.x, info.world.y);
        const onCalcBody = Boolean(hit && hit === this.calcEditId);
        if (onRotate || onHandle || onCalcBody) {
          this.clearLongPress();
          const target = this.tools.select;
          this.dragTool = target;
          this.toolArmed = true;
          target.onDown(this, info);
          return;
        }
        // Clicked empty board / another shape — end keypad, then handle normally.
        this.closeCalculator();
      }
      if (e.button === 0 && this.tryDocArrow(info.screen.x, info.screen.y)) {
        this.clearLongPress();
        this.pointerDown = false;
        return;
      }
      // Rotate knob wins over connect ports (north port sits near the stem).
      const onRotate = this.hitRotateHandle(info.screen.x, info.screen.y);
      const onHandle = onRotate ? null : this.hitHandle(info.screen.x, info.screen.y);
      if (!onRotate && !onHandle) {
        const portHit = this.hitPort(info.screen.x, info.screen.y);
        if (portHit && this.selection.has(portHit.shapeId) && e.button === 0) {
          this.clearLongPress();
          this.connecting = { fromId: portHit.shapeId, fromPort: portHit.port, cur: info.world };
          this.hoverPort = null;
          this.setCursor('crosshair');
          this.dirty = true;
          return;
        }
      }
      let target = this.tool;
      this.dragTool = target;
      this.toolArmed = true;
      target.onDown(this, info);
    } catch (err) {
      console.error('[review] pointerdown error:', err);
      this.events.onError?.(err instanceof Error ? err.message : String(err));
    }
    this.dirty = true;
  };

  private onPointerLeave = (): void => {
    // Keep the last world cursor in awareness — alt-tab and canvas exit must not wipe presence.
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    } else if ((e.pointerType || 'mouse') === 'touch' && this.hasPenPointer()) {
      // Untracked palm contact while inking — ignore.
      return;
    }
    if (this.longPressOrigin) {
      // Coarse fingers jitter more during a still hold — keep slop above dragThresholdPx (10).
      const moveSlop = isCoarsePointer() ? 18 : 10;
      if (Math.hypot(e.clientX - this.longPressOrigin.x, e.clientY - this.longPressOrigin.y) > moveSlop) {
        this.clearLongPress();
        this.lastTap = null;
      }
    }
    if (this.pointers.size >= 2 && this.gesture) {
      this.clearLongPress();
      this.updateGesture();
      return;
    }
    sendCursor(this.pointerInfo(e).world);
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
          const lp = this.cropWorldToBox(p.world.x, p.world.y);
          const inside =
            lp.x >= c.box.x &&
            lp.x <= c.box.x + c.box.w &&
            lp.y >= c.box.y &&
            lp.y <= c.box.y + c.box.h;
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
            for (const port of EDGE_PORTS) {
              const pp = portPos(v, port as PortId, 0);
              const d = Math.hypot(pp.x - info.world.x, pp.y - info.world.y);
              if (d < bestD) { bestD = d; best = port as PortId; }
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
      this.clampCameraToContent();
      return;
    }
    if (!this.pointerDown && !this.connecting && this.selection.size) {
      const info = this.pointerInfo(e);
      // Keep connect ports quiet while the pointer is on resize, rotate, or table [+]/[−].
      if (
        this.hitTablePlus(info.world.x, info.world.y) ||
        this.hitRotateHandle(info.screen.x, info.screen.y) ||
        this.hitHandle(info.screen.x, info.screen.y)
      ) {
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
    if (this.editing) {
      // Keep pointer routing alive for an open calculator resize/move gesture.
      if (!this.calcGeometryInteractive() && !this.pointerDown) return;
      if (!this.calcGeometryInteractive() && this.pointerDown && this.dragTool !== this.tools.select) return;
    }
    try {
      if (this.pointerDown) {
        const useCoalesced =
          e.pointerType === 'pen' && typeof e.getCoalescedEvents === 'function';
        const raw = useCoalesced ? e.getCoalescedEvents() : [];
        const batch = raw.length > 0 ? raw : [e];
        for (const ce of batch) this.dragTool.onMove(this, this.pointerInfo(ce));
      } else {
        this.tool.onHover(this, this.pointerInfo(e));
      }
    } catch (err) {
      console.error('[review] pointermove error:', err);
      this.events.onError?.(err instanceof Error ? err.message : String(err));
    }
    if (this.pointerDown || this.panDrag || this.crop || this.gesture) this.dirty = true;
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) {
      this.gesture = null;
      if (!this.panDrag) this.camera.instant = false;
    }
    const suppress = this.suppressToolUp || this.longPressFired;
    const tapOrigin = this.longPressOrigin;
    this.clearLongPress();
    this.pointerDown = false;
    this.suppressToolUp = false;

    if (suppress) {
      this.toolArmed = false;
      this.longPressFired = false;
      this.lastTap = null;
      this.clearStylusEraserOverride();
      this.dirty = true;
      return;
    }

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
            for (const port of EDGE_PORTS) {
              const pp = portPos(v, port as PortId, 0);
              const d = Math.hypot(pp.x - info.world.x, pp.y - info.world.y);
              if (d < bestD) { bestD = d; best = port as PortId; }
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
          const geom = connectedArrowGeometry(fromV, toV, fromPort, toPort, {
            strokeWidth: settings.shape.strokeWidth,
            arrowHead: settings.shape.arrowHead,
          });
          const draft = {
            type: 'arrow' as const,
            ...geom,
            fill: 'transparent',
            stroke: settings.shape.stroke,
            strokeWidth: settings.shape.strokeWidth,
            arrowHead: settings.shape.arrowHead,
            fromId,
            fromPort,
            toId,
            toPort,
          };
          const box = arrowBounds(draft as ShapeView);
          const id = store.addShape({ ...draft, ...box } as ShapeView);
          this.setSelection([id]);
        }
      } else {
        const fromV = this.views.get(fromId);
        if (fromV) {
          const a = portPos(fromV, fromPort, 0);
          const b = info.world;
          const draft = {
            type: 'arrow' as const,
            fill: 'transparent',
            stroke: settings.shape.stroke,
            strokeWidth: settings.shape.strokeWidth,
            arrowHead: settings.shape.arrowHead,
            points: [a.x, a.y, b.x, b.y],
            x: 0,
            y: 0,
            w: 1,
            h: 1,
          };
          const box = arrowBounds(draft as ShapeView);
          const id = store.addShape({ ...draft, ...box } as ShapeView);
          this.setSelection([id]);
        }
      }
      this.connecting = null;
      this.hoverPort = null;
      this.setCursor(this.toolCursor());
      this.lastTap = null;
      this.clearStylusEraserOverride();
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
      this.lastTap = null;
      this.clearStylusEraserOverride();
      this.dirty = true;
      this.events.onExportRegion?.(rect);
      return;
    }
    if (this.crop) {
      this.cropPointerUp();
      this.lastTap = null;
      this.clearStylusEraserOverride();
      return;
    }
    if (this.panDrag) {
      this.panDrag = false;
      this.camera.instant = false;
      this.clampCameraToContent();
      this.setCursor(this.toolCursor());
      if (e.button === 4) e.preventDefault();
      if (
        e.button === 2 &&
        Math.hypot(e.clientX - this.panStart.x, e.clientY - this.panStart.y) < 5 &&
        !this.editing
      ) {
        this.openContextMenu(e);
      }
      this.lastTap = null;
      this.clearStylusEraserOverride();
      return;
    }
    if (this.editing) {
      this.toolArmed = false;
      this.lastTap = null;
      this.clearStylusEraserOverride();
      return;
    }
    if (!this.toolArmed) {
      this.lastTap = null;
      this.clearStylusEraserOverride();
      return;
    }
    this.toolArmed = false;
    try {
      this.dragTool.onUp(this, this.pointerInfo(e));
    } catch (err) {
      console.error('[review] pointerup error:', err);
      this.events.onError?.(err instanceof Error ? err.message : String(err));
    }
    this.clearStylusEraserOverride();
    // Short touch tap → candidate for double-tap edit.
    if (
      e.pointerType === 'touch' &&
      e.button === 0 &&
      tapOrigin &&
      Math.hypot(e.clientX - tapOrigin.x, e.clientY - tapOrigin.y) < (isCoarsePointer() ? 12 : 10)
    ) {
      this.lastTap = { t: performance.now(), x: e.clientX, y: e.clientY };
    } else if (e.pointerType === 'touch') {
      this.lastTap = null;
    }
    this.dirty = true;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    // Wheel / trackpad scroll always zooms (pan is Space/MMB/hand only).
    const dy = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    this.camera.zoomAt(sx, sy, this.w / 2, this.h / 2, Math.exp(-dy * 0.0022));
    this.clampCameraToContent();
    this.dirty = true;
  };

  private onDblClick = (e: MouseEvent): void => {
    if (this.editing) return;
    this.activateAtPoint(this.pointerInfo(e));
  };

  /** Shared edit entry for dblclick (mouse) and double-tap (touch). */
  private activateAtPoint(p: PointerInfo): void {
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
    if (type === 'calculator') {
      this.openCalculator(id);
      return;
    }
    if (type === 'table' && id) {
      const tv = this.views.get(id);
      if (tv) {
        const cell = tableCellAt(tv, p.world.x, p.world.y);
        this.openTableCellEditor(id, cell.row, cell.col);
      }
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

  /** Abort connector + in-progress tool pointer without touching crop / export pick. */
  private abortConnecting(): void {
    if (!this.connecting) return;
    this.connecting = null;
    this.hoverPort = null;
    this.setCursor(this.toolCursor());
  }

  private abortPointerGesture(): void {
    this.abortConnecting();
    if (this.pointerDown) {
      this.cancelToolDrag();
      this.pointerDown = false;
      this.toolArmed = false;
      this.pointers.clear();
      this.gesture = null;
    }
    this.clearStylusEraserOverride();
  }

  /** Palm reject / capture loss must not commit a connector or export region. */
  private onPointerCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    this.clearLongPress();
    this.lastTap = null;
    this.suppressToolUp = false;
    this.longPressFired = false;
    if (this.pointers.size < 2) {
      this.gesture = null;
      if (!this.panDrag) this.camera.instant = false;
    }
    this.abortConnecting();
    if (this.pointerDown) {
      this.cancelToolDrag();
      this.pointerDown = false;
      this.toolArmed = false;
    }
    if (this.exportPick) {
      this.exportAnchor = null;
      this.exportRect = null;
    }
    if (this.panDrag) {
      this.panDrag = false;
      this.camera.instant = false;
    }
    this.clearStylusEraserOverride();
    this.setCursor(this.toolCursor());
    this.dirty = true;
  };

  /** Drop crop, export pick, connector, and in-progress tool without committing. */
  private cancelTransientUi(): void {
    if (this.crop) this.cancelCrop();
    if (this.exportPick) this.cancelExportPick();
    this.abortPointerGesture();
    this.dirty = true;
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
      this.camera.instant = true;
      if (this.gesture.dist > 1 && dist > 1) {
        this.camera.zoomAt(mx, my, this.w / 2, this.h / 2, dist / this.gesture.dist);
      }
      this.camera.panBy(mid.x - this.gesture.mid.x, mid.y - this.gesture.mid.y);
      this.clampCameraToContent();
    }
    this.gesture = { dist, mid };
    this.dirty = true;
  }

  setErasePreview(whole: Set<string>, partial: Map<string, Set<number>>): void {
    this.erasing = whole;
    this.partialErase = partial;
    this.dirty = true;
  }

  noteEraseAt(world: { x: number; y: number }): void {
    this.lastEraseAt = world;
  }

  commitErase(): void {
    if (settings.eraser.mode === 'partial') this.applyPartialErase();
    else if (this.erasing.size) store.removeShapes([...this.erasing]);
    this.erasing = new Set();
    this.partialErase = new Map();
    this.lastEraseAt = null;
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
        if (pts.length < 2) {
          store.removeShapes([id]);
          continue;
        }
        // Two-point straight line: mid-hit marks both ends — split around the brush.
        if (pts.length === 4 && indices.has(0) && indices.has(1)) {
          const ax = pts[0];
          const ay = pts[1];
          const bx = pts[2];
          const by = pts[3];
          const len = Math.hypot(bx - ax, by - ay) || 1;
          const ux = (bx - ax) / len;
          const uy = (by - ay) / len;
          let mx = (ax + bx) / 2;
          let my = (ay + by) / 2;
          const brush = this.lastEraseAt;
          if (brush) {
            const t = Math.max(0, Math.min(1, ((brush.x - ax) * ux + (brush.y - ay) * uy) / len));
            mx = ax + ux * t * len;
            my = ay + uy * t * len;
          }
          const gap = Math.max(v.strokeWidth, 8);
          const a2x = mx - ux * gap;
          const a2y = my - uy * gap;
          const b1x = mx + ux * gap;
          const b1y = my + uy * gap;
          const style = {
            fill: 'transparent',
            stroke: v.stroke,
            strokeWidth: v.strokeWidth,
            alpha: v.alpha,
          };
          const seg0 = [ax, ay, a2x, a2y];
          const seg1 = [b1x, b1y, bx, by];
          const p0 = v.pressures?.[0];
          const p1 = v.pressures?.[1] ?? p0;
          store.patchShape(id, {
            points: seg0,
            pressures: p0 !== undefined ? [p0, p0] : [],
            ...this.penBox(seg0, v.strokeWidth),
          });
          store.addShape({
            type: 'pen',
            ...style,
            points: seg1,
            pressures: p1 !== undefined ? [p1, p1] : undefined,
            ...this.penBox(seg1, v.strokeWidth),
          });
          continue;
        }
        const segments = splitStrokeByErasedIndices(pts, v.pressures, indices);
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
        store.patchShape(id, {
          points: segments[0]!.points,
          pressures: segments[0]!.pressures ?? [],
          ...this.penBox(segments[0]!.points, v.strokeWidth),
        });
        for (let s = 1; s < segments.length; s++) {
          store.addShape({
            type: 'pen',
            ...style,
            points: segments[s]!.points,
            pressures: segments[s]!.pressures,
            ...this.penBox(segments[s]!.points, v.strokeWidth),
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
      if (!v) continue;
      if (v.type === 'pen' && v.points && v.points.length >= 2) {
        if (polylineHitsPolygon(v.points, pts)) ids.push(id);
        continue;
      }
      if (v.type === 'arrow') {
        const poly = arrowHitPolyline(v);
        if (poly.length >= 2 && polylineHitsPolygon(poly, pts)) ids.push(id);
        continue;
      }
      const probes = shapeLassoProbes(v);
      if (probes.some((p) => pointInPolygon(p.x, p.y, pts))) {
        ids.push(id);
        continue;
      }
      if (pts.some((p) => pointInShape(v, p.x, p.y))) ids.push(id);
    }
    return ids;
  }

  private cropHost(): ShapeView | null {
    return this.crop ? this.views.get(this.crop.id) ?? null : null;
  }

  /** Pointer in the crop box's unrotated frame (same space as `crop.box`). */
  private cropWorldToBox(wx: number, wy: number): { x: number; y: number } {
    const v = this.cropHost();
    if (!v || !shapeRotation(v)) return { x: wx, y: wy };
    const p = worldToLocal(v, wx, wy);
    return { x: v.x + p.x, y: v.y + p.y };
  }

  private cropLocalDelta(from: { x: number; y: number }, to: { x: number; y: number }): { dx: number; dy: number } {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const v = this.cropHost();
    const rot = v ? shapeRotation(v) : 0;
    if (!rot) return { dx, dy };
    const rad = -degToRad(rot);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
  }

  private cropPointerDown(e: PointerEvent): void {
    const c = this.crop;
    if (!c) return;
    const p = this.pointerInfo(e);
    const h = this.cropHitHandle(p.screen.x, p.screen.y);
    const lp = this.cropWorldToBox(p.world.x, p.world.y);
    if (h) {
      c.mode = h;
    } else if (lp.x >= c.box.x && lp.x <= c.box.x + c.box.w && lp.y >= c.box.y && lp.y <= c.box.y + c.box.h) {
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
    const { dx, dy } = this.cropLocalDelta(c.start, p.world);
    if (c.mode === 'move') {
      let x = c.origBox.x + dx;
      let y = c.origBox.y + dy;
      x = Math.max(minX, Math.min(x, maxX - c.origBox.w));
      y = Math.max(minY, Math.min(y, maxY - c.origBox.h));
      c.box = { x, y, w: c.origBox.w, h: c.origBox.h };
    } else {
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
    const v = this.cropHost();
    const z = this.camera.zoom;
    const ox = this.w / 2 - this.camera.x * z;
    const oy = this.h / 2 - this.camera.y * z;
    const wx = (sx - ox) / z;
    const wy = (sy - oy) / z;
    let best: HandleId | null = null;
    let bestD = Infinity;
    for (const handle of HANDLES) {
      const [fx, fy] = HANDLE_POS[handle];
      const localX = c.box.x - (v?.x ?? 0) + fx * c.box.w;
      const localY = c.box.y - (v?.y ?? 0) + fy * c.box.h;
      const world = v ? localToWorld(v, localX, localY) : { x: c.box.x + fx * c.box.w, y: c.box.y + fy * c.box.h };
      const hx = world.x * z + ox;
      const hy = world.y * z + oy;
      const d = Math.hypot(hx - sx, hy - sy);
      if (d < bestD) {
        bestD = d;
        best = handle;
      }
    }
    if (bestD <= 22) return best;
    const lp = this.cropWorldToBox(wx, wy);
    const slop = 16 / z;
    const nearL = Math.abs(lp.x - c.box.x) <= slop;
    const nearR = Math.abs(lp.x - (c.box.x + c.box.w)) <= slop;
    const nearT = Math.abs(lp.y - c.box.y) <= slop;
    const nearB = Math.abs(lp.y - (c.box.y + c.box.h)) <= slop;
    const inX = lp.x >= c.box.x - slop && lp.x <= c.box.x + c.box.w + slop;
    const inY = lp.y >= c.box.y - slop && lp.y <= c.box.y + c.box.h + slop;
    let h = '';
    if (nearT && inX) h += 'n';
    else if (nearB && inX) h += 's';
    if (nearL && inY) h += 'w';
    else if (nearR && inY) h += 'e';
    return (h || null) as HandleId | null;
  }

  private drawCropOverlay(ctx: CanvasRenderingContext2D): void {
    const c = this.crop;
    if (!c) return;
    const v = this.views.get(c.id);
    if (!v) return;
    const s = 1 / this.camera.zoom;
    ctx.save();
    withShapeRotation(ctx, v, () => {
    const img = getImage(v.src ?? '');
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.globalAlpha = 0.35;
      ctx.drawImage(img, c.full.x, c.full.y, c.full.w, c.full.h);
      ctx.globalAlpha = 1;
      const fx = ((c.box.x - c.full.x) / c.full.w) * img.naturalWidth;
      const fy = ((c.box.y - c.full.y) / c.full.h) * img.naturalHeight;
      const fw = (c.box.w / c.full.w) * img.naturalWidth;
      const fh = (c.box.h / c.full.h) * img.naturalHeight;
      if (fw > 0 && fh > 0) {
        ctx.drawImage(img, fx, fy, fw, fh, c.box.x, c.box.y, c.box.w, c.box.h);
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
    });
    ctx.restore();
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  /** Block browser back/forward / middle-click defaults while using those buttons to pan. */
  private onAuxClick = (e: MouseEvent): void => {
    if (e.button === 1 || e.button === 4) e.preventDefault();
  };

  private openContextMenu(e: PointerEvent): void {
    this.openContextMenuAt(e.clientX, e.clientY);
  }

  private openContextMenuAt(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const world = this.camera.screenToWorld(sx, sy, this.w / 2, this.h / 2);
    this.pasteAt = world;
    let id = this.hitTest(world.x, world.y);
    if (!id) id = this.hitSelectedBounds(world.x, world.y);
    const sp = this.worldToScreen(world.x, world.y);
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
    if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
    }
    if (document.querySelector('.sheet-root:not(.is-leaving), .ctx-menu, .info-modal, .export-root, .join-prompt-root')) return;
    if (this.crop) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelTransientUi();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.applyCrop();
      }
      return;
    }
    if (this.exportPick) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelTransientUi();
      }
      return;
    }
    if (this.editing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === ' ') {
      // Always arm temp pan (except inputs / open sheets above). Do not skip when
      // focus is still on a toolbar button after picking a tool — that early
      // return made the first Space hold keep the prior tool until a second press.
      e.preventDefault();
      this.spaceHeld = true;
      if (this.override !== 'pan') {
        this.override = 'pan';
        this.setCursor(this.toolCursor());
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      const picking = this.exportPick;
      this.cancelTransientUi();
      if (!picking) this.setSelection([]);
      return;
    }
    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) store.undoManager.redo();
      else store.undoManager.undo();
      this.remeasureAfterHistory();
      this.events.onSelection?.([...this.selection]);
      return;
    }
    if (mod && e.code === 'KeyY') {
      e.preventDefault();
      store.undoManager.redo();
      this.remeasureAfterHistory();
      this.events.onSelection?.([...this.selection]);
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
      // ponytail: let native 'paste' handle system images (Discord, screenshot) and shapes marker
      // internal fallback is in onPaste → pasteSelection()
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
    if (mod && e.code === 'Digit1') {
      e.preventDefault();
      this.fitContent();
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
      const id = [...this.selection][0];
      const type = this.views.get(id)?.type;
      if (type === 'graph') this.openGraphEditor(id);
      else if (type === 'calculator') this.openCalculator(id);
      else if (type === 'image') this.startCropSelected();
      else this.openTextEditor(id);
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
      // ponytail: KeyH hides the UI chrome (never a tool bind — see keybindings)
      if (e.code === 'KeyH') {
        this.events.onToggleUi?.();
        return;
      }
      const toolBinds = getToolBinds();
      for (const [tool, bind] of Object.entries(toolBinds) as Array<[ToolId, string]>) {
        if (bind && bind === e.code) {
          this.setTool(tool);
          return;
        }
      }
      // Fallback defaults only when the user has not cleared that tool's bind.
      const fallback = TOOL_KEYS_FALLBACK[e.code];
      if (fallback && !toolBindExplicitlyCleared(fallback, toolBinds)) {
        const owned = (Object.entries(toolBinds) as Array<[ToolId, string]>).some(
          ([tool, bind]) => bind === e.code && tool !== fallback
        );
        if (!owned) {
          this.setTool(fallback);
          return;
        }
      }
      // color binds — Digit1..5 = color №1..5 (slot index -> pen slot color)
      const colorBinds = getColorBinds();
      for (const [slot, bind] of Object.entries(colorBinds)) {
        if (bind === e.code) {
          const slots = readPenSlots();
          const idx = Number(slot);
          const color = slots[idx] ?? slots[0];
          updatePenSettings({ color });
          updateShapeSettings({ stroke: color, fill: color });
          // also patch selected shapes
          const patches: Array<[string, Partial<import('../core/shapes').ShapeView>]> = [];
          for (const id of this.selection) {
            const v = this.views.get(id);
            if (!v || v.locked) continue;
            if (v.type === 'pen') patches.push([id, { stroke: color }]);
            else if (['rect','ellipse','diamond','frame','triangle','parallelogram','hexagon','cylinder','terminator','subroutine','display','table'].includes(v.type)) patches.push([id, { fill: color, stroke: color }]);
            else if (v.type === 'sticky') patches.push([id, { fill: color }]);
            else if (v.type === 'text' || v.type === 'arrow') patches.push([id, { stroke: color, textColor: color }]);
          }
          if (patches.length) store.patchShapes(patches);
          return;
        }
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') this.clearSpacePan();
  };

  /** Space-to-pan and middle-button pan stick if keyup/pointerup never arrives (alt-tab). */
  private clearSpacePan(): void {
    this.spaceHeld = false;
    if (this.override === 'pan') {
      this.override = null;
      this.setCursor(this.toolCursor());
      this.dirty = true;
    }
  }

  private onWindowBlur = (): void => {
    this.clearHeldPan();
  };

  private onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') this.clearHeldPan();
  };

  private clearHeldPan(): void {
    this.clearSpacePan();
    if (this.panDrag) {
      this.panDrag = false;
      this.camera.instant = false;
      this.setCursor(this.toolCursor());
      this.dirty = true;
    }
  }

  private loop = (t: number): void => {
    try {
      const dt = Math.min((t - this.lastT) / 1000 || 0.016, 0.05);
      this.lastT = t;
      this.frameDt = dt;
      this.camera.update(dt);
      this.updateConfetti(dt);
      const moved =
        Math.abs(this.camera.x - this.lastCam.x) > 0.0005 ||
        Math.abs(this.camera.y - this.lastCam.y) > 0.0005 ||
        Math.abs(this.camera.zoom - this.lastCam.z) > 0.00001;
      // Pin field is disabled (`if (false && orbitLive)` in render). Do not
      // dirty on a timer for the static screen vignette — that forced full-board
      // paints ~12.5fps while idle on Orbit paper. Re-enable a pulse only
      // together with drawOrbitPaperField.
      if (moved || this.dirty || this.peersAnimating) {
        const paintPeers = this.peersAnimating;
        const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
        this.render();
        if (paintPeers && typeof performance !== 'undefined') {
          notePeerRenderDt((performance.now() - t0) / 1000, {
            peersAnimating: paintPeers,
            dirty: this.dirty,
            peerCount: this.remotePeers.length,
            shapeCount: this.views.size,
          });
        }
      }
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
    const paperBg = this.paperFill;
    const theme = themeFor(paperBg);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const orbitPaper = orbitPaperActive(this.paperTo, paperBg);
    const orbitLive = orbitPaper && isOrbitChromeLive();
    // Transparent only when Warp atmosphere is under the canvas; otherwise solid void / paper.
    if (orbitLive) {
      ctx.clearRect(0, 0, w, h);
    } else if (orbitPaper) {
      ctx.fillStyle = ORBIT_PAPER;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = paperBg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(z, z);
    ctx.translate(-cx, -cy);
     if (false && orbitLive && this.frameDt < 0.05) {
      drawOrbitPaperField(ctx, {
        cx,
        cy,
        zoom: z,
        viewW: w,
        viewH: h,
        now: performance.now(),
        reduceMotion: reduce,
      });
    }
    // Grid stays optional via meta — Orbit only retints the lines.
    if (store.metaGrid()) {
      this.drawGrid(ctx, orbitLive ? orbitGridColor() : theme.grid);
    }
    const vis: ShapeBox = { x: cx - w / 2 / z, y: cy - h / 2 / z, w: w / z, h: h / z };
    const visible = this.grid.query(vis);
    const pageId = store.currentPageId();
    const peerWhole = new Set<string>();
    const peerPartial = new Map<string, Set<number>>();
    for (const peer of this.remotePeers) {
      if (peer.page != null && peer.page !== pageId) continue;
      const ep = peer.erasePreview;
      if (!ep) continue;
      for (const id of ep.whole) {
        if (!this.erasing.has(id)) peerWhole.add(id);
      }
      if (ep.partial) {
        for (const [id, indices] of Object.entries(ep.partial)) {
          if (this.erasing.has(id) || this.partialErase.has(id)) continue;
          let set = peerPartial.get(id);
          if (!set) {
            set = new Set<number>();
            peerPartial.set(id, set);
          }
          for (const i of indices) set.add(i);
        }
      }
    }
    const zInv = 1 / this.camera.zoom;
    const draw = (v: ShapeView) => {
      // hide canvas text of the shape being edited — the overlay renders it.
      // Calculator: keep display+keys on canvas; hide only overlay-owned header
      // chrome (mode label) so open tabs do not ghost a second “Standard”.
      const hideText =
        (this.editing && this.editId === v.id) ||
        (v.type === 'calculator' && this.calcEditId === v.id);
      // tables hide only the edited cell so the rest stays visible while typing
      const active = hideText && v.type === 'table' ? this.tableActive.get(v.id) : undefined;
      const hideCell = active ? { row: active.r, col: active.c } : undefined;
      const partial = this.partialErase.get(v.id) ?? peerPartial.get(v.id);
      const wholeErase = this.erasing.has(v.id) || peerWhole.has(v.id);
      if (partial && partial.size && !wholeErase) {
        const pts = v.points ?? [];
        const segments: number[][] = [];
        let cur: number[] = [];
        for (let i = 0; i < pts.length; i += 2) {
          if (partial.has(i / 2)) {
            if (cur.length >= 2) segments.push(cur);
            cur = [];
          } else {
            cur.push(pts[i], pts[i + 1]);
          }
        }
        if (cur.length >= 2) segments.push(cur);
        for (const seg of segments) {
          if (seg.length >= 2) {
            drawPenStroke(ctx, seg, v.strokeWidth, displayInk(v.stroke, paperBg), v.alpha ?? 1, undefined, {
              bloom: orbitLive,
            });
          }
        }
        return;
      }
      if (wholeErase) {
        ctx.save();
        ctx.globalAlpha = 0.32;
        drawShape(ctx, v, theme.text, paperBg, hideText, hideCell);
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = '#c96a62';
        ctx.lineWidth = 2.2 * zInv;
        ctx.setLineDash([7 * zInv, 5 * zInv]);
        withShapeRotation(ctx, v, () => {
          ctx.strokeRect(v.x - 3 * zInv, v.y - 3 * zInv, v.w + 6 * zInv, v.h + 6 * zInv);
          ctx.fillStyle = 'rgba(201,106,98,0.14)';
          ctx.fillRect(v.x - 3 * zInv, v.y - 3 * zInv, v.w + 6 * zInv, v.h + 6 * zInv);
        });
        ctx.restore();
      } else {
        drawShape(ctx, v, theme.text, paperBg, hideText, hideCell);
      }
    };
    const ord = store.order;
    // Single pass in stacking order so highlighters respect bring-to-front / send-to-back.
    for (let i = 0; i < ord.length; i++) {
      const id = ord.get(i);
      if (!visible.has(id) || !store.isOnActivePage(id)) continue;
      const v = this.views.get(id);
      if (v) draw(v);
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
    this.drawConfetti(ctx);
    ctx.restore();
    if (orbitLive) {
      drawOrbitPaperScreen(ctx, w, h, performance.now(), reduce);
    }
    this.drawPeerMirrors(ctx);
    this.lastCam = { x: cx, y: cy, z };
    // Opaque paper fill covers Warp; Orbit live clears and must keep shader running.
    this.syncOrbitWarpCovered(!orbitLive);
    this.dirty = u < 1 || this.peersAnimating;
  }

  private drawPeers(ctx: CanvasRenderingContext2D): void {
    this.peersAnimating = false;
    if (!this.remotePeers.length) return;
    const s = 1 / this.camera.zoom;
    const dt = this.frameDt;
    const reduce = this.reduceMotion;
    const smooth = this.smoothPeerCursors && !reduce;
    // Softer catch-up so a prediction miss on a new sample does not pop.
    const smoothTime = 0.1;
    // Dead-reckon: realtime uses a longer bridge for occasional WS/main-thread stalls.
    const leadSec = smooth ? 0.04 : REALTIME_LEAD_SEC;
    // Realtime pose is already snapped past leadSec — no need for the longer
    // spring-trail hold (0.14s) that kept full-board paints hot on a frozen glyph.
    const holdSec = smooth ? PEER_MOTION_HOLD_SEC : PEER_MOTION_REALTIME_HOLD_SEC;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const myPage = store.currentPageId();
    const outline = peerToolOutline(this.paperFill || store.viewPaperBg());
    const glyph = 20 * s;
    const boardBg = this.paperFill || store.viewPaperBg();

    for (const peer of this.remotePeers) {
      // Hide cursors of people on another sub-page (missing page → show everywhere).
      if (peer.page != null && peer.page !== myPage) continue;
      // Away (alt-tab, home, minimized): connection alive but not on the board — hide the frozen cursor.
      // Missing flag (old clients) means viewing, so this stays backward compatible.
      if (peer.viewing === false) continue;

      if (peer.draft && peer.draft.points.length >= 4) {
        const d = peer.draft;
        drawPenStroke(
          ctx,
          d.points,
          d.strokeWidth,
          displayInk(d.stroke, boardBg),
          d.alpha ?? 0.85,
          undefined,
          { bloom: orbitPaperActive(boardBg, boardBg) }
        );
        // Do not set peersAnimating from a static draft — setPeers already
        // dirties when tip/geometry changes (peerDraftPaintDirty). Keeping the
        // flag hot forced full-board paints after the tip went stable.
      }

      if (peer.erasePreview) {
        const ep = peer.erasePreview;
        ctx.save();
        ctx.strokeStyle = peer.color;
        ctx.lineWidth = 2 * s;
        ctx.setLineDash([4 * s, 3 * s]);
        ctx.beginPath();
        ctx.arc(ep.x, ep.y, ep.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        // Same as drafts: erase motion dirties via setPeers / samePeerErasePreview.
      }

      if (peer.focus) {
        const fv = this.views.get(peer.focus);
        if (fv && fv.type === 'calculator') {
          ctx.save();
          ctx.strokeStyle = peer.color || '#7c8cff';
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 2.5 * s;
          ctx.setLineDash([]);
          const pad = 4 * s;
          ctx.beginPath();
          ctx.roundRect(fv.x - pad, fv.y - pad, fv.w + pad * 2, fv.h + pad * 2, 14);
          ctx.stroke();
          ctx.restore();
        }
      }

      if (peer.selection?.length) {
        const color = peer.color || '#7c8cff';
        const focusId = peer.focus;
        for (const sid of peer.selection) {
          // Calc focus already draws a soft ring — skip duplicate on that id.
          if (focusId && sid === focusId) {
            const fv = this.views.get(sid);
            if (fv?.type === 'calculator') continue;
          }
          const v = this.views.get(sid);
          if (!v) continue;
          ctx.save();
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 2.25 * s;
          ctx.setLineDash([]);
          const pad = 3 * s;
          if (v.type === 'pen' || v.type === 'arrow') {
            ctx.strokeRect(v.x - pad, v.y - pad, v.w + pad * 2, v.h + pad * 2);
          } else {
            withShapeRotation(ctx, v, () => {
              ctx.beginPath();
              ctx.roundRect(v.x - pad, v.y - pad, v.w + pad * 2, v.h + pad * 2, 8 * s);
              ctx.stroke();
            });
          }
          ctx.restore();
        }
      }

      if (peer.x === null || peer.y === null) continue;
      let pos = this.peerLerp.get(peer.id);
      if (!pos) {
        pos = initPeerMotion(peer.x, peer.y, now);
        this.peerLerp.set(peer.id, pos);
      }

      if (smooth) {
        // Age-based dead-reckon (no between-packet retract) + soft spring.
        const aim = aimPeerMotion(pos, now, { leadSec, maxLead: 14 * s });
        stepPeerMotion(pos, aim.x, aim.y, now, dt, smoothTime);
      } else if (reduce) {
        snapPeerMotionToSample(pos);
      } else {
        // Realtime: short dead-reckon, no spring trail — bridges WS gaps
        // without the laggy smooth-follow delay.
        applyRealtimePeerPose(pos, now, { leadSec, maxLead: 14 * s });
      }

      const screen = this.worldToScreen(pos.x, pos.y);
      const edgePad = 40;
      const onScreen =
        screen.x >= edgePad &&
        screen.x <= this.w - edgePad &&
        screen.y >= edgePad &&
        screen.y <= this.h - edgePad;
      if (!onScreen) continue;

      // Hold frames between awareness packets so brief gaps do not freeze the
      // glyph at packet rate (realtime uses dead-reckon; smooth uses spring).
      if (!reduce && peerMotionShouldAnimate(pos, now, holdSec)) this.peersAnimating = true;

      const fill = peer.color || '#7c8cff';
      const icon = peerToolIcon(peer.tool);

      ctx.save();
      ctx.translate(pos.x, pos.y);

      paintPeerToolGlyph(ctx, icon, glyph, fill, outline, 1.4 * s);

      const label = peer.name;
      ctx.font = `500 ${11 * s}px ${BOARD_TYPEFACE}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = fill;
      ctx.fillText(label, glyph * 0.62, -glyph * 0.48);

      ctx.restore();
    }
  }

  /** Edge name pills for peers off-screen or on another sub-page. */
  private drawPeerMirrors(ctx: CanvasRenderingContext2D): void {
    if (!this.remotePeers.length) return;
    const { w, h } = this;
    const edgePad = 36;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const myPage = store.currentPageId();
    const pages = store.listPages();
    const reduce = this.reduceMotion;
    const smooth = this.smoothPeerCursors && !reduce;
    const holdSec = smooth ? PEER_MOTION_HOLD_SEC : PEER_MOTION_REALTIME_HOLD_SEC;

    for (const peer of this.remotePeers) {
      if (peer.x === null || peer.y === null) continue;
      // ponytail: other page → no mirror pill, only PageBar dot
      if (peer.page != null && peer.page !== myPage) continue;
      const samePage = peer.page == null || peer.page === myPage;

      // Prefer the pose drawPeers already stepped this frame. Stepping again
      // ran the spring at 2× and made remote cursors look choppy. Only advance
      // here for away peers (drawPeers skips them before the spring).
      let pos = this.peerLerp.get(peer.id);
      if (!pos) {
        pos = initPeerMotion(peer.x, peer.y, now);
        this.peerLerp.set(peer.id, pos);
      }
      if (peer.viewing === false) {
        if (smooth) {
          const aim = aimPeerMotion(pos, now, { leadSec: 0.04, maxLead: 14 / this.camera.zoom });
          stepPeerMotion(pos, aim.x, aim.y, now, this.frameDt, 0.1);
        } else if (reduce) {
          snapPeerMotionToSample(pos);
        } else {
          applyRealtimePeerPose(pos, now, {
            leadSec: REALTIME_LEAD_SEC,
            maxLead: 14 / this.camera.zoom,
          });
        }
      }

      const screen = this.worldToScreen(pos.x, pos.y);
      const onScreen =
        screen.x >= edgePad &&
        screen.x <= w - edgePad &&
        screen.y >= edgePad &&
        screen.y <= h - edgePad;
      if (samePage && onScreen) continue;

      const cx = w / 2;
      const cy = h / 2;
      const dx = screen.x - cx;
      const dy = screen.y - cy;
      let edgeX = screen.x;
      let edgeY = screen.y;
      if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
        const halfW = w / 2 - edgePad;
        const halfH = h / 2 - edgePad;
        const scale = Math.min(halfW / Math.abs(dx), halfH / Math.abs(dy));
        edgeX = cx + dx * scale;
        edgeY = cy + dy * scale;
      } else {
        edgeX = w - edgePad;
        edgeY = cy;
      }

      const fill = peer.color || '#7c8cff';
      const alpha = peer.viewing === false ? 0.72 : 1;
      const pageIdx = peer.page ? pages.indexOf(peer.page) + 1 : 1;
      const pageSuffix = !samePage && pageIdx > 0 ? ` · ${pageIdx}` : '';
      const label = peer.name + pageSuffix;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(edgeX, edgeY);
      ctx.font = `600 11px ${BOARD_TYPEFACE}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(label).width;
      const pillPadX = 8;
      const pillH = 22;
      const pillW = tw + pillPadX * 2;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(-pillW / 2, -pillH / 2, pillW, pillH, pillH / 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, 0, 0);
      ctx.restore();
      // Only keep the loop alive while the pill still needs motion frames —
      // static away/off-screen labels must not force full-board paints forever.
      if (!reduce && peerMotionShouldAnimate(pos, now, holdSec)) this.peersAnimating = true;
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
    // Text/graph editors hide selection chrome; calculator keeps it so the
    // on-object keypad can still be resized/rotated like other board shapes.
    if (this.editing && !this.calcGeometryInteractive()) return;
    if (this.active !== 'select' && this.override !== 'select') return;
    const s = 1 / this.camera.zoom;
    const pad = 2 * s;
    const line = 1.5 * s;
    const hr = handleDrawRadiusScale() * s;
    const orbit = orbitPaperActive(this.paperTo || store.viewPaperBg(), this.paperFill || store.viewPaperBg());
    const handleFill = orbit ? '#04052E' : '#ffffff';
    ctx.save();
    ctx.lineJoin = 'round';
    // ponytail: multi-select → thick group + thin solid per-object, same color, zoom-stable
    if (this.selection.size > 1) {
      // thin per-object — solid, same color as group, zoom-stable
      for (const id of this.selection) {
        const v = this.views.get(id);
        if (!v) continue;
        const aabb = v.type === 'pen' || v.type === 'arrow' ? { x: v.x, y: v.y, w: v.w, h: v.h } : rotatedAabb(v);
        const x = aabb.x - pad * 0.7;
        const y = aabb.y - pad * 0.7;
        const w = aabb.w + pad * 1.4;
        const h = aabb.h + pad * 1.4;
        ctx.strokeStyle = COLORS.selection;
        ctx.lineWidth = 1.15 * s;
        ctx.strokeRect(x, y, w, h);
      }
      const box = this.selectionBounds();
      if (box) {
        const x = box.x - pad;
        const y = box.y - pad;
        const w = box.w + pad * 2;
        const h = box.h + pad * 2;
        ctx.strokeStyle = orbit ? 'rgba(4, 5, 46, 0.75)' : 'rgba(28, 28, 26, 0.7)';
        ctx.lineWidth = 3.2 * s;
        ctx.strokeRect(x, y, w, h);
        ctx.strokeStyle = COLORS.selection;
        ctx.lineWidth = 2.4 * s;
        ctx.strokeRect(x, y, w, h);
        const hasUnlocked = [...this.selection].some((id) => !this.views.get(id)?.locked);
        if (hasUnlocked) {
          for (const [fx, fy] of Object.values(HANDLE_POS)) {
            const hx = box.x + fx * box.w;
            const hy = box.y + fy * box.h;
            ctx.beginPath();
            ctx.arc(hx, hy, hr, 0, Math.PI * 2);
            ctx.fillStyle = handleFill;
            ctx.fill();
            ctx.strokeStyle = COLORS.selection;
            ctx.lineWidth = 1.5 * s;
            ctx.stroke();
          }
          // group rotation handle
          const topMid = readPrefs().rotateHandleTop;
          const rp = rotateHandleOnBox(box, ROTATE_HANDLE_OFFSET_PX * s, topMid);
          this.paintRotateKnob(ctx, rp.x, rp.y, hr, s, topMid);
        }
      }
      ctx.restore();
      return;
    }
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v) continue;
      withShapeRotation(ctx, v, () => {
        const x = v.x - pad;
        const y = v.y - pad;
        const w = v.w + pad * 2;
        const h = v.h + pad * 2;
        ctx.strokeStyle = orbit ? 'rgba(4, 5, 46, 0.65)' : 'rgba(28, 28, 26, 0.5)';
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
            ctx.fillStyle = handleFill;
            ctx.fill();
            ctx.strokeStyle = COLORS.selection;
            ctx.lineWidth = 1.5 * s;
            ctx.stroke();
          }
          // Rotation handle — top-middle (default) or legacy corner
          const topMid = readPrefs().rotateHandleTop;
          const local = rotateHandleLocal(v.w, v.h, ROTATE_HANDLE_OFFSET_PX * s, topMid);
          this.paintRotateKnob(ctx, v.x + local.x, v.y + local.y, hr, s, topMid);
          // ponytail: tables get FigJam-style [+]/[−] pills (push/pop row / column) + active-cell frame
          if (v.type === 'table') {
            for (const p of this.tablePlusPills(v)) {
              const px = v.x + p.lx;
              const py = v.y + p.ly;
              ctx.beginPath();
              ctx.arc(px, py, p.r, 0, Math.PI * 2);
              ctx.fillStyle = handleFill;
              ctx.fill();
              ctx.strokeStyle = COLORS.selection;
              ctx.lineWidth = 1.5 * s;
              ctx.stroke();
              const g = p.r * 0.45;
              ctx.strokeStyle = COLORS.selection;
              ctx.lineWidth = 2 * s;
              ctx.lineCap = 'round';
              ctx.beginPath();
              ctx.moveTo(px - g, py);
              ctx.lineTo(px + g, py);
              if (p.kind === 'row' || p.kind === 'col') {
                ctx.moveTo(px, py - g);
                ctx.lineTo(px, py + g);
              }
              ctx.stroke();
            }
            const a = this.tableActive.get(id);
            if (a) {
              const cr = tableCellRect(v, a.r, a.c);
              ctx.strokeStyle = COLORS.selection;
              ctx.lineWidth = 2 * s;
              ctx.strokeRect(cr.x + 1, cr.y + 1, cr.w - 2, cr.h - 2);
            }
          }
        }
      });
    }
    ctx.restore();
  }

  /**
   * Paint selection rotate affordance at world (x,y).
   * Brand-new Lucide-style rotate-cw SVG for BOTH top-middle and legacy corner —
   * legacy swirl / hand-arc paths abandoned (not morphed).
   */
  private paintRotateKnob(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    hr: number,
    s: number,
    _topMiddle: boolean
  ): void {
    const bg = store.viewPaperBg();
    const rotTheme = themeFor(bg);
    const rotStroke = rotTheme.text;
    const rotFill = withAlpha(bg, 0.94);
    ctx.save();
    ctx.translate(x, y);
    // Soft disc so the glyph stays readable on dark and light boards.
    ctx.fillStyle = rotFill;
    ctx.strokeStyle = withAlpha(rotStroke, 0.35);
    ctx.lineWidth = 1.35 * s;
    ctx.beginPath();
    ctx.arc(0, 0, hr * ROTATE_CW_DISC_RADIUS_SCALE, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    strokeRotateCwIcon(ctx, hr * ROTATE_CW_ICON_RADIUS_SCALE, rotStroke, s);
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
      if (this.active !== 'select' && this.override !== 'select') return;
      if (!this.selection.size) return;
      // ponytail: show arrow ports always for selected, not only on hover — smaller, different tone than frame handles
      showFor = [...this.selection];
    }
    const off = 18 * s;
    for (const id of showFor) {
      const v = this.views.get(id);
      if (!v || v.locked) continue;
      if (v.type === 'pen' || v.type === 'arrow') continue;
      for (const port of EDGE_PORTS) {
        const p = portPos(v, port as PortId, off);
        const isHover = this.hoverPort?.shapeId === id && this.hoverPort?.port === port;
        const isFrom = this.connecting?.fromId === id && this.connecting?.fromPort === port;
        const hot = isHover || isFrom;
        ctx.save();
        ctx.fillStyle = hot ? '#ffffff' : withAlpha(COLORS.selection, 0.62);
        ctx.strokeStyle = hot ? COLORS.selection : 'rgba(255,255,255,0.78)';
        ctx.lineWidth = 1.2 * s;
        const r = connectingActive ? (hot ? 4.2 * s : 3.1 * s) : hot ? 3.6 * s : 2.65 * s;
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
    const fromDir = worldPortDir(this.connecting.fromPort, shapeRotation(fromV));
    const dist = Math.hypot(bx - a.x, by - a.y);
    const off = Math.min(80, dist * 0.35);
    let c1x = a.x + fromDir.x * off, c1y = a.y + fromDir.y * off;
    let c2x = bx, c2y = by;
    let endAng = Math.atan2(by - a.y, bx - a.x);
    if (toPort) {
      const hv = this.views.get(this.hoverPort!.shapeId);
      const toDir = worldPortDir(toPort, hv ? shapeRotation(hv) : 0);
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
    ctx.moveTo(a.x, a.y);
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
