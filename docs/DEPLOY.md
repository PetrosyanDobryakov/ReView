# Deploy

ReView is a static Vite build plus optional sync. It runs on Vercel **and Cloudflare Pages** with no server — boards live in IndexedDB and are shared as files.

## Vercel (recommended static)

1. Import the repo on Vercel — it runs `npm run build` and serves `dist/` (see `vercel.json` for SPA rewrites).
2. Open `https://your-app.vercel.app/` — create boards, draw, refresh to confirm persistence (IndexedDB `review-v1-<boardId>`).
3. Share a board: on the board header click the download icon (or Home → per-board export) to get a `.review.json` file; send it to a friend who uses **Home → Import** to open it as a new local board.
4. Optional P2P: both sides open the same board URL (same `<boardId>`), then each enable **Settings → System → Connection → P2P (WebRTC)**. Sync then runs browser-to-browser via `y-webrtc` public signaling (`wss://signaling.yjs.dev`) — no server to deploy. Override with `VITE_P2P_SIGNALING`.

No backend storage is used on Vercel. The public board is the static SPA; each browser keeps its own copies and shares via files.

## Cloudflare Pages (Vercel alternative)

Same static build, same P2P/file-share flow — no adaptation needed. Cloudflare Pages is the direct Vercel equivalent.

1. Create a Pages project from the same repo — **Framework preset: Vite**, **Build command: `npm run build`**, **Build output directory: `dist`**.
2. Vite copies `public/_redirects` and `public/_headers` to `dist/` — `/* -> /index.html 200` gives the SPA rewrite (same as `vercel.json`) and `/assets/*` gets `Cache-Control: immutable`.
3. Open `https://your-app.pages.dev/` — persistence, file share and P2P work exactly as on Vercel. `pages.dev` is already in `STATIC_HOSTS` so sync/P2P detection treats it as static without trying `ws://host:1234`.

No Worker, no `wrangler.toml` needed for Pages. For Workers Static Assets you can add `wrangler.toml` with `assets.directory = "./dist"` and `not_found_handling = "single-page-application"`, but Pages is the recommended path.

## Self-hosted

## Friends on the same Wi‑Fi / LAN

This is the default collab path.

1. Host runs `npm run dev` (or serves `dist/` + `npm run server`).
2. Host opens the board, opens **Members** (top right) → **Copy link for friends**, or Settings → Connection → **On this network**.
3. Friends open that `http://<lan-ip>:5173/board/<id>` link on the same network.
4. Sync follows automatically (`ws://<same-ip>:1234`). No Sync URL paste needed.

The sync server binds `0.0.0.0:1234` and exposes `GET /lan` with private IPv4 addresses so a host on `localhost` can still copy a usable invite. If phones cannot connect, allow Node through the OS firewall on private networks.

Do **not** expose port `1234` to the public internet unprotected. File logging (`GET`/`POST /net-log`) is off unless `REVIEW_NET_LOG=1`. `DELETE /room/<name>` (host-side compaction) is **not** a LAN API: it requires a loopback client (`127.0.0.1` / `::1`) or `REVIEW_COMPACT_TOKEN` / `REVIEW_ROOM_DELETE_TOKEN` (`X-Review-Compact-Token`, `X-Review-Room-Delete-Token`, or `Authorization: Bearer`). Unauthorized DELETE returns `403 { ok: false }`.

## Build

```bash
npm ci
npm run build
```

Static files land in `dist/`. Serve them with any static host (nginx, Caddy, `python -m http.server`, Vite preview).

```bash
npm run preview   # local check of the production build
```

## Sync server (optional)

```bash
npm run server
```

Listens on `0.0.0.0:1234`. Rooms are per board: `review-<boardId>`. The browser connects to `ws(s)://<same-host>:1234`.

If the page is served over HTTPS, the client uses `wss://`. Put a reverse proxy in front of the websocket, or terminate TLS on the same host.

## Friend VM sketch

1. Install Node 20+.
2. Clone the repo, `npm ci && npm run build`.
3. Serve `dist/` on port 80/443 (nginx example below).
4. Run `node server.mjs` under systemd or pm2 for sync.
5. Open `https://your-host/` — home at `/`, boards at `/board/:id`.

### nginx

```nginx
server {
  listen 80;
  server_name board.example;
  root /var/www/review/dist;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location /ws/ {
    proxy_pass http://127.0.0.1:1234/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

If you proxy the websocket under a path, point the client at that URL. In the app: **Settings → System → Connection**, set Sync URL (or build with `VITE_SYNC_URL`). You can also disconnect sync without clearing the board.

## File share (Vercel primary path)

Each board can be saved as a `.review.json` file (Home → export per board, or the download icon on the board header). The file contains a base64 Yjs update plus metadata (name, team, pages). Import on any device via **Home → Import** — it creates a new local board with the same content. Use this when no sync server is deployed.

## Remote friends (optional virtual LAN or P2P)

Same hub — not required for same Wi‑Fi. Use Tailscale / ZeroTier only when friends are not on your LAN: join a mesh, then share the mesh IP the same way as a LAN invite (`http://<mesh-ip>:…`). Guests still should open the app from that IP so sync auto-targets it.

### P2P (WebRTC) — works on Vercel/static

Enable **P2P (WebRTC)** in Settings → System → Connection on each device. Both peers open the same `/board/<id>` URL and the `y-webrtc` provider syncs the Yjs doc over WebRTC (public signaling servers). No `server.mjs` needed. Set `VITE_P2P_SIGNALING` or the per-device Signaling server field to use a custom signaling endpoint.

## Persistence honesty

- Local and shared boards write to IndexedDB `review-v1-<boardId>`.
- Remote boards do **not** write to disk unless:
  - the home toggle «Save others’ boards» is on, or
  - the user clicks «Save locally».
- Board list weight on `/` is the approximate IndexedDB size for that board.
