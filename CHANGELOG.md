# Changelog

## 0.14.30 — unreleased

### Sync smoothness
- Remote cursors keep the paint loop alive between awareness samples (`peerMotionShouldAnimate`): the spring used to settle in 1–2 frames, clear `peersAnimating`, and freeze the glyph until the next packet — packet-rate stutter even when the socket was fine. Drawings were unaffected (doc updates paint immediately).
- Cursor send rate ~50 Hz (20 ms), softer smooth-damp, clamped sample dt (burst arrivals no longer explode aim velocity), and settle only after the hold window.

## 0.14.29 — unreleased

### Sync smoothness
- Remote cursors no longer double-step the spring each frame (glyph + edge pill both advanced the same pose) — that 2× catch-up looked like stutter even when packets arrived on time.
- Sync room full-doc encode is no longer armed from awareness (cursor/draft) frames, and waits for a short sync idle before running. Mid-flood `Y.encodeStateAsUpdate` on a photo board was freezing the Durable Object and bursting every queued cursor/stroke.

## 0.14.28 — unreleased

### Fix
- Concurrent peer page deletes that empty the Y `pages` array now restore `main` via `ensurePages` inside `healActivePageToList`, so the engine is not stuck filtering on a deleted active id (blank canvas).
- `.review` import strips foreign `ownerId` / synced title the same way clone does, so the importer can rename a local board in the header.
- Draft stroke and erase-preview awareness use a trailing flush (like cursors), so peers see the last vertices / hover instead of a truncated preview.

## 0.14.27 — unreleased

### Fix
- Worker wipe rejects websocket Upgrade with 503 while `wipeInFlight`, runs deleteAll/resetRoom under `blockConcurrencyWhile`, and keeps a separate post-wipe persist latch until the next accept — an Upgrade can no longer clear the latch mid-wipe and land on a reset doc.
- `compactBoard` calls `closeWriteGate()` before snapshotting so pending heavy gesture fields (points/pressures/src) land in the live doc instead of flushing into the discarded one.

## 0.14.26 — unreleased

### Fix
- Worker room DELETE / empty-room GC cancels the debounced tail timer, drains the persist gate, and latches a wipe flag so late `waitUntil` flushes and `webSocketClose` handlers cannot rewrite doc/tail blobs after `deleteAll` (compact/GC no longer resurrects a cleared room).

## 0.14.25 — unreleased

### Sync smoothness
- Dragged photos and PDFs paint full again — the placeholder that hid them mid-drag is gone.
- Peers see moves at pointer rate again: light fields (x/y/…) flush immediately even while heavy fields (points/…) coalesce — dragging no longer arrives as 30 Hz teleports.
- Sync room no longer runs storage round-trips inside the message handler: relay stays synchronous, the tail persist trails ~150 ms behind via waitUntil (plus flush-on-close/alarm). Floods stop queueing behind blob writes, so strokes and moves stop arriving in bursts.

## 0.14.24 — unreleased

