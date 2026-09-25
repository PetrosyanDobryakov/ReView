# Changelog

## Unreleased

## 0.15.54

### Ops
- **Workers Builds rustup:** `scripts/build-sync-worker.sh` installs rustup (stable, minimal) and the `wasm32-unknown-unknown` target when `rustup` is missing, then runs `worker-build` 0.8.6. Workers Builds images have `curl` and `build-essential` but not Rust, so production deploys of `60b9eb5` (`bash scripts/deploy.sh all`) died with `build-sync-worker: rustup is required` after the SPA build succeeded. No dashboard install command is required for Rust. Non-production deploy on tip was still `echo done` (set that field to `bash scripts/deploy.sh all` or tip builds never run the script).

## 0.15.53

### Performance
- **Orbit sky:** the pointer light, vignette and dither composite over a cached star field, so moving the cursor no longer reruns the nebula and star shaders. The field itself stays on the existing idle clock (about 10fps for drift and scintillation) and the shader loop pauses while it is hidden or covered. The picture matches the previous full pass (verified pixel-for-pixel, including the work light).

## 0.15.52

### Orbit rework
- **Own space shader** replaces the stock Warp swirl (`@paper-design/shaders-react` removed): four parallax star layers that pan and zoom with the board, realistic stars (pin-sharp, heavy-tailed magnitudes, black-body tints, trace scintillation), a faint galactic band with dust lanes and a dim pointer light. Repaints only on camera / pointer change, ~10fps idle; pauses when hidden, covered by solid paper, or under reduced motion.
- **Mission-control chrome**: neutral graphite glass, hairlines, the same fonts and letter case as the other themes, one Dragon-blue focus color and flight-status colors; spinning conic glows, purple gradients and text glows are gone. Selected items get a soft fill (no underline); the selected tool keeps the default round thumb as a softly lit disc with a hairline ring. "AI Slop" tag in the theme's own colors. Board selection is neutral steel gray.
- **Home <-> board warp jump**: the old view flies past the camera (scale up, blur, fade), the new one arrives out of the depth, while the live sky stays in place and its stars stretch into radial warp streaks (nearer layers streak longer) and the clouds surge forward and settle. Every jump arrives at a random new patch of sky (new star field, new clouds, band always somewhere in view); the swap happens at the warp peak while the clouds dip dark, so it never pops. Under reduced motion the animation is skipped and the sky re-rolls instantly.
- **Board palette**: white / steel / Dragon blue / Merlin orange / abort red pen slots, graphite shapes, dark stickies with an orange band, dot-lattice grid.
- **Board effects (Orbit paper)**: the pen throws off minimal solid star particles (small fully opaque white dots that pop in and shrink away), also used by object sparks and the rocket's payload bloom; the eraser is a reticle that turns red over targets; objects marked for delete get red brackets + hatch, and deleted / erased objects burn up into embers; new objects glint at the corners; a new selection gets steel-gray corner brackets that converge, blink once and show its size; lasso and rubber-band selection get clean steel-gray hairlines with a faint fill, corner ticks / start marker and a live size readout.
- **Rotate-knob easter egg on Orbit**: the triple-press fires a rocket launch instead of paper confetti (ground cloud, ascent plume, booster separation and fall-back, upper stage deploys a payload bloom; ~4.5s from ignition to fade-out); streaks launch salvos, peers replay the same launch. The 5th rapid triple-press in a streak brings up the finale: a full Starship launch from a pad above the toolbar, played in world space so zooming out mid-flight shows the whole scene with nothing cut. Pre-rendered hardware: a stainless Super Heavy with cryo frost, weld seams, chines, three grid fins, a vented hot-staging ring and engine bells; a Ship clad in black hexagonal heat-shield tiles (foreshortened around the barrel and up the nose) with a sliver of bare steel, forward and aft flaps; a lattice tower with chopsticks and a blinking aviation light; the launch mount. Ignition flickers up, the plume is cut where it meets the ground and throws a deluge steam cloud lit orange from within; liftoff, a pitch-over that carries the stack sideways, hot staging (flash + vent jets), the booster flips and burns back while the Ship pulls away on bluish vacuum engines. The plume balloons and its shock diamonds fade with altitude. The whole flight runs ~17s from ignition to the last of the steam. The stack is ~42% of the view height (a third of the old size) and peers fly the same profile.
- **Orbit graphs and calculators**: graphs become telemetry plots (graphite card with bright corner brackets, status light beside the formula, recessed plot well, dotted lattice instead of grid lines, a glowing trace with a soft fill to the axis and a marker at its leading end); calculators become flight computers (graphite body, recessed display with a status light that turns red on errors, graphite digit keys, lighter operators, outline-only function keys, a white execute key).
- Toolbar: the select arrow and the eraser sit optically centered in the selected-tool circle.
- **Confetti frenzy (other themes)**: the 5th rapid triple-press turns the cannon into a continuous eruption (~420 bits/s, wobbling wide fan) for 3.2s; every further spam extends it (up to ~10s), and it sputters out instead of cutting off. Live confetti cap raised to 1400.
- Settings: Orbit theme and paper cards show a patch of sky over Earth's limb.
- **Sky no longer jumps**: the cloud drift runs on the wall clock, so a remount / reload of the backdrop no longer throws the clouds hundreds of px (the drift timer used to restart). Stars and clouds follow the camera in screen px with their own parallax depth (clouds slide 10% of the pan, like the far stars), so zooming toward the cursor at low zoom no longer jumps, and all offsets persist across remounts (sessionStorage).
- Home <-> board transition: an aborted View Transition no longer surfaces as an unhandled promise error.
- **Sky no longer stutters on zoom**: the soft sky (band, dust, haze) renders into a quarter-size buffer and is upscaled; only the stars draw at full resolution, so zoom stays at full frame rate instead of dropping to a few frames.
- **Dot grid no longer snaps on zoom**: each x5 dot tier fades in and grows into major dots from its own on-screen spacing instead of jumping between three density steps.
- PNG export on Orbit paper fills with the rendered void color.

