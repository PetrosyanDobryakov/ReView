# Changelog

## Unreleased

## 0.16.46

### Shelf scroll, straight arrows, honest multi-bar

- **«Ещё» shelf scrolls.** Tool rows live in a capped scroll area instead
  of running off-screen; the block-scheme flyout stays unclipped.
- **Free arrows draw straight.** The auto-bend applies only to glued
  (port-routed) arrows now; the tool preview matches. Old bent arrows
  straighten (the bend was never stored data).
- **Mixed multi-select shows opacity only.** Same-type multis keep the
  full bar; mixed sets no longer pretend to edit stickers + arrowheads
  at once.

## 0.16.45

### One color cell everywhere but pen

- **Fill/text/stroke use a single color cell** opening the shared palette
  window (grid + customs + native picker) instead of five quick slots.
  Pen keeps its thickness-coded slots; mixed selections fall back to the
  cell. Popups shrink accordingly.

## 0.16.44

### Slots: digit keys + stable layout

- **Digit keys (1–5) apply the remembered size**, exactly like clicking
  the slot (settings + selected strokes).
- **Fixed slot cells.** Circles scale 12–21px (max down 25%) inside
  constant 30px cells — the row, popup anchor and island no longer shift
  when thicknesses change. Dots transition smoothly.

## 0.16.43

### Slots scale with thickness

- **No dots, no rings.** Slot buttons themselves scale 12–28px by their
  remembered brush size (thin color = small circle, fat = big): color and
  size read at a glance. Thickness popup unchanged.

## 0.16.42

### Readable slot dots

- **Perceptual dot spread.** Slot dots scale with sqrt across 1..20, so
  neighbouring thicknesses read differently (the linear ramp was flat).

## 0.16.41

### Foreign badge + one pen popup

- **«Чужая» mark.** Remote boards get a Foreign tag in the Home list and
  next to the board title (ru/en/zh).
- **Old pen size slider removed.** Thickness lives in the slot popup now.
- **One pen window.** Slot click applies the color and opens a single
  popup: thickness slider on top, palette + customs below. Right-click
  opens the same window (touch-friendly). Slot dots keep the slot color
  (white dots washed them out) with contrast rings.

## 0.16.40

### Favorite popup fix + pen slot thickness

- **Favorite popup no longer spans the screen.** A leftover `right: 0`
  from the menu class stretched it; now pinned to the cursor.
- **Slots show their thickness.** Every pen slot carries a dot sized by
  its remembered brush size. Clicking a slot applies it and opens a
  thickness popup (slider commits live); right-click (or the palette
  button in the popup) reassigns the slot color as before.

## 0.16.39

### Teams, sizes, search, minimap, summon

- **Favorite team.** Right-click a team tab → favorite (star); Home opens
  it instead of Recent. No favorite → Recent is now the default tab.
  Deleting the favorite clears it.
- **Size per color.** Every pen color remembers its own brush size
  (Holst-style: black thin, green fat). Picking a slot applies its size;
  the size slider saves into the current color. Marker/highlighter math
  unchanged.
- **Board search.** Ctrl+F (or the top-bar icon): texts, stickies, table
  cells, media file names on the active page. Enter flies to the match
  and selects it; arrows cycle, Esc closes.
- **Minimap.** Corner icon bottom-right toggles a live overview (type
  colors, accent viewport frame, persisted). Click/drag pans, wheel zooms
  like the board.
- **Bring to me (host).** Members menu: «Всех ко мне» + per-peer «Ко мне»
  (owner/editors; everyone else just follows). Awareness summon, applied
  once, same-page only, stale-proof; camera eases over, any input wins.
  Recipients get a toast. Continuous follow-me deliberately skipped.

## 0.16.38

### Desktop window follows the route

- **Board owns the full window.** Entering a board maximizes the desktop
  window; leaving for Home restores it (Electron only, browsers untouched).
  Only self-applied state reverts, so a hand-maximized window is left
  alone and board-to-board hops don't flicker.

## 0.16.37

### Player mount flash, for real this time

- **Root cause found.** The card reuses the `board-row-menu` theme class,
  whose mount animation animates `transform` — overriding the dock's
  `scale(k)` for ~200ms. Every fresh dock painted at natural 480px and
  then snapped to size (most visible at low zoom, e.g. multi-selecting).
  Cards now opt out of the animation; geometry was already synchronous.

## 0.16.36

### Back banner re-arms on revisit

- **Dismissal is visit-based, not id-based.** The × used to forget the
  board id, so reopening the same board never brought the banner back. Now
  every board open bumps a visit counter and × hides until the next visit —
  same board included.

## 0.16.35

### Interaction batch 2

- **Home back banner.** «Назад к доске» moved from the header to a
  centered dismissible banner (× forgets this board until the next visit).
- **Arrow preview you can see.** The shaft hover ring actually repaints now
  (it silently never did); vertex dots grab with grab/grabbing cursors,
  distinct from object move.
- **Hold to ungroup.** Разгруппировать needs an 800ms hold (no accidental
  dissolves; Ctrl+Shift+G stays instant). Group ops refresh the open menu
  live (Group↔Ungroup flips without reopening).
- **Drag-only shapes.** Clicks plant nothing on any BoxTool figure —
  double-clicks always fall through to tool reset.
- **No mount flash, structurally.** Card geometry computes synchronously
  for the first paint (same formula as the rAF), so no unscaled frame can
  ever show, single- or multi-select.

