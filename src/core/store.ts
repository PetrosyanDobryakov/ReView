import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { COLORS, SHAPE_FONT, STICKY_FONT, TEXT_FONT, relativeLuminance, themeFor } from '../core/shapes';
import type { ShapeView, ShapeType } from '../core/shapes';
import { bumpBoardUpdated, flushBoardUpdated, getBoard, isBoardPersistedLocally } from '../core/boards';
import { loadUser } from './user';
import { readPrefs } from '../core/prefs';
import { attachSync, detachSync, publishBoardView, publishDraft, publishErasePreview } from '../net';
import { effectiveSyncUrl } from '../net/config';
import { syncClient } from '../net/client';
import { netLog } from '../net/log';
import {
  POINTS_SPACE_LOCAL,
  POINTS_SPACE_META,
  toLocalPoints,
  toWorldPoints,
} from './pointsSpace';
import {
  beginWriteGesture,
  configureWriteGate,
  endWriteGesture,
  enqueuePatch,
  enqueuePatches,
  flushNow as flushWriteGate,
  type PatchBatch,
} from './writeGate';

export const LOCAL_ORIGIN = 'local';
const LEGACY_MIGRATION_KEY = 'review-v1-migrated';

// --- per-board state ---
let currentBoardId: string | null = null;
export let doc = new Y.Doc({ gc: false } as unknown as Record<string, unknown>);
export let board = doc.getMap<Y.Map<unknown>>('shapes');
export let meta = doc.getMap('meta');
export let order = doc.getArray<string>('order');
export let pages = doc.getArray<string>('pages');
let pagesObserved = false;
const pageListeners = new Set<() => void>();
const pageListListeners = new Set<() => void>();
const activePageListeners = new Set<() => void>();
export let undoManager = new Y.UndoManager([board, order, pages], {
  trackedOrigins: new Set([LOCAL_ORIGIN]),
  captureTimeout: 200,
});
export let persistence: IndexeddbPersistence | null = null;

let lastDocLog = 0;
function logDocUpdate(size: number, origin: unknown, tr?: unknown): void {
  const now = Date.now();
  if (now - lastDocLog < 1000) return;
  lastDocLog = now;
  try {
    const changed =
      tr && typeof (tr as { changedParentTypes?: Map<unknown, unknown> }).changedParentTypes !== 'undefined'
        ? Array.from((tr as { changedParentTypes: Map<unknown, unknown> }).changedParentTypes.values()).map((v) => String((v as { constructor?: { name?: string } })?.constructor?.name ?? v))
        : [];
    netLog.debug('yjs doc update (throttled)', () => ({
      size,
      origin: String(origin ?? 'remote'),
      boardId: currentBoardId,
      shapes: board.size,
      orderLen: order.length,
      pagesLen: pages.length,
      metaKeys: Array.from(meta.keys()).join(','),
      changed: changed.join(','),
    }));
  } catch {}
}
function attachDocLog(): void {
  doc.on('update', (u: Uint8Array, o: unknown, _d: unknown, tr: unknown) => logDocUpdate(u.length, o, tr));
}
attachDocLog();

function boardPersistenceKey(id: string): string {
  return `review-v1-${id}`;
}

function pageKey(id: string | null): string {
  return id ? `review-page-${id}` : 'review-page';
}

export function getCurrentBoardId(): string | null {
  return currentBoardId;
}

function shouldPersist(boardId: string): boolean {
  return isBoardPersistedLocally(getBoard(boardId));
}

function attachPersistence(boardId: string): void {
  persistence = new IndexeddbPersistence(boardPersistenceKey(boardId), doc);
  const onSynced = () => {
    ensurePages();
    syncActivePageFromStorage();
    ensureOrder();
    migratePaper();
    migratePointsSpace();
    emitBoardReady();
    // ponytail: auto-compact huge tombstone-bloated boards (gc:false never frees deletes)
    // e.g. bmtag6hutf6x9 was 372MB with 8 shapes after mass delete
    void maybeAutoCompact();
  };
  if ((persistence as unknown as { synced: boolean }).synced) {
    onSynced();
  }
  persistence.on('synced', onSynced);
}

let compactInFlight = false;

/** Heuristic: trigger compaction when Y.Doc is bloated vs live content. */
async function maybeAutoCompact(): Promise<void> {
  if (!currentBoardId || !persistence || compactInFlight) return;
  try {
    if (syncClient.collectPeers().length > 0) {
      netLog.info('autoCompact skipped (peers present)', () => ({ boardId: currentBoardId }));
      return;
    }
    const before = Y.encodeStateAsUpdate(doc).length;
    const liveShapes = board.size;
    // thresholds: compact if >4MB total, or empty board with >1MB tombstones
    const should = before > 4 * 1024 * 1024 || (liveShapes === 0 && before > 1 * 1024 * 1024) || (liveShapes < 20 && before > 8 * 1024 * 1024);
    if (!should) return;
    netLog.info('autoCompact check', () => ({ boardId: currentBoardId, before, liveShapes }));
    const res = await compactBoard();
    if (res.didCompact) netLog.info('autoCompact done', () => res);
  } catch (e) {
    netLog.warn('autoCompact failed', () => ({ err: String(e) }));
  }
}