## 0.15.51

### Fix
- **Tray hosts select before they move**: a press on an unselected table / photo / video / PDF / frame now selects it and starts marquee (riders on top stay rubber-band selectable); dragging the host needs it pre-selected. Tap keeps the fresh selection; shift flow unchanged.

## 0.15.50

### Fix
- **Table riders keep size on whole-table resize**: handle-resize of a table now only translates glued notes, ink and photos (`keepSize` in `mapShapeThroughHostResize`, enabled for table hosts) instead of squeezing them. Same rigid behavior the 0.15.44 fix gave divider drags.

## 0.15.49

### Fix
- **Table outer-border resize**: dragging a selected table's border anywhere (not just the center dots) resizes the edge row/column — the box grows/shrinks and the edge cells absorb the delta while other cells keep absolute size (28px edge-cell floor, riders stay glued, rotation-safe). Center dots keep whole-table resize (handles hit-test first); `ew`/`ns-resize` cursors on hover.

## 0.15.48

### Fix
- **Smooth peer cursors default ON**: `smoothPeerCursors` now defaults to `true` (`src/core/prefs.ts`, `src/engine/Engine.ts`), so remote cursors use spring follow for fresh profiles. Stored explicit `false` is still respected; toggle remains in Settings.

## 0.15.47

### Docs
- **Agent onboarding alignment**: tip-only / no-PR rule and never-touch `dev-petrosyan` in `AGENTS.md`; clarify doc-only ships (bump+push, deploy optional); fix P2P vs `review-sync` on `*.workers.dev`; Node 5m vs DO 90s room GC; observability sampling note; refresh Workers Builds status; drop ephemeral Builds probe stubs from `docs/DEPLOY.md`; README.ru/zh and `PRODUCT.md` room/IndexedDB keys `review-<id>` / `review-v1-<id>`.

### Ops
- **Workers Builds Deploy:** dashboard Deploy command for Worker **review** must be `bash scripts/deploy.sh all` (not `echo done`). Name-mismatch banner suggesting root `name = 'review-sync'` is a **wrong-Worker / wrong Root directory** signal — do not rename the SPA Worker; see `docs/DEPLOY.md`.

### Fix
- **CI sync-test**: `scripts/sync-test.mjs` boots an ephemeral sync server when `REVIEW_SYNC_URL` / `:1234` is not healthy, so `npm test` is green on GitHub Actions without a pre-started daemon (still reuses a live server when present).

## 0.15.46

### Fix
- **review-sync disconnect noise**: Durable Object `webSocketClose` / `webSocketError` reciprocate Close frames (compat `web_socket_auto_reply_to_close`) and never `console.error` / throw on normal peer loss, so tab close and network drop stop looking like app failures in our logs. Cloudflare Metrics still classifies some long-lived WS ends as `responseStreamDisconnected` / `canceled` — filter those out when hunting real exceptions (see Project doc `do-client-disconnect-errors.md`).

## 0.15.45

### Feature
- **GIF and video on the board**: paste / drop / file insert keep animated GIF bytes (no canvas freeze-to-PNG); new `video` shapes for mp4/webm/mov (8 MB cap, same data-URL persistence as photos). Double-click or context menu toggles play/pause; GIF and playing video keep the paint loop alive. Videos magnetize notes like photos and join align/snap media targets.

## 0.15.44

### Fix
- **Table cell resize**: dragging a column/row divider no longer stretches glued pen strokes (or other point geometry); ink and photos keep size and only translate with the cell center — same non-distort intent as box riders.

## 0.15.43

### Fix
- **Align / snap targets**: guide and single-select align references are limited to media containers (`image`, `doc`, `table`, `frame`); freehand pen ink and ordinary shapes are no longer snap/align anchors. Multi-select align-within-selection is unchanged.

## 0.15.42

### Fix
- **Photo magnet z-order**: notes / stickies / pens magnetize to a photo or PDF only when they sit above it in board stacking order; shapes under the photo no longer ride moves/rotates/resizes.

## 0.15.41

### Perf
- **Multiplayer awareness rate floor**: hot cursor/draft/erase flushes stay rAF-coalesced but are capped at ~20 Hz (50 ms min interval) so drawing storms no longer wake `review-sync` Durable Objects at display refresh. `flushNow()` still bypasses for clears/teardown; solo `review-ka` auto-response path unchanged.
- **review-sync ws kind tags**: sampled (`~1/64`) `[review-sync] ws kind=awareness|sync|ka-fallback` logs in Observability for burst triage.

## 0.15.40

### Fix
- **Calculator header optical center**: three-bar nav + mode title share one ink optical centerline (`iconAlignY` + `calcTitleBaselineY` / CSS twin) so burger and “Standard” are pixel-aligned; focused / unfocused / open overlay stay 1:1 via `layout.chrome`.

## 0.15.39

### Fix
- **Calculator header align**: shared `layout.chrome` metrics so canvas (unfocused) and open overlay (focused) paint nav + mode title 1:1 — fixed nav cell, gap, type sizes; drawn three-bar hamburger (no ≡ em-box drift); selection chrome no longer fights a divergent header layout.

