# Changelog

## 0.11.0 — unreleased

### Collaboration
- Nickname setting in the sheet; default guest name with stable color.
- Remote cursors: colored pointer + name label for every online participant.
- Presence badge lists participant names.

### Learning tools
- Equations: `$...$` LaTeX inside text objects renders as formulas (MathJax SVG).
- Function graphs: new «graph» object — axes, grid and the curve of `y = f(x)`;
  double-click opens an expression row under the plot (`x^2-3`, `sin(x)/x`, `1/x`, ...).
- Pages: multiple pages per board, synced to everyone; per-device current page.
  Bottom-left bar: prev/next, add page, delete page.

### Export
- Export dialog: whole board / selection / picked region; scale ×1–×3;
  PNG or JPEG (with quality slider); PNG transparency option.
- Exact output dimensions and file size shown before download.

## 0.10.0 — 2026-08-23

### Rebrand
- Product renamed to **ReView** across storage keys, WS room, docs, and server logs.
- Board name on screen is editable (click it in the header); default `ReView`.
- Object counter moved from the header brand to the presence island.

### Fixes
- Right-click no longer collapses a multi-selection; copy/delete/duplicate act on the whole selection.
- Ctrl+V prefers the board clipboard; system clipboard is used when the board buffer is empty.
- Pasted groups land centered in the current view instead of off-screen.
- Text scales by dragging its frame edges like an image — font size follows the handles.
- Crop frame is now visually distinct: white dashed border with rule-of-thirds guides.

### Image crop rework
- Crop is non-destructive: the original image is kept, crop is stored as a display window.
- While editing frames the full original shows as a dimmed ghost layer; frames can extend beyond the visible part.
- Double-click an image to edit its crop frame; click empty space or press Enter to apply, Esc cancels.
- Context menu gains «Reset crop» for cropped images.