const boardReadyListeners = new Set<() => void>();

function emitBoardReady(): void {
  for (const l of [...boardReadyListeners]) {
    try {
      l();
    } catch {
      /* listener error */
    }
  }
}

/** Fired when IndexedDB (or a fresh ephemeral board) has shapes ready to paint. */
export function onBoardReady(cb: () => void): () => void {
  boardReadyListeners.add(cb);
  return () => {
    boardReadyListeners.delete(cb);
  };
}

function legacyMigrationDone(): boolean {
  try {
    return localStorage.getItem(LEGACY_MIGRATION_KEY) === '1';
  } catch {
    return false;
  }
}

function markLegacyMigrationDone(): void {
  try {
    localStorage.setItem(LEGACY_MIGRATION_KEY, '1');
  } catch {
    /* ignore */
  }
}

async function migrateLegacyBoard(targetPersistence: IndexeddbPersistence): Promise<void> {
  if (legacyMigrationDone()) return;
  const targetDoc = doc;
  const targetBoard = board;
  const targetOrder = order;
  const targetBoardId = currentBoardId;

  try {
    await targetPersistence.whenSynced;
  } catch {
    return;
  }
  if (doc !== targetDoc || currentBoardId !== targetBoardId || legacyMigrationDone()) return;
  if (targetBoard.size > 0 || targetOrder.length > 0) return;

  const oldDoc = new Y.Doc();
  const oldPersist = new IndexeddbPersistence('review-v1', oldDoc);
  let removeLegacyData = false;
  try {
    await oldPersist.whenSynced;
    const oldBoard = oldDoc.getMap('shapes');
    if (oldBoard.size === 0) {
      markLegacyMigrationDone();
      removeLegacyData = true;
      return;
    }
    // The current board may have loaded or changed while the legacy doc synced.
    if (doc !== targetDoc || currentBoardId !== targetBoardId || targetBoard.size > 0) return;
    Y.applyUpdate(targetDoc, Y.encodeStateAsUpdate(oldDoc));
    markLegacyMigrationDone();
    removeLegacyData = true;
  } catch {
    /* leave the legacy database available for a later attempt */
  } finally {
    try {
      if (removeLegacyData) await oldPersist.clearData();
      else await oldPersist.destroy();
    } catch {
      /* migration already succeeded, cleanup is best-effort */
    }
    oldDoc.destroy();
  }
}

/** Enable IndexedDB for the current board (after explicit Save). */
export function enableBoardPersistence(): void {
  if (!currentBoardId || persistence) return;
  attachPersistence(currentBoardId);
}

/** Attach IndexedDB when this board is open and not yet persisted (home save, etc.). */
export function persistBoardIfOpen(boardId: string): boolean {
  if (currentBoardId !== boardId || persistence) return false;
  attachPersistence(boardId);
  return true;
}

export function initBoard(boardId: string): void {
  if (currentBoardId === boardId) {
    if (shouldPersist(boardId) && !persistence) {
      attachPersistence(boardId);
      if (persistence) void migrateLegacyBoard(persistence);
    }
    return;
  }
  try { undoManager.clear(); } catch {}
  try { (undoManager as unknown as { destroy?: () => void })?.destroy?.(); } catch {}
  detachSync();
  try {
    persistence?.destroy();
  } catch {}
  // Rebind pages observer to the new doc; keep React/engine listeners.
  pagesObserved = false;
  // new doc
  try {
    doc.destroy();
  } catch {}
  doc = new Y.Doc({ gc: false } as unknown as Record<string, unknown>);
  board = doc.getMap<Y.Map<unknown>>('shapes');
  meta = doc.getMap('meta');
  order = doc.getArray<string>('order');
  pages = doc.getArray<string>('pages');
  doc.on('update', (u: Uint8Array, o: unknown, _d: unknown, tr: unknown) => logDocUpdate(u.length, o, tr));
  undoManager = new Y.UndoManager([board, order, pages], {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: 200,
  });
  currentBoardId = boardId;
  persistence = null;
  if (shouldPersist(boardId)) {
    attachPersistence(boardId);
    if (persistence) void migrateLegacyBoard(persistence);
  } else {
    // ephemeral session ��� still need pages
    ensurePages();
  }
  // Attach observer on the fresh array and refresh page UIs.
  pagesArray();
  syncActivePageFromStorage();
  lastPageListEmitKey = '';
  lastActivePageEmitKey = '';
  lastPagesEmitKey = '';
  // ponytail: was queueMicrotask — caused race where 3rd peer attached sync before local doc ready → desync/flapping.
  // Now sync attach is synchronous so Yjs can start merging immediately; UI emits are immediate too.
  emitPageList();
  emitActivePage();
  attachSync(doc, boardId);
  // Ephemeral boards never get an IDB 'synced' — still notify the engine immediately.
  if (!persistence) {
    migratePointsSpace();
    emitBoardReady();
  }
}

