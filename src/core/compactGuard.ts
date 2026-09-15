/**
 * Compact is a Y.Doc rebuild. Syncing that snapshot with any live replica of
 * the old document duplicates shapes and reintroduces tombstones.
 *
 * Hidden tabs drop the websocket, so awareness is not a complete replica set.
 * Same-origin tabs leave a localStorage heartbeat; remote peers that were
 * recently visible leave a timestamp. Compact also requires a real size win —
 * a 12MB photo board with no tombstone waste must not rebuild.
 */

export const COMPACT_SAVE_RATIO = 0.7;
export const COMPACT_PEER_GRACE_MS = 120_000;
export const REPLICA_TTL_MS = 120_000;
export const REPLICA_BEAT_MS = 15_000;

const REPLICA_KEY = (boardId: string) => `review-replica-${boardId}`;
const LAST_PEER_KEY = (boardId: string) => `review-last-peer-${boardId}`;
const HAD_REMOTE_KEY = (boardId: string) => `review-had-remote-${boardId}`;

export type KvStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const memory: Record<string, string> = {};
const memoryStore: KvStore = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(memory, k) ? memory[k]! : null),
  setItem: (k, v) => {
    memory[k] = v;
  },
  removeItem: (k) => {
    delete memory[k];
  },
};

function defaultStore(): KvStore {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* private mode */
  }
  return memoryStore;
}

let tabId = '';

export function replicaTabId(storage: KvStore = defaultStore()): string {
  if (tabId) return tabId;
  try {
    if (typeof sessionStorage !== 'undefined') {
      tabId = sessionStorage.getItem('review-tab-id') || '';
      if (!tabId) {
        tabId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        sessionStorage.setItem('review-tab-id', tabId);
      }
      return tabId;
    }
  } catch {
    /* ignore */
  }
  tabId = 'mem-' + Math.random().toString(36).slice(2, 10);
  void storage;
  return tabId;
}

/** True only when the rebuilt doc is at least 30% smaller. Size alone is not a reason to compact. */
export function compactSavesEnough(before: number, after: number, ratio = COMPACT_SAVE_RATIO): boolean {
  if (!(before > 0) || !(after >= 0) || !Number.isFinite(before) || !Number.isFinite(after)) return false;
  return after < before * ratio;
}

export function compactBlockedByRecentPeer(lastOtherAt: number, now: number, grace = COMPACT_PEER_GRACE_MS): boolean {
  return lastOtherAt > 0 && now - lastOtherAt < grace;
}

export type ReplicaMap = Record<string, number>;

export function parseReplicaMap(raw: string | null): ReplicaMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ReplicaMap = {};
    for (const [id, ts] of Object.entries(parsed as Record<string, unknown>)) {
      if (!id) continue;
      const n = typeof ts === 'number' ? ts : Number(ts);
      if (Number.isFinite(n)) out[id] = n;
    }
    return out;
  } catch {
    return {};
  }
}

export function pruneReplicaMap(map: ReplicaMap, now: number, ttl = REPLICA_TTL_MS): ReplicaMap {
  const out: ReplicaMap = {};
  for (const [id, ts] of Object.entries(map)) {
    if (now - ts < ttl) out[id] = ts;
  }
  return out;
}

export function replicaMapHasOther(map: ReplicaMap, selfId: string, now: number, ttl = REPLICA_TTL_MS): boolean {
  for (const [id, ts] of Object.entries(map)) {
    if (id !== selfId && now - ts < ttl) return true;
  }
  return false;
}

export function touchReplica(
  boardId: string,
  now = Date.now(),
  tab = replicaTabId(),
  storage: KvStore = defaultStore()
): void {
  if (!boardId) return;
  const key = REPLICA_KEY(boardId);
  const map = pruneReplicaMap(parseReplicaMap(storage.getItem(key)), now);
  map[tab] = now;
  try {
    storage.setItem(key, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

export function releaseReplica(
  boardId: string,
  tab = replicaTabId(),
  storage: KvStore = defaultStore()
): void {
  if (!boardId) return;
  const key = REPLICA_KEY(boardId);
  const map = parseReplicaMap(storage.getItem(key));
  delete map[tab];
  try {
    if (Object.keys(map).length) storage.setItem(key, JSON.stringify(map));
    else storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function hasOtherLocalReplicas(
  boardId: string,
  now = Date.now(),
  tab = replicaTabId(),
  storage: KvStore = defaultStore()
): boolean {
  if (!boardId) return false;
  const map = parseReplicaMap(storage.getItem(REPLICA_KEY(boardId)));
  return replicaMapHasOther(map, tab, now);
}

export function noteRemotePeer(boardId: string, now = Date.now(), storage: KvStore = defaultStore()): void {
  if (!boardId) return;
  try {
    storage.setItem(LAST_PEER_KEY(boardId), String(now));
  } catch {
    /* ignore */
  }
}

/**
 * Sticky latch: this origin once saw a collaborator who is not the same local user.
 * Auto-compact must never rebuild after that — a hidden remote tab drops its
 * websocket, and a 2-minute grace is not a replica set.
 */
export function markBoardHadRemote(boardId: string, storage: KvStore = defaultStore()): void {
  if (!boardId) return;
  try {
    storage.setItem(HAD_REMOTE_KEY(boardId), '1');
  } catch {
    /* ignore */
  }
}

export function boardHadRemoteCollaborators(boardId: string, storage: KvStore = defaultStore()): boolean {
  if (!boardId) return false;
  return storage.getItem(HAD_REMOTE_KEY(boardId)) === '1';
}

/** Record a distinct remote and latch so auto-compact stays off for this board. */
export function noteDistinctRemote(boardId: string, now = Date.now(), storage: KvStore = defaultStore()): void {
  noteRemotePeer(boardId, now, storage);
  markBoardHadRemote(boardId, storage);
}

export function lastRemotePeerAt(boardId: string, storage: KvStore = defaultStore()): number {
  if (!boardId) return 0;
  const n = Number(storage.getItem(LAST_PEER_KEY(boardId)));
  return Number.isFinite(n) ? n : 0;
}

export function remotePeerRecentlySeen(
  boardId: string,
  now = Date.now(),
  grace = COMPACT_PEER_GRACE_MS,
  storage: KvStore = defaultStore()
): boolean {
  return compactBlockedByRecentPeer(lastRemotePeerAt(boardId, storage), now, grace);
}

let beatTimer: ReturnType<typeof setInterval> | null = null;
let beatBoardId: string | null = null;
let remoteCheck: (() => boolean) | null = null;
let hideListener: (() => void) | null = null;

function pulse(): void {
  if (!beatBoardId) return;
  touchReplica(beatBoardId);
  if (remoteCheck?.()) noteDistinctRemote(beatBoardId);
}

export function startReplicaHeartbeat(boardId: string, hasRemote?: () => boolean): void {
  stopReplicaHeartbeat();
  beatBoardId = boardId;
  remoteCheck = hasRemote ?? null;
  pulse();
  beatTimer = setInterval(pulse, REPLICA_BEAT_MS);
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    hideListener = () => {
      if (document.visibilityState === 'hidden') pulse();
    };
    document.addEventListener('visibilitychange', hideListener);
  }
}

export function stopReplicaHeartbeat(release = true): void {
  if (beatTimer) {
    clearInterval(beatTimer);
    beatTimer = null;
  }
  if (hideListener && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', hideListener);
    hideListener = null;
  }
  remoteCheck = null;
  if (release && beatBoardId) releaseReplica(beatBoardId);
  beatBoardId = null;
}