### Fix
- Enter in the rich overlay keeps the line break when contentEditable wraps the next line in a `<div>` after a bare text node.
- Copy, duplicate, PNG/SVG export, and `.review` download / clone commit the open text overlay and graph preview first, so the snapshot includes what you typed.
- After a compacted snapshot the worker could delete `tail` then fail the drop check, leaving later updates only in memory. Failed drops now rewrite `tail` immediately.
- Region export from the overlay button used a stale engine captured at mount, before Engine existed. The callback now reads the live engine from the board ref.
- Export dialog preview follows the active page. A region pick closes when you switch pages. Leaving a board closes export and cancels crop so Apply cannot target the next board.
- Transparent SVG uses the board paper to adapt ink, same as transparent PNG, instead of keeping near-black strokes that vanish on a dark board.
- PDF/doc next/prev (and create/patch) clamp an out-of-range `page` so a stale index cannot sit on the last visual page while clicks do nothing.
- Region-pick is modal the same way crop is: Delete, undo, and tool keys do not mutate the board until Escape or the rectangle is finished.
- Toolbar Paste commits an open graph formula (same as Copy) instead of reverting it on blur.
- Settings Disconnect no longer bounces the live websocket back on. Same-room reconnect only reuses the socket while sync stays enabled.
- Clicking a table [+] / [−] while a cell overlay is open commits the cell and still inserts or removes the row/column.
- A failed 2D context while encoding an imported image now surfaces the same error toast as a decode failure.
- Escape after a live StyleBar font-size change remasures the text box so the stored glyphs still fit.
- When MathJax finishes loading, text shapes that were measured as raw `$latex$` reflow to the real formula size.
- Closing the tab (pagehide) writes an open graph preview into the doc the same way it flushes the text overlay, instead of dropping the typed formula.
- Graph Copy/export commit on the pointerdown hit target (`data-commit-edit` wins over `.toolbelt` / `.tool-btn`), so blur cannot restore `sin(x)` before the click writes the preview.
- File-bar download and Join Save-as commit the text overlay immediately (`data-commit-edit`), same as toolbar copy, instead of racing a 160ms blur timer.
- Graph copy / export / delete write the preview once through `commitOpenEditors`. Blur onto those buttons no longer also `finish()`, and `graphBlurCancels` ignores commit-edit / keep-edit so a `.tool-btn` is not cancel-vs-commit order-sensitive. Delete commits first so the formula overlay closes.
- PDF/TXT import asks a shared `require2dContext` helper for a 2D canvas; missing context still fails the import.
- Undo after a mid-edit font-size change remasures the text box without adding another undo step, so the remaining size still fits.
- The pages menu portal divides by `--ui-scale`, same as the members menu, so it stays under the trigger when chrome is scaled.
- Switching tools while a graph editor is open cancels on blur when focus moves to a tool or page control, so a `setTimeout(0)` commit cannot beat the toolbar click and keep the typed formula.
- Font-size remasure of a selected text shape (overlay closed) no longer runs twice for one slider change.
- Home / board-leave chrome is `data-dismiss-edit`, so an open graph editor cancels instead of committing a half-typed formula when you leave.
- Toolbar undo/redo is ignored while a text or graph overlay is open (same as the keyboard path), and those buttons do not steal overlay focus.
- Reset crop writes restored geometry and deletes crop keys in one transaction, so remotes never see a full box with the old crop window still applied.
- Mid-edit font-size changes no longer remasure from stored copy, so the overlay wrap and the commit box stay the same.
- Font-size remasure of existing text uses bold/italic from `richHtml` spans, not only the shape-level flags.
- Leaving a board mid-gesture resets write-gate depth after flushing, so the next board does not keep coalescing patches at 30 Hz.
- SVG (and the on-canvas page label) clamp an out-of-range PDF/doc page the same way the canvas does — last page, not first.
- Escape after rotate restores an originally upright shape: `rotation` is written as `0` so the Y key is deleted instead of keeping the mid-gesture angle.
- Switching tools (keyboard or toolbar) while a pointer gesture is down cancels that gesture the same way Escape does — dragged images drop their placeholders, write-gate depth closes, and a half-drawn connector is aborted. Crop and export-region pick stay modal.
- Escape after a move/rotate of a frame restores glue on a rider connector, not only its position.
- Clearing connector ports flushes pending stroke geometry first, so rotate/group-resize unglue does not snap the arrow back to a stale doc pose between pointer moves.
- WebP import/paste keeps alpha (encoded as PNG). JPEG is only used for JPEG files.
- Transparent PNG export on Orbit paper keeps a true alpha background. `background: null` is no longer treated as “missing” and filled with the Orbit void.
- SVG stickies omit the default yellow border the canvas skips. Graph curves use the same paper-adapted stroke as pens.
- Export Download is disabled until the preview blob matches the selected format, so a fast PNG→SVG switch cannot save the old bytes under a new extension.
- Rich paste that sanitizes to nothing falls back to `text/plain`. Transparent or near-white HTML backgrounds are not treated as highlights.
- Graph formula preview paints locally and does not write the doc, so Escape cannot leave an undo step that brings the cancelled expression back.
- Committing text wraps using bold/italic from the rich HTML, so Ctrl+B in the overlay does not under-measure the box.
- Lasso hit-tests the filled silhouette of diamonds, triangles, ellipses, and other non-rect shapes (plus any lasso vertex inside the fill). A loop around an empty AABB corner no longer selects; a loop around a real vertex still does. Rect corners and pen/arrow strokes are unchanged.
- Tall flowchart terminators hit-test the same vertical capsule the canvas and SVG paint (`r = min(w,h)/2`), so a click on the top cap selects and a click beside the waist does not.
- Exporting the selection paints only the selected shapes (plus glued riders), not every neighbor that intersects the AABB. Copy-as-image already did this; PNG/JPEG/SVG/PDF export now match.
- Click-to-type text wraps to the overlay width on commit, so a long line without Enter does not become one huge unwrapped shape. Pasted plain text uses the same wrap width.
- Switching pages while click-to-type is open commits the new text on the page where typing started, not the destination page. If that origin page is deleted first, the text lands on the healed live page instead of under a dead prefix.
- Resizing a table or frame scales a rotated rider's visual AABB the same way group-resize does, so a 90° rectangle on a table grows along the handle instead of its unrotated width.
- Applying a crop on a rotated image keeps the crop window in world space. Reset crop restores that same pose. The old path wrote the unrotated AABB and the picture jumped. Stickies and pens glued to the photo follow the crop/reset, same as "reset to original size."
- Cut copies only unlocked shapes (the same set Delete removes). Cutting a locked selection no longer overwrites the clipboard.
- Context-menu paste drops at the right-click, not the camera center. `pasteAt` is set when the menu opens. Image and plain-text paste use that same point, and dismissing the menu clears it so a later Ctrl+V is not pulled to the old click. Toolbar / context Paste reads a newer system shape marker even when this tab still holds an older in-memory copy.
- Nudging or dragging a connected arrow without its endpoints unglues it. Rotating, group-resizing, or aligning only the connector does the same. Moving either node still rebakes the connector. Resizing a glued arrow disconnects it first so the stroke is not warped and then yanked back.
- Rebaking a connected arrow stores the same visual bounds as create (curve + head), so handles match the painted stroke. Eight-point cubics keep that curve after unglue, instead of collapsing to the start–control chord. Resizing, rotating, or group-resizing a free arrow rebakes those same visual bounds.
- Gesture patches that rewrite a polyline keep the new box and the new points in one doc write, so remotes never see a moved AABB against a stale stroke.
- Clicking a connected-arrow resize handle without dragging leaves it glued. The first resize move disconnects it; Escape restores `fromId` / `toId` / ports from the pointer-down snapshot.
- Gesture patches that rewrite a polyline keep the new box and the new points in one doc write, so remotes never see a moved AABB against a stale stroke.
- Align uses locked members as anchors instead of ignoring them. The context menu offers Align when the selection is the whole board, and Distribute only when at least three unlocked shapes can move.
- Worker empty-room GC no longer deletes storage if a persist is still dirty or queued.
- StyleBar format while editing writes the shape once (no double undo). Table-cell edits no longer stamp whole-table bold/italic from the overlay, and the overlay target does not pick up cell bold/italic/highlight. Closing the text overlay after an external commit does not commit twice.
- Dropping or pasting an image captures the page and world position immediately, so a slow decode cannot land the photo on a page you switched to or at a camera you panned to. PDF/TXT import and clipboard paste (including delayed `getAsString`) capture the same way.
- Enter on a graph opens the formula editor; Enter on an image starts crop. Locked graphs do not open. Table cells and frame titles no longer accept rich shortcuts or HTML paste that the commit would throw away.
- Free arrows store the visual bounds of the curve and head, so handles and marquee match what is painted.
- Pinch-zoom applies zoom immediately (same as pan) so the two-finger pan is not scaled by a stale eased zoom.
- Switching tools while a table cell is open writes the cell through `commitText` → `commitTableCell`, so the overlay text lands in `cells[]` instead of the table's title field.
- Lasso and click hit-tests follow the painted arrow curve and filled head, not the start–end chord. Marquee uses the same visual bounds as the spatial grid.
- Copying or duplicating a connected arrow without both endpoints keeps the clone as a free arrow. The old path remapped one end and dropped the other, so paste left a half-glued connector.
- Lasso hits pen and arrow strokes and the corners of rotated boxes, not only the bounding-box center. A loop in the hollow of a U-shaped stroke no longer selects it.
- The brush-size slider scales a selected highlighter from that stroke's alpha, not the current pen-tool style. Marker and highlighter buttons still convert the selection to the chosen style.
- Table [+]/[−] pills sit apart from each other and from the east connect port, so the plus-shaped port cursor no longer lands on remove-column. Hover on a pill is a pointer, not a crosshair.
- Frame titles, table header cells, and labelled-shape overlays use the same font, first-line clip, and ink as the canvas. Clicks on table [+]/[−] do not start a select gesture.
- Auto-compact never rebuilds a board that once had a remote collaborator. A 2-minute awareness grace is not a replica set: hidden remote tabs drop the websocket, then a rebuild duplicates shapes when they return. Manual compact still runs when no live replica is present. Solo boards that never synced with anyone else still auto-compact tombstone bloat.
- Group-resize of rotated shapes scales each member's visual AABB with the selection, so a 90° rectangle grows along the handle instead of its unrotated width. Stickies/text keep size and track by center; pen points follow the group transform.
- SVG export wraps sticky/text/flowchart/table copy to the box, keeps bold/italic/underline/strike, and embeds MathJax formulas when they have already rendered. One-vertex pen leftovers export as filled dots. Stickies without `textColor` use the same dark ink as the canvas.
- Connected flowchart arrows store cubic controls in world space so rotating a node bends the curve with the port, not along the unrotated east/west axis.
- Double-clicking a rotated table picks the cell under the pointer and the editor overlay rotates with the table. Objects ride the table's rotated rectangle, not its AABB.
- Switching tools while a graph editor is open restores the original expression (same as Escape). The input blurs onto the tool button before `onClick`; commit is deferred so cancel still wins. Worker full persist keeps the tail when the doc mutates during the encode/write, so a concurrent update is not deleted with an empty pending queue.
- A deleted page heals onto a remaining page that still has shapes, not always `pages[0]`.
- SVG text without `textColor` follows the export paper via `displayInk` / `themeFor` (light paper is dark ink, not `#eceae4`).

