import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { UserInfo } from '../core/user';
import { loadUser } from '../core/user';
import { getPeerDisplay, onPeerDisplayChange } from '../core/peerDisplay';
import { boardRoomName, effectiveSyncUrl, isSyncEnabled } from './config';
import { isNetLogEnabled, netLog } from './log';
import type { CursorPos, PeerCursor, SyncStatus } from './types';

type StatusListener = (status: SyncStatus) => void;
type PeerListener = (peers: PeerCursor[]) => void;
type LifecycleListener = () => void;

const CURSOR_MIN_MS = 40;
const CURSOR_LOG_SUMMARY_MS = 5000;

/**
 * One board’s websocket + awareness session.
 * Explicit connect/disconnect — subscribing never opens a socket by itself.
 */
export class SyncClient {
  private doc: Y.Doc | null = null;
  private boardId: string | null = null;
  private provider: WebsocketProvider | null = null;
  private providerUrl: string | null = null;
  private providerRoom: string | null = null;

  private lastUser: UserInfo | null = null;
  private lastCursor: CursorPos | null = null;
  private lastTool: string | null = null;
  private lastPage: string | null = null;
  private lastCursorSent = 0;

  private lastEmittedStatus: SyncStatus | null = null;
  private lastLoggedRosterKey = '';
  private lastCursorLogState: 'on' | 'off' | null = null;
  private cursorSendCount = 0;
  private lastCursorSummaryAt = 0;

  private readonly statusListeners = new Set<StatusListener>();
  private readonly peerListeners = new Set<PeerListener>();
  private readonly lifecycleListeners = new Set<LifecycleListener>();

  private offProviderStatus: (() => void) | null = null;
  private offAwareness: (() => void) | null = null;
  private offPeerDisplay: (() => void) | null = null;

  /** Bind a Y.Doc to a board room and connect if sync is enabled. */
  attach(doc: Y.Doc, boardId: string): void {
    if (this.doc === doc && this.boardId === boardId && this.provider) {
      netLog.debug('attach noop (already attached)', () => ({
        boardId,
        room: boardRoomName(boardId),
      }));
      this.emitLifecycle();
      return;
    }
    netLog.info('attach', () => ({
      boardId,
      room: boardRoomName(boardId),
      syncEnabled: isSyncEnabled(),
      url: effectiveSyncUrl(),
    }));
    this.teardownProvider();
    this.doc = doc;
    this.boardId = boardId;
    if (isSyncEnabled()) this.connect();
    this.emitLifecycle();
    this.emitStatus();
    this.emitPeers();
  }

  /** Drop the board session (leave `/board/:id`). */
  detach(): void {
    netLog.info('detach', () => ({
      boardId: this.boardId,
      room: this.providerRoom ?? boardRoomName(this.boardId),
    }));
    this.teardownProvider();
    this.doc = null;
    this.boardId = null;
    this.lastCursor = null;
    this.lastTool = null;
    this.lastPage = null;
    this.lastEmittedStatus = null;
    this.lastLoggedRosterKey = '';
    this.lastCursorLogState = null;
    this.cursorSendCount = 0;
    this.emitLifecycle();
    this.emitStatus();
    this.emitPeers();
  }

  /** Apply prefs (URL / enabled) by rebuilding the provider when attached. */
  reconnect(): void {
    netLog.info('reconnect', () => ({
      boardId: this.boardId,
      attached: Boolean(this.doc && this.boardId),
      syncEnabled: isSyncEnabled(),
      url: effectiveSyncUrl(),
    }));
    this.teardownProvider();
    if (this.doc && this.boardId && isSyncEnabled()) this.connect();
    this.emitLifecycle();
    this.emitStatus();
    this.emitPeers();
  }

