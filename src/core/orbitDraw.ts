import { isOrbitPaper, ORBIT_COLORS } from './orbit';
import { settings, updatePenSettings, updateShapeSettings, updateTextSettings } from './settings';
import { DEFAULT_SLOTS, readPenSlots, writePenSlot } from './penColors';

/**
 * Orbit board drawing tokens — mission palette on the void.
 * Display/defaults only; never rewrite synced shape colors.
 */
export const ORBIT_DRAW = {
  ink: ORBIT_COLORS.white,
  steel: ORBIT_COLORS.steel,
  dragon: ORBIT_COLORS.dragon,
  merlin: ORBIT_COLORS.merlin,
  abort: ORBIT_COLORS.abort,
  shapeFill: '#131315',
  shapeStroke: ORBIT_COLORS.steel,
  sticky: '#151517',
  stickyStroke: 'rgba(169, 175, 185, 0.24)',
  stickyText: ORBIT_COLORS.white,
  /** Plume-orange band across the top of a sticky — reads as "note" on a dark board. */
  stickyBand: ORBIT_COLORS.merlin,
  text: ORBIT_COLORS.white,
  /** Grid tint (Orbit paper draws a dot lattice, see drawOrbitDotGrid). */
  grid: 'rgba(169, 175, 185, 0.18)',
  handleFill: ORBIT_COLORS.void,
  selectionUnder: 'rgba(5, 5, 6, 0.72)',
} as const;

/** Quick pen slots when Orbit paper is active (local slots only). */
export const ORBIT_PEN_SLOTS: string[] = [
  ORBIT_DRAW.ink,
  ORBIT_DRAW.steel,
  ORBIT_DRAW.dragon,
  ORBIT_DRAW.merlin,
  ORBIT_DRAW.abort,
];

/** Default board paper when leaving Orbit. */
export const PACKET_PAPER = '#1c1c1a';

const PACKET_PEN = '#eceae4';
const PACKET_TEXT = '#eceae4';
const PACKET_FILL = '#ffffff';
const PACKET_STROKE = '#6b6b66';
const CLASSIC_STICKY_TEXT = '#3a2f00';

const SNAP_KEY = 'review-orbit-tool-snap';

interface ToolSnap {
  pen: string;
  text: string;
  fill: string;
  stroke: string;
  slots: string[];
}

export function isClassicStickyText(color: string | undefined): boolean {
  if (!color) return true;
  return color.trim().toLowerCase() === CLASSIC_STICKY_TEXT;
}

function readSnap(): ToolSnap | null {
  try {
    const raw = sessionStorage.getItem(SNAP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ToolSnap>;
    if (
      typeof parsed.pen !== 'string' ||
      typeof parsed.text !== 'string' ||
      typeof parsed.fill !== 'string' ||
      typeof parsed.stroke !== 'string' ||
      !Array.isArray(parsed.slots)
    ) {
      return null;
    }
    return {
      pen: parsed.pen,
      text: parsed.text,
      fill: parsed.fill,
      stroke: parsed.stroke,
      slots: parsed.slots.filter((c): c is string => typeof c === 'string'),
    };
  } catch {
    return null;
  }
}

function writeSnap(snap: ToolSnap): void {
  try {
    sessionStorage.setItem(SNAP_KEY, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
}

function clearSnap(): void {
  try {
    sessionStorage.removeItem(SNAP_KEY);
  } catch {
    /* ignore */
  }
}

function emitPenSlots(): void {
  try {
    window.dispatchEvent(new CustomEvent('review-pen-slots'));
  } catch {
    /* ignore */
  }
}

/**
 * Remint local tool defaults when entering Orbit paper.
 * Snapshots the prior palette once so leave can restore it.
 */
export function applyOrbitToolDefaults(): void {
  if (!readSnap()) {
    writeSnap({
      pen: settings.pen.color,
      text: settings.text.color,
      fill: settings.shape.fill,
      stroke: settings.shape.stroke,
      slots: readPenSlots(),
    });
  }

  updatePenSettings({ color: ORBIT_DRAW.ink });
  updateTextSettings({ color: ORBIT_DRAW.text });
  updateShapeSettings({ fill: ORBIT_DRAW.shapeFill, stroke: ORBIT_DRAW.shapeStroke });
  ORBIT_PEN_SLOTS.forEach((c, i) => writePenSlot(i, c));
  emitPenSlots();
}

/** Restore pre-Orbit tool palette (or Packet defaults if no snap). */
export function restoreOrbitToolDefaults(): void {
  const snap = readSnap();
  if (snap) {
    updatePenSettings({ color: snap.pen });
    updateTextSettings({ color: snap.text });
    updateShapeSettings({ fill: snap.fill, stroke: snap.stroke });
    const slots = snap.slots.length ? snap.slots : DEFAULT_SLOTS;
    slots.forEach((c, i) => writePenSlot(i, c));
    clearSnap();
    emitPenSlots();
    return;
  }

  if (settings.pen.color.toLowerCase() === ORBIT_DRAW.ink.toLowerCase()) {
    updatePenSettings({ color: PACKET_PEN });
  }
  if (settings.text.color.toLowerCase() === ORBIT_DRAW.text.toLowerCase()) {
    updateTextSettings({ color: PACKET_TEXT });
  }
  if (settings.shape.fill.toLowerCase() === ORBIT_DRAW.shapeFill.toLowerCase()) {
    updateShapeSettings({ fill: PACKET_FILL });
  }
  if (settings.shape.stroke.toLowerCase() === ORBIT_DRAW.shapeStroke.toLowerCase()) {
    updateShapeSettings({ stroke: PACKET_STROKE });
  }
  const slots = readPenSlots();
  const stillOrbitSlots = slots.every((c, i) => c.toLowerCase() === ORBIT_PEN_SLOTS[i]?.toLowerCase());
  if (stillOrbitSlots) {
    DEFAULT_SLOTS.forEach((c, i) => writePenSlot(i, c));
    emitPenSlots();
  }
}

export function shouldUseOrbitDraw(boardBg: string): boolean {
  return isOrbitPaper(boardBg);
}
