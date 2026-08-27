# Deploy (self-hosted)

ReView is a static Vite build plus an optional websocket sync server. No cloud account.

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

## Remote friends (optional virtual LAN)

Same hub — not required for same Wi‑Fi. Use Tailscale / ZeroTier only when friends are not on your LAN: join a mesh, then share the mesh IP the same way as a LAN invite (`http://<mesh-ip>:…`). Guests still should open the app from that IP so sync auto-targets it.

WebRTC / true browser P2P is out of scope.

## Persistence honesty

- Local and shared boards write to IndexedDB `review-v1-<boardId>`.
- Remote boards do **not** write to disk unless:
  - the home toggle «Save others’ boards» is on, or
  - the user clicks «Save locally».
- Board list weight on `/` is the approximate IndexedDB size for that board.