  connect(): void {
    if (!this.doc || !this.boardId) {
      netLog.warn('connect skipped (not attached)');
      return;
    }
    if (!isSyncEnabled()) {
      netLog.info('connect skipped (sync disabled)', () => ({ boardId: this.boardId }));
      return;
    }

    const url = effectiveSyncUrl();
    const room = boardRoomName(this.boardId);

    if (
      this.provider &&
      this.providerUrl === url &&
      this.providerRoom === room
    ) {
      netLog.debug('connect noop (same provider)', () => ({ url, room, boardId: this.boardId }));
      return;
    }

    this.teardownProvider();
    netLog.info('provider create', () => ({ url, room, boardId: this.boardId }));
    const provider = new WebsocketProvider(url, room, this.doc);
    this.provider = provider;
    this.providerUrl = url;
    this.providerRoom = room;
    this.bindProvider(provider);

    if (this.lastUser) this.writePresence(this.lastUser);
    else this.writePresence(loadUser());
    if (this.lastCursor) this.writeCursor(this.lastCursor);
    if (this.lastTool) this.writeTool(this.lastTool);
    if (this.lastPage) this.writePage(this.lastPage);

    this.emitStatus();
    this.emitPeers();
  }

  disconnect(): void {
    netLog.info('disconnect', () => ({
      boardId: this.boardId,
      room: this.providerRoom,
      url: this.providerUrl,
    }));
    this.teardownProvider();
    this.emitStatus();
    this.emitPeers();
  }

  isAttached(): boolean {
    return this.doc !== null && this.boardId !== null;
  }

  getBoardId(): string | null {
    return this.boardId;
  }

  roomName(): string {
    return boardRoomName(this.boardId);
  }

  getStatus(): SyncStatus {
    const enabled = isSyncEnabled();
    const p = this.provider;
    if (!p || !enabled) return { online: false, users: 0, enabled };
    const online = p.ws?.readyState === WebSocket.OPEN;
    return {
      online,
      users: online ? p.awareness.getStates().size : 0,
      enabled,
    };
  }

