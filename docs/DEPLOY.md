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

## Cloudflare (UI + hub, no server of your own)

`wrangler.toml` deploys the Worker **review**: the web UI from Workers Assets, plus the same signaling hub as review-host, written for Workers (`cloudflare/worker.ts`).

```bash
npm ci
bash scripts/deploy.sh      # npm run build, then wrangler deploy (needs a Cloudflare login)
```

Open `https://<worker>.workers.dev/board/<id>` and share that link. The page finds its own hub through `/lan`, the same way it does on review-host, and connects over `wss://`, so nothing needs configuring.

- **Hub:** `/signal/<room>` routes each room to its own Durable Object (`SignalRoom`). Wire format, limits (64 peers per room, 64 KB text frames, binary refused) and the 75 s idle drop all match review-host.
- **Nothing is stored.** Sockets use the hibernation API and the object keeps no data. The only thing written is the alarm that sweeps dead sockets while a room has members. A room forgets everyone once its last socket closes.
- **Cost:** `{"t":"ping"}` (every 20 s per tab) is answered by the runtime without waking the object. What gets billed is joins and the WebRTC handshake, which is tens of small messages per link. Board data never passes through Cloudflare, and drawing costs nothing.
- **What it does not do:** LAN discovery (`/lan` lists no addresses or hosts), relaying (no TURN), and global stats (`/health` has no counts, because each room lives in its own object).
- `HUB_NAME` in `[vars]` sets the name peers see (default `Cloudflare`).

Test locally: `npm run test:cf` (protocol test under `wrangler dev`) and `npm run build && E2E_HUB=cloudflare node scripts/p2p-e2e.mjs` (two Chromium tabs synced through the Worker).
