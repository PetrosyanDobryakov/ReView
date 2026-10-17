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

async function call<T>(
  cmd: string,
  args?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<T | null> {
  if (!isDesktop()) return null;
  try {
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
  const data = await call<ArrayBuffer | number[]>('board_load', { id });
  if (!data) return null;
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
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
