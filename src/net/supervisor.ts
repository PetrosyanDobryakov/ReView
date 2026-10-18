/**
 * Transport supervisor policy — pure module (no imports, Node-testable).
 *
 * When every live peer is reachable over P2P, the websocket leg to the hub is
 * redundant: doc updates and awareness already flow directly. The supervisor
 * then wishes the WS channel asleep (socket dropped, provider + awareness
 * clocks kept — see SyncClient.suspend/resume). The hub stops burning duration
 * on the room while history stays in its SQLite for late joiners.
 *
 * Safety rails (why this can't strand anyone):
 * - WS sleeps only after its roster had time to arrive (ROSTER_GRACE_MS) and
 *   every WS-visible peer is also P2P-visible (a WS-only peer, e.g. an old
 *   client, keeps the channel up).
 * - Solo rooms never sleep (no P2P peers → WS stays the source of truth).
 * - A sleeping channel wakes on a probe interval to flush persist + relearn
 *   the roster, then sleeps again after grace.
 * - Any P2P drop wakes WS immediately.
 */

export const WS_ROSTER_GRACE_MS = 10_000;
export const WS_PROBE_INTERVAL_MS = 5 * 60_000;

export interface TransportSnapshot {
  nowMs: number;
  /** Master switch (Settings). */
  saveEnabled: boolean;
  p2pEnabled: boolean;
  p2pOnline: boolean;
  /** Distinct remote peer ids currently P2P-visible. */
  p2pPeerIds: string[];
  /** WS socket currently OPEN. */
  wsOnline: boolean;
  /** Distinct remote peer ids currently WS-visible. */
  wsPeerIds: string[];
  /** When the current WS socket opened (null = never / down). */
  wsConnectedAtMs: number | null;
  /** Currently applied supervisor output. */
  sleeping: boolean;
  /** Last periodic revalidation wake. */
  lastProbeAtMs: number;
}

export type TransportWish = 'ws-up' | 'ws-sleep';

export interface TransportDecision {
  wish: TransportWish;
  /**
   * True when sleeping and a revalidation wake is due. The wiring wakes WS
   * (records a probe) — grace then holds it up briefly before it may sleep.
   */
  probe: boolean;
}

function uncoveredWsPeers(snap: TransportSnapshot): string[] {
  const direct = new Set(snap.p2pPeerIds);
  return snap.wsPeerIds.filter((id) => !direct.has(id));
}

export function decideTransport(snap: TransportSnapshot): TransportDecision {
  const asleep = { wish: 'ws-sleep' as const, probe: false };
  const awake: TransportDecision = { wish: 'ws-up', probe: false };
  if (!snap.saveEnabled || !snap.p2pEnabled || !snap.p2pOnline) return awake;
  if (snap.p2pPeerIds.length === 0) return awake;
  if (uncoveredWsPeers(snap).length > 0) return awake;
  if (!snap.wsOnline) return awake;
  if (snap.wsConnectedAtMs === null || snap.nowMs - snap.wsConnectedAtMs < WS_ROSTER_GRACE_MS) {
    return awake;
  }
  if (snap.sleeping && snap.nowMs - snap.lastProbeAtMs >= WS_PROBE_INTERVAL_MS) {
    return { wish: 'ws-up', probe: true };
  }
  return asleep;
}
