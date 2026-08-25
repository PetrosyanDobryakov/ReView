/** Dedicated sync/network debug logger. Console + session files via sync server. */

import { effectiveSyncUrl } from './config';

export type NetLogLevel = 'debug' | 'info' | 'warn' | 'error';

const PREFIX = '[review:net]';
const STORAGE_KEY = 'review-net-log';
/** Default ON while we harden LAN sync — Settings / ?netLog=0 still disable. */
const DEFAULT_ENABLED = true;

type LogData = unknown | (() => unknown);

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

function readQueryFlag(): boolean | null {
  if (typeof location === 'undefined') return null;
  try {
    const q = new URLSearchParams(location.search).get('netLog');
    if (q === '1' || q === 'true') return true;
    if (q === '0' || q === 'false') return false;
  } catch {
    /* ignore */
  }
  return null;
}

function readStorageFlag(): boolean {
  if (typeof localStorage === 'undefined') return DEFAULT_ENABLED;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_ENABLED;
    return raw === '1' || raw === 'true';
  } catch {
    return DEFAULT_ENABLED;
  }
}

function writeStorageFlag(on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Resolve enable flag (query wins once, then localStorage). Cached until setNetLogEnabled. */
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

/** Toggle net logging (Settings / console). Persists to localStorage. */
export function setNetLogEnabled(on: boolean): void {
  cachedEnabled = on;
  writeStorageFlag(on);
  if (on) scheduleFlush(0);
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
  if (flushInFlight || !queue.length || !isNetLogEnabled()) return;
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
    if (!sessionHintLogged && res.ok) {
      sessionHintLogged = true;
      try {
        const info = (await res.json()) as { file?: string };
        if (info.file) console.info(PREFIX, 'session file', info.file);
      } catch {
        /* body optional */
      }
    }
  } catch {
    // Put back so a later flush can retry (cap to avoid unbounded growth).
    queue.unshift(...batch.slice(-200));
  } finally {
    flushInFlight = false;
    if (queue.length) scheduleFlush(800);
  }
}

function flushBeacon(): void {
  if (!queue.length || typeof navigator === 'undefined' || !navigator.sendBeacon) return;
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
  const fn =
    level === 'debug'
      ? console.debug
      : level === 'info'
        ? console.info
        : level === 'warn'
          ? console.warn
          : console.error;
  if (payload !== undefined) fn(PREFIX, msg, payload);
  else fn(PREFIX, msg);
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
