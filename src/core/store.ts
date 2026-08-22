import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import { COLORS, SHAPE_FONT, STICKY_FONT, TEXT_FONT } from './shapes';
import type { ShapeView, ShapeType } from './shapes';

export const LOCAL_ORIGIN = 'local';

export const doc = new Y.Doc();
export const board = doc.getMap<Y.Map<unknown>>('shapes');
export const meta = doc.getMap('meta');
export const order = doc.getArray<string>('order');

export function ensureOrder(): void {
  if (order.length === board.size) return;
  transact(() => {
    order.delete(0, order.length);
    order.push([...board.keys()]);
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

export function setMeta(patch: Record<string, unknown>): void {
  transact(() => {
    for (const [key, value] of Object.entries(patch)) meta.set(key, value);
  });
}

export function metaBg(): string {
  return (meta.get('bg') as string) ?? COLORS.background;
}

export function metaGrid(): boolean {
  return (meta.get('grid') as boolean) ?? true;
}

export const undoManager = new Y.UndoManager([board, order], {
  trackedOrigins: new Set([LOCAL_ORIGIN]),
  captureTimeout: 200,
});

export const persistence = new IndexeddbPersistence('doska-v1', doc);

persistence.on('synced', () => {
  ensureOrder();
});

const SYNC_URL = `ws://${typeof location !== 'undefined' ? location.hostname : 'localhost'}:1234`;

let provider: WebsocketProvider | null = null;

export function getProvider(): WebsocketProvider {
  if (!provider) {
    provider = new WebsocketProvider(SYNC_URL, 'doska', doc);
  }
  return provider;
}

export function destroyProvider(): void {
  if (provider) {
    provider.destroy();
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
    fontSize: (m.get('fontSize') as number | undefined) ?? (type === 'sticky' ? STICKY_FONT : type === 'rect' || type === 'ellipse' ? SHAPE_FONT : TEXT_FONT),
    textColor: m.get('textColor') as string | undefined,
    alpha: m.get('alpha') as number | undefined,
    src: m.get('src') as string | undefined,
    locked: m.get('locked') as boolean | undefined,
    points: points instanceof Y.Array ? points.toArray() : undefined,
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
  if (v.type === 'sticky' || v.type === 'text' || v.type === 'rect' || v.type === 'ellipse') {
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
  return m;
}

export function addShape(v: Omit<ShapeView, 'id'> & { id?: string }): string {
  const id = v.id ?? makeId();
  const m = createShapeYMap({ ...v, id } as ShapeView);
  transact(() => {
    ensureOrder();
    board.set(id, m);
    order.push([id]);
  });
  return id;
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
