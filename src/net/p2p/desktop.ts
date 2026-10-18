/**
 * Bridge to the desktop shell: Electron (`electron/preload.cjs` exposes
 * `window.reviewDesktop`) on desktop, Tauri on Android. Everything here is a
 * no-op in a plain browser so the web build never needs the shell to exist.
 */

type ElectronBridge = {
  invoke(cmd: string, args?: unknown, headers?: Record<string, string>): Promise<unknown>;
};

function electron(): ElectronBridge | undefined {
  return typeof window !== 'undefined'
    ? (window as unknown as { reviewDesktop?: ElectronBridge }).reviewDesktop
    : undefined;
}

export type LanHost = { id: string; name: string; addresses: string[]; port: number };

export type DesktopHostInfo = {
  /** Port of the host embedded in the app (signaling + web UI for LAN friends). */
  port: number;
  id: string;
  name: string;
  addresses: string[];
  hosts: LanHost[];
  mdns: boolean;
  /** Where board snapshots are written on disk. */
  boardsDir: string;
};

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && (!!electron() || '__TAURI_INTERNALS__' in window);
}

async function call<T>(
  cmd: string,
  args?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<T | null> {
  if (!isDesktop()) return null;
  try {
    const shell = electron();
    if (shell) return (await shell.invoke(cmd, args, headers)) as T;
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args, headers ? { headers } : undefined);
  } catch (e) {
    try { console.warn('[review:desktop]', cmd, e); } catch { /* ignore */ }
    return null;
  }
}

export function desktopHostInfo(): Promise<DesktopHostInfo | null> {
  return call<DesktopHostInfo>('host_info');
}

/** Write a full Yjs snapshot of a board to `<boardsDir>/<id>.review` (raw IPC body, no JSON copy). */
export async function saveBoardFile(id: string, metaJson: string, update: Uint8Array): Promise<boolean> {
  const ok = await call<boolean>('board_save', update as unknown as Record<string, unknown>, {
    'x-board-id': id,
    'x-board-meta': encodeURIComponent(metaJson),
  });
  return ok === true;
}

export async function loadBoardFile(id: string): Promise<Uint8Array | null> {
  const data = await call<ArrayBuffer | Uint8Array | number[]>('board_load', { id });
  if (!data) return null;
  const bytes = new Uint8Array(data);
  return bytes.length ? bytes : null;
}

export type BoardFile = { id: string; savedAt: number; size: number; meta: unknown };

export async function listBoardFiles(): Promise<BoardFile[]> {
  return (await call<BoardFile[]>('board_list')) ?? [];
}

export async function deleteBoardFile(id: string): Promise<void> {
  await call('board_delete', { id });
}

export async function openBoardsFolder(): Promise<void> {
  await call('open_boards_folder');
}

/** Keep media bytes in `<app data>/blobs` (raw IPC body). */
export async function saveBlobFile(hash: string, mime: string, bytes: Uint8Array): Promise<boolean> {
  const ok = await call<boolean>('blob_save', bytes as unknown as Record<string, unknown>, {
    'x-blob-hash': hash,
    'x-blob-mime': mime,
  });
  return ok === true;
}

/** Media bytes from disk, or null when this device does not have them. */
export async function loadBlobFile(hash: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const data = await call<ArrayBuffer | Uint8Array | number[]>('blob_load', { hash });
  if (!data) return null;
  const raw = new Uint8Array(data);
  const nl = raw.indexOf(10);
  if (nl < 0 || nl + 1 >= raw.length) return null;
  return { mime: new TextDecoder().decode(raw.subarray(0, nl)), bytes: raw.slice(nl + 1) };
}
