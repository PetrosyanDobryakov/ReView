export {
  defaultSyncUrl,
  effectiveSyncUrl,
  isSyncEnabled,
  boardRoomName,
} from './config';
export { SyncClient, syncClient } from './client';
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
import { boardRoomName } from './config';
import type { CursorPos, PeerCursor, PeerDraft, PeerErasePreview, SyncStatus } from './types';
import type { UserInfo } from '../core/user';
import type * as Y from 'yjs';

/** Attach the live board document to the sync hub. */
export function attachSync(doc: Y.Doc, boardId: string): void {
  syncClient.attach(doc, boardId);
}

/** Leave the board session (stops WS, clears attachment). */
export function detachSync(): void {
  syncClient.detach();
}

/** Rebuild the provider after sync URL / enabled prefs change. */
export function reconnectSync(): void {
  syncClient.reconnect();
}

export function publishPresence(user: UserInfo): void {
  syncClient.publishPresence(user);
}

export function publishTool(tool: string): void {
  syncClient.publishTool(tool);
}

export function publishPage(page: string): void {
  syncClient.publishPage(page);
}

export function publishBoardView(viewing: boolean): void {
  syncClient.publishBoardView(viewing);
}

export function sendCursor(pos: CursorPos | null): void {
  syncClient.sendCursor(pos);
}

export function publishDraft(draft: PeerDraft | null): void {
  syncClient.publishDraft(draft);
}

export function publishErasePreview(preview: PeerErasePreview | null): void {
  syncClient.publishErasePreview(preview);
}

export function onSyncStatus(cb: (status: SyncStatus) => void): () => void {
  return syncClient.onStatus(cb);
}

export function onPeers(cb: (peers: PeerCursor[]) => void): () => void {
  return syncClient.onPeers(cb);
}

export function onSyncLifecycle(cb: () => void): () => void {
  return syncClient.onLifecycle(cb);
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
