import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import { COLORS, SHAPE_FONT, STICKY_FONT, TEXT_FONT } from '../core/shapes';
import type { ShapeView, ShapeType } from '../core/shapes';
import type { UserInfo } from '../core/user';
import { loadUser } from '../core/user';
import { bumpBoardUpdated, getBoard, isBoardPersistedLocally } from '../core/boards';
import { readPrefs } from '../core/prefs';
import { getPeerDisplay, onPeerDisplayChange } from '../core/peerDisplay';

export const LOCAL_ORIGIN = 'local';
const LEGACY_MIGRATION_KEY = 'review-v1-migrated';

// --- per-board state ---
let currentBoardId: string | null = null;
export let doc = new Y.Doc();
export let board = doc.getMap<Y.Map<unknown>>('shapes');
export let meta = doc.getMap('meta');
export let order = doc.getArray<string>('order');
export let pages = doc.getArray<string>('pages');
let pagesObserved = false;
const pageListeners = new Set<() => void>();
export let undoManager = new Y.UndoManager([board, order, pages], {
  trackedOrigins: new Set([LOCAL_ORIGIN]),
  captureTimeout: 200,
});
export let persistence: IndexeddbPersistence | null = null;

function boardPersistenceKey(id: string): string {
  return `review-v1-${id}`;
}
function boardRoom(id: string): string {
  return `review-${id}`;
}

export function getBoardRoomName(boardId: string | null = currentBoardId): string {
  return boardId ? boardRoom(boardId) : 'review';
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
  if ((persistence as unknown as { synced: boolean }).synced) {
    ensurePages();
    migratePaper();
  }
  persistence.on('synced', () => {
    ensurePages();
    ensureOrder();
    migratePaper();
  });
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

export function initBoard(boardId: string): void {
  if (currentBoardId === boardId) return;
  destroyProvider();
  try {
    (persistence as unknown as { destroy?: () => void })?.destroy?.();
  } catch {}
  try {
    persistence?.destroy();
  } catch {}
  // clear old observers
  pagesObserved = false;
  pageListeners.clear();
  // new doc
  try {
    doc.destroy();
  } catch {}
  doc = new Y.Doc();
  board = doc.getMap<Y.Map<unknown>>('shapes');
  meta = doc.getMap('meta');
  order = doc.getArray<string>('order');
  pages = doc.getArray<string>('pages');
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
    // ephemeral session — still need pages
    ensurePages();
  }
  // Defer so App render finishes before subscribers setState / open WS.
  queueMicrotask(() => emitSyncChange());
}

/** Tear down sync and clear the active board id (e.g. leaving `/board/:id`). */
export function leaveBoard(): void {
  destroyProvider();
  currentBoardId = null;
  queueMicrotask(() => emitSyncChange());
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
  transact(() => {
    order.delete(0, order.length);
    if (next.length) order.push(next);
  });
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

export function metaGrid(): boolean {
  return (meta.get('grid') as boolean) ?? true;
}

function ensurePages(): void {
  const a = pagesArray();
  if (a.length === 0) {
    transact(() => {
      if (a.length === 0) a.push(['main']);
    });
  }
}

const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
const host = typeof location !== 'undefined' ? location.hostname : 'localhost';
const BUILTIN_SYNC_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SYNC_URL) ||
  `${proto}://${host}:1234`;

let provider: WebsocketProvider | null = null;
let providerUrl: string | null = null;
const syncListeners = new Set<() => void>();

function emitSyncChange(): void {
  for (const l of [...syncListeners]) l();
}

export function onSyncConfigChange(cb: () => void): () => void {
  syncListeners.add(cb);
  return () => {
    syncListeners.delete(cb);
  };
}

export function defaultSyncUrl(): string {
  return BUILTIN_SYNC_URL;
}

export function effectiveSyncUrl(): string {
  return readPrefs().syncUrl || BUILTIN_SYNC_URL;
}

export function isSyncEnabled(): boolean {
  return readPrefs().syncEnabled !== false;
}

/** Recreate or tear down the provider after prefs / board change. */
export function reconnectSync(): void {
  destroyProvider();
  if (isSyncEnabled() && currentBoardId) {
    try {
      getProvider();
    } catch {
      /* ignore */
    }
  }
  emitSyncChange();
}

