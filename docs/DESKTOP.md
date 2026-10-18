# Desktop (and Android) app

`src-tauri/` is a Tauri 2 app. Running it makes your computer a ReView host:

- **Embedded `review-host`** (`rust/review-host`, the same code as the standalone binary). It listens on `0.0.0.0:4455`, or the next free port up to `4475`. It serves this same web UI to friends' browsers on your network, runs the signaling hub, and advertises itself over mDNS so other ReView apps on the Wi-Fi find it.
- **The window loads the UI from that host** (`http://127.0.0.1:<port>/`). The app and a friend's browser therefore follow the same origin rules, and `ws://` hubs on the LAN are never blocked as mixed content. Dev builds load Vite instead (`REVIEW_DESKTOP_EMBEDDED=1` forces the embedded UI).
- **Boards are files.** Every saved board is mirrored to `<app data>/boards/<id>.review` (Yjs snapshot) plus `<id>.json` (name, team). On Linux, `<app data>` is `~/.local/share/dev.zpro.review`. The files are the durable copy. If the webview storage is lost or the port (origin) changes, boards come back from the files on launch. Closing the window first writes any pending edit. **Settings → System → Connection (P2P) → Boards folder** opens the folder. Images and other media sit next to it in `<app data>/blobs/`, one file per SHA-256.
- **Native WebRTC where the webview has none.** Ubuntu/Debian WebKitGTK is built without WebRTC. The app then serves `RTCPeerConnection` from Rust (webrtc-rs, `src-tauri/src/rtc.rs`) through a small polyfill (`src/net/p2p/nativeRtc.ts`). It speaks standard WebRTC, so a desktop on Linux connects to Chrome, Firefox, Safari and other desktops. On Windows (WebView2), macOS (WKWebView) and Android the webview's own WebRTC is used. On Linux the app also switches WebKitGTK's own WebRTC setting on, for distro builds that have it.

Nothing in the app stores or forwards board data for anyone else: other people's boards reach this machine only over direct peer links.

## Run

```bash
npm ci
npm run desktop          # tauri dev: Vite + hot reload, embedded host on :4455
npm run desktop:build    # release bundles under src-tauri/target/release/bundle/
```

Linux build dependencies: `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev libayatana-appindicator3-dev patchelf`. Windows and macOS need the usual [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

Environment:

| Variable | Meaning |
| --- | --- |
| `REVIEW_DESKTOP_PORT` | First port to try for the embedded host (default `4455`). |
| `REVIEW_NAME` | Name other peers see for this host (default: hostname). |
| `REVIEW_MDNS=0` | Do not advertise or browse the LAN. |
| `REVIEW_DESKTOP_EMBEDDED=1` | Dev build: load the UI from the embedded host instead of Vite. |
| `REVIEW_SELFTEST=1` | Boot, run checks inside the webview, print `REVIEW_SELFTEST {json}`, exit 0/1. |
| `REVIEW_SELFTEST_BOARD=<id>` | With the self-test: also open that board and wait for a peer's stroke (see below). |

## Inviting friends

Open a board, then **Members → Copy link for friends**. The link is `http://<your-lan-ip>:4455/board/<id>`. A friend opens it in any browser (no install), loads the UI from your app, and connects to you directly. Friends who also run the app see your host in **Connection (P2P) → Hubs** automatically (mDNS) and join it on their own.

For friends outside your network, see [DEPLOY.md](DEPLOY.md#friends-outside-your-network) (Tailscale, or a hub on a VPS).

## Security notes

- IPC (board files, native WebRTC) is granted only to the app's own window on `http://127.0.0.1:*` / `http://localhost:*` (`src-tauri/capabilities/default.json`). Pages served to LAN friends get no IPC; they run in the friend's browser.
- The embedded host accepts only text signaling frames, keeps nothing after a socket closes, and caps rooms and peers (see DEPLOY.md).
- If you do not want to host for the LAN, set `REVIEW_HOST=127.0.0.1` to bind loopback only.

## Verified on this repo's CI box (Linux x86_64, Ubuntu 24.04, WebKitGTK 2.52 without WebRTC)

- `REVIEW_SELFTEST=1 xvfb-run -a src-tauri/target/debug/review-desktop` reports: native WebRTC installed, a loopback data channel delivered `ping`, the embedded host answered `/lan`, and board files round-tripped over IPC.
- `xvfb-run -a node scripts/desktop-e2e.mjs`: the app and a headless Chromium join one board through the app's host. A stroke drawn in Chromium arrives in the app over a direct WebRTC link (Rust stack on one side, Chromium's on the other) and lands in the board file on disk.
- `npx tauri build --bundles deb` produced the release `.deb`.

Not built here: Windows, macOS, Android APK. They use the same code; Android and Apple webviews have WebRTC built in.

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