## 0.15.38

### Fix
- **Idle DO storage ops**: cut storage work on clean close/resync (see prior tip landing).

### Ops
- **GitHub primary tip**: day-to-day work on `PetrosyanDobryakov/ReView` `dev-warexpor`; Cursor Origin demoted. Remotes: `origin` → GitHub.
- **Tip → `main` sync**: `bash scripts/sync-github.sh` (or `npm run sync:github`) pushes tip to `dev-warexpor` and `main`.
- **Persistent Wrangler deploy:** `scripts/deploy.sh` (+ `npm run cf:deploy:all`) deploys `review-sync` then `review` from tip.
- **Cloud Agent snapshot**: tip env uses validated 2026-09-18 snapshot.
- **`sync-github.sh`**: resolves GitHub via `github` remote or `origin` when it already points at `PetrosyanDobryakov/ReView` (no extra remote required on GitHub-primary checkouts).
- **Wrangler `account_id`**: set in root + `worker/wrangler.toml` so non-interactive deploy picks Zpro without an interactive account prompt.

## 0.15.37

### Polish
- **Calculator Windows redesign**: Win-calc chrome — ≡ nav + mode title (same scale as keypad), generous display, modes/DEG/Copy/Sticky/Text in the nav flyout. Drops the tiny ··· overflow toolbar from 0.15.36.

## 0.15.36

### Polish
- **Calculator header declutter**: single-row chrome — mode segment (Standard/Scientific + DEG) on the left, Copy/Sticky/Text behind a quiet ··· overflow so secondary actions no longer crowd under Scientific.

## 0.15.35

### Perf (invisible)
- **Many visible shapes**: cache `wrapText` measure/wrap results; skip Orbit pen bloom when glow is sub-pixel; LOD calculator keypad (solid pad when keys < ~7 CSS px); AABB-refine grid culling + skip sub-pixel blobs; paint only sorted visible shapes (no full-order scan); hit-test ranks spatial candidates by order index; pen hit AABB reject; no per-frame `{...v}` clone for rotated shapes.

## 0.15.34

### Fix
- **DO billable-duration spike (solo awareness wakes)**: y-protocols still renewed local awareness every ~15s over WS even on solo boards; each renew was a hibernation wake (cheap after 0.15.29/30, but volume × wall time blew the billable chart). Solo tabs now skip awareness WS fan-out and use a text keepalive answered by Durable Object `setWebSocketAutoResponse` (no isolate wake). Peer renews move to ~25s. Worker still echoes awareness for multi-peer / older clients.

## 0.15.33

### Fix
- **Lasso (OSO) leftover select ring**: clear marquee/hover/focus/tactile chrome when lasso finishes and auto-swaps back to select so the pointer tool does not keep a stale "selecting" halo.
- **Phone tap highlight**: disable default blue `-webkit-tap-highlight` and add coarse-pointer press feedback (scale + active ring) that matches island chrome; neutralize sticky hover rings on touch.
- **Calculator theme-only colors**: calc body/bezel/ink follow `--chrome-panel` / theme tokens only — no longer inherit StyleBar or selected-shape stroke/fill (e.g. red table).
- **Calculator phone chrome**: two-row toolbar (modes / actions), no wrap overflow, taller header slot so open-session controls stop colliding with the display.

## 0.15.32

### Fix
- **Arrow canvas lag**: cache tessellated shaft/head/bounds per arrow id (invalidate on geometry fingerprint), drop per-arrow `shadowBlur` paint, and adaptive sample counts so hover/snap/pan stay smooth as arrow count grows. Hit-test still follows the painted curve.

## 0.15.31

### Fix
- **Context menu overflow**: cap height to the remaining viewport (safe-area aware) and allow touch/mouse scroll so Align (and long menus) no longer clip off-screen.

## 0.15.30

### Fix
- **Solo DO reconnect storm**: echo awareness frames back to the sending socket (matches y-websocket reference server). Without the echo, solo tabs receive no inbound traffic and force-reconnect every 30s → accept/sync reloads the full board blob (~5s wall) even after the 0.15.29 awareness-skip path.

## 0.15.29

### Fix
- **DO wake wall time**: hibernation no longer reloads the full board blob on awareness-only messages (or when the in-memory doc is already warm). Accept + real sync still `loadOrCreate` and sync-step1 the waking socket.

## 0.15.28

### Fix
- **DO traffic / free-tier duration bleed**: stop hibernation-wake sync-step1 fan-out (each awareness tick was reloading the full board blob then forcing N client sync replies). Solo boards skip the 45s awareness heartbeat; reconnect backoff caps at 60s; client resync every 120s. Worker observability head-sample 10%.

## 0.15.27

### Polish
- **Align submenu close feel**: 320ms ease-in-out roll + reverse-stagger opacity (verifier caught ~60ms snap with `--chrome-ease`).

## 0.15.26

### Polish
- **Align submenu close**: keep children mounted and roll `0fr↔1fr` so close matches the open animation (was unmounting and snapping shut).

## 0.15.25

### Feature
- **Confetti spam frenzy**: repeated rotate triple-press within ~1.6s escalates power (more bits, wider cone, multi-cannon) and stacks; peers get the same `power` via awareness. Cap ~900 live particles.

## 0.15.24

### Feature
- **Confetti lasts longer (~10s)** so bits can fall through the floor / off the bottom of the view.
- **Peer-visible confetti**: awareness broadcasts burst origin+seed so other users see your triple-press cannon (was local-only).

