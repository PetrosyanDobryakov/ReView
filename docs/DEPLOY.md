# Deploy

ReView is a static Vite build plus optional sync. It runs on Vercel **and Cloudflare Pages** with no server — boards live in IndexedDB and are shared as files.

## Vercel (recommended static)

1. Import the repo on Vercel — it runs `npm run build` and serves `dist/` (see `vercel.json` for SPA rewrites).
2. Open `https://your-app.vercel.app/` — create boards, draw, refresh to confirm persistence (IndexedDB `review-v1-<boardId>`).
3. Share a board: on the board header click the download icon (or Home → per-board export) to get a `.review.json` file; send it to a friend who uses **Home → Import** to open it as a new local board.
4. P2P: both sides open the same board URL (same `<boardId>`). On many static hosts without a dedicated sync worker (typical `vercel.app`), y-webrtc starts on its own via `wss://signaling.yjs.dev`. On `*.workers.dev` / `*.pages.dev` (including the canonical tip SPA), P2P is **off** and sync uses `review-sync` instead. Override signaling with `VITE_P2P_SIGNALING` or Settings → Signaling where P2P applies. LAN/self-host still needs **Settings → System → Connection → P2P (WebRTC)** turned on.

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

**Status (2026-09-25):** Production Deploy for Worker **review** is `bash scripts/deploy.sh all`. `main` at `60b9eb5` (0.15.53) built the SPA, then died in `scripts/build-sync-worker.sh` with `rustup is required` (builds `510b0e25-9922-4716-a898-2cb82f2a60b2`, `13f8f6a6-90a5-4ce8-857f-d505725980ee`). The Builds image is Ubuntu 24.04 with `curl` and `build-essential`, not Rust. From 0.15.54 the script installs rustup (stable, minimal, `wasm32-unknown-unknown`) when it is missing — no dashboard install command is required for that. Non-production deploy was still `echo done` on the same commit (`dev-warexpor` `6a6a00fc-6579-443d-aac4-54739691555a`, `dev-warexpor-rust` `cc5ec7ab-f135-4604-9292-92377a3745a9`), so tip pushes green-check without publishing. Set **Non-production branch deploy command** to `bash scripts/deploy.sh all`. Builds MCP/API remains **read-only** for agents. Live `0.15.53+60b9eb5` was a manual Omarchy deploy, not that failed CI run.

#### Preferred: one Builds project on Worker **review**

**Dashboard click path (Zpro account `3058d81da41b02e06744d5d058570aab`):**

1. Cloudflare dashboard → Workers & Pages → Worker **`review`** (id `3fbdea65706b420dbabd7efe946bf55b`)
2. **Settings** → **Builds**
3. Set **Deploy command** and **Non-production branch deploy command** to `bash scripts/deploy.sh all` (not `echo done`)
4. Production / watch branch: `dev-warexpor`
5. Save; next tip push should publish **review-sync** then **review**

| Setting | Value |
|---------|--------|
| Root directory | `/` (repo root) — must load root `wrangler.toml` with `name = "review"` |
| Install command | `npm ci && cd worker && npm ci` |
| Build command | `npm run build` |
| **Deploy command** | **`bash scripts/deploy.sh all`** |
| **Non-production branch deploy command** | **`bash scripts/deploy.sh all`** (or set production branch to `dev-warexpor`) |

Leave the install command as the npm install (default `npm clean-install` is enough). Do not add rustup there: `scripts/build-sync-worker.sh` installs it during the deploy step.

#### Do NOT accept the “name = 'review-sync'” banner on root `wrangler.toml`

That banner means Builds is bound to Worker **review-sync** while Root directory is still the **repo root** (SPA config `name = "review"`). CI overrides the name and can upload SPA `dist/` as a **review-sync** version (log: “Failed to match Worker name… Overriding using the CI provided Worker name”). Confirmed on tip `e51661d`, build UUID `8f1f8215-fe10-4b50-a1dd-f10470218167` (`npx wrangler versions upload`).

**Never** rename root `wrangler.toml` to `review-sync` — that would break https://review.zpro-driftman.workers.dev/.

| If you see the banner on… | Correct action |
|---------------------------|----------------|
| Worker **review-sync** | Set **Root directory** to `worker` (reads `worker/wrangler.toml`, already `name = "review-sync"`). Prefer **disabling** Builds on **review-sync** and deploying both from Worker **review** via `deploy.sh all`. |
| Worker **review** | Keep `name = "review"`. Fix Deploy / non-prod deploy to `bash scripts/deploy.sh all`. |

#### Optional second Builds on Worker **review-sync**

Only if you want a separate trigger (not required when **review** runs `deploy.sh all`):

| Setting | Value |
|---------|--------|
| Root directory | **`worker`** (not `/`) |
| Install | `npm ci` |
| Build | empty / `true` |
| Deploy | `npx wrangler deploy` — builds the Rust Durable Object (`scripts/build-sync-worker.sh`), not SPA `npm run build` |

After a green **review** build with the real Deploy command:

```bash
node scripts/check-live-version.mjs
# or: curl -sS https://review.zpro-driftman.workers.dev/ | grep review-build
```

Home header shows `v{version}+{sha}`. HTML includes `<meta name="review-build" content="…">`.

1. Repo-root `wrangler.toml` has `[build] command = "npm run build"`, `[assets] directory = "./dist"`, and `not_found_handling = "single-page-application"`. That SPA fallback serves `/board/:id`. Do not also put a `/* /index.html` redirect in wrangler.
2. Manual / agent ship: `bash scripts/deploy.sh all` (or `npm run cf:deploy:all`). Partial: `cf:deploy:spa` / `cf:deploy:sync`. Legacy: `npx wrangler deploy` (SPA) and `cd worker && npx wrangler deploy` (sync). Sync deploy compiles `worker/` with `worker-build` and uploads the Rust wasm Durable Object. `worker/src/index.ts` is not the wrangler entry.
3. Vite still copies `public/_headers` to `dist/` so `/assets/*` gets `Cache-Control: immutable` and HTML routes stay `no-cache`.
4. Open the Worker URL — persistence and file share work as on Vercel. Canonical tip SPA uses built-in `wss://review-sync.zpro-driftman.workers.dev` (not LAN `:1234`). On `*.workers.dev` / `*.pages.dev`, **P2P is forced off** in `src/net/config.ts` so clients do not also hit `signaling.yjs.dev`. Pure static hosts without that DO URL (e.g. many `vercel.app` deploys) still default P2P on.


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
4. Run `npm run server` (the Rust `review-sync` binary) under systemd or pm2 for sync. `REVIEW_SYNC_MODE=worker` is the disk-backed personality; the default mode matches the old in-memory Node server.
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