## 0.16.34

### Feedback button + calmer Home footer

- **Report a bug from Home.** New feedback icon in the Home header (left
  of settings, Home only): opens the OnlineTestpad
  bug/suggestion form in a new tab. Tooltip in ru/en/zh.
- **Footer cleanup.** Removed the storage fine-print line from the Home
  footer; the «Save others’ boards» switch stays at the bottom left.

### Interaction micro-batch

- **Rigid groups.** Any touched member selects the whole group — partial
  selections cannot exist, members never drift. One menu toggle
  (Сгруппировать / Разгруппировать), Ctrl+G / Ctrl+Shift+G.
- **Arrow insert flow.** Hovering a free arrow shaft hides the cursor and
  shows a ring preview; press plants a draggable dot at once, repeat
  presses edit it. Waypoints keep a 14px minimum gap (drag slides around
  neighbours). Double-click a middle dot deletes (drags never delete);
  shaft double-clicks never reset the tool.
- **No twin shapes.** Double-click in one spot with a shape tool resets to
  select instead of planting a second figure (pen/mouse exempt).
- **Stabilizer tile.** Smoothing moved from StyleBar to Settings → System
  as its own tile (0–100, default 30).
- **Compact StyleBar.** Controls regroup into wrapping clusters (max two
  rows); nothing removed.
- **No player flash.** Cards stay hidden until the first positioned frame.

## 0.16.33

### Opacity, downloads, smoothing, arrow waypoints, grouping

- **Opacity for everything.** StyleBar gains a transparency slider for any
  selection (5–100%); canvas, DOM player panels and SVG export honor it.
  Pen/highlighter keep working as before.
- **Downloads.** Table → CSV (Excel BOM), text/sticky → TXT, doc → PDF
  (context menu; photo/video/audio originals unchanged).
- **Tablet stabilizer.** One Euro smoothing on pen input with a 0–100
  strength slider next to brush size (0 = raw, default 30). Pressure
  untouched; local-only, never synced.
- **Arrow waypoints.** Free arrows render elbows through stored waypoints
  (new poly curve; legacy cubics untouched). Selected free arrows show
  draggable dots; double-click an edge inserts, double-click a middle dot
  deletes. Glued arrows keep the auto curve.
- **Grouping.** Ctrl+G / Ctrl+Shift+G + context menu; click selects the
  group, again drills to the member, once more pops out; Esc steps up.
  Move/resize/delete/duplicate/align work on groups; full-group copies
  regroup, partial copies drop the id. Synced as a plain string, undoable.
- **Home back button + double-click reset** (0.16.32): «Назад к доске» in
  the header; double-click empty space returns to select.

## 0.16.32

### Back to board + double-click reset

- **Home back button.** Leaving a board for the menu keeps the visit log,
  so Home shows «Назад к доске» with the board name (own and guest
  visits; a deleted board simply hides it).
- **Double-click empty space resets the tool** to select and clears the
  selection (mouse and touch double-tap; crop and export picking keep
  their flow, editors still open on shapes).

## 0.16.31

### Follow means in sync + button cleanup

- **The follow button tells the truth.** It stays lit only while actually
  converged with the shared session: a local pause/scrub/resume while it
  runs unlights it (visibly behind), pressing it catches up with a seek
  jump, opting out still toggles off. Pure `isMediaInSync` predicate,
  covered by media-roles-test.
- **Big play triangle removed.** It was unclear; transport lives in the two
  labeled rows now (shared restart-from-0 moved into «Всем»).
- **Buttons read as buttons.** Transport buttons get tinted substrates
  (stronger for the shared one) and semibold labels.

## 0.16.30

### Video dock redo and cursor layer

- **Constant corners.** Both player cards keep the theme 12px radius at any
  zoom instead of scaling it with the board.
- **Longitudinal video dock.** One ~3:1 tab scaled to the frame width:
  transport buttons in a row, both volume sliders full width below. No more
  square, no more cramped timeline.
- **Aligned sliders, both cards.** Transport buttons share one fixed width
  and volume labels one fixed column, so sliders line up regardless of
  label lengths.
- **Cards below chrome.** Player cards drop to z 10: toolbar, panels,
  menus and dialogs cover them again instead of the reverse.
- **Peer cursors above cards.** Glyph + name paint on a dedicated
  transparent canvas (below chrome) instead of the board canvas, so foreign
  cursors stay visible over opaque cards. Drafts/selections stay board
  content underneath.

## 0.16.29

### Volume follow, quiet tweaks, rights foundation

- **Shared volume slider follows.** The follower's Общая громкость now
  tracks the driver's hand live (paused while dragging it yourself).
- **No notice on tweaks.** Volume and scrub commits ride as quiet states:
  followers apply with no "now playing" toast. Starts/stops still announce;
  a tweak landing mid-countdown folds into it without restarting or
  announcing.
- **Rights, simplified and extensible.** The settings toggle is gone:
  driving is owner/editors only, viewers stay local with a locked row, and
  the owner grants co-hosts per peer as before. One resolved `roleOf(...)`
  now backs every permission (media today, object locking tomorrow);
  Connection → You shows your role (владелец/соведущий/участник).

## 0.16.28

### Shared-audio rights

- **Board mode (owner only, default open).** Settings → Connection:
  «Общий звук для всех» — open boards let anyone drive (a friend's press
  plays for all, zero setup); restricted boards limit driving to
  owner/editors. Synced in board meta, no migration (absent = open).
