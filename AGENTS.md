# (ReView) — agent notes

> Global (ported from `~/.cursor/AGENTS.md` → `~/.grok/AGENTS.md`): No extra global drive. Cursor defaults + pstack + project index at `~/.cursor/PROJECTS.md` (mirrored to `~/.claude/PROJECTS.md`). Old handoffs at `~/.cursor/SESSION-MEMORY.md`. Per-project truth is this file + `.cursor/rules`. WSL/UNC: do not move agent to WSL root — use `wsl`/UNC. Git: inspect `git remote -v` first; WSL only for `origin.cursor.com`, native Windows Git for `github.com` and others.

Local-first infinite whiteboard built with React 19, Vite 7, TypeScript, and optional Yjs sync.

## Git operations

- **Primary remote is GitHub:** `https://github.com/PetrosyanDobryakov/ReView` on tip branch **`dev-warexpor`**. Day-to-day `git push` goes there. Cursor Origin is **not** primary (Project Origin ownership / admin is unreliable for Warexpor).
- Use WSL for Git only if a remote is still on `origin.cursor.com`. For `github.com`, use native Git / `gh`.
- Check `git remote -v` before choosing the Git environment.
- Optional GitHub `main` catch-up: `bash scripts/sync-github.sh` (pushes tip to `dev-warexpor` + `main`).
- Live deploy from tip: `bash scripts/deploy.sh all` (coordinator Wrangler OAuth; no API-token nag).

## Versioning

Semver lives in `package.json` (and matching `package-lock.json`). Current line is `0.15.x`.

1. **Every ship that changes product behavior or ships to preview** bumps the version and adds a `CHANGELOG.md` section for that version. Do not reuse a version string already on `dev-warexpor` / live.
2. **Patch** (`0.15.N` → `0.15.N+1`) for fixes and polish. **Minor** only when Warexpor JR asks. Do not invent majors.
3. **After every version bump:** push `dev-warexpor` to GitHub **and** deploy the preview worker (`npx wrangler deploy` / Project wrangler). Never leave https://review.zpro-driftman.workers.dev/ ahead of `origin/dev-warexpor` as the normal state.
4. **`main`:** fast-forward only when Warexpor explicitly says the tip is stable enough — not automatic on every patch.
5. **One tip lineage:** branch from latest `origin/dev-warexpor`. If two agents race the same next version, rebase and take the next free patch — do not publish duplicate `0.15.N` tips.
6. **Verify live:** Home `v{version}+{sha}` / `node scripts/check-live-version.mjs` / `<meta name="review-build">` should match the pushed tip.

## Cursor Cloud specific instructions

### Prerequisites

- Node 20+ (the cloud snapshot ships Node 22).
- No secrets or external services are required for basic development and testing.

### Commands

| Task | Command |
| --- | --- |
| Install dependencies | `npm ci` |
| Dev server (Vite + sync) | `npm run dev` |
| Sync server only | `npm run server` |
| Run tests | `npm test` |
| Production build | `npm run build` |
| Preview production build | `npm run preview` |

The dev server starts automatically in the **dev** terminal. Vite listens on port **5173**; the Yjs websocket sync server listens on port **1234**. Per-board rooms are `review-<boardId>`.

### Testing changes

1. **Unit / integration tests:** `npm test` — store, paste, engine, and board-size checks; no browser required.
2. **Manual UI testing:** open `http://localhost:5173` in the browser. Home is `/`; boards are `/board/:id`. Draw, add stickies, paste images, and verify persistence after refresh (IndexedDB key `review-v1-<boardId>`).
3. **Remote / save toggle:** on home, «Save others’ boards» defaults off. Opening a remote board should show «Session only» / «Save locally» until saved.
4. **Sync testing:** open a second browser tab on the same board URL; both should share room `review-<id>` via the websocket server.

### Gotchas

- `localhost` and `127.0.0.1` are different origins — IndexedDB will not follow you between them. Pick one and stay there.
- Sync is optional on LAN/self-host; local boards work fully offline with IndexedDB persistence. On static hosts (`pages.dev`, `vercel.app`, …) P2P (y-webrtc) is on by default so peers on the same board URL can see each other without a websocket server.
- Sync client lives in `src/net/` (WebSocket + Yjs awareness). Friend path is same Wi‑Fi / LAN: Members → copy invite (uses `GET /lan` on the sync server). Settings → System → Connection shows LAN IPs. Tailscale is optional for remote-only — see `docs/DEPLOY.md`.
- Live sync smoke test: with server up, `npm run test:sync`.
- **Tip deploy:** `bash scripts/deploy.sh all` (or `npm run cf:deploy:all`) publishes **review-sync** then **review**. Prefer `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID=3058d81da41b02e06744d5d058570aab` in CI/agents; wrangler OAuth is the local fallback. See `docs/DEPLOY.md`.
- **Workers Builds deploy:** Worker **review** Deploy command (and non-prod deploy) must be `bash scripts/deploy.sh all` (or at least `npx wrangler deploy`). If it is `echo done`, Builds green-check while https://review.zpro-driftman.workers.dev/ keeps an old bundle. Dashboard-only fix (Builds API is read-only for agents). **Never** rename root `wrangler.toml` to `review-sync` to clear a Builds name-mismatch banner — that banner means Builds is on Worker **review-sync** with Root directory `/` instead of `worker/` (or **review** Deploy is still wrong). Prefer one Builds on **review** that runs `deploy.sh all`. Verify with `node scripts/check-live-version.mjs` or Home `v{version}+{sha}` / `<meta name="review-build">`.
- **Net debug logs:** **off by default** on client and server. Client: open a board with `?netDebug=1` (or `?netLog=1`), Settings → System → Connection, `localStorage.REVIEW_NET_DEBUG='1'`, or Console `reviewNetDebug(true)`. Expect an immediate Console warn **`[review:net] review net debug ON`**, then connect/open lines and a 5s heartbeat. Network → WS only appears after `/board/…` (socket is to `review-sync`, not the SPA host). Server file logging and `GET`/`POST /net-log` run only when `REVIEW_NET_LOG=1`/`true` — otherwise those routes return 404 and `logs/net/` is not created. When enabled: console `[review:net]` + optional session files under `logs/net/`. Websocket + `GET /lan` stay available. Empty rooms are GC'd after ~5 minutes (`REVIEW_ROOM_GC_MS`).
- Remote boards do not write IndexedDB unless the home toggle is on or the user clicks Save locally.
- **Room DELETE:** `DELETE /room/<name>` on the Node server is loopback-only (`127.0.0.1` / `::1` / IPv4-mapped) or `REVIEW_COMPACT_TOKEN` / `REVIEW_ROOM_DELETE_TOKEN` via `X-Review-Compact-Token` / `X-Review-Room-Delete-Token` / `Authorization: Bearer`. Compaction prefers `http://127.0.0.1:<syncPort>` so a host UI opened via LAN IP can still compact; it does not fall back to an open LAN DELETE. Unauthorized requests get `403 { ok: false }`. Never trust `X-Forwarded-For` for this check. Invalid room names return `400`. On the Cloudflare worker, occupied rooms follow the same token rule; **empty** rooms (0 sockets) may be DELETE'd without a token so compact after detach can wipe the Durable Object (same as the 90s empty-room GC).
- UI defaults to Russian; English and Chinese are available in settings.
- Production / VM notes: `docs/DEPLOY.md`. Optional `VITE_SYNC_URL`.

## Communication

- Never use emojis in any output — no emoji characters, unicode emoji, or emoji-like emoticons. Use plain text only in all responses, commits, comments, and docs.
