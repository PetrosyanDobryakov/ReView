/** Tool / page chrome: dismiss a graph editor without writing the typed formula. */
export const GRAPH_CANCEL_BLUR_SEL =
  '.tool-btn, .toolbelt, .pages-trigger, .pages-menu, .pages-menu-item, [data-dismiss-edit]';

/** Undo/redo (and similar) that must not steal the open overlay. */
export const KEEP_EDIT_SEL = '[data-keep-edit]';

/** Copy / export / duplicate: commit the overlay so the snapshot includes typed work. */
export const COMMIT_EDIT_SEL = '[data-commit-edit]';

/**
 * Text overlay: commit immediately on blur so a following click (tool, style, file-bar)
 * does not race a 160ms timer.
 */
export const OVERLAY_FINISH_CHROME_SEL =
  '.style-island, .pen-pop, .chrome-select-pop, .pen-slots, .toolbelt, .block-scheme-popover, .tool-btn';

export type OverlayRelated = { closest(sel: string): unknown } | null | undefined;

export type GraphChromeKind = 'keep' | 'commit' | 'cancel' | null;

export function overlayKeepEdit(related: OverlayRelated): boolean {
  return Boolean(related?.closest(KEEP_EDIT_SEL));
}

export function overlayCommitEdit(related: OverlayRelated): boolean {
  return Boolean(related?.closest(COMMIT_EDIT_SEL));
}

export function overlayFinishNow(related: OverlayRelated): boolean {
  if (!related) return false;
  return overlayCommitEdit(related) || Boolean(related.closest(OVERLAY_FINISH_CHROME_SEL));
}

/**
 * Classify chrome under a pointer/blur target. Commit-edit wins over `.tool-btn` /
 * `.toolbelt` so Copy inside the toolbelt is not treated as a tool switch.
 */
export function graphChromeKind(related: OverlayRelated): GraphChromeKind {
  if (!related) return null;
  if (overlayKeepEdit(related)) return 'keep';
  if (overlayCommitEdit(related)) return 'commit';
  if (related.closest(GRAPH_CANCEL_BLUR_SEL)) return 'cancel';
  return null;
}

export function graphBlurCancels(related: OverlayRelated, insideEditor: boolean): boolean {
  if (!related || insideEditor) return false;
  return graphChromeKind(related) === 'cancel';
}