## 0.14.23 — unreleased

### Fix
- Compact no longer rebuilds a board that is not actually smaller. The old 8MB force path compacted clean photo boards, then a hidden tab's replica merged duplicates back in.
- Compact skips while another same-origin tab still holds the board (localStorage heartbeat) or a remote peer was seen in the last two minutes. Hidden tabs drop the websocket, so awareness alone was not enough.
- Compact waits for a real IndexedDB commit after the rebuild, same barrier as clone/import.
- Sharing an oversized board reports "too large" instead of a generic failure.
- Resetting or re-cropping an image with a zero crop fraction no longer produces Infinity geometry.
- SVG export clips cropped photos and draws arrowheads. JPEG-in-PDF `/Length` matches the stream bytes (no extra newline).
- Inline formulas that render before MathJax finishes loading are not cached as permanent failures.
- Toolbar paste of copied shapes (when the paste event is blocked) restores shapes instead of dumping the JSON as a text object.
- Toolbar / context Paste reads the system clipboard (cross-tab copies and post-reload paste). A later copy on another tab replaces the in-memory clipboard instead of being ignored.
- Rotating a flowchart node (or group) reattaches connector arrows to the new port positions.
- Graph editor previews the curve while typing, not only after Enter or a preset.
- SVG export draws graph curves and keeps sticky/text line breaks.
- Deleting a board from Home no longer drops it from the list when IndexedDB delete is blocked or fails.
- Worker room persist serializes blob writes so overlapping flush/tail cannot drop the newer document.

