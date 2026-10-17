/**
 * Dedicated sync/network debug logger. Console only: there is no server to
 * ship logs to, and peers never see them.
 */

import { isSyncEnabled } from './config';

export type NetLogLevel = 'debug' | 'info' | 'warn' | 'error';

const PREFIX = '[review:net]';
const STORAGE_KEY = 'review-net-log';
const STORAGE_ALIASES = ['REVIEW_NET_DEBUG', 'review-net-debug'] as const;
const QUERY_KEYS = ['netLog', 'netDebug'] as const;
/** Default OFF — enable via Settings / ?netLog=1 / ?netDebug=1 / localStorage / VITE_NET_LOG. */
const DEFAULT_ENABLED =
  typeof import.meta !== 'undefined' &&
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_NET_LOG === '1';

type LogData = unknown | (() => unknown);
type NetDebugPeek = () => Record<string, unknown>;

let cachedEnabled: boolean | null = null;

let booted = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let statusPeek: NetDebugPeek | null = null;

/** The P2P client registers a peek so heartbeats can report real WS state without import cycles. */
export function registerNetDebugPeek(fn: NetDebugPeek): void {
  statusPeek = fn;
}

export function parseNetFlag(raw: string | null | undefined): boolean | null {
  if (raw == null) return null;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return null;
}

/**
 * Merge `location.search` with `?…` inside the hash (SPA / workers.dev safe).
 * Exported for unit tests.
 */
export function mergeLocationSearch(search: string, hash: string): URLSearchParams {
  const merged = new URLSearchParams();
  try {
    const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    for (const [k, v] of sp) merged.set(k, v);
  } catch {
    /* ignore */
  }
  try {
    const h = hash || '';
    const q = h.indexOf('?');
    if (q >= 0) {
      const hp = new URLSearchParams(h.slice(q + 1));
      for (const [k, v] of hp) merged.set(k, v);
    }
  } catch {
    /* ignore */
  }
  return merged;
}

/** Search params from location.search and from `?…` inside the hash (SPA-safe). */
function allSearchParams(): URLSearchParams {
  if (typeof location === 'undefined') return new URLSearchParams();
  return mergeLocationSearch(location.search || '', location.hash || '');
}

function readQueryFlag(): boolean | null {
  if (typeof location === 'undefined') return null;
  try {
    const params = allSearchParams();
    for (const key of QUERY_KEYS) {
      const v = parseNetFlag(params.get(key));
      if (v !== null) return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readStorageFlag(): boolean {
  if (typeof localStorage === 'undefined') return DEFAULT_ENABLED;
  try {
    const primary = parseNetFlag(localStorage.getItem(STORAGE_KEY));
    if (primary !== null) return primary;
    for (const key of STORAGE_ALIASES) {
      const v = parseNetFlag(localStorage.getItem(key));
      if (v !== null) return v;
    }
    return DEFAULT_ENABLED;
  } catch {
    return DEFAULT_ENABLED;
  }
}

function writeStorageFlag(on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    localStorage.setItem('REVIEW_NET_DEBUG', on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Resolve enable flag (query wins, then localStorage). Cached until setNetLogEnabled. */
export function isNetLogEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  const q = readQueryFlag();
  if (q === true) {
    writeStorageFlag(true);
    cachedEnabled = true;
    return true;
  }
  if (q === false) {
    writeStorageFlag(false);
    cachedEnabled = false;
    return false;
  }
  cachedEnabled = readStorageFlag();
  return cachedEnabled;
}

/**
 * Call once at app boot (main.tsx). Prints a Console line even before any sync
 * traffic — otherwise ?netDebug=1 looks like a no-op on the home screen.
 * Uses console.warn so Chrome shows it without enabling Verbose.
 */
export function bootNetLog(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;

  // Expose a one-liner for DevTools when the query string is awkward.
  (window as unknown as { reviewNetDebug?: (on?: boolean) => void }).reviewNetDebug = (on = true) => {
    setNetLogEnabled(on);
  };

  const on = isNetLogEnabled();
  if (!on) return;

  const syncOn = isSyncEnabled();
  const path = typeof location !== 'undefined' ? location.pathname : '';
  const onBoard = typeof path === 'string' && path.startsWith('/board/');
  // warn = visible under Chrome's default filter (Info/Verbose can be off).
  console.warn(`${PREFIX} review net debug ON`, {
    syncEnabled: syncOn,
    path,
    peek: statusPeek?.() ?? null,
    tip: onBoard
      ? 'Network → WS shows the hub sockets (/signal/<room>); board data goes over WebRTC (chrome://webrtc-internals). Off: ?netLog=0 or reviewNetDebug(false)'
      : 'No hub sockets until you open /board/…. Off: ?netLog=0 or reviewNetDebug(false)',
  });
  if (!syncOn) {
    console.warn(`${PREFIX} P2P is OFF in Settings — this tab works alone until it is turned on`);
  }

  startHeartbeat();
  // Dynamic import avoids a log↔hitch cycle if hitch ever logs during module init.
  void import('./hitchDebug').then((m) => m.bootHitchDebug()).catch(() => {});
}

function startHeartbeat(): void {
  if (heartbeatTimer || typeof setInterval === 'undefined') return;
  heartbeatTimer = setInterval(() => {
    if (!isNetLogEnabled()) return;
    const peek = statusPeek?.() ?? { note: 'open a /board/… to join the mesh' };
    // warn so periodic proof stays visible
    console.warn(`${PREFIX} heartbeat`, {
      t: new Date().toISOString(),
      syncEnabled: isSyncEnabled(),
      ...peek,
    });
  }, 5000);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/** Toggle net logging (Settings / console). Persists to localStorage. */
export function setNetLogEnabled(on: boolean): void {
  cachedEnabled = on;
  writeStorageFlag(on);
  if (on) {
    booted = false;
    bootNetLog();
  } else {
    stopHeartbeat();
    console.warn(`${PREFIX} review net debug OFF`);
  }
}

function resolveData(data: LogData | undefined): unknown {
  if (data === undefined) return undefined;
  if (typeof data === 'function') return data();
  return data;
}

function emit(level: NetLogLevel, msg: string, data?: LogData): void {
  if (!isNetLogEnabled()) return;
  const payload = resolveData(data);
  // Prefer warn for high-signal lines so Default Chrome filters still show them.
  // debug stays debug (needs Verbose). info → warn for visibility.
  if (level === 'debug') {
    if (payload !== undefined) console.debug(PREFIX, msg, payload);
    else console.debug(PREFIX, msg);
  } else if (level === 'error') {
    if (payload !== undefined) console.error(PREFIX, msg, payload);
    else console.error(PREFIX, msg);
  } else {
    if (payload !== undefined) console.warn(PREFIX, msg, payload);
    else console.warn(PREFIX, msg);
  }
}

export const netLog = {
  debug(msg: string, data?: LogData): void {
    emit('debug', msg, data);
  },
  info(msg: string, data?: LogData): void {
    emit('info', msg, data);
  },
  warn(msg: string, data?: LogData): void {
    emit('warn', msg, data);
  },
  error(msg: string, data?: LogData): void {
    emit('error', msg, data);
  },
  /** Kept for callers from the server-log era; console lines are never queued. */
  flush(): Promise<void> {
    return Promise.resolve();
  },
};
