# Deploy (self-hosted)

ReView is a static Vite build plus an optional websocket sync server. No cloud account.

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

Listens on port `1234`. Rooms are per board: `review-<boardId>`. The browser connects to `ws(s)://<same-host>:1234`.

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

## Virtual LAN (recommended for remote friends)

Keep the same WebSocket hub — do **not** expose port `1234` to the public internet unprotected.

1. Host and guests join a private mesh (Tailscale, ZeroTier, or similar).
2. Host runs `npm run server` (or `npm run dev`).
3. Guests open the app and set Sync URL to `ws://<host-mesh-ip>:1234` (or `wss://` if you terminate TLS).
4. Share a board link; room name stays `review-<boardId>`.

WebRTC / true browser P2P is out of scope for now — the mesh + local hub path is the supported side option.

## Persistence honesty

- Local and shared boards write to IndexedDB `review-v1-<boardId>`.
- Remote boards do **not** write to disk unless:
  - the home toggle «Save others’ boards» is on, or
  - the user clicks «Save locally».
- Board list weight on `/` is the approximate IndexedDB size for that board.
