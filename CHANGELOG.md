# Changelog

## 0.12.0 — unreleased

### Security
- Sync server no longer creates `logs/net/` or accepts `GET`/`POST /net-log` unless `REVIEW_NET_LOG=1`. When enabled, `/net-log` returns relative paths only.
- `scripts/open-firewall.ps1` friend-URL hint uses `<lan-ip>` instead of a hardcoded machine address.

### Functional review pass
- Align/distribute: multi-select aligns within the selection; distribute no longer no-ops.
- Clipboard: paste/duplicate remaps connector `fromId`/`toId`; plain-text paste creates a text object.
- Arrows: hit-test and spatial bounds follow the rendered curve; connector preview starts with `moveTo`.
- Eraser: radius matches the cursor; partial erase hits stroke segments (including two-point lines); preview splits gaps like commit.
- Selection: cancel restores pre-drag geometry; frames move contained shapes; resize keeps image aspect on vertical corner drags; text N/S edges pad height.
- Shift-draw boxes stay anchored; frame default label is localized.
- Highlighters respect stacking order; crop overlay highlights the live crop box.
- Trackpad pixel-scroll pans; mouse wheel / pinch still zoom. Ctrl/Cmd+1 fits content.
- Cleared keybinds stay cleared (no silent fallback); cross-tab bind updates reload.
- Undo tracks pages; legacy `review-v1` migrates once with a marker; gesture boundaries via `beginGesture`/`endGesture`.
- Export: Escape closes dialog, soft size caps, stroke padding, clearer current-page label, failure message.
- Home: validated board metadata, localized defaults, remote-status warning, IndexedDB delete failures surface, team rows are not nested buttons.
- Docs import: long-word wrap, PDF destroy on error, truncation notice.
- Tool settings restore validates fields; paper can reset to board default; dismissible error banners + unhandled rejections.
- Text editor: Enter inserts newline; Ctrl/Cmd+Enter commits. Stickies get matching overlay padding.
- Style bar: rect/ellipse labels get formatting controls; custom colors delete with Del/Backspace.

### Documents
- Insert PDF/TXT as a multi-page document object; flip pages with on-canvas arrows and a page counter (up to 60 pages, rendered to page images at import).
- TXT pages are typeset onto A-ratio paper to match the PDF look.
- Unified upload accepts images, PDF, and plain text; pdf.js loads lazily only when importing a PDF.
- Drag-and-drop onto the window inserts at the pointer (drop overlay included); non-PDF/TXT files are rejected instead of being forced through the text renderer.

### Board
- Text, sticky and pen annotations lying fully inside an image stick to it while dragging.
- «Copy as image» and download include annotations on the photo (raw fast path only for clean uncropped images).

### Pen colors
- Miro-style pen color system: 5 quick slots (white, black, red, green, blue) that remember their colors.
- Clicking a slot opens a shade palette (8 hues × 4 shades) plus a custom colors section.
- Custom colors are added via the native picker (committed on confirm) and removed with right-click; the palette stays open while adding.

### Text & formatting
- Rich text on free text and labels: bold, italic, underline, strikethrough, highlight, and left/center/right align in the style bar.
- Free-text ink can adapt to local paper; with adapt off, low-contrast picks are bumped so text stays readable.
- Canvas hides the edited shape’s text while the overlay is open (including diamond / frame / triangle).
- Text wraps to the frame width on canvas (formula-aware metrics); committing keeps the frame and recomputes height.
- Handle semantics for text: corners scale the font, edge handles resize the wrap frame and refresh height.
- Double-click opens text editing on text-bearing objects (not on empty canvas).
- Block-scheme ports moved further from the shape edge (8 → 18 px) to avoid accidental grabs.

### Chrome & cursors
- Scalable tool cursors; quieter stroke cursors; toolbelt icons centered with hover motion.
- Custom board paper color: picker under the background presets in settings.
- Insert button uses an upload-style icon.

### Lock, align & context menu
- Fixed inverted lock toggle: «Заблокировать» locks, «Разблокировать» unlocks (headless `lock-test` added).
- Unlock requires press-and-hold (0.8 s) in the context menu with a theme-colored progress fill; lock/unlock label follows the whole selection.
- Align bar kept for any selected shapes; the same align / distribute actions are also in the context menu when they apply.

### Home
- Version check against GitHub releases: outdated notice with link, or a «dev build» label when ahead of the latest release.
- Home board list polish: custom status select and tighter column layout.

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
