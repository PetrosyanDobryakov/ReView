# (ReView) — agent notes

> Global (ported from `~/.cursor/AGENTS.md` → `~/.grok/AGENTS.md`): No extra global drive. Cursor defaults + pstack + project index at `~/.cursor/PROJECTS.md` (mirrored to `~/.claude/PROJECTS.md`). Old handoffs at `~/.cursor/SESSION-MEMORY.md`. Per-project truth is this file + `.cursor/rules`. WSL/UNC: do not move agent to WSL root — use `wsl`/UNC. Git: inspect `git remote -v` first; WSL only for `origin.cursor.com`, native Windows Git for `github.com` and others.

Local-first infinite whiteboard built with React 19, Vite 7, TypeScript, and peer-to-peer Yjs sync over WebRTC. Self-hosted: `review-host` (Rust) serves the UI and a stateless signaling hub; an optional Cloudflare Worker (`cloudflare/`, `review-hub`) runs the same hub only (no UI) on Workers + Durable Objects. No server stores or relays board data. Desktop app in `electron/` (Electron) runs the same host binary beside it; Android stays in `src-tauri/` (Tauri 2).

## Git operations

- **Primary remote is GitHub:** `https://github.com/PetrosyanDobryakov/ReView` on tip branch **`dev-warexpor`**. Day-to-day `git push` goes there. Cursor Origin is **not** primary (Project Origin ownership / admin is unreliable for Warexpor).
- **Tip-only (Warexpor):** land product work on `dev-warexpor` directly — `git fetch origin dev-warexpor` and update to tip before editing. **No feature-branch PRs** unless Warexpor explicitly asks for a PR. Do not open `cursor/…` branches for normal tip ships.
- **`dev-petrosyan`:** never delete, rename, archive, force-push, or “clean up” `dev-petrosyan` / `origin/dev-petrosyan`. It is Petrosyan’s branch; leave it alone even when stale.
- Use WSL for Git only if a remote is still on `origin.cursor.com`. For `github.com`, use native Git / `gh`.
- Check `git remote -v` before choosing the Git environment.
- Optional GitHub `main` catch-up: `bash scripts/sync-github.sh` (pushes tip to `dev-warexpor` + `main`). Run only when Warexpor asks to FF `main`.
- Cloudflare: `bash scripts/deploy.sh` (= `hub`) publishes Worker `review-hub` from `cloudflare/wrangler.toml`: signaling hub only, no UI (one Durable Object `SignalRoom` per room, hibernating sockets, stores nothing). Same wire format as review-host; keep both in step. `deploy.sh spa` publishes the optional static UI copy `review` (root `wrangler.toml`). Builds join extra hubs from `VITE_HUBS`. Doc-only / agent-notes ships usually **push tip without deploy** unless Warexpor asks to publish.

## Versioning

Semver lives in `package.json` (and matching `package-lock.json`). Current line is `0.15.x` (tip patch moves often; read `package.json`, do not hard-code `N` in notes).

1. **Every ship that changes product behavior, agent-facing ship docs (`AGENTS.md`, deploy gotchas), or ships to preview** bumps the version and adds a `CHANGELOG.md` section for that version. Do not reuse a version string already on `dev-warexpor` / live.
2. **Patch** (`0.15.N` → `0.15.N+1`) for fixes and polish. **Minor** only when Warexpor JR asks. Do not invent majors.
3. **After every version bump:** push `dev-warexpor` to GitHub. If the Cloudflare workers are in use, also `bash scripts/deploy.sh all`. Never leave https://review.zpro-driftman.workers.dev/ ahead of `origin/dev-warexpor` as the normal state after a product ship.
4. **`main`:** fast-forward only when Warexpor explicitly says the tip is stable enough — not automatic on every patch.
5. **One tip lineage:** work from latest `origin/dev-warexpor`. If two agents race the same next version, rebase and take the next free patch — do not publish duplicate `0.15.N` tips.
6. **Verify live:** Home `v{version}+{sha}` / `node scripts/check-live-version.mjs` / `<meta name="review-build">` should match the pushed tip after deploy.

## Cursor Cloud specific instructions

### Prerequisites

- Node 20+ (the cloud snapshot ships Node 22).
- No secrets or external services are required for basic development and testing.

### Commands

| Task | Command |
| --- | --- |
| Install dependencies | `npm ci` |
| Dev server (Vite + hub) | `npm run dev` |
| Hub only | `npm run server` (Rust `review-host` binary; `scripts/rust-server.mjs`) |
| Self-host (UI + hub on :1234) | `npm run host` |
| Run tests | `npm test` (includes `scripts/p2p-test.mjs`: mesh against a real review-host) |
| Browser e2e | `npm run test:e2e` (two headless Chromium contexts sync over WebRTC); `E2E_HUB=cloudflare node scripts/p2p-e2e.mjs` serves the UI statically with the Worker as the only hub |
| Cloudflare hub test | `npm run test:cf` (`cloudflare/worker.ts` under `wrangler dev`) |
| Desktop app | `npm run desktop` / `npm run desktop:build` (installers in `release/`); e2e `npm run test:desktop` (needs a display) |
| Production build | `npm run build` |
| Preview production build | `npm run preview` |

The dev server starts automatically in the **dev** terminal. Vite listens on port **5173**; review-host (signaling hub, `/signal/<room>`) on port **1234**. Per-board rooms are `review-<boardId>`. The desktop app's embedded host uses **4455**.