## 0.15.23

### Polish
- **Selection context menu**: group with separators; Align moves into a submenu (incl. distribute). Long-press on coarse pointers already opened the menu — move-slop hardened so holds cancel less often.

## 0.15.22

### Polish
- **Rotate handle icon at low zoom**: stroke stays Lucide viewBox-stable (no s² fattening) so the knob stays a clean rotate-cw, not a blob.

## 0.15.21

### Polish
- **Confetti cannon feel**: faster launch speed, lighter gravity + drag so bits pop up quick then drift down slowly (lifetime unchanged).

## 0.15.20

### Phone layout
- **Top chrome vertical tighten (≤720)**: file/meta islands ~42–46px (was ~60); icons 36, brand/title 32, zoom chip 32; style island pad-block 6. Board title floor kept. Toolbelt stays 44.

## 0.15.19

### Polish
- **Confetti cannon physics**: always shoots upward; lighter gravity; longer particle lifetime (~3s).

## 0.15.18

### Feature
- **Rotate triple-press confetti cannon**: replaces glow-bubble fireworks with noticeable paper confetti bursting from the live rotate knob.
- **Knob origin fix**: spawn uses `rotateHandleWorldPos` (same geometry as paint/hit-test, including rotate-handle-on-top + shape rotation) instead of a hardcoded bottom-left AABB corner.

## 0.15.17

### Polish
- **More shelf row hover**: keep the row hit box fixed — slide/scale live on icon + label only. Stops the intermittent highlight flash on the previous tool when moving across Calculator / Table / Graph rows (translateX on the button itself re-entered `:hover` on leave).

## 0.15.16

### Sync (invisible)
- **Awareness heartbeat is one WebSocket frame**: the 20s `republishAwareness` path now builds one snapshot (`user` / `tool` / `page` / `viewing` / hot fields) and calls `setLocalState` once instead of up to five `setLocalStateField` publishes. Idle overnight floor ~5× quieter; cursor/draft rAF rates and heartbeat interval unchanged.

## 0.15.15

### Phone layout
- **Board file-island title floor**: ≤720 / tablet brand keeps `min-width: 5.5em` so `overflow: hidden` cannot crush the title to a sliver between Home and Pages; Home product name stays `flex: 0`.
- **Home notice stack**: ≤720 wraps desktop CTA under the cache notice (full-width text, no one-word column / promo overlap); version truncates; seps tighten.
- **Board rows denser**: ≤520 container — tighter pad/gap, `align-items: start`, narrower idx, auto actions; ≤400 hides date + header; Home main “New board” + list padding compact on ≤720.
- **Host-offline CTA-only** on ≤720 (long copy stays for `title` where set).

## 0.15.14

### Perf (invisible)
- **Stop idle Orbit paper ambient dirty**: the rAF loop no longer forces a full-board paint every ~80ms while Orbit paper is live. Pin field is already off (`if (false)`) and the screen vignette is static — idle boards no longer repaint ~12.5fps for nothing.
- **Static peer drafts / erase previews** no longer keep `peersAnimating` hot; tip/geometry changes still dirty via `setPeers` (`peerDraftPaintDirty` / erase equality).
- **Realtime peer hold** tightened to `REALTIME_LEAD_SEC + 1/60` (smooth spring path keeps 0.14s) so snapped realtime glyphs do not force extra full-board paints.
- **Pause Warp when covered**: on a board with solid/non-Orbit paper the opaque canvas fill covers Warp — shader speed goes to 0. Home and Orbit paper keep the live atmosphere. No backdrop-filter / quality / DPR changes.

## 0.15.13

### Polish
- **Calculator key glyphs**: larger shared-face `key` / `keyFn` sizes (Standard + Scientific) so symbols fill spacious wells better.
- **Phone scroll edge fades**: toolbelt + style island `mask-image` stops + inline padding so the slide-thumb selection ring is not eaten at the edges.
- **More on phone**: portal the More shelf (like Pages/Members) so ≤720 `toolbelt-scroll` overflow/mask no longer clips the popover — tap opens Calculator / Table / etc.

## 0.15.12

### Space → temp pan
- **First Space after tool pick** arms temporary pan even when focus is still on the toolbar button (was early-returning on `button` / `role=switch`).
- **Tool swap while Space held** keeps temp pan armed until keyup.

## 0.15.11

### Phone / tablet visual hierarchy
- **Zoom overflow chip**: ≤720 / tablet collision / ≤1024 coarse show a `%` chip that opens an island zoom menu (in/out/reset/fit) instead of scroll-only or pinch-only.
- **Host-offline CTA-only** on ≤720 (long copy stays in `title`); Meta 13px.
- **Scroll edge fades**: toolbelt + style `mask-image` at ≤720.
- **Tablet band 721–1024**: island pad 7px; brand ellipsis 36vw; JS collision collapse → same overflow chip (hysteresis).
- **Coarse ctx / zoom menu rows**: min-height 44px; ui-hidden hint respects safe-area.

## 0.15.10

