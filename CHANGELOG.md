# Changelog

## 0.12.0 — unreleased

### Documents
- Insert PDF/TXT as a multi-page document object; flip pages with on-canvas arrows and a page counter (up to 60 pages, rendered to page images at import).
- TXT pages are typeset onto A-ratio paper to match the PDF look.
- New toolbar button next to image insert; pdf.js loads lazily only when importing.
- Single upload button now accepts images and documents; files can also be dragged onto the window (drop overlay included).
- Double-click no longer opens the text editor (image crop and graph editor keep their double-click actions).

### Board & toolbar
- Custom board paper color: color picker under the background presets in settings.
- Insert-image button now uses an upload-style icon.

### Lock & context menu
- Fixed inverted lock toggle: «Заблокировать» now actually locks, «Разблокировать» unlocks (headless `lock-test` added).
- Unlock requires press-and-hold (0.8 s) in the context menu with a theme-colored progress fill and a «зажмите» hint.
- Alignment moved from the bottom island into the context menu; entries appear only for text/sticky selections (distribute at 3+). Bottom align island removed.

### Persistence
- Home toggle «Save others’ boards» (default off): remote boards stay session-only and are not written to IndexedDB until you save.
- Explicit «Save locally» on home and on the board chrome for remote boards.
- Home board list shows approximate local weight (KB/MB) from IndexedDB `review-v1-<id>`.
- Deleting a board also removes its IndexedDB database.
- Settings sheet reports «Session only» when the open board is not persisted.

### Polish
- Home uses locale strings (RU/EN/ZH); settings open from home.
- Theme `color-scheme` for native controls; nick input and error banner follow chrome tokens.
- Deploy notes in `docs/DEPLOY.md`; optional `VITE_SYNC_URL` for the websocket.

## 0.11.0 — unreleased

### Theming
- Object selection on the board now follows the active UI theme color.
- New chrome themes: Ocean, Forest, Sunset.
- Custom theme builder: pick background, panel, text and accent colors; derived
  shades (borders, dim text, active states) are computed automatically.

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
