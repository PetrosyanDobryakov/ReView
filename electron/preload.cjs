// The page's only door into the shell: `window.reviewDesktop.invoke(cmd, args, headers)`
// (see src/net/p2p/desktop.ts and the command table in main.cjs).

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reviewDesktop', {
  invoke: (cmd, args, headers) => ipcRenderer.invoke('review', cmd, args, headers),
  /** Download progress of `update_install`: `{ got, total }` bytes. */
  onUpdateProgress: (cb) => {
    const fn = (_e, p) => cb(p);
    ipcRenderer.on('review-update', fn);
    return () => ipcRenderer.removeListener('review-update', fn);
  },
});