export function getProvider(): WebsocketProvider {
  if (!isSyncEnabled()) {
    throw new Error('sync disabled');
  }
  const room = getBoardRoomName();
  const url = effectiveSyncUrl();
  if (!provider) {
    provider = new WebsocketProvider(url, room, doc);
    providerUrl = url;
  } else {
    const curRoom = (provider as unknown as { roomname?: string }).roomname;
    if (curRoom !== room || providerUrl !== url) {
      try {
        provider.destroy();
      } catch {
        /* ignore */
      }
      provider = new WebsocketProvider(url, room, doc);
      providerUrl = url;
    }
  }
  return provider;
}

export function tryGetProvider(): WebsocketProvider | null {
  if (!isSyncEnabled()) return null;
  try {
    return getProvider();
  } catch {
    return null;
  }
}

export function destroyProvider(): void {
  if (provider) {
    try {
      provider.destroy();
    } catch {
      /* ignore */
    }
    provider = null;
  }
  providerUrl = null;
}

export type SyncStatus = { online: boolean; users: number; enabled: boolean };

export function onSyncStatus(cb: (status: SyncStatus) => void): () => void {
  const emit = () => {
    const p = tryGetProvider();
    if (!p) {
      cb({ online: false, users: 0, enabled: isSyncEnabled() });
      return;
    }
    const online = p.ws?.readyState === WebSocket.OPEN;
    const users = online ? p.awareness.getStates().size : 0;
    cb({ online, users, enabled: true });
  };
  const onStatus = (e: { status: string }) => {
    if (e.status === 'connected') {
      const p = tryGetProvider();
      cb({ online: true, users: p ? p.awareness.getStates().size : 0, enabled: true });
    } else {
      cb({ online: false, users: 0, enabled: isSyncEnabled() });
    }
  };

  let offAwareness: (() => void) | null = null;
  let bound: WebsocketProvider | null = null;

  const bind = () => {
    if (bound) {
      bound.off('status', onStatus);
      offAwareness?.();
      bound = null;
      offAwareness = null;
    }
    const p = tryGetProvider();
    if (!p) {
      emit();
      return;
    }
    bound = p;
    p.on('status', onStatus);
    const onAware = () => emit();
    p.awareness.on('change', onAware);
    offAwareness = () => p.awareness.off('change', onAware);
    emit();
  };

  bind();
  const unSubConfig = onSyncConfigChange(bind);
  return () => {
    unSubConfig();
    if (bound) bound.off('status', onStatus);
    offAwareness?.();
  };
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
}

export function endGesture(): void {
  undoManager.stopCapturing();
}

