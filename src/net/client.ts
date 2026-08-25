/**
 * SyncClient — websocket + awareness for one board.
 *
 * Traffic posture:
 * - Doc updates: coalesced in store writeGate; polylines stored local-space.
 * - Cursors: ~25 Hz + trailing flush so the last pose always lands.
 * - Draft strokes: awareness-only, downsampled, ~20 Hz.
 * - Periodic resync heals rare stuck states without constant full dumps.
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { UserInfo } from '../core/user';
import { loadUser } from '../core/user';
import { getPeerDisplay, onPeerDisplayChange } from '../core/peerDisplay';
import { downsamplePolyline } from '../core/pointsSpace';
import { boardRoomName, effectiveSyncUrl, isSyncEnabled } from './config';
import { isNetLogEnabled, netLog } from './log';
import type { CursorPos, PeerCursor, PeerDraft, PeerErasePreview, SyncStatus } from './types';

type StatusListener = (status: SyncStatus) => void;
type PeerListener = (peers: PeerCursor[]) => void;
type LifecycleListener = () => void;

const CURSOR_MIN_MS = 40;
const CURSOR_LOG_SUMMARY_MS = 5000;
const DRAFT_MIN_MS = 50;
const DRAFT_MAX_VERTICES = 64;
const ERASE_MIN_MS = 50;
const ERASE_MAX_WHOLE = 48;
const ERASE_MAX_PARTIAL_SHAPES = 16;
const ERASE_MAX_PARTIAL_VERTS = 64;
/** Quantize world coords to cut awareness churn from sub-pixel jitter. */
const CURSOR_QUANT = 0.5;
/** Self-heal rare desync without hammering the hub. */
const RESYNC_INTERVAL_MS = 45_000;

function quantizeCursor(pos: CursorPos): CursorPos {
  return {
    x: Math.round(pos.x / CURSOR_QUANT) * CURSOR_QUANT,
    y: Math.round(pos.y / CURSOR_QUANT) * CURSOR_QUANT,
  };
}

