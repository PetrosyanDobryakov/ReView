import { readPrefs } from '../core/prefs';

const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
const host = typeof location !== 'undefined' ? location.hostname : 'localhost';
const syncPort =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SYNC_PORT) || '1234';

const BUILTIN_SYNC_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SYNC_URL) ||
  `${proto}://${host}:${syncPort}`;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Default websocket URL for this origin (or `VITE_SYNC_URL`). */
export function defaultSyncUrl(): string {
  return BUILTIN_SYNC_URL;
}

/** Pref override when set, otherwise built-in. */
export function effectiveSyncUrl(): string {
  return readPrefs().syncUrl || BUILTIN_SYNC_URL;
}

/** True when the sync URL host is this machine's loopback. */
export function isLoopbackSyncHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return false;
  if (LOOPBACK_HOSTS.has(h)) return true;
  return h.endsWith('.localhost');
}

/** Port from the effective sync URL (falls back to VITE_SYNC_PORT / 1234). */
export function effectiveSyncPort(): string {
  const fallback = String(syncPort || '1234');
  try {
    const u = new URL(effectiveSyncUrl());
    if (u.port) return u.port;
  } catch {
    /* use fallback */
  }
  return fallback;
}

/**
 * HTTP origin for host-side room DELETE.
 * Always 127.0.0.1 so compaction is authorized even when the UI is opened via a LAN IP.
 */
export function loopbackSyncHttpBase(): string {
  return `http://127.0.0.1:${effectiveSyncPort()}`;
}

export function isSyncEnabled(): boolean {
  return readPrefs().syncEnabled !== false;
}

/** Yjs room name for a board. Legacy fallback when no board is active. */
export function boardRoomName(boardId: string | null | undefined): string {
  return boardId ? `review-${boardId}` : 'review';
}
