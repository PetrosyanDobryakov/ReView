import { findSelfHost } from './p2p/hubs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Bracket IPv6 so it is legal in URLs. Keep in sync with `rust/review-host/src/room_name.rs`. */
export function formatHostForUrl(host: string): string {
  const h = host.trim();
  if (!h) return h;
  if (h.includes(':') && !h.startsWith('[')) return `[${h}]`;
  return h;
}

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
  if (/^https?:$/.test(location.protocol) && !isLocalHostname(current)) return current;
  return lanAddresses[0] ?? null;
}

export type LanInfo = {
  /** Port friends should open: the host's when it serves the UI, else this page's (dev). */
  port: number;
  addresses: string[];
  /** True when the address is served by a review-host that bundles the web UI. */
  hostServesUi: boolean;
};

/** Private LAN addresses of the review-host this tab belongs to. */
export async function fetchLanAddresses(): Promise<LanInfo> {
  const self = await findSelfHost(true);
  if (!self) throw new Error('no review-host');
  const addresses = self.addresses
    .filter((a) => !a.includes(':'))
    .sort((a, b) => lanRank(a) - lanRank(b));
  const servesUi = self.ui;
  const port = servesUi ? self.port : Number(uiPort());
  return { port, addresses, hostServesUi: servesUi };
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

function originFor(host: string, port: number, protocol = 'http:'): string {
  const h = formatHostForUrl(host);
  const needsPort = !(port === 80 && protocol === 'http:') && !(port === 443 && protocol === 'https:');
  return needsPort ? `${protocol}//${h}:${port}` : `${protocol}//${h}`;
}

/** Board URL friends can open on the same LAN. */
export function lanBoardUrl(boardId: string, lanHost: string, port = Number(uiPort())): string {
  return `${originFor(lanHost, port)}/board/${encodeURIComponent(boardId)}`;
}

/**
 * Invite that works across the internet: the ReView app opens it (or it is
 * pasted into Home), and both sides meet through the hubs and relays.
 */
export function appInviteUrl(boardId: string): string {
  return `review://board/${encodeURIComponent(boardId)}`;
}

/** App home URL on a LAN host (for Settings "copy app URL"). */
export function lanAppUrl(lanHost: string, port = Number(uiPort())): string {
  return `${originFor(lanHost, port)}/`;
}

/**
 * Best invite URL for a board. A page on a public/LAN hostname shares its own
 * origin; on localhost or inside the desktop app it shares the host's LAN
 * address so a friend's browser can load the UI and the hub from it.
 */
export async function resolveInviteBoardUrl(
  boardId: string,
): Promise<{ url: string; host: string; fromLan: boolean }> {
  if (
    typeof location !== 'undefined' &&
    /^https?:$/.test(location.protocol) &&
    !isLocalHostname(location.hostname)
  ) {
    const url = `${location.origin}/board/${encodeURIComponent(boardId)}`;
    return { url, host: location.hostname, fromLan: false };
  }
  const { addresses, port } = await fetchLanAddresses();
  const host = addresses[0];
  if (!host) throw new Error('no lan address');
  return { url: lanBoardUrl(boardId, host, port), host, fromLan: true };
}