### Phone / tablet support
- **Touch context menu**: long-press (~500ms, small move) opens the board context menu (desktop still uses right-click).
- **Touch edit**: double-tap opens sticky/text/graph/calc/table/crop the same way as desktop double-click.
- **Finger hit targets**: coarse/no-hover pointers use larger resize (24px), rotate (28px), and port (24px) screen hit radii; drawn knobs slightly larger; select/draw tap thresholds raised to ~10px.
- **Narrow chrome (functional)**: ≤720 hides the zoom cluster; file island scrolls horizontally; safe-area insets on file/toolbelt/style; `viewport-fit=cover` + `100dvh` shell; export modal uses `dvh`.
- **Visual chrome**: coarse density (44 tool / 40 style / 28 swatch, island pad 8×10, tool gap 6, glyph 24); style clearance `tool+28+max(16,safe)`; ≤1024 coarse hides zoom + file reserve 140px (wide coarse keeps zoom); ≤720 brand 15px/ellipsis, sep 6px, compact host-offline. Deferred to 0.15.11: zoom ⋯ overflow menu, edge-fade masks.
- **Overlays**: GraphEditor and TextOverlay clamp into `visualViewport` (soft keyboard / URL bar).
- **Polish**: outside-dismiss uses `pointerdown`; invite prefers Web Share then clipboard; tool reorder disabled on coarse pointers; Settings Gestures documents pinch / long-press / double-tap.

## 0.15.9

### Stylus / graphical tablet
- **Palm reject while inking**: ignore touch contacts while a pen pointer is active so a palm does not cancel the stroke into pinch-pan.
- **Eraser tip**: stylus button 5 temporarily overrides to eraser without `setTool` abort; restores prior tool on up/cancel.
- **Coalesced pen samples**: pen `pointermove` folds `getCoalescedEvents()` into the polyline/pressure path for smoother high-rate ink.

## 0.15.8

### UI polish
- **Export dialog**: vertical option groups (source / scale / format) with chip rows so labels and chips no longer wrap unevenly; source chips stacked full-width for long RU labels; preview + Download unchanged.
- **Home storage notice**: restyled to ReView chrome panel/border/warn tokens; desktop CTA uses accent underline (no warm alert chrome or glowing blue).
- **Home sidebar**: modest spacing/grouping tighten only (no IA change).
- **StyleBar**: hide Fill/Stroke (and outline width) for calculator tool and calculator-only selections — calc keeps its own face theme.
- **More shelf**: subtle hover slide + icon scale on Calculator / Table / Graph rows (and other more-rows); respects reduced motion.

## 0.15.7

### Multiplayer
- **Peer-visible selection**: Select-tool shape ids publish via awareness (`selection: string[]`); remotes draw a soft peer-colored outline/ring (no handles). Clears on empty selection, tool switch, board leave, and disconnect. Same batching path as cursor/draft/erase — not written to the Yjs doc. Calc keypad `focus` ring kept; duplicate ring skipped when both apply to the same calculator.

## 0.15.6

### Selection / calculator polish
- **Rotate handle default off**: Customize → Rotate handle on top now defaults to **off** (legacy bottom-left corner). One-shot migrate clears the 0.15.2–0.15.5 default-on for existing installs.
- **No ghost “Standard”**: while the keypad overlay is open, canvas skips header mode chrome the overlay owns (mode row / M) so tabs are not double-painted.
- **Bigger key glyphs**: modest bump to shared face key/fn label sizes so symbols fill spacious wells better (Standard + Scientific; canvas paint).

## 0.15.5

### Selection chrome
- **Rotate icon a bit bigger**: same Lucide-style `rotate-cw` SVG; modest size bump for top-middle and corner placements (`ROTATE_CW_ICON_RADIUS_SCALE` / disc scale in `rotateIcon.ts`).

## 0.15.4

### Selection / calculator / canvas quality
- **Rotate icon from scratch**: abandoned legacy swirl / hand-arc glyph. New Lucide-style `rotate-cw` SVG (`src/core/rotateIcon.ts`) for both top-middle and legacy corner placements.
- **Calculator theme defaults**: creation uses StyleBar fill/stroke like other shapes; untouched body paints `--chrome-panel` + chrome/theme ink (no cream/`#2a2a27` special palette). Explicit StyleBar fills keep their color. Canvas dirty on chrome theme change.
- **Zoom-out crunch fixed**: restore `devicePixelRatio` backing store (was forced `dpr = 1` for “perf”) so far-zoom strokes are not artificially undersampled.

## 0.15.3

### Board calculator — one paint path
- **Canvas is the only face**: shared `buildCalcFaceLayout` drives labeled keypad for peers, export, unfocused, and open session. Open overlay is a transparent hit layer (mode/stamp chrome + key targets) — no separate low-res silhouette vs high-res panel.
- **Labels track frame, not zoom floor**: removed `CALC_CSS_ZOOM_FLOOR` / screen-px label floors. Key/display type scales with object geometry like other board content; far zoom shrinks with the board.
- **Rotate icon redesign**: same curved rotate-cw arrow for top-middle and legacy corner placements (no swirl “C” blob). Customize toggle for placement kept.

## 0.15.2

### Board calculator + selection chrome
- **Closed/unfocused silhouette** paints full labeled keys (shared keypad layout with the overlay) — no hollow gray wells.
- **Label zoom floor**: overlay `--calc-zoom` and canvas key/display type share one readability floor so open/closed stop shrinking together when zoomed far out.
- **Customize → Rotate handle on top** (default on): top-middle rotate control with a normal rotate arrow; off keeps legacy bottom-left swirl.

## 0.15.1

### Board calculator fixes
- **Resize/scale** works while the keypad is open (selection chrome + handle hit-through; min size 240×360).
- Esc **closes** the keypad session (CE stays on-pad); stamp closes calc before sticky/text edit so undo/tool paths stay clean.
- Overlay chrome scales with **frame size × zoom** and follows rotation; matches silhouette better.
- Overlay ink adapts to StyleBar fill (no light-on-light); silhouette row counts match pad; scientific includes memory keys.

