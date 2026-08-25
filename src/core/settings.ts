export type PenStyle = 'marker' | 'highlighter';

export interface PenSettings {
  color: string;
  size: number;
  style: PenStyle;
}

export interface ShapeSettings {
  fill: string;
  stroke: string;
  /** Outline thickness for shapes / arrows. */
  strokeWidth: number;
  /** When false, new shapes get a transparent fill. */
  filled: boolean;
  /** Rounded corners for rectangles (sharp when false). */
  rounded: boolean;
  /** Arrow head length in world units. */
  arrowHead: number;
}

export interface TextSettings {
  color: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  align: 'left' | 'center' | 'right';
  highlight: boolean;
}

export type EraserMode = 'whole' | 'partial';

export interface EraserSettings {
  size: number;
  mode: EraserMode;
}

export const SHAPE_STROKE_MIN = 1;
export const SHAPE_STROKE_MAX = 16;
export const ARROW_HEAD_MIN = 6;
export const ARROW_HEAD_MAX = 48;
export const RECT_CORNER_RADIUS = 6;

export const settings: { pen: PenSettings; shape: ShapeSettings; text: TextSettings; eraser: EraserSettings } = {
  pen: {
    color: '#eceae4',
    size: 3,
    style: 'marker',
  },
  shape: {
    fill: '#ffffff',
    stroke: '#6b6b66',
    strokeWidth: 2,
    filled: true,
    rounded: true,
    arrowHead: 14,
  },
  text: {
    color: '#eceae4',
    size: 18,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    align: 'left',
    highlight: false,
  },
  eraser: {
    size: 32,
    mode: 'whole',
  },
};

const STORAGE_KEY = 'review-tool-settings';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  try {
    import('./userProfile').then((m) => m.persistUserProfile());
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
    if (bag.pen && typeof bag.pen === 'object') {
      const p = bag.pen as Record<string, unknown>;
      if (typeof p.color === 'string') settings.pen.color = p.color;
      if (typeof p.size === 'number' && p.size > 0 && p.size < 200) settings.pen.size = p.size;
      if (p.style === 'marker' || p.style === 'highlighter') settings.pen.style = p.style;
    }
    if (bag.shape && typeof bag.shape === 'object') {
      const s = bag.shape as Record<string, unknown>;
      if (typeof s.fill === 'string') settings.shape.fill = s.fill;
      if (typeof s.stroke === 'string') settings.shape.stroke = s.stroke;
      if (typeof s.strokeWidth === 'number') {
        settings.shape.strokeWidth = clamp(s.strokeWidth, SHAPE_STROKE_MIN, SHAPE_STROKE_MAX);
      }
      if (typeof s.filled === 'boolean') settings.shape.filled = s.filled;
      if (typeof s.rounded === 'boolean') settings.shape.rounded = s.rounded;
      if (typeof s.arrowHead === 'number') {
        settings.shape.arrowHead = clamp(s.arrowHead, ARROW_HEAD_MIN, ARROW_HEAD_MAX);
      }
      // Legacy: transparent fill stored without filled flag.
      if (settings.shape.fill === 'transparent' || settings.shape.fill === 'none') {
        settings.shape.filled = false;
      }
    }
    if (bag.text && typeof bag.text === 'object') {
      const t = bag.text as Record<string, unknown>;
      if (typeof t.color === 'string') settings.text.color = t.color;
      if (typeof t.size === 'number' && t.size >= 4 && t.size <= 200) settings.text.size = t.size;
      if (typeof t.bold === 'boolean') settings.text.bold = t.bold;
      if (typeof t.italic === 'boolean') settings.text.italic = t.italic;
      if (typeof t.underline === 'boolean') settings.text.underline = t.underline;
      if (typeof t.strike === 'boolean') settings.text.strike = t.strike;
      if (t.align === 'left' || t.align === 'center' || t.align === 'right') settings.text.align = t.align;
      if (typeof t.highlight === 'boolean') settings.text.highlight = t.highlight;
    }
    if (bag.eraser && typeof bag.eraser === 'object') {
      const e = bag.eraser as Record<string, unknown>;
      if (typeof e.size === 'number' && e.size > 0 && e.size < 400) settings.eraser.size = e.size;
      if (e.mode === 'whole' || e.mode === 'partial') settings.eraser.mode = e.mode;
    }
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
  if (typeof patch.strokeWidth === 'number') {
    settings.shape.strokeWidth = clamp(patch.strokeWidth, SHAPE_STROKE_MIN, SHAPE_STROKE_MAX);
  }
  if (typeof patch.arrowHead === 'number') {
    settings.shape.arrowHead = clamp(patch.arrowHead, ARROW_HEAD_MIN, ARROW_HEAD_MAX);
  }
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

export type SettingsSnapshot = typeof settings;

export function exportSettingsSnapshot(): SettingsSnapshot {
  return {
    pen: { ...settings.pen },
    shape: { ...settings.shape },
    text: { ...settings.text },
    eraser: { ...settings.eraser },
  };
}

/** Replace in-memory tool settings from a saved profile snapshot. */
export function applySettingsSnapshot(raw: SettingsSnapshot): void {
  if (raw.pen && typeof raw.pen === 'object') Object.assign(settings.pen, raw.pen);
  if (raw.shape && typeof raw.shape === 'object') Object.assign(settings.shape, raw.shape);
  if (raw.text && typeof raw.text === 'object') Object.assign(settings.text, raw.text);
  if (raw.eraser && typeof raw.eraser === 'object') Object.assign(settings.eraser, raw.eraser);
  if (settings.shape.fill === 'transparent' || settings.shape.fill === 'none') {
    settings.shape.filled = false;
  }
  persist();
  emit();
}

/** Fill string for newly drawn shapes (honours the no-fill toggle). */
export function shapeFillValue(): string {
  return settings.shape.filled ? settings.shape.fill : 'transparent';
}

export function effectivePen(): { color: string; width: number; alpha: number } {
  if (settings.pen.style === 'highlighter') {
    return { color: settings.pen.color, width: settings.pen.size * 4, alpha: 0.3 };
  }
  return { color: settings.pen.color, width: settings.pen.size, alpha: 1 };
}
