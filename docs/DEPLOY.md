# Deploy

ReView is a static Vite build plus optional sync. It runs on Vercel **and Cloudflare Pages** with no server — boards live in IndexedDB and are shared as files.

## Vercel (recommended static)

1. Import the repo on Vercel — it runs `npm run build` and serves `dist/` (see `vercel.json` for SPA rewrites).
2. Open `https://your-app.vercel.app/` — create boards, draw, refresh to confirm persistence (IndexedDB `review-v1-<boardId>`).
3. Share a board: on the board header click the download icon (or Home → per-board export) to get a `.review.json` file; send it to a friend who uses **Home → Import** to open it as a new local board.
4. P2P: both sides open the same board URL (same `<boardId>`). On Pages/Vercel, y-webrtc starts on its own via `wss://signaling.yjs.dev`. Override with `VITE_P2P_SIGNALING` or Settings → Signaling. LAN/self-host still needs **Settings → System → Connection → P2P (WebRTC)** turned on.

No backend storage is used on Vercel. The public board is the static SPA; each browser keeps its own copies and shares via files.

## Cloudflare Pages / Workers Static Assets

Same static build, same P2P/file-share flow. Do not add `public/_redirects` with `/* /index.html 200`. Wrangler uploads `dist` as Workers static assets, and `html_handling` strips `.html` / `/index`. That splat rewrite then matches again and Cloudflare rejects the deploy with error 100324 (infinite redirect loop).

### Canonical tip deploy (SPA + sync)

Two Workers stay separate on purpose:

| Worker | Config | Live URL |
|--------|--------|----------|
| **review** | root `wrangler.toml` (SPA Assets) | `https://review.zpro-driftman.workers.dev/` |
| **review-sync** | `worker/wrangler.toml` (Durable Object) | `https://review-sync.zpro-driftman.workers.dev/` |

Do **not** merge them into one wrangler project: DO migrations and the public `wss://review-sync…` URL already ship as `review-sync`.

From tip (`dev-warexpor`), one command deploys both idempotently:

```bash
export CLOUDFLARE_ACCOUNT_ID=3058d81da41b02e06744d5d058570aab
# CI / agents (preferred):
export CLOUDFLARE_API_TOKEN=…   # Account API Token — see “Auth” below
bash scripts/deploy.sh all
# or: npm run cf:deploy:all
```

`scripts/deploy.sh` order: **review-sync** first, then **review** (SPA). Targets: `all` (default), `spa`, `sync`.

Local fallback without a token: `npx wrangler login` once, then the same script (OAuth).

Verify:

```bash
node scripts/check-live-version.mjs
curl -sS https://review-sync.zpro-driftman.workers.dev/health
```

### Auth (persistent)

| Context | How |
|---------|-----|
| CI / cloud agents / CF Builds | Env **`CLOUDFLARE_API_TOKEN`** + **`CLOUDFLARE_ACCOUNT_ID=3058d81da41b02e06744d5d058570aab`** |
| Laptop / coordinator with interactive login | Wrangler OAuth (`wrangler login`) — no token required |

Token: Cloudflare dashboard → **My Profile** → **API Tokens** → Create Token with Workers Scripts Edit (and Workers KV/D1/DO as needed for this account). Name it something like `review-wrangler-deploy`. Paste the value only into CI secrets / agent env — never into chat or git.

Account id is public for this project: `3058d81da41b02e06744d5d058570aab` (Zpro.driftman).

### Workers Builds — deploy must actually deploy

Preview was stuck on old builds while git tip moved because Worker **review** Builds **Deploy command** was `echo done` (build uploads nothing). Re-confirmed on tip `442924b` Builds (`deployCommand: echo done`, build UUID `53ec9a69-3064-45a7-802c-4ac12ff3f055`). Live can still match tip when someone runs `bash scripts/deploy.sh all` manually — Builds green-check alone does **not** ship. The Builds MCP/API available to agents is **read-only** — Warexpor must change this in the dashboard once.

**Dashboard click path (Zpro account `3058d81da41b02e06744d5d058570aab`):**