export function readShape(m: Y.Map<unknown>): ShapeView {
  const type = m.get('type') as ShapeType;
  const points = m.get('points');
  const pagesArr = m.get('pages');
  return {
    id: m.get('id') as string,
    type,
    x: (m.get('x') as number) ?? 0,
    y: (m.get('y') as number) ?? 0,
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
    points: points instanceof Y.Array ? points.toArray() : undefined,
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
    arr.insert(0, v.points);
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
  transact(() => {
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
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === 'points' && Array.isArray(value)) {
      const arr = new Y.Array<number>();
      arr.insert(0, value as number[]);
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

export function patchShape(id: string, patch: Partial<ShapeView>): void {
  transact(() => {
    patchShapeInternal(id, patch);
  });
  bumpCurrentBoard();
}

export function patchShapes(patches: Array<[string, Partial<ShapeView>]>): void {
  if (!patches.length) return;
  transact(() => {
    for (const [id, patch] of patches) patchShapeInternal(id, patch);
  });
  bumpCurrentBoard();
}

export function removeShapes(ids: string[]): void {
  if (!ids.length) return;
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

export function clearShapeKeys(id: string, keys: string[]): void {
  transact(() => {
    const m = board.get(id);
    if (!m) return;
    for (const key of keys) m.delete(key);
  });
}

export function publishPresence(user: UserInfo): void {
  const p = tryGetProvider();
  if (!p) return;
  p.awareness.setLocalStateField('user', user);
}

let lastCursorSent = 0;

export function sendCursor(pos: { x: number; y: number } | null): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (pos && now - lastCursorSent < 40) return;
  lastCursorSent = now;
  try {
    const p = tryGetProvider();
    if (!p) return;
    p.awareness.setLocalStateField('cursor', pos);
  } catch {
    /* no provider in tests */
  }
}

export interface PeerCursor {
  /** Awareness client id (ephemeral). */
  id: number;
  /** Stable user id from awareness, when published. */
  userId: string;
  name: string;
  color: string;
  /** Published name before local override. */
  publishedName: string;
  /** Published color before local override. */
  publishedColor: string;
  overridden: boolean;
  x: number | null;
  y: number | null;
}

export function collectPeers(): PeerCursor[] {
  const p = tryGetProvider();
  if (!p || p.ws?.readyState !== WebSocket.OPEN) return [];
  const selfId = loadUser().id;
  const peers: PeerCursor[] = [];
  for (const [id, state] of p.awareness.getStates()) {
    if (id === p.awareness.clientID) continue;
    const user = state.user as UserInfo | undefined;
    if (!user || !user.name) continue;
    const userId = typeof user.id === 'string' && user.id.trim() ? user.id.trim() : '';
    if (userId && userId === selfId) continue;
    const published = { name: user.name, color: user.color || '#7c8cff' };
    const display = userId ? getPeerDisplay(userId, published) : { ...published, overridden: false };
    const cur = state.cursor as { x: number; y: number } | null | undefined;
    peers.push({
      id,
      userId: userId || `client:${id}`,
      name: display.name,
      color: display.color,
      publishedName: published.name,
      publishedColor: published.color,
      overridden: display.overridden,
      x: cur?.x ?? null,
      y: cur?.y ?? null,
    });
  }
  return peers;
}

export function onPeers(cb: (peers: PeerCursor[]) => void): () => void {
  const emit = () => cb(collectPeers());
  let offAwareness: (() => void) | null = null;
  let bound: WebsocketProvider | null = null;

  const onStatus = (e: { status: string }) => {
    if (e.status !== 'connected') cb([]);
    else emit();
  };

  const bind = () => {
    if (bound) {
      bound.off('status', onStatus);
      offAwareness?.();
      bound = null;
      offAwareness = null;
    }
    const p = tryGetProvider();
    if (!p) {
      cb([]);
      return;
    }
    bound = p;
    p.on('status', onStatus);
    const onAware = () => emit();
    p.awareness.on('change', onAware);
    offAwareness = () => p.awareness.off('change', onAware);
    emit();
  };

  bind();
  const unSubConfig = onSyncConfigChange(bind);
  const unSubDisplay = onPeerDisplayChange(emit);
  return () => {
    unSubConfig();
    unSubDisplay();
    if (bound) bound.off('status', onStatus);
    offAwareness?.();
  };
}

export function onPageChange(cb: () => void): () => void {
  pageListeners.add(cb);
  return () => {
    pageListeners.delete(cb);
  };
}

function emitPages(): void {
  for (const l of [...pageListeners]) l();
}

function pagesArray(): Y.Array<string> {
  if (!pagesObserved) {
    pages.observe(() => {
      emitPages();
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
    queueMicrotask(() => {
      transact(() => {
        const cur = a.toArray();
        const s = new Set<string>();
        const u: string[] = [];
        for (const id of cur) if (!s.has(id)) { s.add(id); u.push(id); }
        if (u.length !== cur.length) {
          a.delete(0, a.length);
          if (u.length) a.push(u);
        }
      });
    });
    return uniq;
  }
  return arr;
}

export function currentPageId(): string {
  const list = listPages();
  let cur = '';
  try {
    cur = localStorage.getItem(pageKey(currentBoardId)) ?? '';
  } catch {
    /* ignore */
  }
  if (!list.includes(cur)) cur = list[0] ?? 'main';
  return cur;
}

export function currentPagePrefix(): string {
  const id = currentPageId();
  return id === 'main' ? '' : id + ':';
}

export function isOnActivePage(key: string): boolean {
  const prefix = currentPagePrefix();
  if (prefix === '') return !key.includes(':');
  return key.startsWith(prefix);
}

export function setCurrentPage(id: string): void {
  try {
    localStorage.setItem(pageKey(currentBoardId), id);
  } catch {
    /* ignore */
  }
  emitPages();
}

export function addPage(): void {
  const a = pagesArray();
  if (a.length === 0) {
    transact(() => {
      if (a.length === 0) a.push(['main']);
    });
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
  else emitPages();
  bumpCurrentBoard();
}

export function pageOfKey(key: string): string {
  const idx = key.indexOf(':');
  return idx === -1 ? 'main' : key.slice(0, idx);
}