  collectPeers(): PeerCursor[] {
    const p = this.provider;
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
      const cur = state.cursor as CursorPos | null | undefined;
      const toolRaw = state.tool;
      const tool = typeof toolRaw === 'string' && toolRaw.trim() ? toolRaw.trim() : null;
      const pageRaw = state.page;
      const page = typeof pageRaw === 'string' && pageRaw.trim() ? pageRaw.trim() : null;
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
        tool,
        page,
      });
    }
    return peers;
  }

  publishPresence(user: UserInfo): void {
    this.lastUser = user;
    netLog.info('publishPresence', () => ({
      id: user.id,
      name: user.name,
      color: user.color,
    }));
    this.writePresence(user);
  }

  publishTool(tool: string): void {
    if (this.lastTool === tool) return;
    this.lastTool = tool;
    netLog.info('publishTool', () => ({ tool }));
    this.writeTool(tool);
  }

  publishPage(page: string): void {
    if (this.lastPage === page) return;
    this.lastPage = page;
    netLog.info('publishPage', () => ({ page }));
    this.writePage(page);
  }

  sendCursor(pos: CursorPos | null): void {
    this.lastCursor = pos;
    if (pos) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - this.lastCursorSent < CURSOR_MIN_MS) return;
      this.lastCursorSent = now;
      this.logCursorSend(pos, now);
    } else {
      this.logCursorSend(null, typeof performance !== 'undefined' ? performance.now() : Date.now());
    }
    this.writeCursor(pos);
  }

  onStatus(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    cb(this.getStatus());
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  onPeers(cb: PeerListener): () => void {
    this.peerListeners.add(cb);
    cb(this.collectPeers());
    return () => {
      this.peerListeners.delete(cb);
    };
  }

  onLifecycle(cb: LifecycleListener): () => void {
    this.lifecycleListeners.add(cb);
    return () => {
      this.lifecycleListeners.delete(cb);
    };
  }

  private logCursorSend(pos: CursorPos | null, now: number): void {
    if (!isNetLogEnabled()) return;
    if (!pos) {
      if (this.lastCursorLogState !== 'off') {
        netLog.debug('cursor', { state: 'off' });
        this.lastCursorLogState = 'off';
        this.cursorSendCount = 0;
      }
      return;
    }
    this.cursorSendCount += 1;
    if (this.lastCursorLogState !== 'on') {
      netLog.debug('cursor', { state: 'on' });
      this.lastCursorLogState = 'on';
      this.lastCursorSummaryAt = now;
      this.cursorSendCount = 0;
      return;
    }
    if (now - this.lastCursorSummaryAt >= CURSOR_LOG_SUMMARY_MS) {
      netLog.debug('cursor', { state: 'active', sends: this.cursorSendCount });
      this.cursorSendCount = 0;
      this.lastCursorSummaryAt = now;
    }
  }

  private writePresence(user: UserInfo): void {
    try {
      this.provider?.awareness.setLocalStateField('user', user);
    } catch (err) {
      netLog.warn('writePresence failed', () => ({ err }));
    }
  }

  private writeCursor(pos: CursorPos | null): void {
    try {
      this.provider?.awareness.setLocalStateField('cursor', pos);
    } catch (err) {
      netLog.warn('writeCursor failed', () => ({ err }));
    }
  }

  private writeTool(tool: string): void {
    try {
      this.provider?.awareness.setLocalStateField('tool', tool);
    } catch (err) {
      netLog.warn('writeTool failed', () => ({ err }));
    }
  }

  private writePage(page: string): void {
    try {
      this.provider?.awareness.setLocalStateField('page', page);
    } catch (err) {
      netLog.warn('writePage failed', () => ({ err }));
    }
  }

  private bindProvider(provider: WebsocketProvider): void {
    const onStatus = (e: { status: string }) => {
      netLog.info('ws status', () => ({
        status: e.status,
        url: this.providerUrl,
        room: this.providerRoom,
        boardId: this.boardId,
      }));
      if (e.status === 'connected') {
        if (this.lastUser) this.writePresence(this.lastUser);
        else this.writePresence(loadUser());
        if (this.lastTool) this.writeTool(this.lastTool);
        if (this.lastPage) this.writePage(this.lastPage);
      }
      this.emitStatus();
      this.emitPeers();
    };
    const onAware = () => {
      this.emitStatus();
      this.emitPeers();
    };
    provider.on('status', onStatus);
    provider.awareness.on('change', onAware);
    this.offProviderStatus = () => provider.off('status', onStatus);
    this.offAwareness = () => provider.awareness.off('change', onAware);

    if (!this.offPeerDisplay) {
      this.offPeerDisplay = onPeerDisplayChange(() => this.emitPeers());
    }
  }

  private teardownProvider(): void {
    this.offProviderStatus?.();
    this.offAwareness?.();
    this.offProviderStatus = null;
    this.offAwareness = null;
    if (this.provider) {
      netLog.info('provider destroy', () => ({
        url: this.providerUrl,
        room: this.providerRoom,
        boardId: this.boardId,
      }));
      try {
        this.provider.destroy();
      } catch (err) {
        netLog.warn('provider destroy error', () => ({ err }));
      }
    }
    this.provider = null;
    this.providerUrl = null;
    this.providerRoom = null;
    this.lastLoggedRosterKey = '';
  }

  private emitStatus(): void {
    const status = this.getStatus();
    const prev = this.lastEmittedStatus;
    if (
      prev &&
      prev.online === status.online &&
      prev.users === status.users &&
      prev.enabled === status.enabled
    ) {
      return;
    }
    this.lastEmittedStatus = status;
    netLog.info('status', () => ({
      ...status,
      boardId: this.boardId,
      room: this.providerRoom ?? boardRoomName(this.boardId),
      url: this.providerUrl ?? effectiveSyncUrl(),
    }));
    for (const l of [...this.statusListeners]) l(status);
  }

  private emitPeers(): void {
    const peers = this.collectPeers();
    if (isNetLogEnabled()) {
      const key = this.rosterKey(peers);
      if (key !== this.lastLoggedRosterKey) {
        this.lastLoggedRosterKey = key;
        netLog.info('awareness roster', () => ({
          peerCount: peers.length,
          awarenessSize: this.provider?.awareness.getStates().size ?? 0,
          roster: peers.map((p) => ({
            id: p.id,
            userId: p.userId,
            name: p.name,
            color: p.color,
            tool: p.tool,
            page: p.page,
            hasCursor: p.x != null && p.y != null,
          })),
        }));
      }
    }
    for (const l of [...this.peerListeners]) l(peers);
  }

  /** Stable roster fingerprint (ignores cursor coords). */
  rosterKey(peers: PeerCursor[] = this.collectPeers()): string {
    return peers
      .map((p) => `${p.id}\0${p.userId}\0${p.name}\0${p.color}\0${p.overridden ? 1 : 0}\0${p.tool ?? ''}\0${p.page ?? ''}`)
      .join('\n');
  }

  private emitLifecycle(): void {
    for (const l of [...this.lifecycleListeners]) l();
  }
}

/** App-wide sync client (one active board at a time). */
export const syncClient = new SyncClient();
