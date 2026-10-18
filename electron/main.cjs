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

const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
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

/**
 * Same folder the Tauri app used (`dev.zpro.review` under the OS data dir), so
 * boards and media saved by earlier versions come back on first launch.
 */
function dataDir() {
  if (process.env.REVIEW_DATA_DIR) return process.env.REVIEW_DATA_DIR;
  if (process.platform === 'linux') {
    const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    return path.join(base, 'dev.zpro.review');
  }
  return path.join(app.getPath('appData'), 'dev.zpro.review');
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

  open_boards_folder: () => shell.openPath(boardsDir()).then(() => undefined),

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

// Tests run the app against a throwaway folder, browser profile included.
if (process.env.REVIEW_DATA_DIR) app.setPath('userData', path.join(process.env.REVIEW_DATA_DIR, 'profile'));

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
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    try {
      const port = await startHost();
      createWindow(process.env.REVIEW_DESKTOP_URL || `http://127.0.0.1:${port}/`);
    } catch (err) {
      console.error('[review] could not start the embedded host:', err);
      app.exit(1);
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', stopHost);
  process.on('exit', stopHost);
}