- **Locked row for viewers.** Without driving rights the "for all" row
  disables with a lock hint, the big button toggles locally, and losing
  rights mid-countdown cancels the pending start.
- **Co-hosts.** Grant/revoke per peer as before (Connection → participant);
  editors drive restricted boards.
- Pure `canDriveShared` predicate covered by media-roles-test.

## 0.16.27

### Transport states and open driving

- **Buttons follow playback.** "For me" toggles Играть/Стоп у меня by local
  state; "for all" toggles Всем: старт/стоп by shared state — no more
  permanent Стоп labels.
- **One primary transport for everyone.** The big button always drives the
  shared session: start (countdown, instant when alone), stop, or restart
  from 0 when stuck at the end. Local preview lives in the "for me" row.
- **Open transport.** Any peer's press/seek/volume drives all followers —
  no more silent friend presses (owner/editor grants stay for later
  refinement; kick still guards trolls). Solo starts skip the countdown.

## 0.16.26

### Media stops when it should, video dock on demand

- **Leaving the board silences everything.** Engine teardown pauses all
  cached audio/video elements (they outlive the board); scheduled shared
  starts already died with it.
- **Deleting a player shape stops it.** The delete path pauses its element
  and cancels its pending countdown — on every peer, since the deletion
  itself syncs.
- **Video dock only when selected.** Audio keeps its permanent window; the
  video control tab appears on click/selection and hides on deselect
  (canvas double-click still toggles playback).

## 0.16.25

### Player cards behave like board objects

- **Wheel over buttons/sliders zooms the board.** The canvas never sees
  events over the overlay, so the card forwards them (native non-passive
  listener); a focused slider no longer eats the wheel either.
- **No viewport clamping.** Cards sit at true coords and slide off-screen
  exactly like the shape under them instead of sticking to the edge and
  vanishing. Applies to the video dock too.
- **Video dock is board-fixed.** The control tab scales with zoom to match
  the frame width instead of staying constant on screen.
- **Wide audio window fills itself.** Controls stretch to the rect width —
  extra space grows the sliders (timeline first) instead of empty margins.

## 0.16.24

### Audio alignment, backdrop window and sync repairs

- **Alignment.** Audio joins the snap/align targets (photos, video, PDFs,
  tables, frames): dragging snaps to it and it snaps to others, single and
  multi-align include it.
- **Window.** The themed rounded backdrop fills the whole world rect, so the
  selection frame always hugs the object. Resize stretches freely
  (vertical/horizontal) with readable minimums (240x150); the controls
  contain-fit inside and never distort.
- **Sync.** Fresh starts never resume from the end (restart from 0, shared
  and local); the driver's seek commits to everyone without a new countdown;
  stop/volume track the shared clock instead of a stale local element;
  volume+stop written in the same millisecond both apply.

## 0.16.23

### Audio is a board object again

- **The player zooms with the board.** The card fills its world rect like a
  photo: zoom in/out rescales it, and it keeps its size on the board. The
  screen-constant card experiment (`audioScale`) is removed.
- **Manual resize scales the shape uniformly** (any handle, aspect locked,
  undoable, synced) so the player never distorts; selection, hit-test,
  marquee and erase work by the world rect like image/video.
- Legacy 320x96 audio heals to the default size once, center-preserving.

## 0.16.22

### Zoom-independent player with manual resize

- **Card ignores board zoom.** Constant screen size at any zoom; selection
  frame, hit-test and corners all derive from the card rect, never from zoom.
- **Resize by corners.** Dragging a card corner scales the player (0.6–2,
  synced, undoable); edges/rotate stay off, footprint snaps back and heals in
  the doc.
- Participant frame hugs the shorter card.

## 0.16.21

### Audio is just the player card

- **No canvas rectangle anymore.** The audio body is invisible, the footprint
  is fixed (288 wide, role-height) and existing shapes snap back to center;
  no resize/rotate handles on audio — select, move, delete only.
- **Mockup layout.** Outline Play (participant toggles locally, organizer
  starts the countdown when idle), "stop for me" + my volume; organizer adds
  "stop for all" + shared volume.

## 0.16.20

### Player card cleanup

- **Fixed-size card.** Follows its shape on zoom/pan but never rescales; audio
  centers over its body, video docks below its frame.
- **No duplicate buttons.** Big round button toggles local play/pause for me
  only; the host gets one contextual start/stop-for-all button (countdown
  start when idle, stop when playing).
- **Labeled volumes.** "My volume" / "Shared volume" text labels next to the
  sliders; sync switch renamed to "Sync with host".

## 0.16.19

### Mockup player cards, countdown starts, top notices

- **Player like the mockup, always visible.** File pill, big toggle, timeline
  with time, stop-for-me plus own volume; owners and co-hosts get
  start/stop-for-all plus the shared volume. Theme-adaptive in every theme.
  Canvas keeps a flat themed body underneath.
- **Synchronized countdown starts.** Play-for-all warns everyone for 3 seconds
  ("starting soon" + file name), then starts together; × opts out locally.
- **Notices top-center and larger.** Errors red, info drains away.
- **"Follow" renamed** to "listen to host" with a plain-language hint.

## 0.16.18

### Media player mockup, countdown notices, notice center

- **Player like the mockup.** File-name pill, big toggle, timeline with time,
  stop-for-me plus own volume; owners and co-hosts get start/stop-for-all
  plus the shared volume. File names stored on the shapes.
