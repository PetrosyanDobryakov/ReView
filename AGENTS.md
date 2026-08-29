# Доска (ReView) — agent notes

> Global (ported from `~/.cursor/AGENTS.md` → `~/.grok/AGENTS.md`): No extra global drive. Cursor defaults + pstack + project index at `~/.cursor/PROJECTS.md` (mirrored to `~/.claude/PROJECTS.md`). Old handoffs at `~/.cursor/SESSION-MEMORY.md`. Per-project truth is this file + `.cursor/rules`. WSL/UNC: do not move agent to WSL root — use `wsl`/UNC. Git: inspect `git remote -v` first; WSL only for `origin.cursor.com`, native Windows Git for `github.com` and others.

Local-first infinite whiteboard built with React 19, Vite 7, TypeScript, and optional Yjs sync.

## Git operations

- Use WSL for Git operations only when the remote URL is hosted on `origin.cursor.com`.
- For GitHub (`github.com`) and all other remotes, use native Windows Git from this workspace; do not route the operation through WSL.
- Check `git remote -v` before choosing the Git environment. Do not infer the host from the repository name or apply the Cursor Origin rule to GitHub.

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
- Sync is optional; local boards work fully offline with IndexedDB persistence.
- Sync client lives in `src/net/` (WebSocket + Yjs awareness). Friend path is same Wi‑Fi / LAN: Members → copy invite (uses `GET /lan` on the sync server). Settings → System → Connection shows LAN IPs. Tailscale is optional for remote-only — see `docs/DEPLOY.md`.
- Live sync smoke test: with server up, `npm run test:sync`.
- **Net debug logs:** **off by default** on client and server. Client: `?netLog=1`, Settings → System → Connection, or `localStorage.setItem('review-net-log','1')`. Server file logging and `GET`/`POST /net-log` run only when `REVIEW_NET_LOG=1`/`true` — otherwise those routes return 404 and `logs/net/` is not created. When enabled: console `[review:net]` + session files under `logs/net/`. Pointers: `logs/net/CURRENT`, `logs/net/latest.log`, and `logs/net/session-<stamp>.log`. `GET /net-log` returns relative paths only (`logs/net/...`). Websocket + `GET /lan` stay available. Empty rooms are GC'd after ~5 minutes (`REVIEW_ROOM_GC_MS`).
- Remote boards do not write IndexedDB unless the home toggle is on or the user clicks Save locally.
- **Room DELETE:** `DELETE /room/<name>` is loopback-only (`127.0.0.1` / `::1` / IPv4-mapped) or `REVIEW_COMPACT_TOKEN` / `REVIEW_ROOM_DELETE_TOKEN` via `X-Review-Compact-Token` / `X-Review-Room-Delete-Token` / `Authorization: Bearer`. Compaction prefers `http://127.0.0.1:<syncPort>` so a host UI opened via LAN IP can still compact; it does not fall back to an open LAN DELETE. Unauthorized requests get `403 { ok: false }`. Never trust `X-Forwarded-For` for this check.
- UI defaults to Russian; English and Chinese are available in settings.
- Production / VM notes: `docs/DEPLOY.md`. Optional `VITE_SYNC_URL`.

## Communication

- Never use emojis in any output — no emoji characters, unicode emoji, or emoji-like emoticons. Use plain text only in all responses, commits, comments, and docs.
