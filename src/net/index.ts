export { isSyncEnabled, boardRoomName } from './config';
export { p2pClient, attachP2p, detachP2p, reconnectP2p } from './p2p';
export type { SyncStatus, PeerCursor, PeerDraft, PeerErasePreview, PeerSummon, CursorPos, AwarenessUser, PeerConfettiBurst } from './types';
export type { BlobBytes, BlobSource, MeshEvent } from './p2p/mesh';
export type { MeshSnapshot, HubInfo, PeerInfo, LinkPath, LinkState, HubState, HubSource } from './p2p/types';
export { normalizeHubUrl } from './p2p/hub';
export { DEFAULT_ICE, findSelfHost, lanHostHub } from './p2p/hubs';
export type { HostProbe } from './p2p/hubs';
export { checkNat, type NatReport } from './p2p/natCheck';
export { currentTurn } from './p2p/turn';
export { canSelfUpdate, changeDataFolder, desktopHostInfo, desktopWindowBoard, installDesktopUpdate, isDesktop, openBoardsFolder } from './p2p/desktop';
export {
  isNetLogEnabled,
  setNetLogEnabled,
  netLog,
  bootNetLog,
  registerNetDebugPeek,
  parseNetFlag,
  mergeLocationSearch,
} from './log';
export type { NetLogLevel } from './log';
export {
  fetchLanAddresses,
  inviteHostname,
  isLocalHostname,
  appInviteUrl,
  lanAppUrl,
  lanBoardUrl,
  resolveInviteBoardUrl,
  formatHostForUrl,
} from './lan';
export type { LanInfo } from './lan';

import { p2pClient } from './p2p';
import { boardRoomName } from './config';
import type { CursorPos, PeerCursor, PeerDraft, PeerErasePreview, PeerSummon, SyncStatus } from './types';
import type { MeshSnapshot } from './p2p/types';
import type { BlobBytes, BlobSource } from './p2p/mesh';
import type { UserInfo } from '../core/user';
import type * as Y from 'yjs';

/** Join the board's P2P room. Board data never leaves this browser except to peers. */
export function attachSync(doc: Y.Doc, boardId: string): void {
  p2pClient.attach(doc, boardId);
}

/** True when any other awareness client is in the room, including another tab of the same user. */
export function hasRemoteCollaborators(): boolean {
  return p2pClient.hasOtherAwarenessClients();
}

/**
 * True when a different user id is in the roster. Other tabs of the same local
 * user are hidden from collectPeers and must not latch auto-compact off.
 */
export function hasDistinctRemoteCollaborators(): boolean {
  return p2pClient.collectPeers().length > 0;
}

/** Leave the board session (closes every link and hub socket). */
export function detachSync(): void {
  p2pClient.detach();
}

/** Answer peers' media requests from `source` (the local blob store). */
export function setBlobSource(source: BlobSource | null): void {
  p2pClient.setBlobSource(source);
}

/** Media bytes by SHA-256 from direct peers; null when none has them. */
export function fetchBlobFromPeers(hash: string): Promise<BlobBytes | null> {
  return p2pClient.fetchBlob(hash);
}

/** Runs whenever a data channel to a peer opens. */
export function onPeerLinkOpen(cb: (peer: string) => void): () => void {
  return p2pClient.onLinkOpen(cb);
}

/** Rebuild the mesh after prefs change. */
export function reconnectSync(): void {
  p2pClient.reconnect();
}

/** Re-resolve hubs and retry them now. */
export function refreshHubs(): void {
  p2pClient.refreshHubs();
}

export function publishPresence(user: UserInfo): void {
  p2pClient.publishPresence(user);
}

export function publishTool(tool: string): void {
  p2pClient.publishTool(tool);
}

export function publishPage(page: string): void {
  p2pClient.publishPage(page);
}

export function publishSummon(s: PeerSummon): void {
  p2pClient.publishSummon(s);
}

export function publishBoardView(viewing: boolean): void {
  p2pClient.publishBoardView(viewing);
}

export function sendCursor(pos: CursorPos | null): void {
  p2pClient.sendCursor(pos);
}

export function publishDraft(draft: PeerDraft | null): void {
  p2pClient.publishDraft(draft);
}

export function publishErasePreview(preview: PeerErasePreview | null): void {
  p2pClient.publishErasePreview(preview);
}

export function publishFocus(shapeId: string | null): void {
  p2pClient.publishFocus(shapeId);
}

export function publishSelection(ids: string[] | null): void {
  p2pClient.publishSelection(ids);
}

export function publishConfetti(origin: { x: number; y: number; seed: number; power?: number }): void {
  p2pClient.publishConfetti(origin);
}

export function onSyncStatus(cb: (status: SyncStatus) => void): () => void {
  let last: SyncStatus | null = null;
  return p2pClient.onStatus((next) => {
    // Cursor/draft awareness re-emits status on every packet; only forward real changes
    // or App setState-storms (random hitch).
    if (
      last &&
      last.online === next.online &&
      last.users === next.users &&
      last.enabled === next.enabled &&
      (last.error ?? null) === (next.error ?? null)
    ) {
      return;
    }
    last = next;
    cb(next);
  });
}

export function onPeers(cb: (peers: PeerCursor[]) => void): () => void {
  return p2pClient.onPeers(cb);
}

export function onMesh(cb: (snap: MeshSnapshot) => void): () => void {
  return p2pClient.onMesh(cb);
}

export function onSyncLifecycle(cb: () => void): () => void {
  return p2pClient.onLifecycle(cb);
}

export function getBoardRoomName(boardId?: string | null): string {
  return boardRoomName(boardId === undefined ? p2pClient.getBoardId() : boardId);
}

export function isSyncAttached(): boolean {
  return p2pClient.isAttached();
}

export function isAwarenessLeader(): boolean {
  return p2pClient.isAwarenessLeader();
}

/** Roster fingerprint helper for UI (ignore cursor xy churn). */
export function peerRosterKey(peers: PeerCursor[]): string {
  return p2pClient.rosterKey(peers);
}
