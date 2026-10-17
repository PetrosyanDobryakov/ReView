/**
 * Board sync over our own P2P mesh (`src/net/p2p/`). Hubs only introduce
 * peers; the board document and awareness (cursors, presence) travel over
 * WebRTC data channels between browsers. Nothing is stored anywhere but in
 * each peer's own local storage.
 */

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { loadUser } from '../core/user';
import { getPeerDisplay, onPeerDisplayChange } from '../core/peerDisplay';
import { AwarenessBatch, type AwarenessPatch } from './awarenessBatch';
import { awarenessChangeIsLocalOnly } from './awarenessChange';
import { boardRoomName, isSyncEnabled } from './config';
import { netLog, registerNetDebugPeek } from './log';
import { clampConfettiPower, parsePeerConfetti, type PeerConfettiBurst } from './peerConfetti';
import { parsePeerSelection, samePeerSelection, slimPeerSelection } from './peerSelection';
import { Mesh } from './p2p/mesh';
import { captureInviteHub, iceServers, resolveHubs } from './p2p/hubs';
import { randomPeerId } from './p2p/protocol';
import { webrtcAvailable } from './p2p/webrtcLink';
import type { MeshSnapshot } from './p2p/types';
import type { CursorPos, PeerCursor, PeerDraft, PeerErasePreview, SyncStatus } from './types';
import type { UserInfo } from '../core/user';

/** Re-read hubs (LAN neighbours come and go) this often while a board is open. */
const HUB_REFRESH_MS = 15_000;

declare const __REVIEW_BUILD__: string;

type StatusListener = (s: SyncStatus) => void;
type PeerListener = (p: PeerCursor[]) => void;
type LifecycleListener = () => void;
type MeshListener = (s: MeshSnapshot) => void;

function appVersion(): string {
  try {
    return typeof __REVIEW_BUILD__ === 'string' ? __REVIEW_BUILD__ : '';
  } catch {
    return '';
  }
}

class P2pClient {
  private doc: Y.Doc | null = null;
  private boardId: string | null = null;
  private awareness: Awareness | null = null;
  private mesh: Mesh | null = null;
  /** One id per tab: other tabs of the same user are separate peers. */
  readonly peerId = randomPeerId();
  private hubTimer: ReturnType<typeof setInterval> | null = null;
  private hubGen = 0;
  private noHub = false;

  private lastUser: UserInfo | null = null;
  private lastCursor: CursorPos | null = null;
  private lastTool: string | null = null;
  private lastPage: string | null = null;
  private lastViewing = true;
  private lastDraft: PeerDraft | null = null;
  private lastErase: PeerErasePreview | null = null;
  private lastSelection: string[] | null = null;
  private lastConfetti: PeerConfettiBurst | null = null;
  private confettiClearTimer: ReturnType<typeof setTimeout> | null = null;
  private confettiSeq = 0;

  private readonly statusListeners = new Set<StatusListener>();
  private readonly peerListeners = new Set<PeerListener>();
  private readonly lifecycleListeners = new Set<LifecycleListener>();
  private readonly meshListeners = new Set<MeshListener>();
  private offPeerDisplay: (() => void) | null = null;
  private readonly hotAwareness = new AwarenessBatch((patch) => this.applyHotAwareness(patch));

  constructor() {
    captureInviteHub();
    registerNetDebugPeek(() => {
      const snap = this.getMeshSnapshot();
      return {
        room: snap.room,
        peer: snap.self,
        hubs: snap.hubs.map((h) => `${h.url} ${h.state}`),
        links: snap.peers.map((p) => `${p.peer.slice(0, 6)} ${p.state} ${p.path} ${p.rtt ?? '-'}ms`),
      };
    });
  }

  attach(doc: Y.Doc, boardId: string): void {
    if (this.doc === doc && this.boardId === boardId && this.mesh) return;
    netLog.info('p2p attach', () => ({ boardId, room: boardRoomName(boardId), peer: this.peerId }));
    this.teardown();
    this.doc = doc;
    this.boardId = boardId;
    if (isSyncEnabled()) this.connect();
    this.emitAll();
  }

