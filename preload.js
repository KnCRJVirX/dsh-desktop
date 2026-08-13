'use strict';

const { contextBridge } = require('electron');

// Minimal, sandbox-safe surface for the DSH web UI (informational only).
contextBridge.exposeInMainWorld('dshDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
