# Доска (ReView) — agent notes

Local-first infinite whiteboard built with React 19, Vite 7, TypeScript, and optional Yjs sync.

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
- **Net debug logs:** **on by default.** Console `[review:net]` + session files under `logs/net/` (written by the sync server). Pointers: `logs/net/CURRENT`, `logs/net/latest.log`, and `logs/net/session-<stamp>.log`. Disable with `?netLog=0`, Settings → System → Connection, or `localStorage.setItem('review-net-log','0')`. Client POSTs batches to `http://<sync>:1234/net-log`; server also records ws connect/disconnect. `GET /net-log` returns the active file path.
- Remote boards do not write IndexedDB unless the home toggle is on or the user clicks Save locally.
- UI defaults to Russian; English and Chinese are available in settings.
- Production / VM notes: `docs/DEPLOY.md`. Optional `VITE_SYNC_URL`.
