import type { ToolId } from '../engine/tools';

export type ToolBinds = Record<ToolId, string>;
export type ColorBinds = Record<string, string>; // color hex -> code

const STORAGE_KEY = 'review-keybinds';

const DEFAULT_TOOL_BINDS: ToolBinds = {
  select: 'KeyV',
  lasso: 'KeyQ',
  pan: 'KeyH',
  pen: 'KeyP',
  rect: 'KeyR',
  ellipse: 'KeyO',
  sticky: 'KeyS',
  text: 'KeyT',
  arrow: 'KeyL',
  eraser: 'KeyE',
  graph: 'KeyG',
  diamond: 'KeyD',
  frame: 'KeyF',
  triangle: 'KeyJ',
  parallelogram: 'KeyW',
  hexagon: 'KeyY',
  cylinder: 'KeyC',
  terminator: 'KeyU',
  subroutine: 'KeyI',
  display: 'KeyK',
};

const DEFAULT_COLOR_BINDS: ColorBinds = {
  '#eceae4': 'Digit1',
  '#ffe27a': 'Digit2',
  '#ff6b6b': 'Digit3',
  '#4cd964': 'Digit4',
  '#c4a35a': 'Digit5',
  '#ffa94d': 'Digit6',
  '#e8e2d6': 'Digit7',
  '#ff9fd0': 'Digit8',
};

export interface Keybinds {
  tools: ToolBinds;
  colors: ColorBinds;
}

function load(): Keybinds {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Keybinds>;
      return {
        tools: { ...DEFAULT_TOOL_BINDS, ...(parsed.tools ?? {}) },
        colors: { ...DEFAULT_COLOR_BINDS, ...(parsed.colors ?? {}) },
      };
    }
  } catch {}
  return { tools: { ...DEFAULT_TOOL_BINDS }, colors: { ...DEFAULT_COLOR_BINDS } };
}

let current: Keybinds = load();

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {}
  window.dispatchEvent(new CustomEvent('review-keybinds-changed'));
}

export function getToolBinds(): ToolBinds {
  return { ...current.tools };
}

export function getColorBinds(): ColorBinds {
  return { ...current.colors };
}

export function getToolBind(tool: ToolId): string {
  return current.tools[tool] ?? DEFAULT_TOOL_BINDS[tool];
}

export function setToolBind(tool: ToolId, code: string): void {
  // remove duplicate
  for (const [k, v] of Object.entries(current.tools) as Array<[ToolId, string]>) {
    if (v === code && k !== tool) current.tools[k] = '';
  }
  for (const [col, c] of Object.entries(current.colors)) {
    if (c === code) delete (current.colors as Record<string, string>)[col];
  }
  current.tools[tool] = code;
  save();
}

export function getColorBind(color: string): string {
  return current.colors[color] ?? '';
}

export function setColorBind(color: string, code: string): void {
  for (const [col, c] of Object.entries(current.colors)) {
    if (c === code && col !== color) delete current.colors[col];
  }
  for (const [tool, c] of Object.entries(current.tools) as Array<[ToolId, string]>) {
    if (c === code) current.tools[tool] = '';
  }
  if (code) current.colors[color] = code;
  else delete current.colors[color];
  save();
}

export function resetKeybinds(): void {
  current = { tools: { ...DEFAULT_TOOL_BINDS }, colors: { ...DEFAULT_COLOR_BINDS } };
  save();
}

export function onKeybindsChange(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener('review-keybinds-changed', h);
  window.addEventListener('storage', h);
  return () => {
    window.removeEventListener('review-keybinds-changed', h);
    window.removeEventListener('storage', h);
  };
}

export function codeToDisplay(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'Space';
  if (code === 'Minus') return '-';
  if (code === 'Equal') return '=';
  return code;
}