  detach(): void {
    netLog.info('p2p detach', () => ({ boardId: this.boardId }));
    this.teardown();
    this.doc = null;
    this.boardId = null;
    this.emitAll();
  }

  /** Rebuild after prefs change (sync toggle, hubs, ICE). */
  reconnect(): void {
    netLog.info('p2p reconnect', () => ({ boardId: this.boardId, enabled: isSyncEnabled() }));
    this.teardown();
    if (this.doc && this.boardId && isSyncEnabled()) this.connect();
    this.emitAll();
  }

  /** Re-resolve hubs now and skip hub retry backoff (P2P panel "refresh"). */
  refreshHubs(): void {
    this.mesh?.retryHubs();
    void this.updateHubs();
  }

  private connect(): void {
    const doc = this.doc;
    const boardId = this.boardId;
    if (!doc || !boardId) return;
    const awareness = new Awareness(doc);
    this.awareness = awareness;
    this.mesh = new Mesh(doc, awareness, boardRoomName(boardId), this.peerId, {
      iceServers: iceServers(),
      appVersion: appVersion(),
      onChange: () => {
        this.emitStatus();
        this.emitMesh();
      },
      log: (msg, data) => netLog.info(`p2p ${msg}`, data),
    });
    this.bind(awareness);
    this.write('user', this.lastUser ?? loadUser());
    if (this.lastTool) this.write('tool', this.lastTool);
    if (this.lastPage) this.write('page', this.lastPage);
    this.write('viewing', this.lastViewing);
    this.hotAwareness.clear();
    this.applyHotAwareness({
      cursor: this.lastCursor,
      draft: this.lastDraft,
      erasePreview: this.lastErase,
      selection: this.lastSelection,
    });
    void this.updateHubs();
    this.hubTimer = setInterval(() => void this.updateHubs(), HUB_REFRESH_MS);
  }

  private async updateHubs(): Promise<void> {
    const mesh = this.mesh;
    if (!mesh) return;
    const gen = ++this.hubGen;
    const { specs } = await resolveHubs();
    if (this.mesh !== mesh || gen !== this.hubGen) return;
    this.noHub = specs.length === 0;
    mesh.setHubs(specs);
    this.emitStatus();
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
    netLog.info('p2p disconnect', () => ({ boardId: this.boardId }));
    this.teardown();
    this.emitAll();
  }

  /**
   * online = at least one hub or one peer link is up. A tab with open links
   * stays online even if every hub goes away.
   */
  getStatus(): SyncStatus {
    if (!isSyncEnabled()) return { online: false, users: 0, enabled: false, error: null };
    const mesh = this.mesh;
    const aw = this.awareness;
    if (!mesh || !aw) return { online: false, users: 0, enabled: true, error: null };
    const online = mesh.hubsOpen() > 0 || mesh.openLinks() > 0;
    const error = !webrtcAvailable() ? 'webrtc-unavailable' : this.noHub ? 'no-hub' : null;
    return { online, users: online ? aw.getStates().size : 0, enabled: true, error };
  }

  /** Live P2P state for the P2P panel. */
  getMeshSnapshot(): MeshSnapshot {
    if (this.mesh) return this.mesh.snapshot();
    return {
      room: this.boardId ? boardRoomName(this.boardId) : null,
      self: this.peerId,
      enabled: isSyncEnabled(),
      webrtc: webrtcAvailable(),
      hubs: [],
      peers: [],
    };
  }

  /** Awareness client id -> display name, for labelling mesh peers in the panel. */
  clientNames(): Map<number, { name: string; color: string }> {
    const out = new Map<number, { name: string; color: string }>();
    const aw = this.awareness;
    if (!aw) return out;
    for (const [id, state] of aw.getStates()) {
      const user = (state as { user?: { name?: string; color?: string } }).user;
      if (user?.name) out.set(id, { name: user.name, color: user.color || '#7c8cff' });
    }
    return out;
  }