- **Warning before shared start.** Everyone sees "starting soon" with a
  filling bar for 3 seconds, then a synchronized start; × opts out locally.
- **Notice center.** All toasts and errors moved to center-screen cards with
  a progress bar (fill, then drain back), × to close, red for errors.

## 0.16.17

### Media transport overlay, shared playback, co-host rights

- **Floating player.** Selecting an audio/video shape pops a transport bar
  above it: big play/pause, scrubbable timeline, own volume, follow toggle.
  Video now plays with sound (user gesture unmutes).
- **Play for everyone.** Owner and granted co-hosts get start/stop-for-all and
  a shared volume; followers seek into position automatically. State rides the
  shape as JSON, untracked by undo; enforcement is UI-level, like kick.
- **Co-host grants** in Connection next to each person (owner only).

## 0.16.16

### Audio files on the board

- **New `audio` shape.** Drop mp3/wav/ogg/opus/m4a/flac onto the board (file
  dialog, paste, drag-and-drop). Files are validated before the shape exists;
  cap is 32 MB so lesson recordings fit.
- **Canvas player card.** Round play/pause button, `mm:ss` readout and an
  animated progress bar, painted like video frames. Double-click or the context
  menu toggles; one plays at a time; no autoplay.
- **Same pipes as video.** SHA-256 blobs outside the Y.Doc, peer fetch and
  prefetch, download from the menu, SVG placeholder on export. No new document
  fields, no waveform yet.

## 0.16.15

### Settings polish, home join block, honest rotation magnet

- **Connection in tiles.** The Connection tab uses the same dark tiles as
  Customize; tabs fit without clipping in all locales.
- **Developer hold fills.** The hold-to-open button shows fill progress and a
  shorter label; the data-folder block is redesigned.
- **Home.** Explicit "Join someone's board" block on top; import and new board
  moved under the list; board row menus always visible.
- **Rotation magnet is honest.** Shift-drawn lines and arrows no longer snap
  when the magnet is off; on, they snap as before. Network-check copy is
  neutral.

## 0.16.14

### Settings reorganized around Connection

- **New Connection tab.** Status, invite links, profile (nick + color), a plain
  link-mode radio (Auto / Direct only / LAN only) instead of three low-level
  switches, people on the board with link badges (LAN / direct / TURN /
  relays), RTT and app versions, per-peer details and session kick, network
  check with human-language results, one-shot diagnostics copy, and a hub
  summary. Custom TURN lines survive mode switches.
- **Developer gate in System.** Raw hub editing, ICE lines, net log and a
  two-click settings reset sit behind a press-and-hold button; everyday users
  never see them.
- **Moves.** Interface scale and tool cursor size moved to Customize; gestures
  reference moved to Binds; desktop data-folder controls moved to System.

## 0.16.13

### One-shot connect diagnostics

- **Mesh keeps a link event ring.** Seen, link start/open/closed, relay
  fallback and hub lost peer lines with timestamps (last 60, peer ids
  shortened) are kept in memory and exposed via `recentEvents()`.
- **Console `await reviewDiag()`.** Runs the NAT check, snapshots the mesh,
  attaches the event ring and prefs (ICE passwords redacted), copies the JSON
  to the clipboard when allowed and returns the object. One paste from each
  side is enough to separate signaling, NAT, firewall and handshake failures.
- **Copy diagnostics carries the same.** Origin, build hubs, sync/WebRTC flags,
  full prefs and the event ring are included alongside the existing NAT, TURN,
  hub and peer data.

## 0.16.12

### Long strokes stop backlogging thin links

- **Live-stroke previews are capped at 96 vertices.** The sender used to push
  the full raw point array ~20 times a second, so a minute-long line piled
  megabytes behind a thin relay and kept drawing long after pen-up. The wire
  now carries at most 96 vertices with a detailed tip; the committed shape
  still keeps every vertex. Old clients' full previews keep rendering.

## 0.16.11

### No comet tails, real telemetry

- **Draft tip stops overshooting.** The dead-reckon now feeds every frame (a
  held pen zeroes its velocity instead of coasting on stale speed), with a
  shorter window and tighter lead cap.
- **Relay and awareness telemetry.** Relay links count batches, hot/bulk bytes
  and send failures; every peer reports awareness age and queued bytes. Copy
  diagnostics carries it all, and a >10 s awareness stall is logged on rejoin.

## 0.16.10

### Remote strokes glide on slow links

- **Draft tip dead-reckoning.** A peer's live stroke used to grow in jumps at
  packet rate. The stroke tip now rides the same motion machine as cursors:
  between packets it glides forward along its velocity (0.4 s window, lead
  capped at 64 screen px, teleports snap). Fast links render exactly as before
  (dense samples leave no age to bridge); relay links feel continuous instead
  of steppy. Verified by the relay e2e (strokes both ways, photo ~1 s).

## 0.16.9

### Copy buttons cannot red-screen the app

- **No more bare `prompt()`.** In the sandboxed desktop shell `prompt` does not
  exist, so copying diagnostics or an invite link with a denied clipboard threw
  and covered the window in red. Copy now falls back to a hidden textarea
  first, asks `prompt` only where it exists, and otherwise logs instead of
  throwing.

## 0.16.8

### Relay link feels live

