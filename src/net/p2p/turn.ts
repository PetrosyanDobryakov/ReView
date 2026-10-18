/**
 * TURN fallback for links that cannot go direct (both peers behind one
 * carrier NAT, strict firewalls). Credentials are short-lived and come from
 * any hub that serves `/turn` (the Cloudflare hub mints them with Cloudflare
 * Realtime TURN). A peer that cannot reach such a hub gets them from a peer
 * that could, over signaling. TURN only forwards the encrypted WebRTC stream;
 * ICE prefers direct pairs, so it carries traffic only when nothing else works.
 */

import { readPrefs } from '../../core/prefs';

const STORE_KEY = 'review-turn';
/** Stop using credentials this long before they expire (a link may outlive the fetch). */
const MARGIN_MS = 2 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
/** Only relays we hand out ourselves are accepted from peers. */
const TRUSTED_HOST = /^turns?:turn\.cloudflare\.com(:\d+)?(\?|$)/;

export type TurnGrant = { iceServers: RTCIceServer[]; exp: number };

let grant: TurnGrant | null = load();

function load(): TurnGrant | null {
  try {
    const g = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as TurnGrant | null;
    return g && valid(g) ? g : null;
  } catch {
    return null;
  }
}

function valid(g: TurnGrant): boolean {
  return (
    typeof g.exp === 'number' &&
    g.exp - MARGIN_MS > Date.now() &&
    Array.isArray(g.iceServers) &&
    g.iceServers.length > 0 &&
    g.iceServers.every(
      (s) =>
        typeof s.username === 'string' &&
        typeof s.credential === 'string' &&
        ([] as string[]).concat(s.urls).every((u) => typeof u === 'string' && TRUSTED_HOST.test(u)),
    )
  );
}

function keep(g: TurnGrant): void {
  grant = g;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(g)); } catch { /* memory only */ }
}

export function turnEnabled(): boolean {
  const prefs = readPrefs();
  return prefs.p2pTurn && !(Array.isArray(prefs.p2pIce) && prefs.p2pIce.length === 0);
}

/** Current credentials, if any are still good. */
export function currentTurn(): TurnGrant | null {
  if (grant && !valid(grant)) grant = null;
  return grant;
}

export function turnServers(): RTCIceServer[] {
  return turnEnabled() ? (currentTurn()?.iceServers ?? []) : [];
}

/** Credentials a peer passed along; kept only if ours are missing or older. */
export function adoptTurn(raw: unknown): boolean {
  const g = raw as TurnGrant;
  if (!g || typeof g !== 'object' || !valid(g)) return false;
  const have = currentTurn();
  if (have && have.exp >= g.exp) return false;
  keep({ iceServers: g.iceServers, exp: g.exp });
  return true;
}

let inFlight: Promise<void> | null = null;

/** Ask the given hubs (ws/wss bases) for credentials unless ours are still good. */
export function refreshTurn(hubs: string[]): Promise<void> {
  if (!turnEnabled() || currentTurn() || inFlight) return inFlight ?? Promise.resolve();
  const bases = hubs
    .filter((u) => /^wss?:\/\//.test(u))
    .filter((u) => !/^wss?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(u))
    .map((u) => u.replace(/^ws/, 'http'));
  inFlight = (async () => {
    for (const base of bases) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(`${base}/turn`, { cache: 'no-store', signal: ctl.signal });
        if (!res.ok) continue;
        const j = (await res.json()) as { ttl?: number; iceServers?: RTCIceServer[] };
        const g = { iceServers: j.iceServers ?? [], exp: Date.now() + (j.ttl ?? 0) * 1000 };
        if (valid(g)) {
          keep(g);
          return;
        }
      } catch {
        /* next hub */
      } finally {
        clearTimeout(timer);
      }
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
