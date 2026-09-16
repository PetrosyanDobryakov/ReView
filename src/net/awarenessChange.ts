/** Helpers for y-protocols awareness `change` payloads. */

/** True when every added/updated/removed client id is the local awareness id. */
export function awarenessChangeIsLocalOnly(
  changes: { added?: number[]; updated?: number[]; removed?: number[] },
  localId: number
): boolean {
  const added = changes.added ?? [];
  const updated = changes.updated ?? [];
  const removed = changes.removed ?? [];
  const n = added.length + updated.length + removed.length;
  if (n === 0) return false;
  for (const id of added) if (id !== localId) return false;
  for (const id of updated) if (id !== localId) return false;
  for (const id of removed) if (id !== localId) return false;
  return true;
}
