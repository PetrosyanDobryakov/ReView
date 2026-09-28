/** Pure toolbar-group logic: strip groups (nav/create) + the More shelf. No React, no prefs IO. */

import type { ToolId } from '../engine/tools';

export type StripGroup = 'nav' | 'create' | 'more';

export const NAV_DEFAULTS: ToolId[] = ['select', 'pan'];
export const CREATE_DEFAULTS: ToolId[] = ['pen', 'eraser', 'rect', 'arrow', 'sticky', 'text'];
/** Default Insert-shelf rows (specialty tools). */
export const MORE_DEFAULTS: ToolId[] = ['graph', 'calculator', 'table'];
export const SCHEME: ToolId[] = [
  'diamond',
  'triangle',
  'parallelogram',
  'hexagon',
  'cylinder',
  'terminator',
  'subroutine',
  'display',
  'frame',
];

/**
 * 1.0 toolbelt: one slot per family. The slot (first id) is what the strip and
 * shelf store; the button shows whichever member was used last and a flyout
 * lists the rest. Lasso folds under select, every shape under rect.
 */
export const TOOL_FAMILIES: Partial<Record<ToolId, ToolId[]>> = {
  select: ['select', 'lasso'],
  rect: ['rect', 'ellipse', ...SCHEME],
};

/** Family slot a tool belongs to (itself when it has no family). */
export function familySlot(id: ToolId): ToolId {
  for (const [slot, members] of Object.entries(TOOL_FAMILIES) as Array<[ToolId, ToolId[]]>) {
    if (members.includes(id)) return slot;
  }
  return id;
}

const PARKABLE_SET = new Set<string>([...NAV_DEFAULTS, ...CREATE_DEFAULTS, ...MORE_DEFAULTS]);

/**
 * Tools that can live on the strip or be parked in the Insert shelf.
 * Family members (lasso, ellipse, scheme shapes) ride in their slot's flyout.
 */
export function isParkable(id: string): id is ToolId {
  return PARKABLE_SET.has(id);
}

export interface ToolbarOrders {
  nav: ToolId[];
  create: ToolId[];
  more: ToolId[];
}

/** Saved prefs shape for the order (more is optional — legacy prefs predate the shelf). */
export interface SavedToolbarOrder {
  nav?: unknown;
  create?: unknown;
  more?: unknown;
}

function clean(v: unknown): ToolId[] {
  if (!Array.isArray(v)) return [];
  const out: ToolId[] = [];
  for (const x of v) {
    if (typeof x === 'string' && isParkable(x) && !out.includes(x)) out.push(x);
  }
  return out;
}

/**
 * Merge saved order with defaults: every parkable tool ends up in exactly one
 * group (priority nav > create > more); unknown scheme ids are dropped.
 */
export function readOrders(saved: SavedToolbarOrder | null): ToolbarOrders {
  const nav = clean(saved?.nav);
  const create = clean(saved?.create).filter((id) => !nav.includes(id));
  const more = clean(saved?.more).filter((id) => !nav.includes(id) && !create.includes(id));
  const seen = new Set<ToolId>([...nav, ...create, ...more]);
  const fill = (id: ToolId) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (MORE_DEFAULTS.includes(id)) more.push(id);
    else if (NAV_DEFAULTS.includes(id)) nav.push(id);
    else create.push(id);
  };
  for (const id of NAV_DEFAULTS) fill(id);
  for (const id of CREATE_DEFAULTS) fill(id);
  for (const id of MORE_DEFAULTS) fill(id);
  return { nav, create, more };
}

/**
 * Move a tool into a group (strip <-> shelf, reorder inside a group).
 * Unknown / scheme ids are ignored (returns prev reference = no change).
 */
export function moveToolInOrders(
  prev: ToolbarOrders,
  id: ToolId,
  to: StripGroup,
  before: ToolId | null,
  after: boolean
): ToolbarOrders {
  if (!isParkable(id)) return prev;
  const next: ToolbarOrders = {
    nav: prev.nav.filter((x) => x !== id),
    create: prev.create.filter((x) => x !== id),
    more: prev.more.filter((x) => x !== id),
  };
  const list = next[to];
  const at = before ? list.indexOf(before) : -1;
  if (at < 0) list.push(id);
  else list.splice(after ? at + 1 : at, 0, id);
  return next;
}