- **Liveness jumps the queue.** Relay batches used to carry frames strictly in
  arrival order, so one 300 KB sync update held cursors and live strokes behind
  it for seconds. The relay link now has two lanes: liveness frames (cursors,
  drafts, pings) ride first in every batch, bulk sync and media after (a hot
  cap per tick keeps bulk from starving). Order inside each lane is preserved,
  failed sends requeue lanes intact. Peer drafts and cursors feel near-instant
  on relay paths; bulk speed is unchanged by design.

## 0.16.7

### Failed direct links keep their reason

- **Direct-link failures stay visible.** The mesh used to wipe the close reason
  (`ice failed`, `timeout`, …) the moment the Nostr relay link opened, so every
  pasted diagnostics report said `lastError: null` and dead direct links could
  not be told apart. The reason now survives as `lastDirectError` in the peer
  snapshot and Copy diagnostics, cleared only when a direct link actually
  opens. First step of the direct-link investigation (same-ISP pair and a
  cross-ISP pair both stuck on relays despite good NAT on all sides).

## 0.16.6

### Own hub, own installers

- **Release line on `dev-petrosyan-p2p`.** Same code as 0.16.5; installers bake in
  our own hub `wss://review-hub.petrosyan-dobryakov.workers.dev` (a clean-room
  deploy of the same hub worker on our own Cloudflare account — the friend's
  amicus hub keeps running untouched as backup). The release workflow checks
  our live hub from GitHub's network before building.
- No TURN key on our hub yet (`/turn` answers 404): direct links and the Nostr
  relay fallback carry strict networks until one is set.

## 0.16.5

### Linked even when no direct path exists
- **Relay link** (`src/net/p2p/relayLink.ts`). After a failed direct attempt (`ice failed`, `timeout`) to a peer both sides see on a Nostr relay, the mesh carries that peer's frames through the relays instead of WebRTC. This is the case of two friends behind one carrier NAT with no TURN. Frames are batched (24 KB), numbered and sent through two relays at five events a second, inside the relay hub's AES-GCM seal under the board key, as ephemeral events the relays keep nothing of. The receiver drops duplicates, restores order and skips a gap that does not fill within 2.5 s; Yjs resyncs anything lost. The other side switches as soon as relay traffic arrives. Peers show "through relays (slow)" in Connection.
- Measured between two browsers: a stroke in 0.2-0.4 s, a 300 KB image in about 4.5 s; with direct links impossible, peers are linked through the relays about 20 s after they meet. Fine for drawing together, slow for large media.
- The relay link uses only Nostr relays, never the Cloudflare hub or a review-host. A relay link that dies tries a direct link again.
- `HUB_LINK=1 node scripts/relay-e2e.mjs` (and `localStorage.REVIEW_FORCE_HUB_LINK = '1'`) forces it. relay-e2e now runs its two browsers in separate contexts, and the release workflow runs the relay-link test from GitHub's network.
- The unusable TURN secrets are removed from the hub (`/turn` answers 404 until a TURN key is set); the TURN support stays for when one is.

## 0.16.4

### Links through a shared carrier NAT
- **TURN fallback.** Two friends behind the same ISP's carrier NAT (both public addresses from one pool, no IPv6) found each other through the relays but every direct link ended in `ice failed`: the ISP does not route between two of its own customers' public mappings. The Cloudflare hub now serves `/turn`, short-lived Cloudflare Realtime TURN credentials (24 h, minted with a TURN key kept as Worker secrets, renewed every 6 h per isolate). The app adds them to ICE, so a link goes through `turn.cloudflare.com` only when no direct pair works; TURN forwards the DTLS-encrypted stream and cannot read the board. Settings, Connection: "Relay through TURN when a direct link fails" (on by default; off, or ICE set to LAN only, disables it).
- **Credentials travel between peers.** A side that cannot reach the hub (networks that block `*.workers.dev`) gets them from a peer that could, over signaling. Only `turn.cloudflare.com` entries are accepted from peers.
- Diagnostics report whether TURN credentials are held. `localStorage.REVIEW_ICE_RELAY = '1'` forces TURN-only links (testing).
- The release workflow checks the live hub first from GitHub's network: `/turn` returns credentials, and two browsers link through TURN only (`TURN_ONLY=1 node scripts/relay-e2e.mjs`).

## 0.16.3

### Why two devices do not link
- **Settings, Connection, Network check**: one ICE round against the STUN servers tells whether this network allows direct links (`ok`), only gives each server a different port (`symmetric`: a friend behind a similar router cannot be reached directly) or gets no STUN reply (`blocked`). Console: `reviewNat()`.
- **Copy diagnostics** puts a JSON report on the clipboard: app version, network check, every hub's state and error, and every peer's link state, attempts, last close reason and the ICE candidate types both sides offered. Both people paste theirs to see which step fails.
- Peer rows show why the last link closed (`ice failed`, `timeout`, ...) while it is not open.

## 0.16.2

### You pick where the app keeps things
- **First launch asks for a folder** (Documents/ReView suggested, or any folder you choose). Boards (`boards/`), media (`blobs/`) and the app's own browser data (`.review-app/`, hidden) all live there; nothing of substance stays in AppData. Only `location.json`, a pointer to that folder, remains in the app's config dir.
- **Older data moves over by itself**: boards and media from `dev.zpro.review` and the 0.16.0-0.16.1 browser profile go into the chosen folder on the restart right after the choice, so nothing is lost.
- **Settings, Connection shows the folder** and has "Change folder…": everything moves to the new folder and the app restarts. Moves run at startup, before the app opens any of the files.
- A hub that keeps failing (the Cloudflare hub on networks that block `*.workers.dev`) is retried every 5 minutes after six attempts instead of every 30 s.