function sameCursor(a: CursorPos | null, b: CursorPos | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y;
}

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
  private lastSentCursor: CursorPos | null = null;
  private lastTool: string | null = null;
  private lastPage: string | null = null;
  private lastViewing = true;
  private lastDraft: PeerDraft | null = null;
  private lastErase: PeerErasePreview | null = null;
  private lastCursorSent = 0;
  private lastDraftSent = 0;
  private lastEraseSent = 0;
  private cursorFlushTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.clearDraft();
    this.clearErasePreview();
    this.teardownProvider();
    this.doc = null;
    this.boardId = null;
    this.lastCursor = null;
    this.lastSentCursor = null;
    this.lastTool = null;
    this.lastPage = null;
    this.lastViewing = true;
    this.lastDraft = null;
    this.lastErase = null;
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
    const provider = new WebsocketProvider(url, room, this.doc, {
      resyncInterval: RESYNC_INTERVAL_MS,
      maxBackoffTime: 10_000,
    });
    this.provider = provider;
    this.providerUrl = url;
    this.providerRoom = room;
    this.bindProvider(provider);

    if (this.lastUser) this.writePresence(this.lastUser);
    else this.writePresence(loadUser());
    if (this.lastCursor) this.writeCursor(this.lastCursor);
    if (this.lastTool) this.writeTool(this.lastTool);
    if (this.lastPage) this.writePage(this.lastPage);
    this.writeViewing(this.lastViewing);
    if (this.lastDraft) this.writeDraft(this.lastDraft);
    if (this.lastErase) this.writeErasePreview(this.lastErase);

    this.emitStatus();
    this.emitPeers();
  }

  disconnect(): void {
    netLog.info('disconnect', () => ({
      boardId: this.boardId,
      room: this.providerRoom,
      url: this.providerUrl,
    }));
    this.clearDraft();
    this.clearErasePreview();
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
      const viewingRaw = state.viewing;
      const viewing = viewingRaw !== false;
      const draft = parseDraft(state.draft);
      const erasePreview = parseErasePreview(state.erasePreview);
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
        viewing,
        draft,
        erasePreview,
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
    if (tool !== 'eraser') this.clearErasePreview();
    netLog.info('publishTool', () => ({ tool }));
    this.writeTool(tool);
  }

  publishPage(page: string): void {
    if (this.lastPage === page) return;
    this.lastPage = page;
    netLog.info('publishPage', () => ({ page }));
    this.writePage(page);
  }

  /** True while the tab is focused on `/board/:id` (false = alt-tab, home, or minimized). */
  publishBoardView(viewing: boolean): void {
    if (this.lastViewing === viewing) return;
    this.lastViewing = viewing;
    if (!viewing) {
      this.clearDraft();
      this.clearErasePreview();
    }
    netLog.info('publishBoardView', () => ({ viewing }));
    this.writeViewing(viewing);
  }

  sendCursor(pos: CursorPos | null): void {
    this.lastCursor = pos ? quantizeCursor(pos) : null;
    if (this.lastCursor && sameCursor(this.lastCursor, this.lastSentCursor)) {
      return;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.lastCursor) {
      const wait = CURSOR_MIN_MS - (now - this.lastCursorSent);
      if (wait > 0) {
        if (!this.cursorFlushTimer) {
          this.cursorFlushTimer = setTimeout(() => {
            this.cursorFlushTimer = null;
            this.flushCursor();
          }, wait);
        }
        return;
      }
    } else if (this.cursorFlushTimer) {
      clearTimeout(this.cursorFlushTimer);
      this.cursorFlushTimer = null;
    }
    this.flushCursor(now);
  }

  /**
   * Publish an in-progress pen stroke to peers (awareness only).
   * Pass null to clear after commit/cancel.
   */
  publishDraft(draft: PeerDraft | null): void {
    if (!draft) {
      this.clearDraft();
      return;
    }
    const slim: PeerDraft = {
      kind: 'pen',
      points: downsamplePolyline(draft.points, DRAFT_MAX_VERTICES),
      stroke: draft.stroke,
      strokeWidth: draft.strokeWidth,
      ...(draft.alpha !== undefined ? { alpha: draft.alpha } : {}),
    };
    this.lastDraft = slim;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastDraftSent < DRAFT_MIN_MS) return;
    this.lastDraftSent = now;
    this.writeDraft(slim);
  }

  /**
   * Publish live eraser hover targets to peers (awareness only).
   * Pass null to clear after commit/cancel/tool change.
   */
  publishErasePreview(preview: PeerErasePreview | null): void {
    if (!preview) {
      this.clearErasePreview();
      return;
    }
    const slim: PeerErasePreview = {
      x: Math.round(preview.x / CURSOR_QUANT) * CURSOR_QUANT,
      y: Math.round(preview.y / CURSOR_QUANT) * CURSOR_QUANT,
      r: preview.r,
      mode: preview.mode,
      whole: preview.whole.slice(0, ERASE_MAX_WHOLE),
      ...(preview.partial
        ? {
            partial: Object.fromEntries(
              Object.entries(preview.partial)
                .slice(0, ERASE_MAX_PARTIAL_SHAPES)
                .map(([id, indices]) => [id, indices.slice(0, ERASE_MAX_PARTIAL_VERTS)])
            ),
          }
        : {}),
    };
    if (sameErasePreview(slim, this.lastErase)) return;
    this.lastErase = slim;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastEraseSent < ERASE_MIN_MS) return;
    this.lastEraseSent = now;
    this.writeErasePreview(slim);
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

  private clearErasePreview(): void {
    if (this.lastErase === null && !this.provider) return;
    this.lastErase = null;
    this.writeErasePreview(null);
  }

  private clearDraft(): void {
    if (this.lastDraft === null && !this.provider) return;
    this.lastDraft = null;
    this.writeDraft(null);
  }

  private flushCursor(now = typeof performance !== 'undefined' ? performance.now() : Date.now()): void {
    if (this.cursorFlushTimer) {
      clearTimeout(this.cursorFlushTimer);
      this.cursorFlushTimer = null;
    }
    const pos = this.lastCursor;
    if (pos && sameCursor(pos, this.lastSentCursor)) return;
    this.lastCursorSent = now;
    this.lastSentCursor = pos;
    this.logCursorSend(pos, now);
    this.writeCursor(pos);
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

  private writeViewing(viewing: boolean): void {
    try {
      this.provider?.awareness.setLocalStateField('viewing', viewing);
    } catch (err) {
      netLog.warn('writeViewing failed', () => ({ err }));
    }
  }

  private writeDraft(draft: PeerDraft | null): void {
    try {
      this.provider?.awareness.setLocalStateField('draft', draft);
    } catch (err) {
      netLog.warn('writeDraft failed', () => ({ err }));
    }
  }

  private writeErasePreview(preview: PeerErasePreview | null): void {
    try {
      this.provider?.awareness.setLocalStateField('erasePreview', preview);
    } catch (err) {
      netLog.warn('writeErasePreview failed', () => ({ err }));
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
        this.writeViewing(this.lastViewing);
        if (this.lastCursor) this.writeCursor(this.lastCursor);
        if (this.lastDraft) this.writeDraft(this.lastDraft);
        if (this.lastErase) this.writeErasePreview(this.lastErase);
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
    if (this.cursorFlushTimer) {
      clearTimeout(this.cursorFlushTimer);
      this.cursorFlushTimer = null;
    }
    this.offProviderStatus?.();
    this.offAwareness?.();
    this.offProviderStatus = null;
    this.offAwareness = null;
    this.offPeerDisplay?.();
    this.offPeerDisplay = null;
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
    this.lastSentCursor = null;
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
            hasDraft: Boolean(p.draft),
            hasErasePreview: Boolean(p.erasePreview),
          })),
        }));
      }
    }
    for (const l of [...this.peerListeners]) l(peers);
  }

  /** Stable roster fingerprint (ignores cursor coords / draft geometry). */
  rosterKey(peers: PeerCursor[] = this.collectPeers()): string {
    return peers
      .map(
        (p) =>
          `${p.id}\0${p.userId}\0${p.name}\0${p.color}\0${p.overridden ? 1 : 0}\0${p.tool ?? ''}\0${p.page ?? ''}\0${p.viewing ? 1 : 0}\0${p.draft ? 1 : 0}\0${p.erasePreview ? 1 : 0}`
      )
      .join('\n');
  }

  private emitLifecycle(): void {
    for (const l of [...this.lifecycleListeners]) l();
  }
}

