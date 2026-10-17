/**
 * Which hubs a board joins. A hub is any running review-host (the one that
 * served this page, the one inside the desktop app, LAN neighbours found by
 * mDNS, or an address the user typed). None of them store anything.
 */

import { readPrefs } from '../../core/prefs';
import { formatHostForUrl } from '../lan';
import { desktopHostInfo, isDesktop, type LanHost } from './desktop';
import { normalizeHubUrl } from './hub';
import type { HubSource } from './types';

export type HubSpec = { url: string; source: HubSource };

export type HostProbe = {
  /** ws base of this host. */
  hub: string;
  /** http base (for invites and the web UI). */
  http: string;
  id: string;
  name: string;
  port: number;
  addresses: string[];
  hosts: LanHost[];
  mdns: boolean;
  /** The host bundles the web UI (friends can open it in a browser). */
  ui: boolean;
};

const PROBE_TIMEOUT_MS = 2_500;
const INVITE_KEY = 'review-invite-hubs';

export const DEFAULT_ICE: readonly string[] = [
  'stun:stun.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
];

function hostPort(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_HOST_PORT || '1234';
}

async function probe(httpBase: string): Promise<HostProbe | null> {
  if (typeof fetch === 'undefined') return null;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${httpBase}/lan`, { cache: 'no-store', signal: ctl?.signal });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    if (j.service !== 'review-host') return null;
    return {
      hub: httpBase.replace(/^http/i, 'ws'),
      http: httpBase,
      id: String(j.id ?? ''),
      name: String(j.name ?? ''),
      port: typeof j.port === 'number' ? j.port : Number(hostPort()),
      addresses: Array.isArray(j.addresses) ? j.addresses.filter((a): a is string => typeof a === 'string') : [],
      hosts: Array.isArray(j.hosts) ? (j.hosts as LanHost[]) : [],
      mdns: j.mdns === true,
      ui: j.ui === true,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let selfCache: { at: number; value: HostProbe | null } | null = null;

/** The review-host this tab belongs to: desktop shell, page origin, or the dev host on :1234. */
export async function findSelfHost(fresh = false): Promise<HostProbe | null> {
  if (!fresh && selfCache && Date.now() - selfCache.at < 10_000) return selfCache.value;
  let value: HostProbe | null = null;
  if (isDesktop()) {
    const info = await desktopHostInfo();
    if (info) {
      value = {
        hub: `ws://127.0.0.1:${info.port}`,
        http: `http://127.0.0.1:${info.port}`,
        id: info.id,
        name: info.name,
        port: info.port,
        addresses: info.addresses,
        hosts: info.hosts,
        mdns: info.mdns,
        ui: true,
      };
    }
  } else if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
    value = await probe(location.origin);
    if (!value) {
      const dev = `${location.protocol}//${formatHostForUrl(location.hostname)}:${hostPort()}`;
      if (dev !== location.origin) value = await probe(dev);
    }
  }
  selfCache = { at: Date.now(), value };
  return value;
}

/** First address of a LAN host, as a hub base. */
export function lanHostHub(h: LanHost): string | null {
  const addr = h.addresses[0];
  if (!addr || !h.port) return null;
  return `ws://${formatHostForUrl(addr)}:${h.port}`;
}

export function readInviteHubs(): string[] {
  try {
    const raw = sessionStorage.getItem(INVITE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Pick up `#hub=<addr>` / `?hub=<addr>` from an invite link (kept for this
 * tab only) and strip it from the address bar.
 */
export function captureInviteHub(): string | null {
  if (typeof location === 'undefined') return null;
  const params = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const raw = hash.get('hub') || params.get('hub');
  if (!raw) return null;
  const url = normalizeHubUrl(raw);
  if (!url) return null;
  const list = readInviteHubs();
  if (!list.includes(url)) list.push(url);
  try { sessionStorage.setItem(INVITE_KEY, JSON.stringify(list.slice(-4))); } catch { /* ignore */ }
  try {
    params.delete('hub');
    hash.delete('hub');
    const q = params.toString();
    const h = hash.toString();
    history.replaceState(history.state, '', `${location.pathname}${q ? `?${q}` : ''}${h ? `#${h}` : ''}`);
  } catch { /* ignore */ }
  return url;
}

let pageHostCache: { at: number; value: HostProbe | null } | null = null;

/**
 * Desktop dev: the window comes from Vite while browsers use the dev hub on
 * :1234, so the app also joins the hub that serves (or sits next to) its page.
 */
async function findPageHost(): Promise<HostProbe | null> {
  if (!isDesktop() || typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  if (pageHostCache && Date.now() - pageHostCache.at < 30_000) return pageHostCache.value;
  let value = await probe(location.origin);
  if (!value) {
    const dev = `${location.protocol}//${formatHostForUrl(location.hostname)}:${hostPort()}`;
    if (dev !== location.origin) value = await probe(dev);
  }
  pageHostCache = { at: Date.now(), value };
  return value;
}

export async function resolveHubs(): Promise<{ specs: HubSpec[]; self: HostProbe | null }> {
  const prefs = readPrefs();
  const self = await findSelfHost();
  const page = await findPageHost();
  const specs: HubSpec[] = [];
  const seen = new Set<string>();
  const add = (url: string | null, source: HubSource) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    specs.push({ url, source });
  };
  if (self) add(self.hub, 'self');
  if (page && page.id !== self?.id) add(page.hub, 'lan');
  if (self && prefs.p2pLanDiscovery) {
    for (const h of self.hosts) if (h.id !== self.id) add(lanHostHub(h), 'lan');
  }
  for (const u of prefs.p2pHubs) add(normalizeHubUrl(u), 'custom');
  for (const u of readInviteHubs()) add(u, 'invite');
  return { specs, self };
}

/** `stun:host:port` or `turn:host:port|user|pass` lines from prefs, else the defaults. */
export function iceServers(): RTCIceServer[] {
  const lines = readPrefs().p2pIce ?? [...DEFAULT_ICE];
  const out: RTCIceServer[] = [];
  for (const line of lines) {
    const [urls, username, credential] = line.split('|').map((s) => s.trim());
    if (!urls || !/^(stun|turns?):/i.test(urls)) continue;
    out.push(username ? { urls, username, credential: credential ?? '' } : { urls });
  }
  return out;
}