## 0.14.22 — unreleased

### Fix
- Importing a .review file no longer leaves an empty orphan board when the IndexedDB write fails.
- Duplicating a board waits for a real IDB flush (not an 80ms sleep), fails instead of handing you a blank copy, and deletes the copy if the write does not commit.
- Oversized boards report "too large" on export again. Load no longer collapsed that case into a generic failure.
- Partial erase now clips stylus pressure with the stroke, so remaining ink keeps its width.
- SVG export draws PDF pages as images and flowchart nodes as their real shapes instead of empty rectangles.
- Compact treats another tab of the same user as a live peer, treats DELETE 404 as a successful wipe, and stays detached if the server room cannot be cleared (so tombstones cannot crawl back in).
- Duplicate page ids are deduped only by the lowest awareness client ID, including other tabs of the same user (the roster hides those, so both tabs used to rewrite the list).
- Durable Object blobs commit a generation pointer only after every chunk exists. A crash mid-write leaves the previous document readable.
- Restoring a keybind profile cannot rebind H (UI-hide is reserved). Pan copy no longer claims H.
- Flowchart nodes persist the 16px shape font, matching what the canvas already draws.

## 0.14.21 — unreleased

### Fix
- Deleting the page under your feet no longer leaves an empty canvas until reload: it is a real page switch now, the engine reloads the landing page at once.
- Peers stranded on a deleted page auto-follow to a live page with content instead of sitting on an empty one.
- Page delete no longer rewrites the whole order array: entries drop by index ranges, so the sync update stays O(deleted) and always fits the wire.

## 0.14.20 — unreleased

### UI
- H hides the interface again (session-only, resets on board switch / reload). No pill, no cooldown, no buttons — just a passive hint; H brings everything back. Pan is unbound from H (H is reserved for UI-hide).

### Deploy
- Root `wrangler.toml` now has `[build] command = "npm run build"` so `wrangler versions upload` / `wrangler deploy` actually produce `dist/` before upload.

