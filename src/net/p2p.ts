/**
 * Optional P2P sync via y-webrtc. Used on Vercel/static where no
 * central websocket server exists. Awareness (cursors, presence) is
 * shared via the same Yjs awareness channel.
 */

import * as Y from 'yjs';
import type { WebrtcProvider } from 'y-webrtc';
import { loadUser } from '../core/user';
import { getPeerDisplay, onPeerDisplayChange } from '../core/peerDisplay';
import { boardRoomName, isP2pEnabled, p2pSignalingUrls } from './config';
import { netLog } from './log';
import type { CursorPos, PeerCursor, PeerDraft, PeerErasePreview, SyncStatus } from './types';
import type { UserInfo } from '../core/user';

const P2P_RETRY_BASE_MS = 1000;
const P2P_RETRY_MAX_MS = 30000;

type StatusListener = (s: SyncStatus) => void;
type PeerListener = (p: PeerCursor[]) => void;
type LifecycleListener = () => void;

class P2pClient {
  private doc: Y.Doc | null = null;
  private boardId: string | null = null;
  private provider: unknown | null = null;
  private providerRoom: string | null = null;
  private pendingTeardown: Promise<void> = Promise.resolve();
  private connectGate: Promise<void> = Promise.resolve();

  private lastUser: UserInfo | null = null;
  private lastCursor: CursorPos | null = null;
  private lastTool: string | null = null;
  private lastPage: string | null = null;
  private lastViewing = true;
  private lastDraft: PeerDraft | null = null;
  private lastErase: PeerErasePreview | null = null;

  private lastError: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;

  private readonly statusListeners = new Set<StatusListener>();
  private readonly peerListeners = new Set<PeerListener>();
  private readonly lifecycleListeners = new Set<LifecycleListener>();
  private offPeerDisplay: (() => void) | null = null;
  private awarenessChangeHandler: (() => void) | null = null;
  private statusHandler: (() => void) | null = null;

  attach(doc: Y.Doc, boardId: string): void {
    if (this.doc === doc && this.boardId === boardId && this.provider) return;
    netLog.info('p2p attach', () => ({ boardId, room: boardRoomName(boardId) }));
    this.teardown();
    this.clearRetryTimer();
    this.retryAttempt = 0;
    this.lastError = null;
    this.doc = doc;
    this.boardId = boardId;
    if (isP2pEnabled()) void this.connect();
    this.emitLifecycle();
    this.emitStatus();
    this.emitPeers();
  }

  detach(): void {
    netLog.info('p2p detach', () => ({ boardId: this.boardId }));
    this.teardown();
    this.clearRetryTimer();
    this.retryAttempt = 0;
    this.lastError = null;
    this.doc = null;
    this.boardId = null;
    this.emitLifecycle();
    this.emitStatus();
    this.emitPeers();
  }

  reconnect(): void {
    netLog.info('p2p reconnect', () => ({ boardId: this.boardId, p2pEnabled: isP2pEnabled() }));
    this.teardown();
    this.clearRetryTimer();
    this.retryAttempt = 0;
    this.lastError = null;
    if (this.doc && this.boardId && isP2pEnabled()) void this.connect();
    this.emitLifecycle();
    this.emitStatus();
    this.emitPeers();
  }

  async connect(): Promise<void> {
    const prevGate = this.connectGate;
    let release!: () => void;
    this.connectGate = new Promise<void>(r => (release = r));
    await prevGate;
    try {
      await this.pendingTeardown;
      if (!this.doc || !this.boardId) return;
      if (!isP2pEnabled()) return;
      const expectedDoc = this.doc;
      const expectedBoardId = this.boardId;
      const room = boardRoomName(expectedBoardId);
      if (this.provider && this.providerRoom === room) return;
      this.teardown();
      await this.pendingTeardown;
      try {
        const mod = await import('y-webrtc');
      // Re-check after async gap: detach() or attach(newBoard) may have run during import.
      if (!this.doc || !this.boardId) return;
      if (this.doc !== expectedDoc || this.boardId !== expectedBoardId) return;
      if (boardRoomName(this.boardId) !== room) return;
      if (!isP2pEnabled()) return;
      if (this.provider && this.providerRoom === room) return;
      const WebrtcProvider = (mod as unknown as { WebrtcProvider: new (room: string, doc: Y.Doc, opts: Record<string, unknown>) => unknown }).WebrtcProvider;
      if (!WebrtcProvider) throw new Error('no WebrtcProvider');
      const signaling = p2pSignalingUrls();
      netLog.info('p2p provider create', () => ({ room, signaling }));
      const provider = new WebrtcProvider(room, this.doc, {
        signaling,
        awareness: undefined,
        filterBcConns: false,
      } as Record<string, unknown>);
      // Guard before assignment: if doc/boardId changed during construction, destroy leaked provider.
      if (!this.doc || !this.boardId || this.doc !== expectedDoc || this.boardId !== expectedBoardId || boardRoomName(this.boardId) !== room) {
        try { (provider as unknown as { destroy?: () => void }).destroy?.(); } catch {}
        try { (provider as unknown as { disconnect?: () => void }).disconnect?.(); } catch {}
        return;
      }
      this.provider = provider;
      this.providerRoom = room;
      this.bind(provider);
      if (this.lastUser) this.write('user', this.lastUser); else this.write('user', loadUser());
      if (this.lastCursor) this.write('cursor', this.lastCursor);
      if (this.lastTool) this.write('tool', this.lastTool);
      if (this.lastPage) this.write('page', this.lastPage);
      this.write('viewing', this.lastViewing);
      if (this.lastDraft) this.write('draft', this.lastDraft);
      if (this.lastErase) this.write('erasePreview', this.lastErase);
      this.lastError = null;
      this.retryAttempt = 0;
      this.clearRetryTimer();
      this.emitStatus();
      this.emitPeers();
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
        // netLog is gated off by default; also emit to console so chunk-load/missing-export is never silent
        try { console.error('[review:net] p2p connect failed', e); } catch {}
        netLog.warn('p2p connect failed', () => ({ err: String(e) }));
        this.emitStatus();
        this.scheduleRetry();
      }
    } finally {
      release();
    }
  }

