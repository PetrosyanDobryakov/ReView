/** Local-only display overrides for remote peers (name / color). Does not rewrite awareness. */

export type PeerDisplayOverride = {
  name?: string;
  color?: string;
};

const STORAGE_KEY = 'review-peer-display-v1';

type Store = Record<string, PeerDisplayOverride>;

let cached: Store | null = null;
const listeners = new Set<() => void>();

function normalizeHex(raw: string): string | null {
  const s = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  return null;
}

function readStore(): Store {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const next: Store = {};
        for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (!id || !v || typeof v !== 'object') continue;
          const row = v as PeerDisplayOverride;
          const name = typeof row.name === 'string' ? row.name.trim().slice(0, 24) : undefined;
          const color = typeof row.color === 'string' ? normalizeHex(row.color) ?? undefined : undefined;
          if (name || color) next[id] = { ...(name ? { name } : {}), ...(color ? { color } : {}) };
        }
        cached = next;
        return cached;
      }
    }
  } catch {
    /* ignore */
  }
  cached = {};
  return cached;
}

function writeStore(store: Store): void {
  cached = store;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
  for (const l of [...listeners]) l();
}

export function getPeerOverride(peerUserId: string): PeerDisplayOverride | null {
  const row = readStore()[peerUserId];
  return row ?? null;
}

export function getPeerDisplay(
  peerUserId: string,
  published: { name: string; color: string }
): { name: string; color: string; overridden: boolean } {
  const o = getPeerOverride(peerUserId);
  if (!o) return { name: published.name, color: published.color, overridden: false };
  const name = o.name?.trim() ? o.name.trim().slice(0, 24) : published.name;
  const color = o.color || published.color;
  return {
    name,
    color,
    overridden: Boolean((o.name && o.name !== published.name) || (o.color && o.color !== published.color)),
  };
}

export function setPeerDisplay(peerUserId: string, patch: PeerDisplayOverride): void {
  if (!peerUserId) return;
  const store = { ...readStore() };
  const prev = store[peerUserId] ?? {};
  const name =
    patch.name !== undefined ? (patch.name.trim().slice(0, 24) || undefined) : prev.name;
  const color =
    patch.color !== undefined ? normalizeHex(patch.color) ?? prev.color : prev.color;
  const next: PeerDisplayOverride = {};
  if (name) next.name = name;
  if (color) next.color = color;
  if (!next.name && !next.color) {
    delete store[peerUserId];
  } else {
    store[peerUserId] = next;
  }
  writeStore(store);
}

export function clearPeerDisplay(peerUserId: string): void {
  if (!peerUserId) return;
  const store = { ...readStore() };
  if (!(peerUserId in store)) return;
  delete store[peerUserId];
  writeStore(store);
}

export function onPeerDisplayChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
