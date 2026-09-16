/**
 * Dedicated sync/network debug logger.
 * Console (always when enabled) + optional POST to sync `/net-log` when that route exists.
 */

import { effectiveSyncUrl, isSyncEnabled } from './config';

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

type QueuedLine = {
  t: string;
  level: NetLogLevel;
  msg: string;
  data?: unknown;
  client?: string;
};

const queue: QueuedLine[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let clientTag: string | null = null;
let sessionHintLogged = false;
let flushInFlight = false;
let serverNetLogDisabled = false;
let booted = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let statusPeek: NetDebugPeek | null = null;

/** SyncClient registers a peek so heartbeats can report real WS state without import cycles. */
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

  const syncUrl = effectiveSyncUrl();
  const syncOn = isSyncEnabled();
  const path = typeof location !== 'undefined' ? location.pathname : '';
  const onBoard = typeof path === 'string' && path.startsWith('/board/');
  // warn = visible under Chrome's default filter (Info/Verbose can be off).
  console.warn(`${PREFIX} review net debug ON`, {
    syncUrl,
    syncEnabled: syncOn,
    path,
    peek: statusPeek?.() ?? null,
    tip: onBoard
      ? 'Network → WS should show wss://…review-sync…/<room>. Off: ?netLog=0 or reviewNetDebug(false)'
      : 'No WS until you open /board/…. Then Network → WS → review-sync. Off: ?netLog=0 or reviewNetDebug(false)',
  });
  if (!syncOn) {
    console.warn(
      `${PREFIX} sync is DISABLED in Settings — Network → WS will stay empty until sync is turned on`
    );
  }

  startHeartbeat();
}

function startHeartbeat(): void {
  if (heartbeatTimer || typeof setInterval === 'undefined') return;
  heartbeatTimer = setInterval(() => {
    if (!isNetLogEnabled()) return;
    const peek = statusPeek?.() ?? { note: 'open a /board/… to attach SyncClient' };
    // warn so periodic proof stays visible
    console.warn(`${PREFIX} heartbeat`, {
      t: new Date().toISOString(),
      syncUrl: effectiveSyncUrl(),
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
    scheduleFlush(0);
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

function getClientTag(): string {
  if (clientTag) return clientTag;
  try {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    clientTag = `tab-${id.slice(0, 8)}`;
  } catch {
    clientTag = `tab-${Date.now().toString(36)}`;
  }
  return clientTag;
}

/** HTTP base for the sync server (ws → http). */
export function syncHttpBase(): string {
  return effectiveSyncUrl().replace(/^ws/i, 'http');
}

function enqueue(level: NetLogLevel, msg: string, data?: unknown): void {
  if (serverNetLogDisabled) return;
  queue.push({
    t: new Date().toISOString(),
    level,
    msg,
    data,
    client: getClientTag(),
  });
  if (queue.length >= 24) scheduleFlush(0);
  else scheduleFlush(400);
}

function scheduleFlush(ms: number): void {
  if (flushTimer) {
    if (ms === 0) {
      clearTimeout(flushTimer);
      flushTimer = null;
    } else return;
  }
  if (ms === 0) {
    void flushQueue();
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, ms);
}

async function flushQueue(): Promise<void> {
  if (flushInFlight || !queue.length || !isNetLogEnabled() || serverNetLogDisabled) {
    if (serverNetLogDisabled) queue.length = 0;
    return;
  }
  if (typeof fetch === 'undefined') return;
  flushInFlight = true;
  const batch = queue.splice(0, queue.length);
  try {
    const res = await fetch(`${syncHttpBase()}/net-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: batch }),
      keepalive: true,
    });
    if (res.status === 404) {
      // Cloudflare sync worker has no /net-log — console-only is fine.
      serverNetLogDisabled = true;
      queue.length = 0;
      return;
    }
    if (!sessionHintLogged && res.ok) {
      sessionHintLogged = true;
      try {
        const info = (await res.json()) as { file?: string };
        if (info.file) console.warn(PREFIX, 'session file', info.file);
      } catch {
        /* body optional */
      }
    }
  } catch {
    queue.unshift(...batch.slice(-200));
  } finally {
    flushInFlight = false;
    if (queue.length) scheduleFlush(800);
  }
}

function flushBeacon(): void {
  if (
    !queue.length ||
    typeof navigator === 'undefined' ||
    !navigator.sendBeacon ||
    !isNetLogEnabled() ||
    serverNetLogDisabled
  )
    return;
  const batch = queue.splice(0, queue.length);
  try {
    const blob = new Blob([JSON.stringify({ lines: batch })], { type: 'application/json' });
    navigator.sendBeacon(`${syncHttpBase()}/net-log`, blob);
  } catch {
    /* ignore */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushBeacon);
  window.addEventListener('beforeunload', flushBeacon);
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
  enqueue(level, msg, payload);
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
  /** Force pending lines to the sync server (tests / debug). */
  flush(): Promise<void> {
    return flushQueue();
  },
};