## 0.15.0

### Release
- Version bump to **0.15.0** (minor after board calculator and 0.14.x sync/cursor work).

## 0.14.41

### Board calculator
- First-class **calculator** board object (More shelf): Standard + Scientific modes with Windows-parity engine (precedence, memory, CE/C/⌫, error states, deg/rad, 2nd functions).
- On-object keypad overlay (shape-aligned, StyleBar fill/stroke) — not a floating OS dialog. Canvas silhouette for peers/export.
- Board actions: stamp result as sticky, stamp expression as text, copy display. Live Yjs sync of calc state; peer focus ring while in use.

## 0.14.40

### Sync smoothness
- **User-rejected 0.14.39** (`PEER_MOTION_STALE_SEC = 0.2` zero-velocity reset): mid-move stalls looked like new jaggers and the idle→move slingshot remained incomplete.
- Idle → first move: after `PEER_MOTION_RESUME_GAP_SEC` (1s), hard-snap display pose to the wire sample and clear dead-reckon/spring velocity — no coast across the gap.
- `sampleDeltaSec` no longer ceilings at 0.12s (floor-only for bursts), so brief stalls do not invent `(delta / 0.12)` speeds.
- Continuous realtime motion keeps velocity under the resume gap; smooth toggle still optional (default realtime).

## 0.14.39 (user-rejected)

### Sync smoothness
- Idle → first-move observer snap: after a long awareness gap (`PEER_MOTION_STALE_SEC`), `pushPeerSample` resets velocity instead of inventing speed via `sampleDeltaSec`'s 0.12s ceiling. Realtime dead-reckon no longer slingshots on cold start after a stale peer, then snaps back on the next packet. Smooth toggle unchanged. **Live: worse — new mid-move jaggers + old snap; superseded by 0.14.40.**

## 0.14.38

### Sync smoothness
- Cut random remote-cursor hitches from **React setState storms**: `onSyncStatus` no longer re-emits on every awareness/cursor packet (status-field dedupe only); PageBar gates `setPeerPages` on page-id fingerprint.
- Skip `emitPeers` for local-only awareness changes; P2P listens to `change` only (no double `update`+`change`).
- Off-screen mirror pills no longer force continuous full-board paints; realtime dead-reckon bridge `0.04` → **`0.08`** s (still no spring trail).
- Sync DO postpones full-doc encode while awareness traffic is recent (`AWARENESS_QUIET_BEFORE_FULL_MS`), so O(board) persist CPU is less likely to stall cursor relay.
- netDebug: awareness receive-gap histogram + longtask + slow peer-paint warns (`?netDebug=1`).

## 0.14.37

### Sync smoothness
- Realtime peer cursors (default) bridge brief awareness/WS gaps with short dead-reckon + frame-hold — no spring trail, smooth toggle unchanged. Stops freeze-then-jump micro-stutters when packets arrive irregularly.
- `setPeers` no longer snap-backs display pose on unrelated awareness emits (that was killing between-packet extrapolation).
- Live draft tip changes at a fixed vertex count dirty the canvas again; erase-preview compare drops `JSON.stringify` on the hot path.

## 0.14.36

### Sync smoothness
- Peer cursors default to **realtime**: display pose snaps to the latest awareness sample (no spring trail). Optional **Smooth peer cursors** toggle in Settings → Customize restores the previous spring/lerp follow. Preference persists with other customise settings. Send path unchanged (batching / quant).

## 0.14.35

### Deploy / version visibility
- Home always shows `v{version}+{sha}` (no more version-less “dev build” label). Production HTML gets `<meta name="review-build">` for curl checks (`scripts/check-live-version.mjs`).
- Docs: Workers Builds **Deploy command must be `npx wrangler deploy`**. Preview was stuck on **0.14.25** while tips through 0.14.34 only ran `echo done` after `npm run build` — Builds succeeded, assets never uploaded. That is why “0.14.34 unchanged” was observed on the live preview.

### Sync smoothness (wire)
- Cursor awareness quantization `0.5` → **`0.05`** world units so zoomed remotes do not stair-step (periodic micromovements that are not lag). Live **0.14.25** also still double-steps the peer spring (glyph+pill); that fix is already in tip since 0.14.29 and will land once deploy actually uploads.

## 0.14.34

### Sync smoothness
- Remote cursors no longer micro-jerk at awareness packet rate. Dead-reckon aim used to jump ahead on each sample then *retract* toward the last point (`leadSec - age×0.5`) until the next packet — periodic micromovements that looked like stutter, not lag. Aim now advances with sample age only, soft spring (`smoothTime` 0.1) absorbs corrections, and samples never snap the rendered pose.

## 0.14.33

### Net debug visibility
- Boot prints a hard-to-miss Console line: **`[review:net] review net debug ON`** (warn-level so Chrome Default filters show it). Heartbeat every 5s with live WS readyState. `window.reviewNetDebug(true|false)`.
- Flag detection reads `?netDebug=1` / `?netLog=1` from **search and hash** (SPA/workers.dev safe) and persists to `localStorage` (`review-net-log` + `REVIEW_NET_DEBUG`).
- Connect path logs `opening websocket` / `websocket open` / errors. Traffic still summarized as `ws traffic 1s` while drawing.
- SPA `_headers`: HTML routes `Cache-Control: no-cache` so a stale index.html cannot hide the new logger.

## 0.14.32

