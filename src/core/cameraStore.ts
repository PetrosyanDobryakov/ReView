export interface SavedView {
  x: number;
  y: number;
  zoom: number;
}

function keyFor(boardId: string, pageId: string): string {
  return `review-camera-${boardId}:${pageId}`;
}

function legacyKeyFor(boardId: string): string {
  return `review-camera-${boardId}`;
}

export function loadCamera(boardId: string, pageId: string): SavedView | null {
  try {
    const raw = localStorage.getItem(keyFor(boardId, pageId));
    if (raw) {
      const v = JSON.parse(raw) as SavedView;
      if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom)) {
        return { x: v.x, y: v.y, zoom: Math.min(4, Math.max(0.1, v.zoom)) };
      }
    }
    const legacy = localStorage.getItem(legacyKeyFor(boardId));
    if (legacy) {
      const v = JSON.parse(legacy) as SavedView;
      if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom)) {
        return { x: v.x, y: v.y, zoom: Math.min(4, Math.max(0.1, v.zoom)) };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saveCamera(boardId: string, pageId: string, view: SavedView): void {
  try {
    localStorage.setItem(keyFor(boardId, pageId), JSON.stringify(view));
  } catch {
    /* ignore */
  }
}