/** Tear down sync and clear the active board id (tab close / switch board). */
export function leaveBoard(): void {
  flushWriteGate();
  flushBoardUpdated();
  detachSync();
  currentBoardId = null;
}

/** Leave the board view but keep sync + last cursor (navigate to home, still on site). */
export function pauseBoardView(): void {
  flushWriteGate();
  flushBoardUpdated();
  publishBoardView(false);
  publishDraft(null);
  publishErasePreview(null);
}

export function ensureOrder(): void {
  const ids = new Set(board.keys());
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of order.toArray()) {
    if (!ids.has(id) || seen.has(id)) continue;
    next.push(id);
    seen.add(id);
  }
  for (const id of board.keys()) {
    if (!seen.has(id)) next.push(id);
  }
  if (next.length === order.length && next.every((id, i) => order.get(i) === id)) return;
  try { netLog.debug('ensureOrder repair', () => ({ before: order.toArray().join(','), after: next.join(','), boardSize: board.size })); } catch {}
  doc.transact(() => {
    order.delete(0, order.length);
    if (next.length) order.push(next);
  }, null);
}

export function moveOrderToFront(ids: string[]): void {
  transact(() => {
    for (const id of ids) {
      const idx = order.toArray().indexOf(id);
      if (idx >= 0) order.delete(idx, 1);
    }
    order.push(ids);
  });
}

export function moveOrderToBack(ids: string[]): void {
  transact(() => {
    for (const id of ids) {
      const idx = order.toArray().indexOf(id);
      if (idx >= 0) order.delete(idx, 1);
    }
    order.insert(0, ids);
  });
}

const PAPER_MIGRATE: Record<string, string> = {
  '#161922': '#1c1c1a',
  '#0d0f16': '#121110',
  '#2b3040': '#2c2a26',
};

export const META_TITLE = 'title';
export const META_OWNER_ID = 'ownerId';

export function metaTitle(): string | null {
  const raw = meta.get(META_TITLE);
  if (typeof raw !== 'string') return null;
  const v = raw.trim().slice(0, 40);
  return v || null;
}

export function metaOwnerId(): string | null {
  const raw = meta.get(META_OWNER_ID);
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return v || null;
}

export function setSyncedBoardTitle(title: string): void {
  const v = title.trim().slice(0, 40);
  if (!v) return;
  setMeta({ [META_TITLE]: v });
}

/**
 * First open on the creator device claims ownership and seeds synced title.
 * Joiners never write ownerId ��� they inherit it from the CRDT doc.
 */
export function seedBoardMeta(local: { name: string; status: string }): void {
  const userId = loadUser().id;
  transact(() => {
    const ownerRaw = meta.get(META_OWNER_ID);
    const hasOwner = typeof ownerRaw === 'string' && ownerRaw.trim().length > 0;
    if (!hasOwner && local.status === 'local') {
      meta.set(META_OWNER_ID, userId);
      const titleRaw = meta.get(META_TITLE);
      if (typeof titleRaw !== 'string' || !titleRaw.trim()) {
        meta.set(META_TITLE, local.name.trim().slice(0, 40) || 'ReView');
      }
      return;
    }
    const titleRaw = meta.get(META_TITLE);
    if (
      (typeof titleRaw !== 'string' || !titleRaw.trim()) &&
      hasOwner &&
      ownerRaw === userId &&
      local.status === 'local'
    ) {
      meta.set(META_TITLE, local.name.trim().slice(0, 40) || 'ReView');
    }
  });
}

export function setMeta(patch: Record<string, unknown>): void {
  transact(() => {
    for (const [key, value] of Object.entries(patch)) meta.set(key, value);
  });
}

export function metaBg(): string {
  const raw = meta.get('bg');
  const bg = typeof raw === 'string' ? raw : COLORS.background;
  return PAPER_MIGRATE[bg] ?? bg;
}

/**
 * Paper color for this client. Local prefs override synced meta so collaborators
 * can keep different papers on the same board.
 */
export function viewPaperBg(): string {
  const local = readPrefs().paperBg;
  if (typeof local === 'string') return PAPER_MIGRATE[local] ?? local;
  return metaBg();
}

export function migratePaper(): void {
  const raw = meta.get('bg');
  if (typeof raw !== 'string') return;
  const next = PAPER_MIGRATE[raw];
  if (next) setMeta({ bg: next });
}

/**
 * One-time: bake current display adaptation into stored colors.
 * Only pure black↔white is swapped: dark paper black→white, light paper white→black.
 * Returns number of shapes mutated.
 */
