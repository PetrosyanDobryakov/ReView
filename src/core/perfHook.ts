/** Desktop perf probe (electron/perf_probe.js, REVIEW_PERF=1); absent otherwise. */
export function perfHook(): { render(ms: number): void; orbit(ms: number): void } | undefined {
  return (globalThis as { __reviewPerf?: { render(ms: number): void; orbit(ms: number): void } }).__reviewPerf;
}