### Sync backend
- Cloudflare rooms persist Yjs as chunked blobs (under the 2 MiB SQLite `put()` row limit) plus a hibernation-safe update tail, so photo boards no longer vanish after the isolate sleeps.
- Hibernation restore re-sends sync step 1 to live sockets; awareness client IDs live on websocket attachments and are removed on close (no ghost peers).
- Empty Worker rooms can be DELETE'd without a secret after detach (same outcome as the 90s GC), so compact on `workers.dev` actually wipes the Durable Object. Occupied rooms still need a token. Node LAN DELETE is still loopback-or-token.
- Node sync server: 32 MB websocket payload (matches `.review` export), room-name validation, max rooms, HEAD `/health`, richer health JSON, CORS Max-Age, SIGTERM drain, unique-local IPv6 in `/lan`.
- Clients republish awareness on sync and on a 20s heartbeat so a sleeping hub does not strand cursors.

## 0.14.19 — unreleased

### Perf
- Dragged photos and PDFs paint as cheap placeholders until drop (no per-frame multi-MP rescale), so moving them no longer stutters.

## 0.14.18 — unreleased

### Sync worker
- Throttled room persist (first write immediate, then ≤1/s): full-doc encode+put on every message stalled the room under drag floods.

## 0.14.17 — unreleased

### Rollback
- Reverted to the 0.14.13 code (H-hide UI, rejoin banner, and pill cooldown removed) after breakage in production.

## 0.14.13 — unreleased

### Presence
- Fixed ghost peers after tab hide/show: the socket now suspends on the live provider instead of destroying it (recreating reset awareness clocks on the same client ID, so the hub dropped every update as stale). Both sides reappear within ~1s.
- Cursor smoothing: dead-reckoning lead is capped (no hook past the final point on abrupt stops), zigzag corners kill slingshot velocity, and the cursor settles straight onto the target when samples stop.

## 0.14.12 — unreleased

### Sync cost
- Sync rooms hibernate now: idle-but-open boards bill ~zero Durable Objects duration instead of ticking every second. Hidden tabs drop their socket and reconnect on return; empty rooms are GC'd after 90s; resync every 60s.

## 0.14.11 — unreleased

### PDF
- Ink sticks to PDFs now: pen, sticky, and text drawn on a PDF page move with it when dragged, same as photos. Ink off the page stays put.

## 0.14.10 — unreleased

### Eraser
- Only ink erases now: photos, PDF docs, tables, graphs, frames, and all 8 flowchart nodes are immune in both eraser modes, while pen strokes drawn on top of them still wipe off.

## 0.14.9 — unreleased

### Toolbar
- Block-scheme fly-out no longer collapses while reaching for it (it sat 10px off the row, tripping mouseleave in the gap — now overlaps by 2px).

## 0.14.8 — unreleased

### Toolbar
- Fixed toolbar dying after shelf drag-and-drop: a cross-group drop unmounts the source button, losing its dragend and sticking the click guard — the guard is now shared, released on every drop, and backed by a window-level dragend.
- Switching to a drawing tool now clears the selection (select/pan/lasso keep it): no more stale style island with a hidden frame, and the new tool's own panel always appears.

## 0.14.7 — unreleased

### Board files
- Fixed .review export failing with a bare error on photo boards: file/update/base64 limits raised 8 → 32 MB (import accepts them back, so friend handoff keeps working).
- Oversized boards now report honestly ("too large") instead of a generic error.

## 0.14.6 — unreleased

### Export
- One bad shape no longer kills the whole export (per-shape isolation in PNG/JPEG and SVG paths, culprit logged to console).
- Export failures now log the real error to the console instead of failing silently.

## 0.14.5 — unreleased

### Eraser
- Size is now a slider in points (2–96, like the pen brush) instead of three fixed slots — small precise erasing for 1–3pt handwriting is possible.

## 0.14.4 — unreleased

### Tables
- Creating a table no longer opens the first cell for typing — it drops back to the select tool with nothing selected, so you stay free to move around the board.

## 0.14.3 — unreleased