export function adaptInkOnce(): number {
  const bg = viewPaperBg();
  const bgL = relativeLuminance(bg);
  if (bgL == null) return 0;
  const isDarkBg = bgL < 0.12;
  const isLightBg = bgL > 0.7;
  if (!isDarkBg && !isLightBg) return 0;
  const target = themeFor(bg).text;
  let changed = 0;
  const patches: Array<[string, Partial<import('./shapes').ShapeView>]> = [];
  for (const [key, m] of board.entries()) {
    const stroke = m.get('stroke') as string | undefined;
    const textColor = m.get('textColor') as string | undefined;
    const patch: Record<string, unknown> = {};
    if (typeof stroke === 'string') {
      const l = relativeLuminance(stroke);
      if (l != null) {
        if ((isDarkBg && l < 0.05) || (isLightBg && l > 0.82)) {
          patch.stroke = target;
          // also fix textColor if it matches stroke or is same extreme
          if (typeof textColor === 'string') {
            const tl = relativeLuminance(textColor);
            if (tl != null && ((isDarkBg && tl < 0.05) || (isLightBg && tl > 0.82))) patch.textColor = target;
          }
        }
      }
    } else if (typeof textColor === 'string') {
      const l = relativeLuminance(textColor);
      if (l != null && ((isDarkBg && l < 0.05) || (isLightBg && l > 0.82))) patch.textColor = target;
    }
    // sticky yellow / other fills are not touched — only ink
    if (Object.keys(patch).length) {
      patches.push([key, patch as Partial<import('./shapes').ShapeView>]);
      changed++;
    }
  }
  if (patches.length) transact(() => {
    for (const [id, p] of patches) {
      const mm = board.get(id);
      if (!mm) continue;
      for (const [k, v] of Object.entries(p)) mm.set(k, v);
    }
  });
  if (changed) bumpCurrentBoard();
  return changed;
}

/**
 * One-shot: convert legacy world-space polylines to shape-local storage.
 * Idempotent via meta.pointsSpace === 'local'.
 */
export function migratePointsSpace(): void {
  if (meta.get(POINTS_SPACE_META) === POINTS_SPACE_LOCAL) return;
  let converted = 0;
  transact(() => {
    if (meta.get(POINTS_SPACE_META) === POINTS_SPACE_LOCAL) return;
    for (const [, m] of board.entries()) {
      const pts = m.get('points');
      if (!(pts instanceof Y.Array) || pts.length < 2) continue;
      const x = (m.get('x') as number) ?? 0;
      const y = (m.get('y') as number) ?? 0;
      const world = pts.toArray() as number[];
      const local = toLocalPoints(world, x, y);
      const arr = new Y.Array<number>();
      arr.insert(0, local);
      m.set('points', arr);
      converted += 1;
    }
    meta.set(POINTS_SPACE_META, POINTS_SPACE_LOCAL);
  });
  if (converted > 0) bumpCurrentBoard();
}

export function metaGrid(): boolean {
  return (meta.get('grid') as boolean) ?? true;
}

function ensurePages(): void {
  const a = pagesArray();
  if (a.length === 0) {
    doc.transact(() => {
      if (a.length === 0) a.push(['main']);
    }, null);
  }
}

/** In-memory active page ��� never read localStorage from the render loop. */
let activePageId = 'main';
/** Fingerprints ��� skip no-op storms from Yjs observe noise. */
let lastPageListEmitKey = '';
let lastActivePageEmitKey = '';
let lastPagesEmitKey = '';

function readStoredPageId(): string {
  try {
    return localStorage.getItem(pageKey(currentBoardId)) ?? '';
  } catch {
    return '';
  }
}

function syncActivePageFromStorage(): void {
  const list = listPages();
  let cur = readStoredPageId();
  if (!list.includes(cur)) cur = list[0] ?? 'main';
  activePageId = cur;
}

function pageListEmitKey(): string {
  return listPages().join('\0');
}

function pagesEmitKey(): string {
  return `${activePageId}\0${pageListEmitKey()}`;
}

function emitPageList(): void {
  const key = pageListEmitKey();
  if (key === lastPageListEmitKey) return;
  lastPageListEmitKey = key;
  lastPagesEmitKey = '';
  for (const l of [...pageListListeners]) l();
  emitPages();
}

function emitActivePage(): void {
  const key = activePageId;
  if (key === lastActivePageEmitKey) return;
  lastActivePageEmitKey = key;
  lastPagesEmitKey = '';
  for (const l of [...activePageListeners]) l();
  emitPages();
}

let uid = 0;
export function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  uid += 1;
  return Date.now().toString(36) + '-' + uid.toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

export function transact(fn: () => void): void {
  doc.transact(fn, LOCAL_ORIGIN);
}

export function beginGesture(): void {
  undoManager.stopCapturing();
  beginWriteGesture();
}

