/**
 * y-webrtc signaling relay core — runtime-agnostic (Node `ws`, workerd, …).
 *
 * Wire protocol (matches the reference y-webrtc signaling server):
 * - `{type:'subscribe', topics:[...]}` — join topic subscriber sets
 * - `{type:'unsubscribe', topics:[...]}` — leave them
 * - `{type:'publish', topic, ...rest}` — relayed to every subscriber of
 *   `topic` with `clients` set to the subscriber count
 * - `{type:'ping'}` — answered with `{type:'pong'}`
 * Anything else is ignored. Oversize/non-JSON input closes the socket.
 *
 * Connection interface (provided by the runtime adapter):
 * `{ send(text: string): void, close(): void }`
 */

export const MAX_SIGNAL_MESSAGE_BYTES = 256 * 1024;
export const MAX_SIGNAL_TOPICS_PER_SOCKET = 64;

export function createSignalRelay() {
  /** topic -> subscribers */
  const topics = new Map();
  /** conn -> its topics (for cleanup on close) */
  const memberships = new Map();

  function memberTopics(conn) {
    let set = memberships.get(conn);
    if (!set) {
      set = new Set();
      memberships.set(conn, set);
    }
    return set;
  }

  function safeSend(conn, message) {
    try {
      conn.send(JSON.stringify(message));
    } catch {
      try {
        conn.close();
      } catch {
        /* ignore */
      }
    }
  }

  function onMessage(conn, raw) {
    const text = typeof raw === 'string' ? raw : raw instanceof Buffer ? raw.toString('utf8') : null;
    if (text === null || text.length > MAX_SIGNAL_MESSAGE_BYTES) {
      try {
        conn.close();
      } catch {
        /* ignore */
      }
      return;
    }
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!message || typeof message.type !== 'string') return;
    switch (message.type) {
      case 'subscribe': {
        const mine = memberTopics(conn);
        const list = Array.isArray(message.topics) ? message.topics : [];
        for (const name of list) {
          if (typeof name !== 'string' || !name || mine.size >= MAX_SIGNAL_TOPICS_PER_SOCKET) continue;
          let subs = topics.get(name);
          if (!subs) {
            subs = new Set();
            topics.set(name, subs);
          }
          subs.add(conn);
          mine.add(name);
        }
        break;
      }
      case 'unsubscribe': {
        const mine = memberships.get(conn);
        const list = Array.isArray(message.topics) ? message.topics : [];
        for (const name of list) {
          if (typeof name !== 'string') continue;
          const subs = topics.get(name);
          if (subs) {
            subs.delete(conn);
            if (subs.size === 0) topics.delete(name);
          }
          if (mine) {
            mine.delete(name);
            if (mine.size === 0) memberships.delete(conn);
          }
        }
        break;
      }
      case 'publish': {
        if (typeof message.topic !== 'string' || !message.topic) return;
        const receivers = topics.get(message.topic);
        if (!receivers || receivers.size === 0) return;
        const out = { ...message, clients: receivers.size };
        for (const receiver of [...receivers]) {
          safeSend(receiver, out);
        }
        break;
      }
      case 'ping': {
        safeSend(conn, { type: 'pong' });
        break;
      }
      default:
        break;
    }
  }

  function onClose(conn) {
    const mine = memberships.get(conn);
    memberships.delete(conn);
    if (!mine) return;
    for (const name of mine) {
      const subs = topics.get(name);
      if (!subs) continue;
      subs.delete(conn);
      if (subs.size === 0) topics.delete(name);
    }
  }

  return {
    onMessage,
    onClose,
    topicCount: () => topics.size,
    socketCount: () => memberships.size,
  };
}
