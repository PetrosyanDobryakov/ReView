/** Temporary debug NDJSON logger for free-text investigation. Remove after fix. */
export function agentLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {}
): void {
  const payload = JSON.stringify({
    sessionId: 'freetext',
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  });
  try {
    void fetch('http://127.0.0.1:7242/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    });
  } catch {
    /* ignore */
  }
  try {
    void fetch('/__agent_debug_log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    });
  } catch {
    /* ignore */
  }
}