export function endGesture(): void {
  endWriteGesture();
  undoManager.stopCapturing();
}

export function readShape(m: Y.Map<unknown>): ShapeView {
  const type = m.get('type') as ShapeType;
  const x = (m.get('x') as number) ?? 0;
  const y = (m.get('y') as number) ?? 0;
  const points = m.get('points');
  const pagesArr = m.get('pages');
  const localPts = points instanceof Y.Array ? (points.toArray() as number[]) : undefined;
  const worldPts =
    localPts && localPts.length
      ? meta.get(POINTS_SPACE_META) === POINTS_SPACE_LOCAL
        ? toWorldPoints(localPts, x, y)
        : localPts
      : undefined;
  return {
    id: m.get('id') as string,
    type,
    x,
    y,
    w: (m.get('w') as number) ?? 0,
    h: (m.get('h') as number) ?? 0,
    fill: (m.get('fill') as string) ?? COLORS.fill,
    stroke: (m.get('stroke') as string) ?? COLORS.stroke,
    strokeWidth: (m.get('strokeWidth') as number) ?? 2,
    text: m.get('text') as string | undefined,
    fontSize: (m.get('fontSize') as number | undefined) ?? (type === 'sticky' ? STICKY_FONT : ['rect', 'ellipse', 'diamond', 'frame', 'triangle', 'parallelogram', 'hexagon', 'cylinder', 'terminator', 'subroutine', 'display'].includes(type) ? SHAPE_FONT : TEXT_FONT),
    textColor: m.get('textColor') as string | undefined,
    bold: m.get('bold') === true,
    italic: m.get('italic') === true,
    underline: m.get('underline') === true,
    strike: m.get('strike') === true,
    textAlign: (m.get('textAlign') as ShapeView['textAlign'] | undefined) ?? undefined,
    highlight: m.get('highlight') === true,
    alpha: m.get('alpha') as number | undefined,
    src: m.get('src') as string | undefined,
    pages: pagesArr instanceof Y.Array ? pagesArr.toArray() : undefined,
    page: m.get('page') as number | undefined,
    locked: m.get('locked') as boolean | undefined,
    cropX: m.get('cropX') as number | undefined,
    cropY: m.get('cropY') as number | undefined,
    cropW: m.get('cropW') as number | undefined,
    cropH: m.get('cropH') as number | undefined,
    expr: m.get('expr') as string | undefined,
    points: worldPts,
    pressures: (() => {
      const p = m.get('pressures');
      return p instanceof Y.Array ? p.toArray() : undefined;
    })(),
    rotation: typeof m.get('rotation') === 'number' ? (m.get('rotation') as number) : undefined,
    cornerRadius: typeof m.get('cornerRadius') === 'number' ? (m.get('cornerRadius') as number) : undefined,
    arrowHead: typeof m.get('arrowHead') === 'number' ? (m.get('arrowHead') as number) : undefined,
    richHtml: typeof m.get('richHtml') === 'string' ? (m.get('richHtml') as string) : undefined,
    fromId: m.get('fromId') as string | undefined,
    fromPort: m.get('fromPort') as string | undefined,
    toId: m.get('toId') as string | undefined,
    toPort: m.get('toPort') as string | undefined,
  };
}

function createShapeYMap(v: ShapeView): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('id', v.id);
  m.set('type', v.type);
  m.set('x', v.x);
  m.set('y', v.y);
  m.set('w', v.w);
  m.set('h', v.h);
  m.set('fill', v.fill);
  m.set('stroke', v.stroke);
  m.set('strokeWidth', v.strokeWidth);
  const textTypes = new Set(['sticky', 'text', 'rect', 'ellipse', 'diamond', 'frame', 'triangle', 'parallelogram', 'hexagon', 'cylinder', 'terminator', 'subroutine', 'display']);
  if (textTypes.has(v.type)) {
    m.set('text', v.text ?? '');
    m.set(
      'fontSize',
      v.fontSize ?? (v.type === 'sticky' ? STICKY_FONT : v.type === 'rect' || v.type === 'ellipse' ? SHAPE_FONT : TEXT_FONT)
    );
    if (v.textColor) m.set('textColor', v.textColor);
    if (v.bold) m.set('bold', true);
    if (v.italic) m.set('italic', true);
    if (v.underline) m.set('underline', true);
    if (v.strike) m.set('strike', true);
    if (v.textAlign && v.textAlign !== 'left') m.set('textAlign', v.textAlign);
    if (v.highlight) m.set('highlight', true);
    if (v.richHtml) m.set('richHtml', v.richHtml);
  }
  if (v.points) {
    const arr = new Y.Array<number>();
    arr.insert(0, toLocalPoints(v.points, v.x, v.y));
    m.set('points', arr);
  }
  if (v.pressures?.length) {
    const arr = new Y.Array<number>();
    arr.insert(0, v.pressures);
    m.set('pressures', arr);
  }
  if (v.rotation) m.set('rotation', v.rotation);
  if (v.cornerRadius !== undefined) m.set('cornerRadius', v.cornerRadius);
  if (v.arrowHead !== undefined) m.set('arrowHead', v.arrowHead);
  if (v.pages) {
    const arr = new Y.Array<string>();
    arr.insert(0, v.pages);
    m.set('pages', arr);
    m.set('page', v.page ?? 0);
  }
  if (v.alpha !== undefined) m.set('alpha', v.alpha);
  if (v.src) m.set('src', v.src);
  if (v.locked) m.set('locked', true);
  if (v.cropW !== undefined || v.cropH !== undefined) {
    m.set('cropX', v.cropX ?? 0);
    m.set('cropY', v.cropY ?? 0);
    m.set('cropW', v.cropW ?? 1);
    m.set('cropH', v.cropH ?? 1);
  }
  if (v.type === 'graph') m.set('expr', v.expr ?? 'sin(x)');
  if (v.fromId) m.set('fromId', v.fromId);
  if (v.fromPort) m.set('fromPort', v.fromPort);
  if (v.toId) m.set('toId', v.toId);
  if (v.toPort) m.set('toPort', v.toPort);
  return m;
}

