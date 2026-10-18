# Hosting ReView yourself

ReView is self-hosted and peer to peer. There is no ReView cloud and no sync server that holds boards.

- **Board data** goes straight between devices over WebRTC data channels and is stored only on those devices: IndexedDB in a browser, plus plain files in the desktop app.
- **`review-host`** (Rust, `rust/review-host`) is the only server piece. It does three small jobs:
  1. serves the web UI (`dist/`) so friends can open it in a browser;
  2. runs a **signaling hub** at `/signal/<room>`. The hub tells peers in the same board who else is there and passes their WebRTC handshake (offer, answer, ICE candidates). It refuses binary frames, never sees board content, and forgets a room the moment its last peer leaves;
  3. finds other hosts on the LAN with mDNS (`_review._tcp`), so devices on the same Wi-Fi find each other without typing addresses.
- **The desktop app** (`src-tauri/`) embeds the same host. Whoever runs the app is a host. See [DESKTOP.md](DESKTOP.md).

Once two peers are connected, the hub is no longer involved: if it goes away, open links keep syncing.

## Quick start (one machine, friends on the same Wi-Fi)

```bash
npm ci
npm run host          # builds dist/ and runs review-host with the UI on :1234
```

The banner prints `http://<lan-ip>:1234/`. Open it, create a board. To invite friends, use **Members → Copy link for friends** or **Settings → System → Connection (P2P)**. They open `http://<lan-ip>:1234/board/<id>` in any modern browser. Their browser loads the UI from your host, joins the hub on the same address, and then talks to you directly.

If a phone cannot load the page, allow `review-host` (or the ReView app) through the OS firewall on private networks.

## Development

```bash
npm run dev           # Vite on :5173 + review-host (hub only) on :1234
```

In dev the page comes from Vite and the client finds the hub on `:1234` of the same hostname (`VITE_HOST_PORT` to change it). Invite links use the Vite port.

## review-host reference

```bash
cargo run --manifest-path rust/Cargo.toml -p review-host -- --dist dist
# or: node scripts/rust-server.mjs --dist dist
```

| Flag / env | Default | Meaning |
| --- | --- | --- |
| `--dist <dir>` / `REVIEW_DIST` | none | Serve the built UI. Without it the host is a hub only. |
| `--port <n>` / `REVIEW_PORT` (`REVIEW_SYNC_PORT` still read) | `1234` | Listen port. |
| `--host <addr>` / `REVIEW_HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` to keep it off the LAN. |
| `--name <text>` / `REVIEW_NAME` | hostname | Name other peers see in their hub list. |
| `--no-mdns` / `REVIEW_MDNS=0` | on | Turn LAN discovery off. |
| `--verbose` / `REVIEW_VERBOSE=1` | off | Print joins, leaves and frame sizes. |

Routes:

- `GET /signal/<room>?peer=<id>`: websocket hub. Room names are `review-<boardId>` (letters, digits, `.`, `_`, `-`, max 200). Peer ids are 6 to 64 of `[A-Za-z0-9_-]`. Text frames up to 64 KB. Limits are 1024 rooms and 64 peers per room. The wire format is in `rust/review-host/src/hub.rs`.
- `GET /lan`: `{ service: "review-host", proto, id, name, port, addresses, mdns, ui, hosts }`. `hosts` lists other review-hosts found on the LAN. CORS is open, and `Access-Control-Allow-Private-Network` is sent.
- `GET /health`: `{ ok, service, proto, rooms, peers }`. These are live counts only; nothing is persisted.
- Everything else serves `--dist` with SPA fallback (`/board/<id>` → `index.html`).

The host writes nothing to disk.

## Friends outside your network

WebRTC needs both sides to reach some hub, then tries a direct path.

1. **Virtual LAN (simplest).** Put everyone on Tailscale or ZeroTier and share `http://<mesh-ip>:1234/board/<id>`. Everything else is the same as on a LAN.
2. **Public host.** Run `review-host --dist dist` on a VPS behind TLS (example below) and share `https://board.example/board/<id>`. The VPS only introduces peers. Board data still goes browser to browser.
3. **Friend's hub.** In **Settings → System → Connection (P2P) → Friend's hub**, add another host's address (`192.168.1.20:1234`, `ws://100.64.0.5:1234`, `wss://board.example`). Your tab joins that hub as well as your own. Invite links can also carry a hub: `…/board/<id>#hub=<address>`.