function sameErasePreview(a: PeerErasePreview | null, b: PeerErasePreview | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.x !== b.x || a.y !== b.y || a.r !== b.r || a.mode !== b.mode) return false;
  if (a.whole.length !== b.whole.length) return false;
  for (let i = 0; i < a.whole.length; i++) {
    if (a.whole[i] !== b.whole[i]) return false;
  }
  const ap = a.partial ?? {};
  const bp = b.partial ?? {};
  const aKeys = Object.keys(ap);
  const bKeys = Object.keys(bp);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    const ai = ap[k];
    const bi = bp[k];
    if (!bi || ai.length !== bi.length) return false;
    for (let i = 0; i < ai.length; i++) {
      if (ai[i] !== bi[i]) return false;
    }
  }
  return true;
}

function parseDraft(raw: unknown): PeerDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.kind !== 'pen') return null;
  if (!Array.isArray(d.points) || d.points.length < 4) return null;
  if (typeof d.stroke !== 'string' || typeof d.strokeWidth !== 'number') return null;
  const points: number[] = [];
  for (const n of d.points) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    points.push(n);
  }
  if (points.length % 2 !== 0) return null;
  return {
    kind: 'pen',
    points,
    stroke: d.stroke,
    strokeWidth: d.strokeWidth,
    ...(typeof d.alpha === 'number' ? { alpha: d.alpha } : {}),
  };
}

function parseErasePreview(raw: unknown): PeerErasePreview | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.x !== 'number' || typeof e.y !== 'number' || typeof e.r !== 'number') return null;
  if (e.mode !== 'whole' && e.mode !== 'partial') return null;
  if (!Array.isArray(e.whole)) return null;
  const whole: string[] = [];
  for (const id of e.whole) {
    if (typeof id === 'string' && id) whole.push(id);
  }
  let partial: Record<string, number[]> | undefined;
  if (e.partial && typeof e.partial === 'object') {
    partial = {};
    for (const [id, indices] of Object.entries(e.partial as Record<string, unknown>)) {
      if (!Array.isArray(indices)) continue;
      const verts: number[] = [];
      for (const n of indices) {
        if (typeof n === 'number' && Number.isFinite(n)) verts.push(n);
      }
      if (verts.length) partial[id] = verts;
    }
    if (!Object.keys(partial).length) partial = undefined;
  }
  return { x: e.x, y: e.y, r: e.r, mode: e.mode, whole, ...(partial ? { partial } : {}) };
}

/** App-wide sync client (one active board at a time). */
export const syncClient = new SyncClient();