### Sync smoothness
- Live draft downsampling is tip-stable: over-budget strokes keep a fixed live tip and only re-sample the older prefix. Re-picking indices across the *whole* polyline on every append made midpoints jump every frame — remote ink (and the shared paint/WS load) looked jagged even after rAF awareness batching.

### Net debug
- `[review:net]` console logs include **WS traffic 1s** summaries (in/out bytes, sync vs awareness frame counts, max frame). Enable: `?netLog=1`, `?netDebug=1`, `localStorage.REVIEW_NET_DEBUG=1`, or Settings → Net debug log. Default off.

## 0.14.31

### Sync smoothness
- Live freehand + cursors no longer emit two awareness WebSocket frames per tick: cursor, draft, and erase coalesce into one `setLocalState` per animation frame (`AwarenessBatch`). While drawing, the dual cursor+draft flood was jamming the Durable Object and arriving as jagged bursts on peers.
- Draft polyline budget raised to 96 vertices; heavy gesture doc flushes ~60 Hz (16 ms) for mid-gesture point rewrites.

## 0.14.30

### Sync smoothness
- Remote cursors keep the paint loop alive between awareness samples (`peerMotionShouldAnimate`): the spring used to settle in 1–2 frames, clear `peersAnimating`, and freeze the glyph until the next packet — packet-rate stutter even when the socket was fine. Drawings were unaffected (doc updates paint immediately).
- Cursor send rate ~50 Hz (20 ms), softer smooth-damp, clamped sample dt (burst arrivals no longer explode aim velocity), and settle only after the hold window.

## 0.14.29

### Sync smoothness
- Remote cursors no longer double-step the spring each frame (glyph + edge pill both advanced the same pose) — that 2× catch-up looked like stutter even when packets arrived on time.
- Sync room full-doc encode is no longer armed from awareness (cursor/draft) frames, and waits for a short sync idle before running. Mid-flood `Y.encodeStateAsUpdate` on a photo board was freezing the Durable Object and bursting every queued cursor/stroke.

## 0.14.28

### Fix
- Concurrent peer page deletes that empty the Y `pages` array now restore `main` via `ensurePages` inside `healActivePageToList`, so the engine is not stuck filtering on a deleted active id (blank canvas).
- `.review` import strips foreign `ownerId` / synced title the same way clone does, so the importer can rename a local board in the header.
- Draft stroke and erase-preview awareness use a trailing flush (like cursors), so peers see the last vertices / hover instead of a truncated preview.

## 0.14.27

### Fix
- Worker wipe rejects websocket Upgrade with 503 while `wipeInFlight`, runs deleteAll/resetRoom under `blockConcurrencyWhile`, and keeps a separate post-wipe persist latch until the next accept — an Upgrade can no longer clear the latch mid-wipe and land on a reset doc.
- `compactBoard` calls `closeWriteGate()` before snapshotting so pending heavy gesture fields (points/pressures/src) land in the live doc instead of flushing into the discarded one.

## 0.14.26

### Fix
- Worker room DELETE / empty-room GC cancels the debounced tail timer, drains the persist gate, and latches a wipe flag so late `waitUntil` flushes and `webSocketClose` handlers cannot rewrite doc/tail blobs after `deleteAll` (compact/GC no longer resurrects a cleared room).

## 0.14.25

### Sync smoothness
- Dragged photos and PDFs paint full again — the placeholder that hid them mid-drag is gone.
- Peers see moves at pointer rate again: light fields (x/y/…) flush immediately even while heavy fields (points/…) coalesce — dragging no longer arrives as 30 Hz teleports.
- Sync room no longer runs storage round-trips inside the message handler: relay stays synchronous, the tail persist trails ~150 ms behind via waitUntil (plus flush-on-close/alarm). Floods stop queueing behind blob writes, so strokes and moves stop arriving in bursts.

## 0.14.24

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

## 0.14.23

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

## 0.14.22

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

## 0.14.21

### Fix
- Deleting the page under your feet no longer leaves an empty canvas until reload: it is a real page switch now, the engine reloads the landing page at once.
- Peers stranded on a deleted page auto-follow to a live page with content instead of sitting on an empty one.
- Page delete no longer rewrites the whole order array: entries drop by index ranges, so the sync update stays O(deleted) and always fits the wire.

## 0.14.20

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

## 0.14.19

### Perf
- Dragged photos and PDFs paint as cheap placeholders until drop (no per-frame multi-MP rescale), so moving them no longer stutters.

## 0.14.18

### Sync worker
- Throttled room persist (first write immediate, then ≤1/s): full-doc encode+put on every message stalled the room under drag floods.

## 0.14.17

### Rollback
- Reverted to the 0.14.13 code (H-hide UI, rejoin banner, and pill cooldown removed) after breakage in production.

## 0.14.13

### Presence
- Fixed ghost peers after tab hide/show: the socket now suspends on the live provider instead of destroying it (recreating reset awareness clocks on the same client ID, so the hub dropped every update as stale). Both sides reappear within ~1s.
- Cursor smoothing: dead-reckoning lead is capped (no hook past the final point on abrupt stops), zigzag corners kill slingshot velocity, and the cursor settles straight onto the target when samples stop.

## 0.14.12

### Sync cost
- Sync rooms hibernate now: idle-but-open boards bill ~zero Durable Objects duration instead of ticking every second. Hidden tabs drop their socket and reconnect on return; empty rooms are GC'd after 90s; resync every 60s.

## 0.14.11

### PDF
- Ink sticks to PDFs now: pen, sticky, and text drawn on a PDF page move with it when dragged, same as photos. Ink off the page stays put.

## 0.14.10

