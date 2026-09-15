/** Same-room reconnect: bounce the live socket only while sync stays enabled. */
export function syncReconnectMode(enabled: boolean, liveSameEndpoint: boolean): 'bounce' | 'rebuild' {
  if (enabled && liveSameEndpoint) return 'bounce';
  return 'rebuild';
}
