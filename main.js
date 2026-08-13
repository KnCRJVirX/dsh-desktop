'use strict';

const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('node:path');
const { startServer } = require('./lib/server');

let mainWindow = null;
let server = null;

async function createWindow(url) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'DeepSeek Harness',
    backgroundColor: '#0b0d12',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // New windows / external links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) {
      shell.openExternal(target);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Confine document navigation to the served origin; punt external to browser.
  win.webContents.on('will-navigate', (event, target) => {
    try {
      if (new URL(target).origin === new URL(url).origin) return;
    } catch {
      /* malformed target handled below */
    }
    event.preventDefault();
    if (/^https?:\/\//i.test(target)) shell.openExternal(target);
  });

  await win.loadURL(url);
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  mainWindow = win;
  return win;
}

async function boot() {
  // Share the official DSH home: pass DSH_HOME through only when it is set,
  // otherwise leave it unset so the child DSH resolves its own default
  // (~/.dsh) — identical to running `dsh web` directly. This keeps config,
  // MCP, plugins, sessions, settings and credentials in sync with the CLI.
  const dshHome = process.env.DSH_HOME || undefined;
  server = await startServer({ dshHome, host: '127.0.0.1', port: 0 });
  console.log(`[dsh-desktop] DSH web server ready at ${server.url}${dshHome ? ` (home: ${dshHome})` : ' (home: default ~/.dsh)'}`);
  await createWindow(server.url);
}

app.whenReady().then(async () => {
  try {
    await boot();
  } catch (error) {
    const detail = (error && (error.stderr || error.message)) || String(error);
    console.error('[dsh-desktop]', detail);
    dialog.showErrorBox('DeepSeek Harness failed to start', String(detail));
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && server) {
      createWindow(server.url).catch((error) => {
        dialog.showErrorBox('DeepSeek Harness', String((error && error.message) || error));
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (server) {
    try {
      server.stop();
    } catch {
      /* ignore */
    }
    server = null;
  }
});