## 0.16.1

### Meet friends from any network
- **Public Nostr relays as hubs** (`src/net/p2p/nostrHub.ts`), joined by default next to the Cloudflare hub: `nos.lol`, `relay.primal.net`, `nostr.mom`, `offchain.pub`. Some networks cannot reach `*.workers.dev` at all (TLS is cut), so two apps there never met. Relays are reachable and need no account. They only introduce peers: each handshake goes out as an ephemeral event (kind 21078, relays forward it and keep nothing), tagged with a SHA-256 of the room and sealed with AES-GCM under a key derived from the board, so a relay sees neither the board id nor any address. Board data and media still go only device to device over WebRTC. Switch: Settings, Connection, "Meet through public relays". `nostr+wss://relay` hub addresses can be added by hand.
- **Invite over the internet.** In the app, Members has "Copy invite link": a `review://board/<id>` link. The ReView app opens it (Windows, macOS, the .deb, and the AppImage, which now writes its own launcher entry), or the friend pastes it into the field on Home. The LAN link for a browser on the same Wi-Fi stays below it. Copy link on Home gives the same app link.
- `npm run test:relay`: two browsers with no hub of their own meet only through the relays and sync a stroke.

### Update button
- **The app updates itself.** When a newer `p2p-desktop-v*` release exists, the version chip on Home becomes "Update to vX" and shows download progress. The AppImage replaces its own file and restarts; Windows installs silently over itself and restarts; the .deb and .dmg are downloaded and opened in the system installer. Other copies (unpacked dev builds) open the release page.

## 0.16.0

First release of the peer-to-peer line (branch `claude/full-p2p-desktop`), on top of 0.15.58. Test builds of this line were tagged 1.0.x; those tags and prereleases are gone and this is the initial release.

### Media by content hash
- **Images, videos and document pages are no longer stored inside the board.** Their bytes go into a local blob store keyed by SHA-256 (IndexedDB `review-blobs`, plus `<app data>/blobs/` on the desktop app); the shape keeps only the hash, a 256 px thumbnail hash, mime and size. A board with a 2 MB photo is now about 1.5 KB of document, so joining, syncing and saving stay fast however many pictures it holds.
- **Peers fetch media from each other** over the same data channel (`BLOB_WANT` / `BLOB_PART` / `BLOB_MISS`). Replies go out in 64 KB slices only while the link's send buffer is short, so live edits never wait behind a big transfer. The receiver checks the hash, so a peer cannot slip in other bytes. A peer serves only media the open board references.
- **Everyone keeps a full copy.** With no server, media survives only on devices that hold it, so each member quietly prefetches the board's missing media in the background, as when the bytes lived inside the document.
- Far-away media paints from the thumbnail and loads full size when zoomed in (viewport LOD). Board export (`.review` v2) carries the bytes and asks peers for any this device lacks.
- **Older boards**: a background migration adds hashes next to the inline copies, and compaction drops an inline copy once its bytes are held locally. Shared boards keep their inline copies (compaction never runs while others hold the board).
- Ported from `dev-petrosyan-desktop` (blob store, thumbnails, LOD, migration, `.review` v2). Its WebSocket transport supervisor and y-webrtc signaling relay are not carried over: this line has neither.
- Tests: `blobs-test`, `media-blobs-test` (including bytes from peers), `board-file-test`; `p2p-test` fetches 2 MB by hash, checks a live edit overtakes it and that a peer serving wrong bytes is refused; `p2p-e2e` drops a 1.9 MB photo on A and checks B gets it while the doc stays small; the desktop e2e round-trips a blob file.

### Cloudflare: hub only
- The Cloudflare hub is now its own Worker, **review-hub** (`cloudflare/wrangler.toml`). It serves no web UI and no `/lan`, only `/signal/<room>` and `/health`. The UI stays self-hosted. The `review` Worker goes back to being an optional static UI copy.
- `VITE_HUBS=wss://…` at build time bakes hubs into the UI, so every page from that build joins them. The P2P panel shows them as "built-in".
- `scripts/deploy.sh` targets: `hub` (default), `spa`, `all`.
- `E2E_HUB=cloudflare` e2e serves the UI from a plain static server, and the Worker is the only hub. The test's wrangler runs in its own process group, so killing the hub cannot orphan workerd.

### P2P
- **Edits lost on a dying link are repaired.** Relay suppression trusted that a peer with a direct link to the author got each edit from it. If that link died with an edit still in flight, the edit never arrived, and later edits that built on it got stuck. Now, whenever a link closes, the remaining peers exchange state vectors and fill each other's gaps. A peer that receives an update with missing parents also asks its links for a resync (at most once per 2 s). This is the likely cause of the occasional `p2p-e2e` failure "B -> A with the hub dead": a write the third tab made on joining reached only one of the other two before it left.
- Tests: `p2p-test` covers a lost in-flight edit. `p2p-e2e` checks that A and B agree before killing the hub, and dumps mesh state and console on failure.

