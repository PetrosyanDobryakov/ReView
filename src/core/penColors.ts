/** Miro-style pen color slots: N quick slots + shared palette + custom colors. */

const SLOTS_KEY = 'review-pen-slots';
const CUSTOM_KEY = 'review-pen-custom-colors';

export const DEFAULT_SLOTS: string[] = ['#ffffff', '#1c1c1a', '#e03131', '#ffe27a', '#2f9e44', '#1c7ed6'];

/** Hue columns, light → dark. Rendered transposed: rows are shades, columns are hues (Miro-like). */
export const PALETTE_HUES: string[][] = [
  ['#fff9c4', '#ffe27a', '#f6c945', '#b98a1f'], // yellow
  ['#ffe0b8', '#ffa94d', '#e8762d', '#a34d12'], // orange
  ['#ffc9c9', '#ff8787', '#e03131', '#a01010'], // red
  ['#c3fad0', '#8ce99a', '#2f9e44', '#1b6b2c'], // green
  ['#d0ebff', '#74c0fc', '#1c7ed6', '#1864ab'], // blue
  ['#e5dbff', '#b197fc', '#7950f2', '#5230a0'], // purple
  ['#f8f9fa', '#dee2e6', '#ced4da', '#495057'], // gray
  ['#ffffff', '#f046d2', '#868e96', '#1c1c1a'], // white / magenta / slate / black
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
