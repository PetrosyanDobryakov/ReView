# Desktop (and Android) app

The desktop app is Electron (`electron/`, packaged by `electron-builder.yml`). Android stays on Tauri 2 (`src-tauri/`). Running the desktop app makes your computer a ReView host:

- **Embedded `review-host`** (`rust/review-host`, the same binary as the standalone host, shipped inside the app). It listens on `0.0.0.0:4455`, or the next free port up to `4475`. It serves this same web UI to friends' browsers on your network, runs the signaling hub, and advertises itself over mDNS so other ReView apps on the Wi-Fi find it.
- **The window loads the UI from that host** (`http://127.0.0.1:<port>/`). The app and a friend's browser therefore follow the same origin rules, and `ws://` hubs on the LAN are never blocked as mixed content.
- **Boards are files.** Every saved board is mirrored to `<app data>/boards/<id>.review` (Yjs snapshot) plus `<id>.json` (name, team). `<app data>` is `~/.local/share/dev.zpro.review` on Linux, `%APPDATA%\dev.zpro.review` on Windows, `~/Library/Application Support/dev.zpro.review` on macOS (the same folder the earlier Tauri builds used, so their boards come back). The files are the durable copy. If the page storage is lost or the port (origin) changes, boards come back from the files on launch. Closing the window first writes any pending edit. **Settings → System → Connection (P2P) → Boards folder** opens the folder. Images and other media sit next to it in `<app data>/blobs/`, one file per SHA-256.
- **WebRTC is Chromium's own.** The app offers real LAN addresses as ICE host candidates (not mDNS `.local` names), like a native app.
- **IPC** is one channel (`electron/preload.cjs` exposes `window.reviewDesktop.invoke`; the command table is in `electron/main.cjs`). It answers only the app's own page on `http://127.0.0.1` / `localhost`.

Nothing in the app stores or forwards board data for anyone else: other people's boards reach this machine only over direct peer links.

## Run

```bash
npm ci
npm run desktop          # builds review-host (release) and the UI, then starts Electron
npm run desktop:build    # installers under release/ (AppImage + deb, NSIS exe, dmg by platform)
```

`node scripts/desktop.mjs --dist -- --linux deb` passes extra flags to electron-builder; `--target <rust triple>` cross-builds review-host (CI: Intel macOS on Apple runners). Only Rust and Node are needed; no system webview packages.

Environment:

| Variable | Meaning |
| --- | --- |
| `REVIEW_DESKTOP_PORT` | First port to try for the embedded host (default `4455`). |
| `REVIEW_NAME` | Name other peers see for this host (default: hostname). |
| `REVIEW_MDNS=0` | Do not advertise or browse the LAN. |
| `REVIEW_DESKTOP_URL` | Load the UI from this URL instead (dev: `http://localhost:5173` with `npm run dev`). |
| `REVIEW_DATA_DIR` | Use this folder for boards, media and the browser profile (tests). |
| `REVIEW_PERF=1` | Frame-pacing probe: `PERF {...}` lines on stdout (`electron/perf_probe.js`). |
| `REVIEW_CONSOLE=1` | Page console on stdout. |
| `REVIEW_UPDATE_FEED` | Releases JSON to update from instead of GitHub (tests). |

## Updates

The app checks this line's GitHub releases (`p2p-desktop-v*`). When one is newer, the version chip on Home turns into **Update to vX**: the AppImage downloads the new AppImage over itself and restarts, Windows runs the new installer silently and restarts, the .deb and .dmg are saved to Downloads and opened. An AppImage also writes `~/.local/share/applications/review-desktop.desktop` on launch, so it shows up in the app launcher and opens `review://` links.

## Inviting friends

**Over the internet:** open a board, then **Members → Copy invite link**. It is a `review://board/<id>` link: your friend opens it in the ReView app (or pastes it into the field on Home). Both apps meet through the built-in hubs: the Cloudflare hub and public Nostr relays, which pass only a sealed handshake and keep nothing. The board itself then goes directly between the two devices.

**On the same Wi-Fi, friend without the app:**

Open a board, then **Members → Copy link for friends**. The link is `http://<your-lan-ip>:4455/board/<id>`. A friend opens it in any browser (no install), loads the UI from your app, and connects to you directly. Friends who also run the app see your host in **Connection (P2P) → Hubs** automatically (mDNS) and join it on their own.

For friends outside your network, see [DEPLOY.md](DEPLOY.md#friends-outside-your-network) (Tailscale, or a hub on a VPS).

## Security notes

- File IPC (boards, media) answers only the app's own page on `http://127.0.0.1:*` / `http://localhost:*`. Pages served to LAN friends run in the friend's browser and get none. The page runs sandboxed with context isolation and no Node.
- Links to other sites open in the system browser; the window never navigates away from its host.
- The embedded host accepts only text signaling frames, keeps nothing after a socket closes, and caps rooms and peers (see DEPLOY.md).
- If you do not want to host for the LAN, set `REVIEW_HOST=127.0.0.1` to bind loopback only.

## Tests

`npm run test:desktop` builds the UI and review-host, starts the app on a throwaway data folder (Playwright's Electron driver) and checks WebRTC, `host_info`, board and media files over IPC, then has headless Chromium join the same board through the app's host and draw. The stroke has to arrive in the app over a direct link and land in the board file on disk. Needs a display (`xvfb-run -a` on a headless box) and a non-loopback network interface (Chromium gathers no loopback ICE candidates).

## Android

Tauri CLI 2.11.5 looks for Android SDK platform 36 and NDK `29.0.13846066`. Java 21 was already on this machine (`JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`). These commands installed the command-line SDK and NDK, then generated `src-tauri/gen/android`:

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
mkdir -p "$ANDROID_HOME/cmdline-tools"
curl -fsSL -o /tmp/cmdtools.zip https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
unzip -q /tmp/cmdtools.zip -d /tmp/cmdtools
rm -rf "$ANDROID_HOME/cmdline-tools/latest"
mv /tmp/cmdtools/cmdline-tools "$ANDROID_HOME/cmdline-tools/latest"
yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses
sdkmanager --sdk_root="$ANDROID_HOME" --install "platform-tools" "platforms;android-36" "ndk;29.0.13846066"
export NDK_HOME="$ANDROID_HOME/ndk/29.0.13846066"
npm run tauri -- android init --ci
```

`sdkmanager` here was `$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager` (package 19.0). Init also installed the Rust targets `aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`, and `x86_64-linux-android`. `src-tauri/gen/android/local.properties` is machine-specific and gitignored.

After that, dev and a release APK would be:

```bash
npm run android
npm run android:build
```

Those are `tauri android dev` and `tauri android build`. Dev still uses the Vite server. On Android the app embeds the same host as on desktop; the system WebView has WebRTC, so the native bridge is not used. The CLI rewrites the dev host so an emulator can reach the machine. A release Android build embeds `dist/`. Neither command was run here.