### Fully peer-to-peer, self-hosted
- **No server holds boards any more.** Board data moves only between devices over WebRTC data channels and is stored only on those devices. The Cloudflare `review-sync` Durable Object, its room storage, compaction DELETE and the y-websocket client are gone.
- **Own P2P layer** (`src/net/p2p/`): full mesh, Yjs sync and awareness over an ordered `review` data channel, 16 KiB framing with chunked reassembly for big pastes, relay through a middle peer when two peers cannot reach each other (skipped when the target already has a direct link), RTT pings, link path detection (same network, direct through NAT, TURN). Links outlive their hub.
- **`review-host`** (Rust, replaces `review-sync`): serves the web UI (`--dist`), a stateless signaling hub at `/signal/<room>` that only forwards SDP/ICE (binary frames refused, empty rooms forgotten at once), `/lan` and `/health`, and mDNS discovery of other hosts on the LAN. `npm run host` = build + host on `:1234`.
- **P2P panel** (Settings → System): on/off, invite address, live links (who, state, path, RTT, traffic), hubs (this host, LAN, added, from invite) with state, add a friend's hub, LAN discovery switch, STUN/TURN lines. Console helper `reviewP2p()`.
- **Joined boards are saved on your device by default**, since there is no server copy.

### Tests
- `scripts/p2p-test.mjs` (in `npm test`): framing, hub addresses, mesh against a real review-host with in-memory links (late join, awareness, 300 KB chunked update, leave clears cursors, relay, duplicate-relay suppression).
- `scripts/p2p-e2e.mjs` (`npm run test:e2e`): two headless Chromium browsers over real WebRTC: late join, live edits, hub forgets leavers, links survive the hub being killed.
- Rust: hub unit tests and a websocket integration test in `rust/review-host`.

### Cloudflare hub live
- **review-hub is deployed** on the amicus account: `wss://review-hub.amicus-vamicus.workers.dev` (`/health` reports `service: "review-hub"`).
- **`scripts/deploy.sh` no longer leaks the zpro account into the hub deploy.** It used to export `CLOUDFLARE_ACCOUNT_ID` = zpro for every target, which overrides `account_id` in `cloudflare/wrangler.toml`. Now each target gets its own account (`HUB_ACCOUNT_ID`, default amicus; `SPA_ACCOUNT_ID`, default zpro).
- **Tests against a live hub.** `CF_HUB_URL=https://review-hub.<sub>.workers.dev` makes `cf-hub-test` and `E2E_HUB=cloudflare` `p2p-e2e` use that deployed Worker instead of `wrangler dev`. A live hub cannot be killed, so the e2e routes the browsers' hub sockets through Playwright and cuts them; it now also checks both tabs really lost the hub before the "hub dead" sync step.
- `playwright` is a pinned dev dependency (1.63.0), so `npm run test:e2e` works after `npm ci`.

### Desktop app
- **Electron app** (`electron/`, `electron-builder.yml`). An earlier Tauri shell was dropped: WebKitGTK on Linux was the bottleneck: on NVIDIA under Wayland it either crashed (DMA-BUF renderer) or presented at about 60 fps with pan input arriving at 17-50 events a second, so panning felt like 15 fps. Chromium renders and delivers input at the display rate on every OS.
- **The app is a host.** It starts the bundled `review-host` binary and loads the UI from it, serves the same UI to friends' browsers on the Wi-Fi (`http://<lan-ip>:4455/board/<id>`), runs the hub and finds other ReView hosts over mDNS. Boards and media are files in `dev.zpro.review` under the OS data dir (`boards/<id>.review` + `.json`, `blobs/<ab>/<sha256>`), restored on launch when the page storage lacks them; closing the window writes pending edits first. The earlier Tauri test builds used the same folder, so their boards come back.
- **No title bar on tiling Wayland/X11 window managers** (Hyprland, Sway, i3, niri, ...); other desktops keep their frame. No menu bar on Windows and Linux.
- **Mouse side buttons pan the board** in the app (Chromium passes them to the page; WebKitGTK turned them into history navigation).
- WebRTC offers real LAN addresses as host candidates instead of mDNS `.local` names, so app-to-app and app-to-browser links on one network no longer depend on multicast DNS.
- Panning clamps the camera once per frame instead of on every pointer and wheel event, and measures pan steps from `clientX/Y` (some engines round `movementX`).
- `npm run test:desktop` drives the app with Playwright's Electron driver against a throwaway data folder. `review-host` reads `REVIEW_PORT_TRIES`.
- **Releases**: pushing a `p2p-desktop-v*` tag (`.github/workflows/desktop-release.yml`) builds Windows NSIS `.exe`, macOS arm64 and x64 `.dmg` (ad-hoc signed) and Linux `.AppImage` and `.deb`, and publishes a GitHub prerelease, never marked latest. Builds bake in `VITE_HUBS=wss://review-hub.amicus-vamicus.workers.dev`. Installers are unsigned: SmartScreen on Windows, `xattr -cr` on macOS. Android stays on Tauri.
- **Honest update check and footer.** The app follows only this line's `p2p-desktop-v*` releases and reads only dotted versions. It says boards are saved as files on this device and does not ask you to download the desktop app; in a browser that link opens the desktop releases. External links open in the system browser.

### New Home page, rest stays main's UI
- **Home is the redesigned single calm column** (from dev-warexpor `65346d4`, `0b7793d`, `440bf7b`), with the procedural, name-aware board thumbnails (`BoardGlyph`). Only Home is ported: board chrome, toolbar, settings and icons stay main's.
- Keeps the desktop fixes on the new Home footer: boards-as-files text in the app, no "download desktop" link inside it, and in a browser the link opens the P2P desktop releases.

