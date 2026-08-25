import { effectiveSyncUrl } from './config';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLocalHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return true;
  if (LOCAL_HOSTS.has(h)) return true;
  return h.endsWith('.localhost');
}

/** Host to put in a friend invite link (LAN IP or current non-local hostname). */
export function inviteHostname(lanAddresses: string[]): string | null {
  if (typeof location === 'undefined') return lanAddresses[0] ?? null;
  const current = location.hostname;
  if (!isLocalHostname(current)) return current;
  return lanAddresses[0] ?? null;
}

function syncHttpBase(): string {
  try {
    const sync = new URL(effectiveSyncUrl());
    const httpProto = sync.protocol === 'wss:' ? 'https:' : 'http:';
    return `${httpProto}//${sync.host}`;
  } catch {
    const proto =
      typeof location !== 'undefined' && location.protocol === 'https:' ? 'https' : 'http';
    const host = typeof location !== 'undefined' ? location.hostname : 'localhost';
    return `${proto}://${host}:1234`;
  }
}

export type LanInfo = {
  port: number;
  addresses: string[];
};

/** Ask the sync server which private LAN IPv4 addresses this machine has. */
export async function fetchLanAddresses(signal?: AbortSignal): Promise<LanInfo> {
  const res = await fetch(`${syncHttpBase()}/lan`, {
    method: 'GET',
    signal,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`lan ${res.status}`);
  const data: unknown = await res.json();
  if (!data || typeof data !== 'object') throw new Error('lan bad body');
  const rec = data as Record<string, unknown>;
  const port = typeof rec.port === 'number' ? rec.port : 1234;
  const raw = Array.isArray(rec.addresses) ? rec.addresses : [];
  const addresses = raw
    .filter((a): a is string => typeof a === 'string' && a.length > 0)
    .slice()
    .sort((a, b) => lanRank(a) - lanRank(b));
  return { port, addresses };
}

function lanRank(addr: string): number {
  if (addr.startsWith('192.168.')) return 0;
  if (addr.startsWith('10.')) return 1;
  return 2;
}

function uiPort(): string {
  if (typeof location === 'undefined') return '5173';
  if (location.port) return location.port;
  return location.protocol === 'https:' ? '443' : '80';
}

function uiProtocol(): string {
  if (typeof location === 'undefined') return 'http:';
  return location.protocol === 'https:' ? 'https:' : 'http:';
}

/** Board URL friends can open on the same LAN. */
export function lanBoardUrl(boardId: string, lanHost: string): string {
  const port = uiPort();
  const needsPort = port !== '80' && port !== '443';
  const origin = needsPort
    ? `${uiProtocol()}//${lanHost}:${port}`
    : `${uiProtocol()}//${lanHost}`;
  return `${origin}/board/${encodeURIComponent(boardId)}`;
}

/** App home URL on a LAN host (for Settings “copy app URL”). */
export function lanAppUrl(lanHost: string): string {
  const port = uiPort();
  const needsPort = port !== '80' && port !== '443';
  return needsPort
    ? `${uiProtocol()}//${lanHost}:${port}/`
    : `${uiProtocol()}//${lanHost}/`;
}

/** Resolve the best invite URL for a board (LAN when on localhost). */
export async function resolveInviteBoardUrl(
  boardId: string,
  signal?: AbortSignal
): Promise<{ url: string; host: string; fromLan: boolean }> {
  if (typeof location !== 'undefined' && !isLocalHostname(location.hostname)) {
    const url = `${location.origin}/board/${encodeURIComponent(boardId)}`;
    return { url, host: location.hostname, fromLan: false };
  }
  const { addresses } = await fetchLanAddresses(signal);
  const host = inviteHostname(addresses);
  if (!host) throw new Error('no lan address');
  return { url: lanBoardUrl(boardId, host), host, fromLan: true };
}