### Testing changes

1. **Unit / integration tests:** `npm test` — many node scripts (store, paste, engine, board-size, awareness, calc, p2p, …); no browser required. `scripts/p2p-test.mjs` builds and boots an ephemeral review-host on a random port (needs `cargo`).
2. **Manual UI testing:** open `http://localhost:5173` in the browser. Home is `/`; boards are `/board/:id`. Draw, add stickies, paste images, and verify persistence after refresh (IndexedDB key `review-v1-<boardId>`).
3. **Remote / save toggle:** on home, «Save others’ boards» defaults **on** (no server keeps a copy). With it off, opening a remote board shows «Session only» / «Save locally» until saved.
4. **Sync testing:** open the same board URL in a second browser profile (or another device on the LAN); Settings → Connection shows the link (path, RTT, bytes) and hubs. Console: `reviewP2p()`.

### Gotchas

- `localhost` and `127.0.0.1` are different origins — IndexedDB will not follow you between them. Pick one and stay there.
- **Architecture:** board data moves only over WebRTC data channels between peers (`src/net/p2p/`: `mesh.ts` = Yjs sync + awareness + relay via neighbours, `webrtcLink.ts`, `hub.ts`, `protocol.ts` frames + 16 KiB chunks). Hubs (`rust/review-host/src/hub.rs`, and its Workers twin `cloudflare/worker.ts`) only introduce peers and forward SDP/ICE; binary frames are refused and empty rooms vanish immediately. A link survives its hub dying. Do not add any server-side board storage or data relay; that is a product rule, not an omission.
- **Media:** images, videos and doc pages are blobs by SHA-256 (`src/core/blobs.ts`, `mediaBlobs.ts`); shapes carry `blob`/`thumb`/`mime`/`bytes` (`pageBlobs`/`pageThumbs` for docs), not bytes. Use `mediaUrl(v)` / `docPageUrl(v, i)` / `docPageCount(v)` from `shapes.ts` instead of reading `src`/`pages`, which only legacy shapes have. Missing bytes come from peers (`Mesh.fetchBlob`, frames 0x08-0x0a, paced, hash-checked) and every member prefetches the board's media (`store.ts`). Do not put media bytes back into the Y.Doc.
- **Hub discovery:** the page's own origin if it is a review-host (`GET /lan` with `service: "review-host"`), else `:1234` on the same hostname (dev), the desktop shell's host (`host_info` IPC), mDNS LAN hosts from `/lan.hosts`, build-time hubs (`VITE_HUBS`, tagged built-in), public Nostr relays (`DEFAULT_RELAYS` in `hubs.ts`, `nostr+wss://…`, `src/net/p2p/nostrHub.ts`: ephemeral sealed handshakes only, switch `prefs.p2pRelays`), user hubs (`prefs.p2pHubs`), and `#hub=` invite hints. https pages cannot use `ws://` hubs except loopback (shown as blocked).
- **ICE:** public STUN by default (`prefs.p2pIce`, null = defaults, [] = LAN only). TURN fallback: hubs that serve `/turn` (the Cloudflare hub, TURN key in Worker secrets `TURN_KEY_ID` / `TURN_KEY_TOKEN`) hand out 24 h Cloudflare TURN credentials; peers pass them on over signaling (`src/net/p2p/turn.ts`, `prefs.p2pTurn`). TURN only forwards the encrypted stream when no direct pair works; it is not a board relay.
- **Desktop:** Electron (`electron/main.cjs`) spawns `review-host` (shipped in `resources/bin`, dev: `rust/target/{release,debug}`) and loads `http://127.0.0.1:<port>/` from it. IPC is one `review` channel (`electron/preload.cjs` → `window.reviewDesktop.invoke`), answered only for loopback page origins; `src/net/p2p/desktop.ts` falls back to Tauri `invoke` on Android. Board files: `<data>/boards/<id>.review` + `.json` (`<data>` = the folder the user picked on first launch, pointer in `<config>/location.json`; also holds `blobs/` and the browser profile `.review-app/`; old `dev.zpro.review` data moves in at startup), restored on boot when IndexedDB lacks them; compaction rewrites the file without merging the old one back. Media files: `<data>/blobs/<ab>/<sha256>` (`<mime>\n<bytes>`, commands `blob_save` / `blob_load`). Release: `p2p-desktop-v*` tag → `.github/workflows/desktop-release.yml` (electron-builder).
- **Net debug logs:** **off by default**, console only. Client: `?netDebug=1` (or `?netLog=1`), Settings → System, `localStorage.REVIEW_NET_DEBUG='1'`, or Console `reviewNetDebug(true)`. Host: `--verbose` / `REVIEW_VERBOSE=1` prints joins, leaves and frame sizes.
- Remote boards skip IndexedDB only when the home toggle is off and the user has not clicked Save locally.
- UI defaults to Russian; English and Chinese are available in settings (`ru` / `en` / `zh`).
- Product / design intent: `PRODUCT.md`, `DESIGN.md`. Hosting notes: `docs/DEPLOY.md`; desktop: `docs/DESKTOP.md`. Optional `VITE_HOST_PORT` (dev hub port).

## Communication

- Never use emojis in any output — no emoji characters, unicode emoji, or emoji-like emoticons. Use plain text only in all responses, commits, comments, and docs.
