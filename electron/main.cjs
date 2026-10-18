// ReView desktop shell (Electron).
//
// On launch the app starts its own `review-host` (rust/review-host, shipped
// next to the app) on the LAN interface: it serves this same web UI to
// friends' browsers and runs the signaling hub that introduces peers. Board
// data never goes through it; it flows over WebRTC between peers and is
// stored here as files under the app data dir.
//
// The window loads the UI from that host (`http://127.0.0.1:<port>`), so the
// app and a friend's browser run the exact same origin rules (plain-http hubs
// on the LAN are not mixed content).

'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, net, shell } = require('electron');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Fixed so the page origin (and its IndexedDB) stays the same between runs. */
const DEFAULT_PORT = 4455;
const PORT_TRIES = 20;
/** If the page never answers the close (crashed, hung), close anyway. */
const QUIT_GRACE_MS = 3000;
const MAX_BOARD_BYTES = 512 * 1024 * 1024;
const MAX_BLOB_BYTES = 64 * 1024 * 1024;

// ---- where everything lives ---------------------------------------------
//
// The user picks one folder on first launch (Documents/ReView suggested) and
// can move it later from Settings. It holds boards/, blobs/ and the app's
// browser profile (.review-app/, page storage and caches), so nothing of
// substance sits in AppData. Only a pointer file stays in the OS config dir.
// Moves happen at startup, before Chromium opens anything.

const PROFILE_DIR = '.review-app';
/** The app's default config dir (`%APPDATA%\ReView`, `~/.config/ReView`). */
const configDir = app.getPath('userData');
const pointerFile = path.join(configDir, 'location.json');

/** Folder of the Tauri builds and 0.16.0-0.16.1. */
function legacyDataDir() {
  if (process.platform === 'linux') {
    const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    return path.join(base, 'dev.zpro.review');
  }
  return path.join(app.getPath('appData'), 'dev.zpro.review');
}

function readPointer() {
  try {
    const j = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
    return typeof j.dataDir === 'string' && path.isAbsolute(j.dataDir) ? j : null;
  } catch {
    return null;
  }
}

function writePointer(j) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(pointerFile, JSON.stringify(j, null, 2));
}

