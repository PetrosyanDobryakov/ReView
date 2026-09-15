/** Internal clipboard payload written by copySelection / read by paste. */
export function shapesFromClipboardText(text: string): unknown[] | null {
  const trimmed = text.replace(/\r\n/g, '\n').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const shapes = (parsed as { __reviewShapes?: unknown }).__reviewShapes;
    if (!Array.isArray(shapes) || !shapes.length) return null;
    return shapes;
  } catch {
    return null;
  }
}
