# ReView

[English](README.md) · [Русский](README.ru.md) · [中文](README.zh.md)

Local-first infinite board. Draw, drop stickies, type, paste images. It keeps working with the network unplugged. Optional realtime sync is a websocket on your machine (or LAN), or peer-to-peer WebRTC in the browser. Works as a static site on Vercel with local save and file sharing.

The product is named ReView. The on-screen name can be renamed by clicking it in the header.

Home is `/`. Each board lives at `/board/:id` with its own IndexedDB (`review-v1-<id>`) and sync room (`review-<id>`). Remote boards are not written to disk unless you turn on «Save others’ boards» on the home page or click «Save locally».

![Empty board](docs/screenshots/board.png)

## What you get

- Pen, highlighter, eraser (whole object or a bite out of a stroke)
- Rect, ellipse, arrow, sticky, text, flowchart blocks
- Images: file, paste, drag-and-drop, crop
- Undo / redo, z-order, lock, lasso, marquee
- Teams and multiple boards on the home page, with local size shown
- Per-board IndexedDB persistence (`review-v1-<id>`)
- Optional Yjs rooms `review-<id>` on `ws://<host>:1234` or P2P WebRTC
- Save and share boards as `.review` files (local import/export) — primary sharing on Vercel
- Works on Vercel as a static SPA (no server required)
- UI in Russian (default), English, Chinese
- Chrome skins and board paper are separate settings

![Drawing](docs/screenshots/drawing.png)

## Run

Needs Node 20+.

```bash
npm install
npm run dev
```

That starts the Vite app at [http://localhost:5173](http://localhost:5173) and the sync server at `ws://localhost:1234`. Open the page. Draw. Refresh: the board is still there.

Sync is optional. `npm run server` is enough if you only want the websocket. Two browsers on the same machine, or another device on the LAN using your host IP instead of `localhost`, share the same board room.

`localhost` and `127.0.0.1` are different origins. IndexedDB will not follow you between them. Pick one and stay there.

```bash
npm test
npm run build
```

## Deploy

- **Vercel (static, no server):** push to Vercel — it builds `dist/` and serves as SPA (`vercel.json` handles rewrites). Boards stay in the browser (IndexedDB). Use **Export** on the board / home to download a `.review` file, and **Import** on another device to open it. Optional P2P: Settings → System → Connection → enable **P2P (WebRTC)** — room `review-<boardId>` then syncs via public signaling without a server.
- **Self-hosted with sync:** `npm run server` or `node server.mjs`. Set `VITE_SYNC_URL` to point browsers at your `wss://` server.

Production / VM hosting: see [docs/DEPLOY.md](docs/DEPLOY.md). Optional env: `VITE_SYNC_URL`, `VITE_P2P_SIGNALING`.

![Settings](docs/screenshots/settings.png)

## Layout

Chrome floats over a full-bleed canvas. File island top-left (name, undo, zoom). Presence and settings top-right. Toolbelt bottom-center. Style island above the belt when the live tool or the selection needs it. Connection and persist copy live in the settings sheet.

## License

Apache License 2.0. See [LICENSE](LICENSE).