### Eraser
- Tables and photos are never erasable (both eraser modes, including peers' previews).
- Dots erase: single-tap pen dots are hittable in whole mode, and pen hit-testing is now brush-radius aware (was: stroke-width precision, so dots needed pixel-perfect aim).

## 0.14.2 — unreleased

### Tables
- Fixed riders freezing mid-drag: carried objects are now re-patched on every move frame (was: only the first ~zero-delta move applied, so nothing visibly followed).
- Rider rule is now marks-vs-sheets: pen, arrow, sticky and text ride by center alone; rect, ellipse, image, frame, doc, graph and nested tables must also fit — huge backgrounds underneath stay put.
- Regression tests use incremental drag moves (a single jump masked the freeze).

## 0.14.1 — unreleased

### Tables
- Insert row/column now GROWS the table by the donor size (was: split the last cell in half); delete shrinks it back. Existing cells keep their size.
- Riders hardened: tray rule is now center-on-table + not-bigger (casually placed objects hanging off the edge ride along, huge backgrounds stay), rotated tables included. Verified exact in unit tests (mouse drag, nudge) and end-to-end in the browser.

## 0.14.0 — unreleased

### Tables
- `[−]` pills next to `[+]`: pop the last row / column (insert/delete at the active cell stays in the context menu).
- Resizable cells: drag interior grid lines (fractions persist, outer resize keeps proportions, insert splits / delete merges, Esc reverts mid-drag).
- Header tint removed (first row still reads through bold; toggle it off in the menu for a fully uniform grid).
- Cell editing no longer traps dragging: Enter commits and EXITS (Tab keeps fast entry to the next cell); double-clicking another cell of the same table commits the current one first (was silently lost).
- Objects placed on a table ride along when it moves (mouse drag and arrow nudge, nested tables cascade); riders stay individually movable.

## 0.13.0 — unreleased

### Tables
- New `table` tool (More shelf, parkable): drag to size (cols/rows derived from the box), click for a 3×4 default.
- Uniform grid with header row (bold + tint, toggleable), hairline grid, cell text wrap/clip, 14px default.
- Cell editing via the text overlay: double-click / Enter, spreadsheet nav (Enter = down, Tab = right), plain-text cells synced over Yjs.
- FigJam-style `[+]` pills on the selected table append row/column; context menu inserts/deletes at the active cell + toggles the header.
- Style island covers tables (fill, stroke, text, size); color keys paint fill+stroke; SVG export draws grid + cells; info dialog shows grid dims.
- Fixes: labels now contrast against the shape fill (was invisible light-on-white), canvas hides only the edited table cell while typing.

## 0.12.6 — unreleased

### Toolbar
- Customizable toolbar: any strip tool can be parked in the "More" shelf and dragged back out; shelf rows reorder by drag. Order persists in prefs (`toolbarOrder.more`).
- Drag onto the closed shelf button spring-opens the popover; dropping on a group appends.
- Block-scheme shapes stay in the nested fly-out submenu (not individually movable).
- New pure-logic module `core/toolbarOrder.ts` + `toolbar-order-test` in the suite.

## 0.12.5 — unreleased

### Sync / presence
- Away peers (alt-tab, home, minimized) no longer leave a frozen cursor: `Engine` skips `viewing=false` peers when painting cursors. They stay in the members roster while the tab is open.
- Regression test: `engine-test` asserts only viewing peers paint (`Viewer`+legacy shown, `Away` hidden).

## 0.12.4 — unreleased

### Toolbar
- More shelf: "Block-scheme" row spans full popover width like "Graph" (root cause was `align-items:center` inherited from `.island` shrink-wrapping the `.more-sub` wrapper).

## 0.12.3 — unreleased

### Toolbar
- More-shelf rows use an explicit grid layout so labels always align left.

## 0.12.2 — unreleased

### Toolbar
- Graph moved into the new "More" shelf (sparkles button); block-schemes live in a nested fly-out submenu. No more strip duplicates.
- More popover is a labeled list with a side submenu, detached from the strip.
- Delete / copy / duplicate appear only when something is selected.
- Strip order (navigate + create groups) is draggable and persisted.

### Home
- "Recent" pseudo-team tab above Teams: own + guest boards in visit order, same board list UI.
- Storage notice banner + desktop app teaser placeholder.

### Stickies
- Typed text no longer lost when switching editors (dblclick another sticky commits first).
- Commit persists the edited fontSize; classic yellow sticky is borderless (custom borders still drawn).

### Engine
- Multi-select resizes via the group bbox only — invisible per-member handles no longer hijack drags.

## 0.12.1 — unreleased

### Board titles
- Switching boards no longer leaks the previous board's synced title onto the newly opened board (title effects ran before `initBoard`; reconcile/mirror now apply only to the current board).
- "Save as my board" copies no longer inherit the source title/owner — the copy keeps its "(copy)" name.

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