export function addShape(v: Omit<ShapeView, 'id'> & { id?: string }): string {
  const id = v.id ?? makeId();
  const m = createShapeYMap({ ...v, id } as ShapeView);
  const key = currentPagePrefix() + id;
  // Structural adds flush any coalesced gesture patches first so order stays sane.
  flushWriteGate();
  transact(() => {
    if (meta.get(POINTS_SPACE_META) !== POINTS_SPACE_LOCAL) {
      meta.set(POINTS_SPACE_META, POINTS_SPACE_LOCAL);
    }
    ensureOrder();
    board.set(key, m);
    order.push([key]);
  });
  bumpCurrentBoard();
  return key;
}

function patchShapeInternal(id: string, patch: Partial<ShapeView>): void {
  const m = board.get(id);
  if (!m) return;
  // Apply scalar geometry first so points can be stored relative to the new origin.
  if (patch.x !== undefined) m.set('x', patch.x);
  if (patch.y !== undefined) m.set('y', patch.y);
  const originX = (m.get('x') as number) ?? 0;
  const originY = (m.get('y') as number) ?? 0;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === 'x' || key === 'y') continue;
    if (key === 'points' && Array.isArray(value)) {
      const arr = new Y.Array<number>();
      arr.insert(0, toLocalPoints(value as number[], originX, originY));
      m.set('points', arr);
    } else if (key === 'pressures' && Array.isArray(value)) {
      const arr = new Y.Array<number>();
      arr.insert(0, value as number[]);
      m.set('pressures', arr);
    } else if (key === 'pages' && Array.isArray(value)) {
      const arr = new Y.Array<string>();
      arr.insert(0, value as string[]);
      m.set('pages', arr);
    } else if (key === 'rotation' && value === 0) {
      m.delete('rotation');
    } else if (key === 'richHtml' && value === '') {
      m.delete('richHtml');
    } else {
      m.set(key, value);
    }
  }
}

function flushPatchesToDoc(batch: PatchBatch): void {
  if (!batch.length) return;
  transact(() => {
    if (meta.get(POINTS_SPACE_META) !== POINTS_SPACE_LOCAL) {
      meta.set(POINTS_SPACE_META, POINTS_SPACE_LOCAL);
    }
    for (const [id, patch] of batch) patchShapeInternal(id, patch);
  });
  bumpCurrentBoard();
}

let liveViewApplier: ((batch: PatchBatch) => void) | null = null;

/** Engine registers this so coalesced gestures still paint at pointer rate. */
export function setLiveViewApplier(fn: ((batch: PatchBatch) => void) | null): void {
  liveViewApplier = fn;
  configureWriteGate({
    flush: flushPatchesToDoc,
    live: (batch) => liveViewApplier?.(batch),
  });
}

// Default gate wiring (live applier attached when Engine mounts).
configureWriteGate({ flush: flushPatchesToDoc, live: null });

export function patchShape(id: string, patch: Partial<ShapeView>): void {
  enqueuePatch(id, patch);
}

export function patchShapes(patches: Array<[string, Partial<ShapeView>]>): void {
  enqueuePatches(patches);
}

/** Force pending coalesced patches into the doc (tests / before structural ops). */
export function flushPendingPatches(): void {
  flushWriteGate();
}

export function removeShapes(ids: string[]): void {
  if (!ids.length) return;
  flushWriteGate();
  transact(() => {
    for (const id of ids) board.delete(id);
    for (const id of ids) {
      const idx = order.toArray().indexOf(id);
      if (idx >= 0) order.delete(idx, 1);
    }
  });
  bumpCurrentBoard();
}

function bumpCurrentBoard(): void {
  if (currentBoardId) bumpBoardUpdated(currentBoardId);
}

