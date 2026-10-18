/**
 * Desktop app only: media bytes are also written to the app's data folder, so
 * boards restored from their files (see desktopBoards.ts) keep their images
 * when the webview's IndexedDB is gone.
 */

import { hashBytes, type BlobStore, type StoredBlob } from './blobs.ts';
import { loadBlobFile, saveBlobFile } from '../net/p2p/desktop.ts';

export class DesktopFileBlobStore implements BlobStore {
  async get(hash: string): Promise<StoredBlob | null> {
    const row = await loadBlobFile(hash);
    return row ? { ...row, storedAt: Date.now() } : null;
  }

  async has(hash: string): Promise<boolean> {
    return (await loadBlobFile(hash)) !== null;
  }

  async put(hash: string, bytes: Uint8Array, mime: string): Promise<void> {
    if ((await hashBytes(bytes)) !== hash) throw new Error('blob hash mismatch');
    if (!(await saveBlobFile(hash, mime, bytes))) throw new Error('blob file write failed');
  }

  /** Files are kept; nothing deletes media yet. */
  async delete(): Promise<boolean> {
    return false;
  }
}
