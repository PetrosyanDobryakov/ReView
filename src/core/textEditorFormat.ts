/** contentEditable toolbar helpers (browser only). */

const HILITE_HEX = '#ffe27a';

/** Tables store plain cell strings; frames store a single title line. Rich overlay markup cannot persist there. */
export function textOverlayAllowsRich(target: { type?: string | null; tableCell?: unknown }): boolean {
  return !target.tableCell && target.type !== 'frame';
}

export type LiveTextFormat = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  highlight: boolean;
  color: string;
};

const HIGHLIGHT_RGB = 'rgb(255, 226, 122)';

function cssColorToHex(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v || v === 'transparent') return null;
  if (v.startsWith('#')) {
    if (v.length === 4) {
      return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toUpperCase();
    }
    return v.length === 7 ? v.toUpperCase() : null;
  }
  const m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return null;
  const hex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${hex(Number(m[1]))}${hex(Number(m[2]))}${hex(Number(m[3]))}`.toUpperCase();
}

function selectionInsideMark(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel?.anchorNode) return false;
  let n: Node | null = sel.anchorNode;
  if (n.nodeType === Node.TEXT_NODE) n = n.parentElement;
  while (n && n instanceof HTMLElement) {
    if (n === root) break;
    if (n.tagName === 'MARK') return true;
    n = n.parentElement;
  }
  return false;
}

export function readLiveFormat(root: HTMLElement, fallbackColor: string): LiveTextFormat {
  const fore = cssColorToHex(document.queryCommandValue('foreColor')) ?? fallbackColor.toUpperCase();
  const back = document.queryCommandValue('backColor')?.toLowerCase() ?? '';
  const highlighted =
    selectionInsideMark(root) ||
    back.includes('255, 226, 122') ||
    back.includes('ffe27a') ||
    back === HIGHLIGHT_RGB;
  return {
    bold: document.queryCommandState('bold'),
    italic: document.queryCommandState('italic'),
    underline: document.queryCommandState('underline'),
    strike: document.queryCommandState('strikeThrough'),
    highlight: highlighted,
    color: fore,
  };
}

function hasTextSelection(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  return root.contains(range.commonAncestorContainer);
}

function unwrapMarksInRange(range: Range): void {
  const container = range.commonAncestorContainer;
  const scope = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
  if (!scope) return;
  const marks: HTMLElement[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      return node.nodeName === 'MARK' && range.intersectsNode(node)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  let n = walker.nextNode();
  while (n) {
    marks.push(n as HTMLElement);
    n = walker.nextNode();
  }
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }
}

export function clearHighlightInEditor(root: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  if (hasTextSelection(root)) {
    unwrapMarksInRange(sel.getRangeAt(0));
    return;
  }
  root.querySelectorAll('mark').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
}

function setCommandState(cmd: string, active: boolean, root: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  const hadRange = hasTextSelection(root);
  if (!hadRange) sel.selectAllChildren(root);
  let guard = 0;
  while (document.queryCommandState(cmd) !== active && guard++ < 4) {
    document.execCommand(cmd);
  }
  if (!hadRange) sel.collapseToEnd();
}

export type EditorFormatPatch = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  highlight?: boolean;
  color?: string;
};

/** Apply formatting inside the live text overlay. */
export function applyFormatToEditor(root: HTMLElement, patch: EditorFormatPatch): void {
  root.focus();
  const sel = window.getSelection();
  const ranged = hasTextSelection(root);

  if (patch.color !== undefined) {
    try {
      document.execCommand('styleWithCSS', false, 'true');
    } catch {
      /* legacy browsers */
    }
    if (ranged) {
      document.execCommand('foreColor', false, patch.color);
    } else {
      const range = document.createRange();
      range.selectNodeContents(root);
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand('foreColor', false, patch.color);
      sel?.collapseToEnd();
      root.style.color = patch.color;
    }
    root.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return;
  }

  if (patch.bold !== undefined) setCommandState('bold', patch.bold, root);
  if (patch.italic !== undefined) setCommandState('italic', patch.italic, root);
  if (patch.underline !== undefined) setCommandState('underline', patch.underline, root);
  if (patch.strike !== undefined) setCommandState('strikeThrough', patch.strike, root);

  if (patch.highlight !== undefined) {
    if (patch.highlight) {
      if (!ranged) sel?.selectAllChildren(root);
      document.execCommand('hiliteColor', false, HILITE_HEX);
      if (!ranged) sel?.collapseToEnd();
    } else {
      clearHighlightInEditor(root);
    }
  }
  root.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

type FlushTextTarget = {
  id: string | null;
  text?: string;
  richHtml?: string;
  tableCell?: { row: number; col: number } | null;
};

/** Commit an open overlay into the engine (board leave, tool switch, page switch). Duck-typed so App can call it without an Engine import cycle. */
export function flushOpenTextEditor<T extends FlushTextTarget>(
  engine:
    | {
        editing?: boolean;
        commitTableCell(id: string, row: number, col: number, text: string): void;
        commitText(id: string | null, text: string, target: T, html?: string): void;
        cancelTextEdit(): void;
      }
    | null
    | undefined,
  target: T | null | undefined,
  el: { innerText: string; innerHTML: string } | null | undefined
): boolean {
  if (!engine || !target) return false;
  // Overlay blur / a prior flush already committed — do not addShape again.
  if (engine.editing === false) {
    engine.cancelTextEdit();
    return false;
  }
  try {
    if (target.tableCell && target.id) {
      engine.commitTableCell(
        target.id,
        target.tableCell.row,
        target.tableCell.col,
        el?.innerText ?? target.text ?? ''
      );
    } else {
      engine.commitText(target.id, el?.innerText ?? target.text ?? '', target, el?.innerHTML ?? target.richHtml);
    }
  } catch {
    /* overlay or doc may already be gone */
  }
  engine.cancelTextEdit();
  return true;
}

type PersistEngine<T extends FlushTextTarget> = {
  editing?: boolean;
  commitTableCell(id: string, row: number, col: number, text: string): void;
  commitText(id: string | null, text: string, target: T, html?: string): void;
  cancelTextEdit(): void;
  commitOpenGraphEditor?: () => boolean;
};

/** Text overlay + graph preview into the doc (copy/export, tab close). */
export function persistOpenEditors<T extends FlushTextTarget>(
  engine: PersistEngine<T> | null | undefined,
  target: T | null | undefined,
  el: { innerText: string; innerHTML: string } | null | undefined
): { text: boolean; graph: boolean } {
  return {
    text: flushOpenTextEditor(engine, target, el),
    graph: Boolean(engine?.commitOpenGraphEditor?.()),
  };
}