**NAT traversal.** By default the client asks public STUN servers (`stun.l.google.com`, `stun.cloudflare.com`) for its public address. STUN only answers "what is my address" and carries no data. Clear the STUN list in **Connection (P2P) → Advanced** for LAN-only use.

**No relay by default.** Some networks (strict corporate NAT, some mobile carriers) block every direct path. ReView does not relay board data through any server. If you want that fallback, run your own TURN (coturn) and add `turn:host:3478|user|pass` in **Connection (P2P) → Advanced**; the panel then shows such links as "via TURN".

### nginx in front of review-host

```nginx
server {
  listen 443 ssl;
  server_name board.example;

  location / {
    proxy_pass http://127.0.0.1:1234;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

Run review-host with `--host 127.0.0.1 --no-mdns` there.

**Mixed content.** An `https://` page cannot open `ws://` sockets to other machines. On an https origin, add other hubs as `wss://`. The P2P panel marks blocked hubs.

## Where boards live

- **Browser:** IndexedDB `review-v1-<boardId>`, per origin. `localhost`, `127.0.0.1` and a LAN IP are three different origins with three separate storages.
- **Desktop app:** IndexedDB, plus `<app data>/boards/<id>.review` (Yjs snapshot) and `<id>.json` (name, team). The files are the durable copy. If the webview storage is lost, boards are restored from them on launch. **Settings → System → Connection (P2P) → Boards folder** opens the folder.
- **Joined boards** are saved by default («Save others' boards» on Home), because no server keeps a copy. With it off, a joined board lasts only for the tab session.
- **A board exists only while some device has it.** If you are alone and offline, your copy is the only one. **Export** writes a `.review` file you can import anywhere.

## Cloudflare hub (introductions only)

`cloudflare/` deploys the Worker **review-hub**. It is the same signaling hub as review-host, written for Workers, and it serves **no web UI**: people keep hosting the UI themselves (review-host, the desktop app, or any static host). Use it when friends are on different networks and nobody wants to run a VPS.

```bash
npm ci
npx wrangler login          # once, or set CLOUDFLARE_API_TOKEN
bash scripts/deploy.sh hub  # = npx wrangler deploy -c cloudflare/wrangler.toml
```

Wrangler prints the hub address, for example `https://review-hub.<account>.workers.dev`. Clients connect to it as `wss://review-hub.<account>.workers.dev`. To use it, do any of these:

- **Build it into your UI:** `VITE_HUBS=wss://review-hub.<account>.workers.dev npm run build` (or `npm run host`). Every page from that build joins it, and the P2P panel lists it as "built-in". Separate several hubs with commas.
- **Add it by hand:** Settings → System → Connection (P2P) → Friend's hub.
- **Put it in an invite:** `…/board/<id>#hub=wss://review-hub.<account>.workers.dev`.

A page joins every hub it knows. A review-host on your LAN and the Cloudflare hub work together.

- **Routes:** `/signal/<room>` (one Durable Object `SignalRoom` per room) and `/health`. Everything else returns 404. There is no `/lan`, no UI and no mDNS.
- **Behavior matches review-host:** the same wire format, 64 peers per room, 64 KB text frames, binary refused, and silent sockets dropped after 75 s.
- **Nothing is stored.** Sockets hibernate, and the object keeps no data. The only write is an alarm that sweeps dead sockets while a room has members. A room forgets everyone once its last socket closes.
- **Cost:** the runtime answers `{"t":"ping"}` (every 20 s per tab) without waking the object. Only joins and WebRTC handshakes are billed, which is tens of small messages per link. Board data never passes through Cloudflare.
- **Not done:** relaying (no TURN). `HUB_NAME` in `cloudflare/wrangler.toml` sets the name peers see (default `Cloudflare`).

Test locally with `npm run test:cf` (a protocol test under `wrangler dev`) and `npm run build && E2E_HUB=cloudflare node scripts/p2p-e2e.mjs`. The e2e test serves the UI from a plain static server, and the Worker is the only hub.

## Optional static copy of the UI

`bash scripts/deploy.sh spa` publishes `dist/` to the Worker `review` (Assets only, root `wrangler.toml`). A static https copy has no hub of its own, so build it with `VITE_HUBS=wss://…`, or add a `wss://` hub in the P2P panel.