## 0.15.58

### Home redesign
- **One column instead of sidebar + table**: big "Boards" title with Import and New board on the right, one "paste a board link" field under it (the Join button appears once there is something to join), team tabs as pills with board counts, then the board list. The four explainer boxes in the sidebar are gone.
- **Cleaner board rows**: a procedural mini-board thumbnail that follows the board name (ru / en / zh keywords): sprint or retro draws a kanban, architecture or DB a flowchart, moodboard or design image tiles and swatches, roadmap or onboarding a timeline, ideas a mind map, metrics a bar / line / pie chart, math a function plot, prototype or app a browser or phone wireframe, notes or meeting a checklist or page. Other names get a free sketch or a random scene. Layouts, counts and colors are seeded from the board id, so every board keeps its own picture. Then the name, and a relative "updated 5 hours ago" (exact time on hover) plus size. The "#" column, table header and board id (now the row tooltip) are gone; the storage badge only shows when a board is session-only, next to its Keep on device button.
- **Actions on hover**: copy link and a ⋯ menu (Save as my board, Export, Rename, Delete) appear on hover or focus; always visible on touch.
- **Teams**: "+" pill adds a team, double-click a team to rename it, the ⋯ at the end of the tab row renames or deletes the active team.
- **Footer fine print**: the browser-cache warning, the "Save others' boards" switch (its explanation is now the tooltip) and the desktop-app note sit quietly at the bottom.
- Empty team shows a dashed empty state with a New board button. Works across all interface themes, Orbit included, and on phones.

## 0.15.57

### Starship finale realism
- **Booster return and tower catch**: after hot staging the booster flips on its 3 center engines (gimbaled plume), burns back toward the pad on 13 engines, turns engines-down and falls under gravity and drag with grid-fin steering toward the tower. A guided landing burn (13 engines, then the center 3) lights exactly when the fall needs it, it hovers down between the open chopsticks, the arms swing closed under the grid fins, the pins settle on the arms with a small bounce, the engines cut and the tanks vent. It no longer floats around and fades out mid-air.
- **Gentle ascent**: straight up past the tower, a small pitch kick, then a slow gravity turn (about 7 degrees at staging instead of 34, about 21 for the Ship afterwards instead of 60). The pad and tower sit centered in the view.
- **More detail**: frost flakes shed off the tanks at ignition and liftoff, a vapor cone around the Ship through max-Q, the Ship's plume scorching the booster's ring at separation, engine bells glowing dull red after each burn, the landing plume hitting the mount with its own steam and glow, and a live chopstick carriage and truss arms (near arm over the booster, far arm behind).

### Orbit sky
- Stars are a bit more present: more mid-bright stars, slightly brighter and wider points, still static and gray-to-white.

## 0.15.56

### Orbit polish
- **Stars are plain and static**: gray-to-white only (no blue / warm / orange tints), no halo and no twinkle, dimmer bright stars. The sky haze is neutral too, and the settings preview cards use gray stars.
- **Starship booster return**: the booster now turns about its own center (it used to swing around its engine end and then slide off at a frozen angle), turns its engines along the flight path for the boostback burn, turns upright engines-down, and lights a short entry burn before fading.
- **Starship plumes**: more detailed fire: nozzle glow, a turbulent sheath of three independently flickering lobes, individual engine jets merging below the bells, softer Mach diamonds with halos.
- **Rotate-knob rocket**: the booster also turns about its center with a boostback lean, legs out on approach; drawn sea-level / vacuum plumes (core, sheath, shock diamonds) instead of a flat glow, and flame particles cool smoothly white to orange.
- **Toggles on Orbit** look and behave like the default themes (no press-scale on the row, no Orbit-only colors).
- **Calculator / graph**: the green status light is gone; the calculator's execute key is light gray instead of white.
- Orbit paper preview card: the limb sits higher so the card shows sky over the planet, with the label on the planet.

### Palette
- Standard color picker for pen / shapes / text: neutrals (white, gray, charcoal, black) then red, orange, yellow, green, blue, purple, pink ramps. Default yellow slot is a real yellow. Orbit quick slots use the same standard colors (white ink first) instead of the mission palette; old Orbit slots are still restored on leaving Orbit.

### Interface and board themes are independent
- Orbit interface and Orbit board paper no longer lock each other: pick the Orbit interface over any paper (Charcoal, Cream, custom...), or Orbit paper under any interface (Charcoal, White, Custom...). Choosing one never switches the other. The space backdrop now shows under any interface while the board is on Orbit paper, and Orbit board effects (stardust pen, burn-up, lock brackets, rocket launch) follow the paper, not the interface. Turning the Orbit unlock off still leaves both.

### Fix
- **Custom board color works from Orbit**: choosing "Custom" while on Orbit paper re-applied the Orbit paper (the custom seed picked it up), so a custom color could never be set. Orbit paper is no longer used as a custom seed.

## 0.15.55

### Ops
- **worker-build OpenSSL:** compiling `worker-build` needs OpenSSL headers (`ureq` / `native-tls`). The Builds image preinstalls `libssl-dev` but not necessarily `pkg-config`. `scripts/build-sync-worker.sh` uses `pkg-config` when it can see openssl, otherwise points `openssl-sys` at the system headers and libs, and `apt-get install pkg-config libssl-dev` only when those files are missing.

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