### Eraser
- Only ink erases now: photos, PDF docs, tables, graphs, frames, and all 8 flowchart nodes are immune in both eraser modes, while pen strokes drawn on top of them still wipe off.

## 0.14.9

### Toolbar
- Block-scheme fly-out no longer collapses while reaching for it (it sat 10px off the row, tripping mouseleave in the gap — now overlaps by 2px).

## 0.14.8

### Toolbar
- Fixed toolbar dying after shelf drag-and-drop: a cross-group drop unmounts the source button, losing its dragend and sticking the click guard — the guard is now shared, released on every drop, and backed by a window-level dragend.
- Switching to a drawing tool now clears the selection (select/pan/lasso keep it): no more stale style island with a hidden frame, and the new tool's own panel always appears.

## 0.14.7

### Board files
- Fixed .review export failing with a bare error on photo boards: file/update/base64 limits raised 8 → 32 MB (import accepts them back, so friend handoff keeps working).
- Oversized boards now report honestly ("too large") instead of a generic error.

## 0.14.6

### Export
- One bad shape no longer kills the whole export (per-shape isolation in PNG/JPEG and SVG paths, culprit logged to console).
- Export failures now log the real error to the console instead of failing silently.

## 0.14.5

### Eraser
- Size is now a slider in points (2–96, like the pen brush) instead of three fixed slots — small precise erasing for 1–3pt handwriting is possible.

## 0.14.4

### Tables
- Creating a table no longer opens the first cell for typing — it drops back to the select tool with nothing selected, so you stay free to move around the board.

## 0.14.3

### Eraser
- Tables and photos are never erasable (both eraser modes, including peers' previews).
- Dots erase: single-tap pen dots are hittable in whole mode, and pen hit-testing is now brush-radius aware (was: stroke-width precision, so dots needed pixel-perfect aim).

## 0.14.2

### Tables
- Fixed riders freezing mid-drag: carried objects are now re-patched on every move frame (was: only the first ~zero-delta move applied, so nothing visibly followed).
- Rider rule is now marks-vs-sheets: pen, arrow, sticky and text ride by center alone; rect, ellipse, image, frame, doc, graph and nested tables must also fit — huge backgrounds underneath stay put.
- Regression tests use incremental drag moves (a single jump masked the freeze).

## 0.14.1

### Tables
- Insert row/column now GROWS the table by the donor size (was: split the last cell in half); delete shrinks it back. Existing cells keep their size.
- Riders hardened: tray rule is now center-on-table + not-bigger (casually placed objects hanging off the edge ride along, huge backgrounds stay), rotated tables included. Verified exact in unit tests (mouse drag, nudge) and end-to-end in the browser.

## 0.14.0

### Tables
- `[−]` pills next to `[+]`: pop the last row / column (insert/delete at the active cell stays in the context menu).
- Resizable cells: drag interior grid lines (fractions persist, outer resize keeps proportions, insert splits / delete merges, Esc reverts mid-drag).
- Header tint removed (first row still reads through bold; toggle it off in the menu for a fully uniform grid).
- Cell editing no longer traps dragging: Enter commits and EXITS (Tab keeps fast entry to the next cell); double-clicking another cell of the same table commits the current one first (was silently lost).
- Objects placed on a table ride along when it moves (mouse drag and arrow nudge, nested tables cascade); riders stay individually movable.

## 0.13.0

### Tables
- New `table` tool (More shelf, parkable): drag to size (cols/rows derived from the box), click for a 3×4 default.
- Uniform grid with header row (bold + tint, toggleable), hairline grid, cell text wrap/clip, 14px default.
- Cell editing via the text overlay: double-click / Enter, spreadsheet nav (Enter = down, Tab = right), plain-text cells synced over Yjs.
- FigJam-style `[+]` pills on the selected table append row/column; context menu inserts/deletes at the active cell + toggles the header.
- Style island covers tables (fill, stroke, text, size); color keys paint fill+stroke; SVG export draws grid + cells; info dialog shows grid dims.
- Fixes: labels now contrast against the shape fill (was invisible light-on-white), canvas hides only the edited table cell while typing.

## 0.12.6

### Toolbar
- Customizable toolbar: any strip tool can be parked in the "More" shelf and dragged back out; shelf rows reorder by drag. Order persists in prefs (`toolbarOrder.more`).
- Drag onto the closed shelf button spring-opens the popover; dropping on a group appends.
- Block-scheme shapes stay in the nested fly-out submenu (not individually movable).
- New pure-logic module `core/toolbarOrder.ts` + `toolbar-order-test` in the suite.

## 0.12.5

### Sync / presence
- Away peers (alt-tab, home, minimized) no longer leave a frozen cursor: `Engine` skips `viewing=false` peers when painting cursors. They stay in the members roster while the tab is open.
- Regression test: `engine-test` asserts only viewing peers paint (`Viewer`+legacy shown, `Away` hidden).

## 0.12.4

### Toolbar
- More shelf: "Block-scheme" row spans full popover width like "Graph" (root cause was `align-items:center` inherited from `.island` shrink-wrapping the `.more-sub` wrapper).

## 0.12.3

### Toolbar
- More-shelf rows use an explicit grid layout so labels always align left.

## 0.12.2

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

## 0.12.1

### Board titles
- Switching boards no longer leaks the previous board's synced title onto the newly opened board (title effects ran before `initBoard`; reconcile/mirror now apply only to the current board).
- "Save as my board" copies no longer inherit the source title/owner — the copy keeps its "(copy)" name.

## 0.12.0

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

## 0.11.0

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
