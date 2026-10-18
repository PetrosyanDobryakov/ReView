/**
 * What this network allows for direct links, from one ICE gathering round
 * against the configured STUN servers (no peer involved):
 *
 * - `blocked`: no STUN reply. Only same-network links (or TURN) can work.
 * - `symmetric`: the router shows each STUN server a different public port
 *   for the same local socket. A friend behind a similar router cannot be
 *   reached directly; one of you needs an open router, TURN or a virtual LAN.
 * - `ok`: one public address and port for everyone; hole punching works with
 *   most friends.
 */

import { iceServers } from './hubs';

export type NatKind = 'ok' | 'symmetric' | 'blocked' | 'unknown';
export type NatReport = { kind: NatKind; publicIp: string | null; mapped: string[]; stunServers: number };

const GATHER_MS = 6_000;

export async function checkNat(): Promise<NatReport> {
  const servers = iceServers().filter((s) => String(s.urls).startsWith('stun:'));
  if (typeof RTCPeerConnection !== 'function') return { kind: 'unknown', publicIp: null, mapped: [], stunServers: servers.length };
  // One server per entry keeps the candidates apart (same local socket, different server).
  const pc = new RTCPeerConnection({ iceServers: servers });
  const srflx: { ip: string; port: number; base: string }[] = [];
  try {
    pc.createDataChannel('nat');
    await new Promise<void>((resolve) => {
      const done = setTimeout(resolve, GATHER_MS);
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) {
          clearTimeout(done);
          resolve();
          return;
        }
        const c = ev.candidate;
        if (c.type === 'srflx' && c.address && c.port) {
          srflx.push({ ip: c.address, port: c.port, base: `${c.relatedAddress ?? ''}:${c.relatedPort ?? ''}` });
        }
      };
      void pc.createOffer().then((o) => pc.setLocalDescription(o));
    });
  } finally {
    pc.close();
  }
  const mapped = [...new Set(srflx.map((c) => `${c.ip}:${c.port}`))];
  if (!srflx.length) return { kind: servers.length ? 'blocked' : 'unknown', publicIp: null, mapped, stunServers: servers.length };
  const byBase = new Map<string, Set<number>>();
  for (const c of srflx) {
    const set = byBase.get(c.base) ?? new Set<number>();
    set.add(c.port);
    byBase.set(c.base, set);
  }
  const symmetric = [...byBase.values()].some((ports) => ports.size > 1);
  return { kind: symmetric ? 'symmetric' : 'ok', publicIp: srflx[0]!.ip, mapped, stunServers: servers.length };
}
