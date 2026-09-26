'use strict';
// BASPAR FOAM CRM — Electron desktop wrapper
// Embeds the same Node server + SQLite database (local server mode).
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const isWin = process.platform === 'win32';
const fs = require('fs');
// Locate the CRM app root: next to main.js (copied/packaged), else one level up (dev)
const ROOT = fs.existsSync(path.join(__dirname, 'server', 'server.js'))
  ? __dirname
  : path.resolve(__dirname, '..');

let serverProc = null;
let win = null;
const PORT = Number(process.env.PORT || 0); // 0 = random free port

function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

async function startServer() {
  const port = PORT || await freePort();
  process.env.BASPAR_ELECTRON = '1';
  serverProc = spawn(process.execPath === '' ? 'node' : 'node', [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
  serverProc.stderr.on('data', (d) => process.stderr.write('[server:err] ' + d));
  // wait for readiness
  const url = `http://127.0.0.1:${port}/api/health`;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return port;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
}

async function createWindow(port) {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#14161a',
    title: 'CRM هوشمند بسپار فوم غرب',
    webPreferences: { contextIsolation: true },
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('http://127.0.0.1')) shell.openExternal(url);
    return { action: 'deny' };
  });
  await win.loadURL(`http://127.0.0.1:${port}/`);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.show(); win.focus(); }
  });

  app.whenReady().then(async () => {
    try {
      const port = await startServer();
      await createWindow(port);
    } catch (e) {
      console.error(e);
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (serverProc) serverProc.kill();
    if (!isWin) app.quit();
  });

  app.on('before-quit', () => {
    if (serverProc) serverProc.kill();
  });
}
