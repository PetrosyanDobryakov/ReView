import { readPrefs } from '../core/prefs';
import { DEFAULT_P2P_SIGNALING, resolveP2pEnabled } from './p2pPolicy';

const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
const host = typeof location !== 'undefined' ? location.hostname : 'localhost';
const syncPort =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SYNC_PORT) || '1234';

const BUILTIN_SYNC_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SYNC_URL) ||
  `${proto}://${host}:${syncPort}`;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const STATIC_HOSTS = new Set(['vercel.app', 'netlify.app', 'github.io', 'pages.dev', 'onrender.com']);

/** True when running on Vercel/static without a dedicated sync server. */
export function isStaticHost(): boolean {
  if (typeof location === 'undefined') return false;
  const h = location.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(h) || h.endsWith('.localhost')) return false;
  // Private LAN IPs are not static — sync server is reachable on the LAN.
  if (/^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return false;
  for (const s of STATIC_HOSTS) if (h === s || h.endsWith(`.${s}`)) return true;
  // Any other public hostname (e.g. review.example.com on a VPS) is
  // treated as self-hosted with a co-located sync server, so sync is
  // available by default without requiring VITE_SYNC_URL/prefs.
  return false;
}

/** Default websocket URL for this origin (or `VITE_SYNC_URL`). */
export function defaultSyncUrl(): string {
  return BUILTIN_SYNC_URL;
}

/** Pref override when set, otherwise built-in. */
export function effectiveSyncUrl(): string {
  return readPrefs().syncUrl || BUILTIN_SYNC_URL;
}

/** Whether we should even attempt a websocket connection on this host. */
export function isSyncAvailable(): boolean {
  if (!isStaticHost()) return true;
  const viteSync = (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: Record<string,string> }).env?.VITE_SYNC_URL) || '';
  return Boolean(readPrefs().syncUrl || viteSync);
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
  if (readPrefs().syncEnabled === false) return false;
  return isSyncAvailable();
}

export function isP2pEnabled(): boolean {
  const prefs = readPrefs();
  return resolveP2pEnabled({
    staticHost: isStaticHost(),
    storedEnabled: prefs.p2pEnabled,
    userSet: prefs.p2pUserSet,
  });
}

export function p2pSignalingUrls(): string[] {
  const custom = readPrefs().p2pSignaling;
  if (custom) return [custom];
  const env = (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: Record<string,string> }).env?.VITE_P2P_SIGNALING) || '';
  if (env) {
    const validated = env
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => /^wss?:\/\//i.test(s))
      .map(s => s.replace(/\/$/, ''));
    if (validated.length) return validated;
  }
  return [...DEFAULT_P2P_SIGNALING];
}

/** Yjs room name for a board. Legacy fallback when no board is active. */
export function boardRoomName(boardId: string | null | undefined): string {
  return boardId ? `review-${boardId}` : 'review';
}