/**
 * Forever fix for 355MB ghost boards (gc:false tombstones).
 * Rebuilds a fresh Y.Doc with only live shapes/meta/order/pages,
 * wipes IndexedDB `review-v1-*` and in-memory server room.
 */
export async function compactBoard(): Promise<{ before: number; after: number; didCompact: boolean }> {
  if (!currentBoardId || compactInFlight) return { before: 0, after: 0, didCompact: false };
  compactInFlight = true;
  const boardId = currentBoardId;
  let before = 0;
  try {
    try {
      before = Y.encodeStateAsUpdate(doc).length;
    } catch {
      return { before: 0, after: 0, didCompact: false };
    }
    if (syncClient.collectPeers().length > 0) {
      netLog.info('compact skipped (peers present)', () => ({ boardId, before }));
      return { before, after: before, didCompact: false };
    }
    // Build compact doc
    const compact = new Y.Doc({ gc: false } as unknown as Record<string, unknown>);
    const cBoard = compact.getMap<Y.Map<unknown>>('shapes');
    const cMeta = compact.getMap('meta');
    const cOrder = compact.getArray<string>('order');
    const cPages = compact.getArray<string>('pages');
    for (const [k, v] of meta.entries()) cMeta.set(k, v);
    for (const [key, m] of board.entries()) {
      const nm = new Y.Map<unknown>();
      for (const [k, v] of (m as Y.Map<unknown>).entries()) {
        if (v instanceof Y.Array) {
          const arr = new Y.Array<unknown>();
          arr.insert(0, v.toArray() as unknown[]);
          nm.set(k, arr);
        } else if (v instanceof Y.Map) {
          const sub = new Y.Map<unknown>();
          for (const [sk, sv] of (v as Y.Map<unknown>).entries()) sub.set(sk, sv);
          nm.set(k, sub);
        } else {
          nm.set(k, v as unknown);
        }
      }
      cBoard.set(key, nm);
    }
    cOrder.push(order.toArray());
    cPages.push(pages.toArray());
    let after = 0;
    try {
      after = Y.encodeStateAsUpdate(compact).length;
    } catch {
      compact.destroy();
      return { before, after: before, didCompact: false };
    }
    // only replace if meaningful saving or before huge
    if (after >= before * 0.7 && before < 8 * 1024 * 1024) {
      compact.destroy();
      return { before, after, didCompact: false };
    }
    netLog.info('compactBoard start', () => ({ boardId, before, after, shapes: board.size, orderLen: order.length }));
    const persistLocally = Boolean(persistence) && shouldPersist(boardId);
    // detach before destroying
    detachSync();
    // clear old IndexedDB database content
    try {
      await persistence?.clearData();
    } catch {}
    try {
      persistence?.destroy();
    } catch {}
    try {
      doc.destroy();
    } catch {}
    try {
      undoManager.clear();
      (undoManager as unknown as { destroy?: () => void })?.destroy?.();
    } catch {}
    // rewire globals to compact doc
    doc = compact;
    board = cBoard;
    meta = cMeta;
    order = cOrder;
    pages = cPages;
    pagesObserved = false;
    undoManager = new Y.UndoManager([board, order, pages], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 200,
    });
    doc.on('update', (u: Uint8Array, o: unknown, _d: unknown, tr: unknown) => logDocUpdate(u.length, o, tr));
    pagesArray();
    lastPageListEmitKey = '';
    lastActivePageEmitKey = '';
    lastPagesEmitKey = '';
    emitPageList();
    emitActivePage();
    if (persistLocally) {
      persistence = new IndexeddbPersistence(boardPersistenceKey(boardId), doc);
      try {
        await (persistence as unknown as { whenSynced: Promise<void> }).whenSynced;
      } catch {}
    } else {
      persistence = null;
    }
    // clear server in-memory room (it still holds 372MB Y.Doc)
    try {
      const syncUrl = effectiveSyncUrl();
      const base = syncUrl.replace(/^ws(s)?:\/\//, 'http$1://');
      const room = `review-${boardId}`;
      await fetch(`${base}/room/${encodeURIComponent(room)}`, { method: 'DELETE' });
      fileLogFallback('info', 'compact cleared server room', { room });
    } catch (e) {
      netLog.warn('compact clear server room failed', () => ({ err: String(e) }));
    }
    attachSync(doc, boardId);
    bumpCurrentBoard();
    emitBoardReady();
    netLog.info('compactBoard done', () => ({ boardId, before, after }));
    return { before, after, didCompact: true };
  } finally {
    compactInFlight = false;
  }
}

function fileLogFallback(level: string, msg: string, data?: unknown): void {
  try {
    netLog.info(msg, () => data as unknown as never);
  } catch {}
  void level;
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__compactBoard = compactBoard;
  (window as unknown as Record<string, unknown>).__maybeAutoCompact = maybeAutoCompact;
}

