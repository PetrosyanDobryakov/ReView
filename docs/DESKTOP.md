# Desktop and Android shell

One Tauri 2 app in `src-tauri/` loads the existing Vite/React frontend. It does not replace `rust/review-sync` or the wasm `review-sync` worker. The shell version in `src-tauri/tauri.conf.json` is `0.1.0`. The web app stays at the `package.json` version. This note does not change that web version.

Identifier: `dev.zpro.review`. Dev URL: `http://localhost:5173`. Production assets: `dist/` from `npm run build`. `beforeDevCommand` is `npm run dev` (Vite plus the Rust sync server). `beforeBuildCommand` is `npm run build`. Content security policy is unset so the existing whiteboard, websocket, and WebRTC code is not blocked by a new policy. Vite ignores `src-tauri/**` so Rust build output does not restart the dev server.

Run these from the repository root.

## Desktop dev

```bash
npm install
npm run desktop
```

`npm run desktop` is `tauri dev`. It starts `npm run dev` for you. Do not start a second `npm run dev` on ports 5173 and 1234.

Linux packages used to compile here: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`. Windows and macOS use the same project; install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for those hosts. `bundle.targets` is `all`, which is Tauri's default set for the host you build on.

Production bundle:

```bash
npm run desktop:build
```

That runs `tsc --noEmit && vite build`, then the release shell.

## Android

Initialize once, after the Android SDK, NDK, and Java are installed and `ANDROID_HOME` / `NDK_HOME` are set:

```bash
npm run tauri android init
```

That writes `src-tauri/gen/android`. Then:

```bash
npm run android
npm run android:build
```

Those are `tauri android dev` and `tauri android build`. Dev still uses the Vite server. The CLI rewrites the dev host so an emulator can reach the machine. A release Android build embeds `dist/`.

## What this machine actually built

Linux x86_64, Tauri CLI 2.11.5:

- `cargo build --manifest-path src-tauri/Cargo.toml` finished the debug shell.
- `npx tauri build` finished the release shell and wrote `ReView_0.1.0_amd64.deb`, `ReView-0.1.0-1.x86_64.rpm`, and `ReView_0.1.0_amd64.AppImage` under `src-tauri/target/release/bundle/`. Those bundles are gitignored. The window was not opened.

Not built here:

- Windows and macOS. The project targets them; this host is Linux.
- Android. `tauri android init --ci` exited 1 before creating `src-tauri/gen/android`: `Android SDK not found`. `ANDROID_HOME` and `NDK_HOME` were unset. Java 21 is installed. No emulator was present, and no APK was produced.
