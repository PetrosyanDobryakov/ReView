/** Public y-webrtc signaling. Heroku relays were shut down. */
export const DEFAULT_P2P_SIGNALING: readonly string[] = ['wss://signaling.yjs.dev'];

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
