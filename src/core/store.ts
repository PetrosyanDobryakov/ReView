import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import { COLORS, SHAPE_FONT, STICKY_FONT, TEXT_FONT } from '../core/shapes';
import type { ShapeView, ShapeType } from '../core/shapes';
import type { UserInfo } from '../core/user';

export const LOCAL_ORIGIN = 'local';

// --- per-board state ---
let currentBoardId: string | null = null;
export let doc = new Y.Doc();
export let board = doc.getMap<Y.Map<unknown>>('shapes');
export let meta = doc.getMap('meta');
export let order = doc.getArray<string>('order');
export let undoManager = new Y.UndoManager([board, order], {
  trackedOrigins: new Set([LOCAL_ORIGIN]),
  captureTimeout: 200,
});
export let persistence: IndexeddbPersistence | null = new IndexeddbPersistence('review-v1', doc);

function boardPersistenceKey(id: string): string {
  return `review-v1-${id}`;
}
function boardRoom(id: string): string {
  return `review-${id}`;
}
function pageKey(id: string | null): string {
  return id ? `review-page-${id}` : 'review-page';
}

export function getCurrentBoardId(): string | null {
  return currentBoardId;
}

export function initBoard(boardId: string): void {
  if (currentBoardId === boardId) return;
  // destroy old
  try {
    provider?.destroy();
  } catch {}
  provider = null;
  try {
    (persistence as unknown as { destroy?: () => void })?.destroy?.();
  } catch {}
  try {
    persistence?.destroy();
  } catch {}
  // clear old observers
  pagesArr = null;
  pageListeners.clear();
  // new doc
  try {
    doc.destroy();
  } catch {}
  doc = new Y.Doc();
  board = doc.getMap<Y.Map<unknown>>('shapes');
  meta = doc.getMap('meta');
  order = doc.getArray<string>('order');
  undoManager = new Y.UndoManager([board, order], {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: 200,
  });
  currentBoardId = boardId;
  persistence = new IndexeddbPersistence(boardPersistenceKey(boardId), doc);
  // migrate old single-board data if new board empty and old exists
  const maybeMigrate = async () => {
    // if new board has no data, try to copy from old review-v1
    if (board.size === 0 && order.length === 0) {
      try {
        const oldDoc = new Y.Doc();
        const oldPersist = new IndexeddbPersistence('review-v1', oldDoc);
        await new Promise<void>((res) => {
          if ((oldPersist as unknown as { synced: boolean }).synced) res();
          else oldPersist.on('synced', () => res());
          setTimeout(() => res(), 1200);
        });
        const oldBoard = oldDoc.getMap('shapes');
        if (oldBoard.size > 0) {
          const update = Y.encodeStateAsUpdate(oldDoc);
          Y.applyUpdate(doc, update);
        }
        oldPersist.destroy();
        oldDoc.destroy();
      } catch {}
    }
  };
  maybeMigrate();
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

if ((persistence as unknown as { synced: boolean }).synced) {
  ensurePages();
  migratePaper();
}
(persistence as unknown as { on: (e: string, cb: () => void) => void }).on('synced', () => {
  ensurePages();
  ensureOrder();
  migratePaper();
});

const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
const host = typeof location !== 'undefined' ? location.hostname : 'localhost';
const SYNC_URL = `${proto}://${host}:1234`;

let provider: WebsocketProvider | null = null;

export function getProvider(): WebsocketProvider {
  const room = currentBoardId ? boardRoom(currentBoardId) : 'review';
  if (!provider) {
    provider = new WebsocketProvider(SYNC_URL, room, doc);
  } else {
    // if room changed, recreate
    const curRoom = (provider as unknown as { roomname?: string }).roomname;
    if (curRoom !== room) {
      try { provider.destroy(); } catch {}
      provider = new WebsocketProvider(SYNC_URL, room, doc);
    }
  }
  return provider;
}

export function destroyProvider(): void {
  if (provider) {
    try { provider.destroy(); } catch {}
    provider = null;
  }
}

export type SyncStatus = { online: boolean; users: number };

export function onSyncStatus(cb: (status: SyncStatus) => void): () => void {
  const p = getProvider();
  const count = () => p.awareness.getStates().size;
  const emit = () => {
    const online = p.ws?.readyState === WebSocket.OPEN;
    cb({ online, users: online ? count() : 0 });
  };
  const onStatus = (e: { status: string }) => {
    if (e.status === 'connected') cb({ online: true, users: count() });
    else cb({ online: false, users: 0 });
  };
  p.on('status', onStatus);
  p.awareness.on('change', emit);
  if (p.ws?.readyState === WebSocket.OPEN) cb({ online: true, users: count() });
  else cb({ online: false, users: 0 });
  return () => {
    p.off('status', onStatus);
    p.awareness.off('change', emit);
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

export function readShape(m: Y.Map<unknown>): ShapeView {
  const type = m.get('type') as ShapeType;
  const points = m.get('points');
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
    alpha: m.get('alpha') as number | undefined,
    src: m.get('src') as string | undefined,
    locked: m.get('locked') as boolean | undefined,
    cropX: m.get('cropX') as number | undefined,
    cropY: m.get('cropY') as number | undefined,
    cropW: m.get('cropW') as number | undefined,
    cropH: m.get('cropH') as number | undefined,
    expr: m.get('expr') as string | undefined,
    points: points instanceof Y.Array ? points.toArray() : undefined,
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
  }
  if (v.points) {
    const arr = new Y.Array<number>();
    arr.insert(0, v.points);
    m.set('points', arr);
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
  // bump board updated
  try {
    if (currentBoardId) {
      const raw = localStorage.getItem('review-boards');
      if (raw) {
        const arr = JSON.parse(raw) as Array<{ id: string; updatedAt: number }>;
        const idx = arr.findIndex((b) => b.id === currentBoardId);
        if (idx >= 0) {
          arr[idx].updatedAt = Date.now();
          localStorage.setItem('review-boards', JSON.stringify(arr));
        }
      }
    }
  } catch {}
  return key;
}

function patchShapeInternal(id: string, patch: Partial<ShapeView>): void {
  const m = board.get(id);
  if (!m) return;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === 'points' && Array.isArray(value)) {
      const arr = new Y.Array<number>();
      arr.insert(0, value);
      m.set('points', arr);
    } else {
      m.set(key, value);
    }
  }
}

export function patchShape(id: string, patch: Partial<ShapeView>): void {
  transact(() => {
    patchShapeInternal(id, patch);
  });
}

export function patchShapes(patches: Array<[string, Partial<ShapeView>]>): void {
  transact(() => {
    for (const [id, patch] of patches) patchShapeInternal(id, patch);
  });
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
}

export function clearShapeKeys(id: string, keys: string[]): void {
  transact(() => {
    const m = board.get(id);
    if (!m) return;
    for (const key of keys) m.delete(key);
  });
}

export function publishPresence(user: UserInfo): void {
  getProvider().awareness.setLocalStateField('user', user);
}

let lastCursorSent = 0;

export function sendCursor(pos: { x: number; y: number } | null): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (pos && now - lastCursorSent < 40) return;
  lastCursorSent = now;
  try {
    getProvider().awareness.setLocalStateField('cursor', pos);
  } catch {
    /* no provider in tests */
  }
}

