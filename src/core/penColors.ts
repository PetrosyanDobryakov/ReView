/** Miro-style pen color slots: N quick slots + shared palette + custom colors. */

const SLOTS_KEY = 'review-pen-slots';
const CUSTOM_KEY = 'review-pen-custom-colors';

export const DEFAULT_SLOTS: string[] = ['#ffffff', '#1c7ed6', '#e03131', '#fab005', '#2f9e44'];

/**
 * Hue columns, light → dark. Rendered transposed: rows are shades, columns are
 * hues. The standard picker set: neutrals (white to black) then the usual
 * hue wheel, one clean ramp per hue.
 */
export const PALETTE_HUES: string[][] = [
  ['#ffffff', '#adb5bd', '#495057', '#000000'], // white / gray / black
  ['#ffc9c9', '#ff6b6b', '#e03131', '#a51111'], // red
  ['#ffd8a8', '#ffa94d', '#f76707', '#b04a00'], // orange
  ['#fff3bf', '#ffd43b', '#fab005', '#b37d00'], // yellow
  ['#b2f2bb', '#69db7c', '#2f9e44', '#1b5e2a'], // green
  ['#d0ebff', '#4dabf7', '#1c7ed6', '#0b4f99'], // blue
  ['#e5dbff', '#9775fa', '#7048e8', '#4424a0'], // purple
  ['#ffdeeb', '#f783ac', '#d6336c', '#8f1d48'], // pink
];

function isHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((c): c is string => typeof c === 'string' && isHex(c));
    }
  } catch {
    /* ignore */
  }
  return [];
}

function writeList(key: string, values: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    /* ignore */
  }
}

export function readPenSlots(): string[] {
  const stored = readList(SLOTS_KEY);
  const slots = DEFAULT_SLOTS.map((def, i) => (stored[i] && isHex(stored[i]) ? stored[i] : def));
  return slots;
}

export function writePenSlot(index: number, color: string): void {
  if (!isHex(color)) return;
  const slots = readPenSlots();
  slots[index] = color;
  writeList(SLOTS_KEY, slots);
}

export function readCustomColors(): string[] {
  return readList(CUSTOM_KEY);
}

export function addCustomColor(color: string): string[] {
  if (!isHex(color)) return readCustomColors();
  const list = readCustomColors();
  const value = color.toLowerCase();
  if (!list.some((c) => c.toLowerCase() === value)) {
    list.push(value);
    if (list.length > 30) list.splice(0, list.length - 30);
    writeList(CUSTOM_KEY, list);
  }
  return list;
}

export function removeCustomColor(color: string): string[] {
  const value = color.toLowerCase();
  const list = readCustomColors().filter((c) => c.toLowerCase() !== value);
  writeList(CUSTOM_KEY, list);
  return list;
}
