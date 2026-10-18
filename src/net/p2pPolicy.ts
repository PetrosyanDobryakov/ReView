/** Public y-webrtc signaling. Heroku relays were shut down. */
export const DEFAULT_P2P_SIGNALING: readonly string[] = ['wss://signaling.yjs.dev'];

/** Default port of our own signaling relay (scripts/signal-server.mjs). */
export const DEFAULT_SIGNAL_PORT = '1235';

/** Loopback + RFC1918 hosts — keep in sync with src/net/config.ts. */
const SIGNAL_LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Own signaling URL derived from the sync URL (same host, signal port).
 * Returns null for public sync hosts (they keep the public signaling list).
 */
export function deriveOwnSignalingUrl(syncUrl: string, signalPort: string): string | null {
  const port = /^\d+$/.test(signalPort) ? signalPort : DEFAULT_SIGNAL_PORT;
  let u: URL | null = null;
  try {
    u = new URL(syncUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null;
  const h = u.hostname.toLowerCase();
  const loopback = SIGNAL_LOOPBACK.has(h) || h.endsWith('.localhost');
  const lan =
    /^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(h);
  if (!loopback && !lan) return null;
  const host = h.includes(':') && !h.startsWith('[') ? `[${h}]` : u.hostname;
  return `${u.protocol === 'wss:' ? 'wss' : 'ws'}://${host}:${port}`;
}

/**
 * Signaling URL list: explicit custom URL wins, then our own relay when the
 * sync host is loopback/LAN, otherwise the public fallback list.
 */
export function resolveSignalingUrls(input: {
  custom: string | null;
  syncUrl: string;
  signalPort: string;
  fallback: readonly string[];
}): string[] {
  if (input.custom) return [input.custom];
  const own = deriveOwnSignalingUrl(input.syncUrl, input.signalPort);
  if (own) return [own];
  return [...input.fallback];
}

/**
 * Static hosts (pages.dev, vercel.app, …) have no LAN websocket, so P2P is on
 * unless the user explicitly turned it off. Stored `p2pEnabled: false` from the
 * old default is not an explicit off (`userSet` is missing/false).
 * LAN / self-host stays opt-in: only `storedEnabled === true`.
 */
export function resolveP2pEnabled(input: {
  staticHost: boolean;
  storedEnabled: boolean;
  userSet: boolean;
}): boolean {
  if (input.staticHost && !input.userSet) return true;
  return input.storedEnabled === true;
}
