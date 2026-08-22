export type PenStyle = 'marker' | 'highlighter';

export interface PenSettings {
  color: string;
  size: number;
  style: PenStyle;
}

export interface ShapeSettings {
  fill: string;
  stroke: string;
}

export interface TextSettings {
  color: string;
  size: number;
}

export type EraserMode = 'whole' | 'partial';

export interface EraserSettings {
  size: number;
  mode: EraserMode;
}

export const settings: { pen: PenSettings; shape: ShapeSettings; text: TextSettings; eraser: EraserSettings } = {
  pen: {
    color: '#eceae4',
    size: 3,
    style: 'marker',
  },
  shape: {
    fill: '#ffffff',
    stroke: '#6b6b66',
  },
  text: {
    color: '#eceae4',
    size: 18,
  },
  eraser: {
    size: 32,
    mode: 'whole',
  },
};

const STORAGE_KEY = 'doska-tool-settings';

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

function restore(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    const bag = parsed as Record<string, unknown>;
    if (bag.pen && typeof bag.pen === 'object') Object.assign(settings.pen, bag.pen);
    if (bag.shape && typeof bag.shape === 'object') Object.assign(settings.shape, bag.shape);
    if (bag.text && typeof bag.text === 'object') Object.assign(settings.text, bag.text);
    if (bag.eraser && typeof bag.eraser === 'object') Object.assign(settings.eraser, bag.eraser);
  } catch {
    /* ignore */
  }
}

restore();

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export function updatePenSettings(patch: Partial<PenSettings>): void {
  Object.assign(settings.pen, patch);
  persist();
  emit();
}

export function updateShapeSettings(patch: Partial<ShapeSettings>): void {
  Object.assign(settings.shape, patch);
  persist();
  emit();
}

export function updateTextSettings(patch: Partial<TextSettings>): void {
  Object.assign(settings.text, patch);
  persist();
  emit();
}

export function updateEraserSettings(patch: Partial<EraserSettings>): void {
  Object.assign(settings.eraser, patch);
  persist();
  emit();
}

export function onSettingsChange(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function effectivePen(): { color: string; width: number; alpha: number } {
  if (settings.pen.style === 'highlighter') {
    return { color: settings.pen.color, width: settings.pen.size * 4, alpha: 0.3 };
  }
  return { color: settings.pen.color, width: settings.pen.size, alpha: 1 };
}
