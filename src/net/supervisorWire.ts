/**
 * Transport supervisor wiring — subscribes to both providers and applies the
 * pure policy from `./supervisor` via suspend/resume (socket drop / reopen,
 * provider + awareness clocks preserved). Started/stopped with the board
 * session; re-evaluates on every status/peer change plus a 5s poll for the
 * probe interval. Never throws into callers.
 */

import { syncClient } from './client';
import { p2pClient } from './p2p';
import { isP2pEnabled } from './config';
import { readPrefs } from '../core/prefs';
import { decideTransport, type TransportSnapshot } from './supervisor';

const POLL_MS = 5000;

let running = false;
let stopFns: Array<() => void> = [];
let timer: ReturnType<typeof setInterval> | null = null;
let sleeping = false;
let lastProbeAtMs = 0;
let wsConnectedAtMs: number | null = null;
let lastWsOnline = false;

function peerIds(list: Array<{ userId: string; id: number | string }>): string[] {
  const out: string[] = [];
  for (const p of list) {
    const key = p.userId || String(p.id ?? '');
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

function evaluate(): void {
  if (!running) return;
  if (!syncClient.isAttached()) return;
  let saveEnabled = true;
  try {
    saveEnabled = readPrefs().transportSave;
  } catch {
    /* prefs unavailable — default on */
  }
  let p2pEnabled = false;
  try {
    p2pEnabled = isP2pEnabled();
  } catch {
    /* config unavailable — stay on WS */
  }
  const nowMs = Date.now();
  const wsStatus = syncClient.getStatus();
  const p2pStatus = p2pClient.getStatus();
  if (wsStatus.online && !lastWsOnline) wsConnectedAtMs = nowMs;
  if (!wsStatus.online) wsConnectedAtMs = null;
  lastWsOnline = wsStatus.online;
  const snap: TransportSnapshot = {
    nowMs,
    saveEnabled,
    p2pEnabled,
    p2pOnline: p2pStatus.online,
    p2pPeerIds: peerIds(p2pClient.collectPeers()),
    wsOnline: wsStatus.online,
    wsPeerIds: peerIds(syncClient.collectPeers()),
    wsConnectedAtMs,
    sleeping,
    lastProbeAtMs,
  };
  const d = decideTransport(snap);
  if (d.wish === 'ws-sleep' && !sleeping) {
    sleeping = true;
    try {
      syncClient.suspend();
    } catch {
      /* best-effort */
    }
  } else if (d.wish === 'ws-up' && sleeping) {
    sleeping = false;
    if (d.probe) lastProbeAtMs = nowMs;
    try {
      syncClient.resume();
    } catch {
      /* best-effort */
    }
  }
}

export function startTransportSupervisor(): void {
  if (running) return;
  running = true;
  sleeping = false;
  lastProbeAtMs = 0;
  wsConnectedAtMs = null;
  lastWsOnline = false;
  try {
    stopFns = [
      syncClient.onStatus(() => evaluate()),
      syncClient.onPeers(() => evaluate()),
      p2pClient.onStatus(() => evaluate()),
      p2pClient.onPeers(() => evaluate()),
    ];
  } catch {
    stopFns = [];
  }
  timer = setInterval(() => evaluate(), POLL_MS);
  const t = timer as unknown as { unref?: unknown };
  if (timer && typeof t.unref === 'function') {
    (t as unknown as { unref(): void }).unref();
  }
  evaluate();
}

export function stopTransportSupervisor(): void {
  running = false;
  for (const off of stopFns) {
    try {
      off();
    } catch {
      /* ignore */
    }
  }
  stopFns = [];
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  sleeping = false;
  wsConnectedAtMs = null;
}

/** Test hook: current applied state. */
export function __transportSleepingForTests(): boolean {
  return sleeping;
}