1. Cloudflare dashboard → Workers & Pages → Worker **`review`**
2. **Settings** → **Builds** (or Build configuration)
3. Edit **Deploy command** from `echo done` → `bash scripts/deploy.sh all`
4. Save; next push to the watched branch should deploy both **review** and **review-sync**

**Worker `review`** → Settings → Builds:

| Setting | Value |
|---------|--------|
| Root directory | `/` (repo root) |
| Install command | `npm ci && cd worker && npm ci` |
| Build command | `npm run build` |
| **Deploy command** | **`bash scripts/deploy.sh all`** (not `echo done`) |
| Watch paths / branch | `dev-warexpor` (and production branch if used) |

That single Builds project publishes **both** Workers after each tip push. Alternative: Deploy command `npx wrangler deploy` (SPA only) **and** enable a second Builds trigger on Worker **review-sync** with Install `cd worker && npm ci`, Build empty/`true`, Deploy `cd worker && npx wrangler deploy`.

After the next green build:

```bash
node scripts/check-live-version.mjs
# or: curl -sS https://review.zpro-driftman.workers.dev/ | grep review-build
```

Home header shows `v{version}+{sha}`. HTML includes `<meta name="review-build" content="…">`.

1. Repo-root `wrangler.toml` has `[build] command = "npm run build"`, `[assets] directory = "./dist"`, and `not_found_handling = "single-page-application"`. That SPA fallback serves `/board/:id`. Do not also put a `/* /index.html` redirect in wrangler.
2. Manual / agent ship: `bash scripts/deploy.sh all` (or `npm run cf:deploy:all`). Partial: `cf:deploy:spa` / `cf:deploy:sync`. Legacy: `npx wrangler deploy` (SPA) and `cd worker && npx wrangler deploy` (sync).
3. Vite still copies `public/_headers` to `dist/` so `/assets/*` gets `Cache-Control: immutable` and HTML routes stay `no-cache`.
4. Open the Worker URL — persistence, file share and P2P work as on Vercel. `workers.dev` / `pages.dev` are in `STATIC_HOSTS`, so LAN `ws://host:1234` is not attempted, and P2P is on unless the user turns it off.


## Self-hosted

## Friends on the same Wi‑Fi / LAN

This is the default collab path.

1. Host runs `npm run dev` (or serves `dist/` + `npm run server`).
2. Host opens the board, opens **Members** (top right) → **Copy link for friends**, or Settings → Connection → **On this network**.
3. Friends open that `http://<lan-ip>:5173/board/<id>` link on the same network.
4. Sync follows automatically (`ws://<same-ip>:1234`). No Sync URL paste needed.

The sync server binds `0.0.0.0:1234` and exposes `GET /lan` with private IPv4 addresses so a host on `localhost` can still copy a usable invite. If phones cannot connect, allow Node through the OS firewall on private networks.

Do **not** expose port `1234` to the public internet unprotected. File logging (`GET`/`POST /net-log`) is off unless `REVIEW_NET_LOG=1`. `DELETE /room/<name>` (host-side compaction) is **not** a LAN API: it requires a loopback client (`127.0.0.1` / `::1`) or `REVIEW_COMPACT_TOKEN` / `REVIEW_ROOM_DELETE_TOKEN` (`X-Review-Compact-Token`, `X-Review-Room-Delete-Token`, or `Authorization: Bearer`). Unauthorized DELETE returns `403 { ok: false }`. Invalid room names return `400`. Websocket payloads are capped at 32 MB (same as `.review` export). `GET /health` reports room count, payload cap, and GC window. The Cloudflare worker allows unauthenticated DELETE only when the room has zero sockets (occupied rooms still need the secret).

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

Listens on `0.0.0.0:1234`. Rooms are per board: `review-<boardId>` (letters, digits, `.`, `_`, `-`; max 200 chars). The browser connects to `ws(s)://<same-host>:1234`. Websocket messages up to 32 MB. Empty in-memory rooms are GC'd after 5 minutes (`REVIEW_ROOM_GC_MS`). Cap live rooms with `REVIEW_MAX_ROOMS` (default 512).

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
