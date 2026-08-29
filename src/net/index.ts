export {
  defaultSyncUrl,
  effectiveSyncUrl,
  effectiveSyncPort,
  isLoopbackSyncHostname,
  isSyncEnabled,
  isStaticHost,
  isSyncAvailable,
  isP2pEnabled,
  p2pSignalingUrls,
  loopbackSyncHttpBase,
  boardRoomName,
} from './config';
export { SyncClient, syncClient } from './client';
export { p2pClient, attachP2p, detachP2p, reconnectP2p } from './p2p';
export type { SyncStatus, PeerCursor, PeerDraft, PeerErasePreview, CursorPos, AwarenessUser } from './types';
export { isNetLogEnabled, setNetLogEnabled, netLog, syncHttpBase } from './log';
export type { NetLogLevel } from './log';
export {
  fetchLanAddresses,
  inviteHostname,
  isLocalHostname,
  lanAppUrl,
  lanBoardUrl,
  resolveInviteBoardUrl,
} from './lan';
export type { LanInfo } from './lan';

import { syncClient } from './client';
import { p2pClient } from './p2p';
import { boardRoomName, isP2pEnabled } from './config';
import type { CursorPos, PeerCursor, PeerDraft, PeerErasePreview, SyncStatus } from './types';
import type { UserInfo } from '../core/user';
import type * as Y from 'yjs';

/** Attach the live board document to the sync hub (ws + optional p2p). */
export function attachSync(doc: Y.Doc, boardId: string): void {
  syncClient.attach(doc, boardId);
  if (isP2pEnabled()) p2pClient.attach(doc, boardId);
}

/** Leave the board session (stops WS + p2p, clears attachment). */
export function detachSync(): void {
  syncClient.detach();
  p2pClient.detach();
}

/** Rebuild the providers after prefs change. */
export function reconnectSync(): void {
  syncClient.reconnect();
  if (isP2pEnabled()) {
    if (p2pClient.isAttached()) {
      p2pClient.reconnect();
    } else {
      const doc = syncClient.getDoc();
      const boardId = syncClient.getBoardId();
      if (doc && boardId) p2pClient.attach(doc, boardId);
      else p2pClient.reconnect();
    }
  } else {
    p2pClient.disconnect();
  }
}

export function reconnectP2pOnly(): void {
  p2pClient.reconnect();
}

/** Ensure p2p is attached when toggled on outside of board lifecycle. */
export function ensureP2pAttached(doc: Y.Doc, boardId: string): void {
  if (isP2pEnabled()) p2pClient.attach(doc, boardId);
}

export function publishPresence(user: UserInfo): void {
  syncClient.publishPresence(user);
  p2pClient.publishPresence(user);
}

export function publishTool(tool: string): void {
  syncClient.publishTool(tool);
  p2pClient.publishTool(tool);
}

export function publishPage(page: string): void {
  syncClient.publishPage(page);
  p2pClient.publishPage(page);
}

export function publishBoardView(viewing: boolean): void {
  syncClient.publishBoardView(viewing);
  p2pClient.publishBoardView(viewing);
}

export function sendCursor(pos: CursorPos | null): void {
  syncClient.sendCursor(pos);
  p2pClient.sendCursor(pos);
}

export function publishDraft(draft: PeerDraft | null): void {
  syncClient.publishDraft(draft);
  p2pClient.publishDraft(draft);
}

export function publishErasePreview(preview: PeerErasePreview | null): void {
  syncClient.publishErasePreview(preview);
  p2pClient.publishErasePreview(preview);
}

function mergePeers(a: PeerCursor[], b: PeerCursor[]): PeerCursor[] {
  const byId = new Map<string, PeerCursor>();
  for (const p of [...a, ...b]) {
    const key = p.userId || String(p.id);
    byId.set(key, p);
  }
  return [...byId.values()];
}

function mergeStatus(
  ws: SyncStatus,
  p2p: SyncStatus,
  _wsPeers: PeerCursor[],
  _p2pPeers: PeerCursor[],
): SyncStatus {
  const enabled = ws.enabled || p2p.enabled;
  const online = ws.online || p2p.online;
  const error = p2p.error || ws.error || null;
  if (!online) return { online, users: 0, enabled, error };
  // Use awareness sizes directly for consistency with per-provider getStatus (awareness.getStates().size)
  const users = Math.max(ws.users, p2p.users);
  return { online, users, enabled, error };
}

export function onSyncStatus(cb: (status: SyncStatus) => void): () => void {
  let ws: SyncStatus = syncClient.getStatus();
  let p2p: SyncStatus = p2pClient.getStatus();
  let wsPeers: PeerCursor[] = syncClient.collectPeers();
  let p2pPeers: PeerCursor[] = p2pClient.collectPeers();
  const emit = () => cb(mergeStatus(ws, p2p, wsPeers, p2pPeers));
  const offWs = syncClient.onStatus((s) => { ws = s; emit(); });
  const offP2p = p2pClient.onStatus((s) => { p2p = s; emit(); });
  const offWsPeers = syncClient.onPeers((peers) => { wsPeers = peers; emit(); });
  const offP2pPeers = p2pClient.onPeers((peers) => { p2pPeers = peers; emit(); });
  // initial emit
  emit();
  return () => { offWs(); offP2p(); offWsPeers(); offP2pPeers(); };
}

export function onPeers(cb: (peers: PeerCursor[]) => void): () => void {
  let wsPeers: PeerCursor[] = syncClient.collectPeers();
  let p2pPeers: PeerCursor[] = p2pClient.collectPeers();
  const emit = () => cb(mergePeers(wsPeers, p2pPeers));
  const offWs = syncClient.onPeers((list) => { wsPeers = list; emit(); });
  const offP2p = p2pClient.onPeers((list) => { p2pPeers = list; emit(); });
  emit();
  return () => { offWs(); offP2p(); };
}

export function onSyncLifecycle(cb: () => void): () => void {
  const offWs = syncClient.onLifecycle(cb);
  const offP2p = p2pClient.onLifecycle(cb);
  return () => { offWs(); offP2p(); };
}

export function getBoardRoomName(boardId?: string | null): string {
  return boardRoomName(boardId === undefined ? syncClient.getBoardId() : boardId);
}

export function isSyncAttached(): boolean {
  return syncClient.isAttached();
}

/** Roster fingerprint helper for UI (ignore cursor xy churn). */
export function peerRosterKey(peers: PeerCursor[]): string {
  return syncClient.rosterKey(peers);
}
