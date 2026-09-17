# ReView — Tauri 2 on Linux (WebKitGTK)

Minimal desktop shell. Does **not** rewrite the React board or the sync server — it only hosts the existing Vite SPA in a native window.

| Mode | What loads |
| --- | --- |
| `npm run tauri:dev` | `http://localhost:5173` (starts `npm run dev` = Vite + sync) |
| `npm run tauri:build` | Built files from `dist/` embedded in the binary |

Out of scope here: iOS, macOS, Android.

## One-time packages (Debian / Ubuntu)

```bash
sudo apt update
sudo apt install \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev
```

Needs **Rust** (rustup) and **Node 20+**.

## Run

```bash
cd /path/to/ReView
npm install
npm run tauri:dev
```

Window title **ReView**. Home `/`, boards `/board/:id`. Sync still on `ws://localhost:1234` (from `npm run dev`).

Release `.deb`:

```bash
npm run tauri:build
# → src-tauri/target/release/bundle/deb/*.deb
# binary: src-tauri/target/release/review
```

## Layout

- `src-tauri/` — Rust + `tauri.conf.json` (identifier `app.review.whiteboard`)
- Scripts: `tauri`, `tauri:dev`, `tauri:build`
- Vite: when `TAURI_ENV_PLATFORM` is set, `strictPort` + ignore `src-tauri/**` watch

## WebKitGTK vs Chromium (watch list)

Static review of APIs the SPA already uses; confirm on a real desktop WebKitGTK window:

1. **Orbit Warp (`@paper-design/shaders-react`)** — WebGL. If WebGL is blocked/slow in WebKitGTK, Orbit chrome may blank or stutter; non-Orbit papers still work.
2. **`PointerEvent.getCoalescedEvents()`** — used for pen ink. Guarded (`typeof … === 'function'`); missing → coarser strokes, no crash.
3. **Clipboard image write (`ClipboardItem` + `navigator.clipboard.write`)** — Engine already falls back when insecure / unavailable. WebKitGTK often needs a secure context; image paste/copy may be weaker than Chromium.
4. **`navigator.clipboard.read` / `readText`** — paste paths may need extra permission or fail silently → use in-app import.
5. **y-webrtc (P2P)** — WebRTC in WebKitGTK varies by build; prefer LAN websocket sync (`npm run server` / `tauri:dev`) for desktop testing.
6. **IndexedDB + `localhost`** — same as browser: stick to one origin. Tauri prod uses a custom protocol origin (not `http://localhost`) — local boards from browser Chromium will not auto-share IDB with the desktop app.
7. **Stylus pressure / eraser tip (button 5)** — depends on WebKitGTK + compositor input; palm-reject path should still no-op safely if events differ.

## Notes

- No custom Tauri IPC yet — frontend talks to the network the same way as in a browser.
- Bundle target is **deb** only (Linux). Windows later.
- Version in `src-tauri/tauri.conf.json` / `Cargo.toml` tracks `package.json`.
