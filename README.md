# ReView

[English](README.md) · [Русский](README.ru.md) · [中文](README.zh.md)

Local-first infinite board. Draw, drop stickies, type, paste images. It keeps working with the network unplugged. Realtime collaboration is peer to peer: boards travel directly between devices over WebRTC and are stored only on those devices. You host it yourself with one small binary, `review-host`, or the desktop app. The host serves the UI and introduces peers. It never stores or relays board data.

The product is named ReView. The on-screen name can be renamed by clicking it in the header.

Home is `/`. Each board lives at `/board/:id` with its own IndexedDB (`review-v1-<id>`) and P2P room (`review-<id>`). Boards you join are saved on your device by default, since no server keeps a copy. Turn off «Save others’ boards» on Home for session-only joins.

![Empty board](docs/screenshots/board.png)

## What you get

- Pen, highlighter, eraser (whole object or a bite out of a stroke)
- Rect, ellipse, arrow, sticky, text, flowchart blocks
- Images: file, paste, drag-and-drop, crop
- Undo / redo, z-order, lock, lasso, marquee
- Teams and multiple boards on the home page, with local size shown
- Per-board IndexedDB persistence (`review-v1-<id>`)
- Peer-to-peer sync (Yjs over WebRTC data channels) with a P2P panel that shows each link's path (LAN, direct, TURN), latency and traffic
- Self-hosting with `review-host`: web UI, stateless signaling hub, LAN discovery (mDNS)
- Desktop app (Tauri 2) that hosts for friends on your Wi-Fi and keeps boards as files
- Save and share boards as `.review` files (local import/export)
- UI in Russian (default), English, Chinese
- Chrome skins and board paper are separate settings

![Drawing](docs/screenshots/drawing.png)

## Run

Needs Node 20+.

```bash
npm install
npm run dev
```

That starts the Vite app at [http://localhost:5173](http://localhost:5173) and `review-host` (the signaling hub) on `:1234`. Open the page. Draw. Refresh: the board is still there.

Two browsers, or another device on the LAN using your IP instead of `localhost`, on the same `/board/<id>` connect to each other directly. The board then flows browser to browser.

To host for real (UI and hub on one port):

```bash
npm run host        # http://<lan-ip>:1234/
```

Desktop app: `npm run desktop` (dev) / `npm run desktop:build`. See [docs/DESKTOP.md](docs/DESKTOP.md).

`localhost` and `127.0.0.1` are different origins. IndexedDB will not follow you between them. Pick one and stay there.

```bash
npm test            # unit tests + P2P mesh against a real review-host
npm run test:e2e    # two headless Chromium browsers sync a board over WebRTC
npm run build
```

## Deploy

There is nothing to deploy to a cloud. Whoever runs `review-host` (or the desktop app) is a host. See [docs/DEPLOY.md](docs/DEPLOY.md) for LAN, virtual-LAN (Tailscale) and VPS setups, TLS, STUN/TURN, and where boards are stored.

![Settings](docs/screenshots/settings.png)

## Layout

Chrome floats over a full-bleed canvas. File island top-left (name, undo, zoom). Presence and settings top-right. Toolbelt bottom-center. Style island above the belt when the live tool or the selection needs it. Connection and persist copy live in the settings sheet.

## License

Apache License 2.0. See [LICENSE](LICENSE).