export interface PeerCursor {
  id: number;
  name: string;
  color: string;
  x: number | null;
  y: number | null;
}

export function onPageChange(cb: () => void): () => void {
  pageListeners.add(cb);
  return () => {
    pageListeners.delete(cb);
  };
}

let pagesArr: Y.Array<string> | null = null;
const pageListeners = new Set<() => void>();

function emitPages(): void {
  for (const l of [...pageListeners]) l();
}

function pagesArray(): Y.Array<string> {
  if (!pagesArr) {
    pagesArr = doc.getArray<string>('pages');
    pagesArr.observe(() => {
      emitPages();
    });
  }
  return pagesArr;
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
}

export function deletePage(id: string): void {
  const a = pagesArray();
  if (a.length <= 1) return;
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
  });
  const idx = a.toArray().indexOf(id);
  if (idx >= 0) transact(() => a.delete(idx, 1));
  if (currentPageId() === id) setCurrentPage(a.toArray()[0] ?? 'main');
  else emitPages();
}

export function pageOfKey(key: string): string {
  const idx = key.indexOf(':');
  return idx === -1 ? 'main' : key.slice(0, idx);
}

export function onPeers(cb: (peers: PeerCursor[]) => void): () => void {
  const p = getProvider();
  const emit = () => {
    const peers: PeerCursor[] = [];
    for (const [id, state] of p.awareness.getStates()) {
      if (id === p.awareness.clientID) continue;
      const user = state.user as UserInfo | undefined;
      if (!user || !user.name) continue;
      const cur = state.cursor as { x: number; y: number } | null | undefined;
      peers.push({ id, name: user.name, color: user.color, x: cur?.x ?? null, y: cur?.y ?? null });
    }
    cb(peers);
  };
  p.awareness.on('change', emit);
  emit();
  return () => {
    p.awareness.off('change', emit);
  };
}