/** Rename, or copy then delete across drives. Existing files at the target win. */
function moveInto(src, dst) {
  if (!fs.existsSync(src) || path.resolve(src) === path.resolve(dst)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (!fs.existsSync(dst)) {
    try {
      fs.renameSync(src, dst);
      return;
    } catch {
      /* other drive: copy below */
    }
  }
  fs.cpSync(src, dst, { recursive: true, force: false, errorOnExist: false });
  fs.rmSync(src, { recursive: true, force: true });
}

/** Carry out a move the last run scheduled (first-run choice or a folder change). */
function applyPendingMove(pointer) {
  const move = pointer.move;
  if (!move) return pointer;
  const to = pointer.dataDir;
  try {
    fs.mkdirSync(to, { recursive: true });
    for (const name of ['boards', 'blobs']) moveInto(path.join(move.data, name), path.join(to, name));
    if (move.profile) {
      // The old profile dir is also where the pointer lives: move its contents only.
      const target = path.join(to, PROFILE_DIR);
      fs.mkdirSync(target, { recursive: true });
      for (const name of fs.existsSync(move.profile) ? fs.readdirSync(move.profile) : []) {
        if (name === 'location.json') continue;
        // Chromium's single-instance lock links belong to the old run.
        if (name.startsWith('Singleton')) {
          fs.rmSync(path.join(move.profile, name), { force: true });
          continue;
        }
        moveInto(path.join(move.profile, name), path.join(target, name));
      }
      if (path.basename(move.profile) === PROFILE_DIR) {
        try { fs.rmdirSync(move.profile); } catch { /* not empty: leave it */ }
      }
    }
    if (move.data !== to && path.basename(move.data) === 'dev.zpro.review') {
      try { fs.rmdirSync(move.data); } catch { /* not empty: leave it */ }
    }
  } catch (err) {
    console.error('[review] moving data failed:', err);
  }
  const next = { dataDir: to };
  writePointer(next);
  return next;
}

let pointer = process.env.REVIEW_DATA_DIR ? null : readPointer();
if (pointer) pointer = applyPendingMove(pointer);

function dataDir() {
  if (process.env.REVIEW_DATA_DIR) return process.env.REVIEW_DATA_DIR;
  return pointer?.dataDir ?? legacyDataDir();
}

if (process.env.REVIEW_DATA_DIR) {
  // Tests run the app against a throwaway folder, browser profile included.
  app.setPath('userData', path.join(process.env.REVIEW_DATA_DIR, 'profile'));
} else if (pointer) {
  const profile = path.join(pointer.dataDir, PROFILE_DIR);
  fs.mkdirSync(profile, { recursive: true });
  if (process.platform === 'win32') execFile('attrib', ['+h', profile], () => {});
  app.setPath('userData', profile);
}

const ui = (() => {
  const lang = app.getLocale?.() || process.env.LANG || '';
  if (/^ru/i.test(lang)) {
    return {
      title: 'Где хранить доски?',
      detail: (p) => `Доски, картинки и данные приложения будут лежать в одной папке. Предлагаем:\n${p}\n\nПапку можно сменить позже в Настройках, Подключение.`,
      use: 'Использовать эту папку',
      pick: 'Выбрать папку…',
      pickTitle: 'Папка для досок ReView',
    };
  }
  if (/^zh/i.test(lang)) {
    return {
      title: '白板保存在哪里？',
      detail: (p) => `白板、图片和应用数据都会放在同一个文件夹。建议：\n${p}\n\n以后可以在 设置 > 连接 中更改。`,
      use: '使用此文件夹',
      pick: '选择文件夹…',
      pickTitle: 'ReView 白板文件夹',
    };
  }
  return {
    title: 'Where should ReView keep your boards?',
    detail: (p) => `Boards, images and the app's own data all go into one folder. Suggested:\n${p}\n\nYou can move it later in Settings, Connection.`,
    use: 'Use this folder',
    pick: 'Choose folder…',
    pickTitle: 'Folder for ReView boards',
  };
});

async function pickFolder(defaultPath) {
  const r = await dialog.showOpenDialog({
    title: ui().pickTitle,
    defaultPath,
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
}

/**
 * First launch of this version: ask for the folder, schedule moving whatever
 * older versions left (boards, media, browser profile) and restart into it.
 * Returns false when the app restarts.
 */
async function ensureDataDir() {
  if (process.env.REVIEW_DATA_DIR || pointer) return true;
  const suggested = path.join(app.getPath('documents'), 'ReView');
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'ReView',
    message: ui().title,
    detail: ui().detail(suggested),
    buttons: [ui().use, ui().pick],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  const chosen = (response === 1 && (await pickFolder(suggested))) || suggested;
  writePointer({ dataDir: chosen, move: { data: legacyDataDir(), profile: configDir } });
  app.relaunch();
  app.exit(0);
  return false;
}

/** Settings: move everything to another folder (restarts the app). */
async function changeDataDir() {
  const current = dataDir();
  const chosen = await pickFolder(current);
  if (!chosen || path.resolve(chosen) === path.resolve(current)) return null;
  if (path.resolve(chosen).startsWith(path.resolve(current) + path.sep)) throw new Error('inside the current folder');
  try {
    await win?.webContents.executeJavaScript('window.__reviewFlushBoards ? window.__reviewFlushBoards() : null');
  } catch {
    /* page gone: files are as fresh as they get */
  }
  writePointer({ dataDir: chosen, move: { data: current, profile: app.getPath('userData') } });
  app.relaunch();
  setImmediate(() => {
    quitReady = true;
    app.quit();
  });
  return chosen;
}

function hostBinary() {
  const exe = process.platform === 'win32' ? 'review-host.exe' : 'review-host';
  if (app.isPackaged) return path.join(process.resourcesPath, 'bin', exe);
  const root = path.join(__dirname, '..');
  for (const profile of ['release', 'debug']) {
    const p = path.join(root, 'rust', 'target', profile, exe);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('review-host not built: cargo build --manifest-path rust/Cargo.toml -p review-host');
}

function distDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'dist') : path.join(__dirname, '..', 'dist');
}

let host = null;
let hostPort = 0;

/** Start review-host and resolve with the port it bound. */
function startHost() {
  return new Promise((resolve, reject) => {
    const first = Number(process.env.REVIEW_DESKTOP_PORT) || DEFAULT_PORT;
    host = spawn(hostBinary(), [], {
      env: {
        ...process.env,
        REVIEW_PORT: String(first),
        REVIEW_PORT_TRIES: String(PORT_TRIES),
        REVIEW_DIST: distDir(),
      },
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
    });
    let buf = '';
    host.stdout.on('data', (d) => {
      process.stdout.write(d);
      if (hostPort) return;
      buf += String(d);
      const m = buf.match(/ on :(\d+) /);
      if (m) {
        hostPort = Number(m[1]);
        resolve(hostPort);
      } else if (buf.includes('already running')) {
        reject(new Error(`no free port in ${first}..${first + PORT_TRIES}`));
      }
    });
    host.on('error', reject);
    host.on('exit', (code) => {
      host = null;
      if (!hostPort) reject(new Error(`review-host exited (${code})`));
    });
  });
}

function stopHost() {
  if (host) {
    host.kill();
    host = null;
  }
}

// ---- board and media files (renderer IPC) ------------------------------

const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const validHash = (h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h);

function boardsDir() {
  const dir = path.join(dataDir(), 'boards');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function blobPath(hash) {
  const dir = path.join(dataDir(), 'blobs', hash.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, hash);
}

/** Temp file + rename so a crash never leaves half a board. */
function writeAtomic(file, bytes) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
}

const toBuffer = (data) => (data instanceof Uint8Array ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : null);

async function hostInfo() {
  const lan = await (await fetch(`http://127.0.0.1:${hostPort}/lan`)).json();
  return {
    port: hostPort,
    id: lan.id,
    name: lan.name,
    addresses: lan.addresses ?? [],
    hosts: lan.hosts ?? [],
    mdns: !!lan.mdns,
    boardsDir: boardsDir(),
    dataDir: dataDir(),
  };
}

const commands = {
  host_info: () => hostInfo(),

  board_save(bytes, headers) {
    const id = headers?.['x-board-id'];
    const buf = toBuffer(bytes);
    if (!validId(id)) throw new Error('bad board id');
    if (!buf || !buf.length || buf.length > MAX_BOARD_BYTES) throw new Error('bad board size');
    const dir = boardsDir();
    writeAtomic(path.join(dir, `${id}.review`), buf);
    const meta = headers?.['x-board-meta'];
    if (typeof meta === 'string') {
      const json = decodeURIComponent(meta);
      try {
        JSON.parse(json);
        writeAtomic(path.join(dir, `${id}.json`), json);
      } catch {
        /* keep the old meta */
      }
    }
    return true;
  },

  board_load(args) {
    if (!validId(args?.id)) throw new Error('bad board id');
    try {
      return new Uint8Array(fs.readFileSync(path.join(boardsDir(), `${args.id}.review`)));
    } catch {
      return new Uint8Array();
    }
  },

  board_list() {
    const dir = boardsDir();
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.review')) continue;
      const id = name.slice(0, -'.review'.length);
      if (!validId(id)) continue;
      const st = fs.statSync(path.join(dir, name));
      let meta = null;
      try {
        meta = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
      } catch {
        /* no meta */
      }
      out.push({ id, savedAt: Math.floor(st.mtimeMs), size: st.size, meta });
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  },

  board_delete(args) {
    if (!validId(args?.id)) throw new Error('bad board id');
    const dir = boardsDir();
    for (const ext of ['review', 'json']) fs.rmSync(path.join(dir, `${args.id}.${ext}`), { force: true });
  },

  open_boards_folder: () => shell.openPath(dataDir()).then(() => undefined),

  data_dir_change: () => changeDataDir(),

  blob_save(bytes, headers) {
    const hash = headers?.['x-blob-hash'];
    const mime = headers?.['x-blob-mime'] ?? '';
    const buf = toBuffer(bytes);
    if (!validHash(hash) || typeof mime !== 'string' || mime.length > 100 || mime.includes('\n')) {
      throw new Error('bad blob');
    }
    if (!buf || !buf.length || buf.length > MAX_BLOB_BYTES) throw new Error('bad blob size');
    const file = blobPath(hash);
    if (!fs.existsSync(file)) writeAtomic(file, Buffer.concat([Buffer.from(`${mime}\n`), buf]));
    return true;
  },

  update_install: () => installUpdate(),

  blob_load(args) {
    if (!validHash(args?.hash)) throw new Error('bad blob hash');
    try {
      return new Uint8Array(fs.readFileSync(blobPath(args.hash)));
    } catch {
      return new Uint8Array();
    }
  },
};

/** Only the app's own page (served by the embedded host) gets file access. */
function trusted(frame) {
  try {
    const u = new URL(frame.url);
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch {
    return false;
  }
}

ipcMain.handle('review', (e, cmd, args, headers) => {
  if (!e.senderFrame || !trusted(e.senderFrame)) throw new Error('not allowed');
  const fn = Object.hasOwn(commands, cmd) ? commands[cmd] : null;
  if (!fn) throw new Error(`unknown command ${cmd}`);
  return fn(args, headers);
});

// ---- updates -----------------------------------------------------------
//
// Follows this line's GitHub releases (`p2p-desktop-v*`), like the page's
// banner (src/core/version.ts). AppImage and Windows replace themselves and
// restart; a .deb or .dmg is downloaded and opened for the system installer.

// REVIEW_UPDATE_FEED: another releases JSON (tests).
const RELEASES_API =
  process.env.REVIEW_UPDATE_FEED || 'https://api.github.com/repos/PetrosyanDobryakov/ReView/releases?per_page=100';
const TAG_PREFIX = 'p2p-desktop-v';

function newer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** How this copy was installed decides how it updates. */
function installKind() {
  if (!app.isPackaged) return null;
  if (process.platform === 'win32') return 'exe';
  if (process.platform === 'darwin') return 'dmg';
  if (process.env.APPIMAGE) return 'appimage';
  if (process.execPath.startsWith('/opt/')) return 'deb';
  return null;
}

function assetSuffix(kind) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return {
    exe: `-win-${arch}.exe`,
    dmg: `-mac-${arch}.dmg`,
    appimage: `-linux-${process.arch === 'arm64' ? 'arm64' : 'x86_64'}.AppImage`,
    deb: `-linux-${process.arch === 'arm64' ? 'arm64' : 'amd64'}.deb`,
  }[kind];
}

async function latestRelease() {
  const res = await net.fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  let best = null;
  for (const r of await res.json()) {
    if (r.draft || !r.tag_name?.startsWith(TAG_PREFIX)) continue;
    const version = r.tag_name.slice(TAG_PREFIX.length);
    if (!best || newer(version, best.version)) best = { version, release: r };
  }
  return best;
}

async function download(url, file, onProgress) {
  const res = await net.fetch(url);
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(file);
  let got = 0;
  let last = 0;
  try {
    for await (const chunk of res.body) {
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (Date.now() - last > 200) {
        last = Date.now();
        onProgress(got, total);
      }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  onProgress(got, total);
}

let updating = false;

/** Returns `restarting` (the app quits and comes back), `opened` (an installer is shown) or `latest`. */
async function installUpdate() {
  const kind = installKind();
  if (!kind) throw new Error('this copy cannot update itself');
  if (updating) throw new Error('update already running');
  updating = true;
  try {
    const best = await latestRelease();
    if (!best || !newer(best.version, app.getVersion())) return 'latest';
    const suffix = assetSuffix(kind);
    const asset = best.release.assets?.find((a) => a.name.endsWith(suffix));
    if (!asset) throw new Error(`no ${suffix} in ${best.release.tag_name}`);
    const progress = (got, total) => win?.webContents.send('review-update', { got, total });
    if (kind === 'appimage') {
      const target = process.env.APPIMAGE;
      const tmp = `${target}.update`;
      await download(asset.browser_download_url, tmp, progress);
      fs.chmodSync(tmp, 0o755);
      fs.renameSync(tmp, target);
      app.relaunch({ execPath: target, args: [] });
      setImmediate(() => win?.close());
      return 'restarting';
    }
    const dir = kind === 'exe' ? app.getPath('temp') : app.getPath('downloads');
    const file = path.join(dir, asset.name);
    await download(asset.browser_download_url, file, progress);
    if (kind === 'exe') {
      // Silent NSIS install over this copy, then it starts the new version.
      spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
      setImmediate(() => win?.close());
      return 'restarting';
    }
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
    return 'opened';
  } finally {
    updating = false;
  }
}

// ---- review:// invite links ---------------------------------------------

const SCHEME = 'review';

function boardFromArgs(argv) {
  for (const a of argv) {
    const m = /^review:\/\/board\/([A-Za-z0-9_-]{1,64})/i.exec(String(a));
    if (m) return m[1];
  }
  return null;
}

let pendingBoard = boardFromArgs(process.argv);

function openBoard(id) {
  if (!win || !hostPort) {
    pendingBoard = id;
    return;
  }
  if (win.isMinimized()) win.restore();
  win.focus();
  void win.loadURL(`${new URL(win.webContents.getURL() || `http://127.0.0.1:${hostPort}/`).origin}/board/${id}`);
}

/**
 * Make `review://` links open this app. Installers register the scheme on
 * Windows, macOS and for the .deb; an AppImage has no install step, so it
 * writes its own desktop entry (also putting the app in the launcher).
 */
function registerScheme() {
  if (!app.isPackaged) return;
  if (process.platform === 'linux' && process.env.APPIMAGE) {
    try {
      const apps = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'applications');
      const icons = path.join(path.dirname(apps), 'icons', 'hicolor', '512x512', 'apps');
      fs.mkdirSync(apps, { recursive: true });
      fs.mkdirSync(icons, { recursive: true });
      fs.copyFileSync(path.join(__dirname, 'icon.png'), path.join(icons, 'review-desktop.png'));
      const entry = [
        '[Desktop Entry]',
        'Name=ReView',
        'Comment=Local-first whiteboard with peer-to-peer sync',
        `Exec="${process.env.APPIMAGE}" %U`,
        'Icon=review-desktop',
        'Type=Application',
        'Categories=Office;',
        'StartupWMClass=review-desktop',
        `MimeType=x-scheme-handler/${SCHEME};`,
        '',
      ].join('\n');
      const file = path.join(apps, 'review-desktop.desktop');
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== entry) fs.writeFileSync(file, entry);
      execFile('xdg-mime', ['default', 'review-desktop.desktop', `x-scheme-handler/${SCHEME}`], () => {});
      execFile('update-desktop-database', [apps], () => {});
    } catch (err) {
      console.warn('[review] desktop entry:', err);
    }
    return;
  }
  app.setAsDefaultProtocolClient(SCHEME);
}

// ---- window ------------------------------------------------------------

/** Tiling compositors draw no title bars, so a frame there is just wasted space. */
function tilingWm() {
  if (process.platform !== 'linux') return false;
  const tiling = ['hyprland', 'sway', 'i3', 'niri', 'river', 'bspwm', 'qtile', 'dwm'];
  const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase().split(':');
  return (
    desktop.some((d) => tiling.includes(d)) ||
    ['HYPRLAND_INSTANCE_SIGNATURE', 'SWAYSOCK', 'I3SOCK', 'NIRI_SOCKET'].some((v) => process.env[v])
  );
}

// Real host candidates instead of `<uuid>.local` names: those need working
// multicast DNS on both ends, which many networks (and Windows setups) lack.
// Native apps (and the old Tauri shell) always offered real addresses.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

const perfProbe = !!process.env.REVIEW_PERF && process.env.REVIEW_PERF !== '0';
let win = null;
let quitReady = false;

function createWindow(url) {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'ReView',
    frame: !tilingWm(),
    backgroundColor: '#0b0d12',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // The board keeps animating peers and media when the window is behind others.
      backgroundThrottling: false,
    },
  });

  // `target="_blank"` links (update banner, release page) open in the system browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  // The app never leaves its own host; anything else goes to the browser.
  win.webContents.on('will-navigate', (e, target) => {
    if (new URL(target).origin !== new URL(url).origin) {
      e.preventDefault();
      if (/^https?:/i.test(target)) void shell.openExternal(target);
    }
  });

  if (perfProbe) {
    const probe = fs.readFileSync(path.join(__dirname, 'perf_probe.js'), 'utf8');
    win.webContents.on('dom-ready', () => void win.webContents.executeJavaScript(probe));
  }
  if (perfProbe || process.env.REVIEW_CONSOLE) {
    win.webContents.on('console-message', (e) => console.log(e.message));
  }

  // Closing first lets the page write pending board files.
  win.on('close', (e) => {
    if (quitReady) return;
    e.preventDefault();
    const done = () => {
      quitReady = true;
      win?.close();
    };
    const timer = setTimeout(done, QUIT_GRACE_MS);
    win.webContents
      .executeJavaScript('window.__reviewFlushBoards ? window.__reviewFlushBoards() : null')
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        done();
      });
  });
  win.on('closed', () => {
    win = null;
  });

  void win.loadURL(url);
}

if (!app.requestSingleInstanceLock()) {
  // A second copy would start a second host on another port (another origin).
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const id = boardFromArgs(argv);
    if (id) return openBoard(id);
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  // macOS hands links over as an event, possibly before the window exists.
  app.on('open-url', (e, url) => {
    e.preventDefault();
    const id = boardFromArgs([url]);
    if (id) openBoard(id);
  });

  app.whenReady().then(async () => {
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    try {
      if (!(await ensureDataDir())) return;
      registerScheme();
      const port = await startHost();
      const base = process.env.REVIEW_DESKTOP_URL || `http://127.0.0.1:${port}`;
      createWindow(`${base.replace(/\/$/, '')}/${pendingBoard ? `board/${pendingBoard}` : ''}`);
      pendingBoard = null;
    } catch (err) {
      console.error('[review] could not start the embedded host:', err);
      app.exit(1);
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', stopHost);
  process.on('exit', stopHost);
}