  /** Lowest awareness client id dedups shared arrays so peers do not ping-pong. */
  isAwarenessLeader(): boolean {
    const aw = this.awareness;
    if (!aw) return true;
    let min = aw.clientID;
    for (const id of aw.getStates().keys()) if (id < min) min = id;
    return min === aw.clientID;
  }

  collectPeers(): PeerCursor[] {
    const aw = this.awareness;
    if (!aw) return [];
    const selfId = loadUser().id;
    const byUser = new Map<string, PeerCursor>();
    for (const [id, state] of aw.getStates()) {
      if (id === aw.clientID) continue;
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
        focus: typeof st.focus === 'string' && (st.focus as string).trim() ? (st.focus as string).trim() : null,
        selection: parsePeerSelection(st.selection),
        confetti: parsePeerConfetti(st.confetti),
      });
    }
    return [...byUser.values()];
  }

  /** Another tab of the same user still counts — compact must not run against a live replica. */
  hasOtherAwarenessClients(): boolean {
    const aw = this.awareness;
    if (!aw) return false;
    for (const id of aw.getStates().keys()) {
      if (id !== aw.clientID) return true;
    }
    return false;
  }

  publishPresence(user: UserInfo): void { this.lastUser = user; this.write('user', user); }
  publishTool(tool: string): void {
    if (this.lastTool === tool) return;
    this.lastTool = tool;
    if (tool !== 'eraser') {
      this.lastErase = null;
      this.hotAwareness.queue({ erasePreview: null });
      this.hotAwareness.flushNow();
    }
    this.write('tool', tool);
  }
  publishFocus(shapeId: string | null): void {
    this.write('focus', shapeId);
  }
  publishSelection(ids: string[] | null): void {
    if (!ids || !ids.length) {
      if (this.lastSelection === null && !this.awareness) return;
      this.lastSelection = null;
      this.hotAwareness.queue({ selection: null });
      this.hotAwareness.flushNow();
      return;
    }
    const slim = slimPeerSelection(ids);
    if (samePeerSelection(slim, this.lastSelection)) return;
    this.lastSelection = slim;
    this.hotAwareness.queue({ selection: slim });
    if (!slim) this.hotAwareness.flushNow();
  }
  publishConfetti(origin: { x: number; y: number; seed: number; power?: number }): void {
    this.confettiSeq = (this.confettiSeq + 1) >>> 0;
    const burst: PeerConfettiBurst = {
      x: origin.x,
      y: origin.y,
      seed: origin.seed >>> 0,
      id: this.confettiSeq,
      t: Date.now(),
      power: clampConfettiPower(origin.power),
    };
    this.lastConfetti = burst;
    if (this.confettiClearTimer) {
      clearTimeout(this.confettiClearTimer);
      this.confettiClearTimer = null;
    }
    this.hotAwareness.queue({ confetti: burst });
    this.hotAwareness.flushNow();
    this.confettiClearTimer = setTimeout(() => this.clearConfettiField(), 2500);
  }
  private clearConfettiField(): void {
    if (this.confettiClearTimer) {
      clearTimeout(this.confettiClearTimer);
      this.confettiClearTimer = null;
    }
    if (this.lastConfetti === null && !this.awareness) return;
    this.lastConfetti = null;
    this.hotAwareness.queue({ confetti: null });
    this.hotAwareness.flushNow();
  }
  publishPage(page: string): void { if (this.lastPage === page) return; this.lastPage = page; this.write('page', page); }
  publishBoardView(viewing: boolean): void {
    if (this.lastViewing === viewing) return;
    this.lastViewing = viewing;
    if (!viewing) {
      this.lastDraft = null;
      this.lastErase = null;
      this.lastSelection = null;
      this.clearConfettiField();
      this.hotAwareness.queue({ draft: null, erasePreview: null, selection: null });
      this.hotAwareness.flushNow();
    }
    this.write('viewing', viewing);
  }
  sendCursor(pos: CursorPos | null): void {
    this.lastCursor = pos;
    this.hotAwareness.queue({ cursor: pos });
    if (!pos) this.hotAwareness.flushNow();
  }
  publishDraft(d: PeerDraft | null): void {
    this.lastDraft = d;
    this.hotAwareness.queue({ draft: d });
    if (!d) this.hotAwareness.flushNow();
  }
  publishErasePreview(p: PeerErasePreview | null): void {
    this.lastErase = p;
    this.hotAwareness.queue({ erasePreview: p });
    if (!p) this.hotAwareness.flushNow();
  }

  onStatus(cb: StatusListener): () => void { this.statusListeners.add(cb); cb(this.getStatus()); return () => { this.statusListeners.delete(cb); }; }
  onPeers(cb: PeerListener): () => void { this.peerListeners.add(cb); cb(this.collectPeers()); return () => { this.peerListeners.delete(cb); }; }
  onLifecycle(cb: LifecycleListener): () => void { this.lifecycleListeners.add(cb); return () => { this.lifecycleListeners.delete(cb); }; }
  onMesh(cb: MeshListener): () => void { this.meshListeners.add(cb); cb(this.getMeshSnapshot()); return () => { this.meshListeners.delete(cb); }; }

  rosterKey(peers: PeerCursor[] = this.collectPeers()): string {
    return peers.map(p => `${p.id}\0${p.userId}\0${p.name}\0${p.color}\0${p.tool ?? ''}\0${p.page ?? ''}\0${p.focus ?? ''}\0${(p.selection ?? []).join(',')}`).join('\n');
  }

  private applyHotAwareness(patch: AwarenessPatch): void {
    const aw = this.awareness;
    if (!aw) return;
    try {
      const prev = aw.getLocalState() ?? {};
      aw.setLocalState({ ...prev, ...patch });
    } catch {}
  }

  private write(field: string, value: unknown): void {
    try { this.awareness?.setLocalStateField(field, value); } catch {}
  }

  private bind(aw: Awareness): void {
    const onAware = (changes?: { added?: number[]; updated?: number[]; removed?: number[] }) => {
      this.emitStatus();
      if (changes && awarenessChangeIsLocalOnly(changes, aw.clientID)) return;
      this.emitPeers();
    };
    aw.on('change', onAware);
    this.offAwareness = () => aw.off('change', onAware);
    if (!this.offPeerDisplay) this.offPeerDisplay = onPeerDisplayChange(() => this.emitPeers());
  }

  private offAwareness: (() => void) | null = null;

  private teardown(): void {
    this.hotAwareness.clear();
    this.hubGen += 1;
    if (this.hubTimer) { clearInterval(this.hubTimer); this.hubTimer = null; }
    if (this.offAwareness) { try { this.offAwareness(); } catch {} this.offAwareness = null; }
    if (this.offPeerDisplay) { try { this.offPeerDisplay(); } catch {} this.offPeerDisplay = null; }
    // Mesh first: it sends our "gone" awareness frame while links are still open.
    try { this.mesh?.destroy(); } catch {}
    this.mesh = null;
    try { this.awareness?.destroy(); } catch {}
    this.awareness = null;
    this.noHub = false;
  }

  private emitAll(): void {
    this.emitLifecycle();
    this.emitStatus();
    this.emitPeers();
    this.emitMesh();
  }

  private emitMesh(): void {
    if (!this.meshListeners.size) return;
    const snap = this.getMeshSnapshot();
    for (const l of [...this.meshListeners]) l(snap);
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

if (typeof window !== 'undefined') {
  // Console helper: `reviewP2p()` prints hubs, links, paths and RTT.
  (window as unknown as { reviewP2p?: () => MeshSnapshot }).reviewP2p = () => p2pClient.getMeshSnapshot();
}

export function attachP2p(doc: Y.Doc, boardId: string): void { p2pClient.attach(doc, boardId); }
export function detachP2p(): void { p2pClient.detach(); }
export function reconnectP2p(): void { p2pClient.reconnect(); }