  isAttached(): boolean {
    return this.doc !== null && this.boardId !== null;
  }

  getBoardId(): string | null {
    return this.boardId;
  }

  getDoc(): Y.Doc | null {
    return this.doc;
  }

  disconnect(): void {
    netLog.info('p2p disconnect', () => ({ boardId: this.boardId, room: this.providerRoom }));
    this.teardown();
    this.clearRetryTimer();
    this.retryAttempt = 0;
    this.lastError = null;
    this.emitStatus();
    this.emitPeers();
  }

  getStatus(): SyncStatus {
    if (!isP2pEnabled()) return { online: false, users: 0, enabled: false, error: null };
    const p = this.provider as unknown as WebrtcProvider | null;
    if (!p) return { online: false, users: 0, enabled: true, error: this.lastError };
    const states = p.awareness?.getStates();
    const size = states ? states.size : 0;
    // Provider.connected is the public y-webrtc signal (room !== null && shouldConnect).
    // Avoid probing private internals (signalingConns[].ws/connected, room.bcconnected,
    // room.webrtcConns) typed as any / deprecated lib0 fields that can silently break
    // on version changes and cause false offline (previous: online required transportOnline).
    const online = p.connected === true;
    return { online, users: online ? size : 0, enabled: true, error: this.lastError };
  }

  collectPeers(): PeerCursor[] {
    const p = this.provider as unknown as { awareness?: { getStates(): Map<number, unknown>; clientID: number } } | null;
    if (!p?.awareness) return [];
    const selfId = loadUser().id;
    const byUser = new Map<string, PeerCursor>();
    for (const [id, state] of p.awareness.getStates()) {
      if (id === p.awareness.clientID) continue;
      const st = state as Record<string, unknown>;
      const user = st.user as UserInfo | undefined;
      if (!user || !user.name) continue;
      const userId = typeof user.id === 'string' && user.id.trim() ? user.id.trim() : '';
      if (userId && userId === selfId) continue;
      const key = userId || `client:${id}`;
      // ponytail: dedup by userId — keep freshest entry, drop stale reconnect (last wins)
      const published = { name: user.name, color: (user as unknown as { color?: string }).color || '#7c8cff' };
      const display = userId ? getPeerDisplay(userId, published) : { ...published, overridden: false };
      const cur = st.cursor as CursorPos | null | undefined;
      const tool = typeof st.tool === 'string' && (st.tool as string).trim() ? (st.tool as string).trim() : null;
      const page = typeof st.page === 'string' && (st.page as string).trim() ? (st.page as string).trim() : null;
      const viewing = st.viewing !== false;
      byUser.set(key, {
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
        draft: parseDraft(st.draft),
        erasePreview: parseErasePreview(st.erasePreview),
      });
    }
    return [...byUser.values()];
  }

  publishPresence(user: UserInfo): void { this.lastUser = user; this.write('user', user); }
  publishTool(tool: string): void {
    if (this.lastTool === tool) return;
    this.lastTool = tool;
    if (tool !== 'eraser') { this.lastErase = null; this.write('erasePreview', null); }
    this.write('tool', tool);
  }
  publishPage(page: string): void { if (this.lastPage === page) return; this.lastPage = page; this.write('page', page); }
  publishBoardView(viewing: boolean): void {
    if (this.lastViewing === viewing) return;
    this.lastViewing = viewing;
    if (!viewing) { this.lastDraft = null; this.lastErase = null; this.write('draft', null); this.write('erasePreview', null); }
    this.write('viewing', viewing);
  }
  sendCursor(pos: CursorPos | null): void { this.lastCursor = pos; this.write('cursor', pos); }
  publishDraft(d: PeerDraft | null): void { this.lastDraft = d; this.write('draft', d); }
  publishErasePreview(p: PeerErasePreview | null): void { this.lastErase = p; this.write('erasePreview', p); }

