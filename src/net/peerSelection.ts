/** Ephemeral multi-shape selection published via awareness (not the Yjs doc). */

export const SELECTION_MAX_IDS = 64;

/** Parse awareness `selection` — null/empty clears remote chrome. */
export function parsePeerSelection(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= SELECTION_MAX_IDS) break;
  }
  return out.length ? out : null;
}

/** Cheap equality for awareness / paint dirty checks. */
export function samePeerSelection(
  a: string[] | null | undefined,
  b: string[] | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Cap + dedupe before publish; empty → null. */
export function slimPeerSelection(ids: readonly string[]): string[] | null {
  return parsePeerSelection([...ids]);
}
