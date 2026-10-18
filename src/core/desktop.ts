/**
 * Desktop (Tauri) detection + paths. Browser-safe: every helper degrades to
 * null/false outside the Tauri webview, so the site bundle is unaffected.
 */

import { isTauri } from '@tauri-apps/api/core';

/** True inside the Tauri shell (Windows/Mac/Linux app), false on the site. */
export function isDesktop(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

/** App data dir (`%APPDATA%/ReView`, `~/.local/share/...`, `~/Library/...`). */
export async function desktopDataDir(): Promise<string | null> {
  if (!isDesktop()) return null;
  try {
    const { appDataDir, join } = await import('@tauri-apps/api/path');
    return await join(await appDataDir(), 'ReView');
  } catch {
    return null;
  }
}

/** Where board files live in the desktop app. Created on first use. */
export async function desktopBoardsDir(): Promise<string | null> {
  const base = await desktopDataDir();
  if (!base) return null;
  try {
    const { join } = await import('@tauri-apps/api/path');
    return await join(base, 'boards');
  } catch {
    return null;
  }
}