  onStatus(cb: StatusListener): () => void { this.statusListeners.add(cb); cb(this.getStatus()); return () => { this.statusListeners.delete(cb); }; }
  onPeers(cb: PeerListener): () => void { this.peerListeners.add(cb); cb(this.collectPeers()); return () => { this.peerListeners.delete(cb); }; }
  onLifecycle(cb: LifecycleListener): () => void { this.lifecycleListeners.add(cb); return () => { this.lifecycleListeners.delete(cb); }; }

  rosterKey(peers: PeerCursor[] = this.collectPeers()): string {
    return peers.map(p => `${p.id}\0${p.userId}\0${p.name}\0${p.color}\0${p.tool ?? ''}\0${p.page ?? ''}`).join('\n');
  }

  private write(field: string, value: unknown): void {
    const p = this.provider as unknown as { awareness?: { setLocalStateField(k: string, v: unknown): void } } | null;
    try { p?.awareness?.setLocalStateField(field, value); } catch {}
  }

  private bind(provider: unknown): void {
    const p = provider as unknown as {
      awareness: { on(e: string, fn: () => void): void; off(e: string, fn: () => void): void; getStates(): Map<number, unknown> };
      on?(e: string, fn: () => void): void;
      off?(e: string, fn: () => void): void;
    };
    const onAware = () => { this.emitStatus(); this.emitPeers(); };
    p.awareness.on('update', onAware);
    p.awareness.on('change', onAware);
    this.awarenessChangeHandler = onAware;
    if (typeof p.on === 'function') {
      const onStatus = () => { this.emitStatus(); this.emitPeers(); };
      p.on('peers', onStatus);
      p.on('status', onStatus);
      this.statusHandler = onStatus;
    }
    if (!this.offPeerDisplay) this.offPeerDisplay = onPeerDisplayChange(() => this.emitPeers());
    // keep reference to allow teardown
    (this as unknown as { _p: unknown })._p = p;
  }

  private teardown(): void {
    const p = (this as unknown as { _p?: { awareness: { off(e: string, fn: () => void): void } ; off?(e: string, fn: () => void): void } })._p as { awareness: { off(e: string, fn: () => void): void }; off?(e:string, fn:()=>void):void } | undefined;
    if (p && this.awarenessChangeHandler) {
      try { p.awareness.off('update', this.awarenessChangeHandler); } catch {}
      try { p.awareness.off('change', this.awarenessChangeHandler); } catch {}
      if (this.statusHandler && p.off) {
        try { p.off('peers', this.statusHandler); } catch {}
        try { p.off('status', this.statusHandler); } catch {}
      }
    }
    this.awarenessChangeHandler = null;
    this.statusHandler = null;
    (this as unknown as { _p?: unknown })._p = undefined;
    if (this.offPeerDisplay) { try { this.offPeerDisplay(); } catch {} this.offPeerDisplay = null; }
    const prov = this.provider as unknown as { destroy?: () => void; disconnect?: () => void; awareness?: { setLocalState(v: unknown): void }; key?: Promise<unknown> } | null;
    if (prov) {
      try { prov.awareness?.setLocalState(null); } catch {}
      try { prov.destroy?.(); } catch {}
      try { prov.disconnect?.(); } catch {}
      // WebrtcProvider.destroy is async via key.then(() => { room.destroy(); rooms.delete() })
      // even with no password it is Promise.resolve(null).then() => microtask delay.
      // Chain pendingTeardown so rapid re-attach waits for global rooms.delete before openRoom.
      const prev = this.pendingTeardown;
      const k = prov.key;
      const hasKey = !!k && typeof (k as unknown as { then?: unknown }).then === 'function';
      const cur = hasKey
        ? prev.then(() => (k as Promise<unknown>).then(() => {}, () => {})).then(() => {})
        : prev.then(() => {});
      // one extra microtask ensures destroy's key.then handler (rooms.delete) has run
      this.pendingTeardown = cur.then(() => new Promise<void>(res => queueMicrotask(res))).catch(() => {});
    }
    this.provider = null;
    this.providerRoom = null;
    // do not clear lastError here — connect() preserves failure error via catch after teardown;
    // explicit clear is done on successful connect and on detach/disconnect/reconnect below
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private scheduleRetry(): void {
    if (!this.doc || !this.boardId || !isP2pEnabled() || this.provider) return;
    if (this.retryTimer) return;
    const delay = Math.min(P2P_RETRY_BASE_MS * 2 ** this.retryAttempt, P2P_RETRY_MAX_MS);
    this.retryAttempt += 1;
    netLog.info('p2p retry scheduled', () => ({ delay, attempt: this.retryAttempt }));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.doc && this.boardId && isP2pEnabled() && !this.provider) void this.connect();
    }, delay);
  }

  private emitStatus(): void {
    const s = this.getStatus();
    for (const l of [...this.statusListeners]) l(s);
  }
  private emitPeers(): void {
    const peers = this.collectPeers();
    for (const l of [...this.peerListeners]) l(peers);
  }
  private emitLifecycle(): void { for (const l of [...this.lifecycleListeners]) l(); }
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

export const p2pClient = new P2pClient();

export function attachP2p(doc: Y.Doc, boardId: string): void { p2pClient.attach(doc, boardId); }
export function detachP2p(): void { p2pClient.detach(); }
export function reconnectP2p(): void { p2pClient.reconnect(); }
