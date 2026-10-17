/**
 * Bridge to the Tauri desktop shell. Everything here is a no-op in a plain
 * browser so the web build never needs the desktop to exist.
 */

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
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isDesktop()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch (e) {
    try { console.warn('[review:desktop]', cmd, e); } catch { /* ignore */ }
    return null;
  }
}

export function desktopHostInfo(): Promise<DesktopHostInfo | null> {
  return call<DesktopHostInfo>('host_info');
}

/** Write a full Yjs snapshot of a board to `<boardsDir>/<id>.review`. */
export async function saveBoardFile(id: string, title: string, update: Uint8Array): Promise<boolean> {
  const ok = await call<boolean>('board_save', { id, title, data: Array.from(update) });
  return ok === true;
}

export async function loadBoardFile(id: string): Promise<Uint8Array | null> {
  const data = await call<number[] | null>('board_load', { id });
  return data ? new Uint8Array(data) : null;
}

export async function deleteBoardFile(id: string): Promise<void> {
  await call('board_delete', { id });
}

export async function openBoardsFolder(): Promise<void> {
  await call('open_boards_folder');
}