export function clearShapeKeys(id: string, keys: string[]): void {
  transact(() => {
    const m = board.get(id);
    if (!m) return;
    for (const key of keys) m.delete(key);
  });
}

export function onPageChange(cb: () => void): () => void {
  pageListeners.add(cb);
  return () => {
    pageListeners.delete(cb);
  };
}

/** Synced page list changed (count / ids) ��� does not switch anyone's active page. */
export function onPageListChange(cb: () => void): () => void {
  pageListListeners.add(cb);
  return () => {
    pageListListeners.delete(cb);
  };
}

/** Local active page changed ��� canvas should reload that page only. */
export function onActivePageChange(cb: () => void): () => void {
  activePageListeners.add(cb);
  return () => {
    activePageListeners.delete(cb);
  };
}

function emitPages(): void {
  const key = pagesEmitKey();
  if (key === lastPagesEmitKey) return;
  lastPagesEmitKey = key;
  for (const l of [...pageListeners]) l();
}

function pagesArray(): Y.Array<string> {
  if (!pagesObserved) {
    pages.observe((ev: Y.YArrayEvent<string>) => {
      // ponytail: ignore dedup repairs to avoid ping-pong with 3 peers
      if ((ev as unknown as { transaction?: { origin?: unknown } }).transaction?.origin === 'dedup') return;
      emitPageList();
    });
    pagesObserved = true;
  }
  return pages;
}

export function listPages(): string[] {
  const a = pagesArray();
  if (a.length === 0) {
    return ['main'];
  }
  const arr = a.toArray();
  const seen = new Set<string>();
  const uniq: string[] = [];
  let dup = false;
  for (const id of arr) {
    if (seen.has(id)) dup = true;
    else {
      seen.add(id);
      uniq.push(id);
    }
  }
  if (dup) {
    // ponytail: only leader dedups to avoid 3-peer ping-pong
    try {
      const peers = syncClient.collectPeers();
      const selfAwareness =
        (syncClient as unknown as { provider?: { awareness: { clientID: number } } }).provider?.awareness.clientID ??
        doc.clientID;
      const min = Math.min(selfAwareness, ...peers.map((p) => p.id));
      if (selfAwareness !== min) return uniq;
    } catch {}
    queueMicrotask(() => {
      doc.transact(() => {
        const cur = a.toArray();
        const s = new Set<string>();
        const u: string[] = [];
        for (const id of cur) if (!s.has(id)) { s.add(id); u.push(id); }
        if (u.length !== cur.length) {
          a.delete(0, a.length);
          if (u.length) a.push(u);
        }
      }, 'dedup');
    });
    return uniq;
  }
  return arr;
}

export function currentPageId(): string {
  const list = listPages();
  if (!list.includes(activePageId)) {
    activePageId = list[0] ?? 'main';
  }
  return activePageId;
}

export function currentPagePrefix(): string {
  const id = currentPageId();
  return id === 'main' ? '' : id + ':';
}

/** Hot-path page filter ��� uses in-memory activePageId only (no storage / Y reads). */
export function isOnActivePage(key: string): boolean {
  if (activePageId === 'main') return !key.includes(':');
  return key.startsWith(activePageId + ':');
}

export function setCurrentPage(id: string): void {
  if (activePageId === id) {
    // Still persist if storage was missing, but don't re-emit.
    try {
      localStorage.setItem(pageKey(currentBoardId), id);
    } catch {
      /* ignore */
    }
    return;
  }
  activePageId = id;
  try {
    localStorage.setItem(pageKey(currentBoardId), id);
  } catch {
    /* ignore */
  }
  emitActivePage();
}

export function addPage(): void {
  const a = pagesArray();
  if (a.length === 0) {
    doc.transact(() => {
      if (a.length === 0) a.push(['main']);
    }, null);
  }
  const pid = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  transact(() => pagesArray().push([pid]));
  setCurrentPage(pid);
  bumpCurrentBoard();
}

export function deletePage(id: string): void {
  const a = pagesArray();
  if (a.length <= 1) return;
  const idx = a.toArray().indexOf(id);
  if (idx < 0) return;
  const isMain = id === 'main';
  transact(() => {
    for (const key of [...board.keys()]) {
      const del = isMain ? !key.includes(':') : key.startsWith(id + ':');
      if (del) board.delete(key);
    }
    const kept = order.toArray().filter((k) => {
      const del = isMain ? !k.includes(':') : k.startsWith(id + ':');
      return !del;
    });
    order.delete(0, order.length);
    if (kept.length) order.push(kept);
    a.delete(idx, 1);
  });
  if (currentPageId() === id) setCurrentPage(a.toArray()[0] ?? 'main');
  else emitPageList();
  bumpCurrentBoard();
}

export function pageOfKey(key: string): string {
  const idx = key.indexOf(':');
  return idx === -1 ? 'main' : key.slice(0, idx);
}
