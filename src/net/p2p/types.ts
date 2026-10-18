/**
 * Public shapes of the P2P layer. The UI and the rest of the app only see
 * these; the WebRTC and hub details stay inside `src/net/p2p/`.
 */

/** Where a hub address came from. Hubs only introduce peers; they carry no board data. */
export type HubSource = 'self' | 'lan' | 'preset' | 'custom' | 'invite';

export type HubState = 'connecting' | 'open' | 'retrying' | 'blocked' | 'error';

export type HubInfo = {
  /** Base address, `ws://host:port` or `wss://host`. */
  url: string;
  source: HubSource;
  state: HubState;
  /** Display name the host advertised in its welcome. */
  name: string | null;
  /** Peers in this room the hub introduced us to (excluding us). */
  peers: number;
  error: string | null;
};

export type LinkState = 'connecting' | 'open' | 'failed' | 'closed';

/**
 * How the bytes travel once a link is open, from the selected ICE pair:
 * `lan` = host candidates (same network), `direct` = through NAT via STUN,
 * `relay` = through a TURN server the user configured, `unknown` = stats not read yet.
 */
export type LinkPath = 'lan' | 'direct' | 'relay' | 'unknown';

export type PeerInfo = {
  /** Mesh peer id (one per tab). */
  peer: string;
  state: LinkState;
  path: LinkPath;
  /** Round trip in ms from our own PING frames, null until measured. */
  rtt: number | null;
  bytesIn: number;
  bytesOut: number;
  /** App version from the peer's HELLO. */
  app: string | null;
  /** Yjs awareness client ids this link reported (for name lookup). */
  clients: number[];
  /** Hubs that currently list this peer. */
  hubs: string[];
  /** Connection attempts since the peer appeared. */
  attempts: number;
};

export type MeshSnapshot = {
  room: string | null;
  self: string;
  enabled: boolean;
  webrtc: boolean;
  hubs: HubInfo[];
  peers: PeerInfo[];
};

/**
 * One transport between this tab and one other peer. Today there is only
 * the WebRTC data-channel link; the mesh is written against this interface.
 */
export interface PeerLink {
  readonly peer: string;
  readonly state: LinkState;
  readonly path: LinkPath;
  readonly bytesIn: number;
  readonly bytesOut: number;
  /** Queue one framed message (already split to MAX_FRAME). False if the link is not open. */
  send(frame: Uint8Array): boolean;
  /** Feed a signaling payload that the hub delivered from this peer. */
  signal(data: unknown): void;
  close(): void;
}

export type LinkEvents = {
  open(): void;
  message(data: Uint8Array): void;
  close(reason: string): void;
  /** Send a signaling payload to the peer through any hub. */
  signal(data: unknown): void;
};
