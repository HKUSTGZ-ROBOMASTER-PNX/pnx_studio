'use strict';
const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const platform = require('./core/platform.cjs');
const { createBackend } = require('./core/backend.cjs');

const APP_ROOT = path.join(__dirname, '..');
const RENDERER_ROOT = path.join(APP_ROOT, 'renderer');
const START_MOCK = process.argv.includes('--mock');

// Desktop launchers (Finder, .desktop files) do not inherit an interactive shell PATH.
if (process.platform !== 'win32') {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const extra of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', path.join(os.homedir(), '.local', 'bin')])
    if (!dirs.includes(extra) && fs.existsSync(extra)) dirs.push(extra);
  process.env.PATH = dirs.join(path.delimiter);
}
// WSLg GPU acceleration is unreliable; software rendering is plenty for this UI.
if (platform.isWsl() || process.env.STUDIO_DISABLE_GPU === '1') app.disableHardwareAcceleration();

// Render at a fixed scale (e.g. STUDIO_SCALE=2 when WSLg's own HiDPI stretching is disabled,
// so Chromium draws at full resolution instead of being bitmap-upscaled).
if (Number(process.env.STUDIO_SCALE) > 0) app.commandLine.appendSwitch('force-device-scale-factor', String(Number(process.env.STUDIO_SCALE)));

// Isolated profile for tests and side-by-side instances.
if (process.env.STUDIO_USER_DATA) app.setPath('userData', path.resolve(process.env.STUDIO_USER_DATA));

protocol.registerSchemesAsPrivileged([{ scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

// Windows: tie taskbar entries to our shortcut/icon instead of the generic Electron one.
if (process.platform === 'win32') app.setAppUserModelId('dev.embedded-studio.app');

// ---------------------------------------------------------------- backend (shared with server/serve.cjs)
let window = null;
let backend = null;

function send(channel, payload) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function createElectronBackend() {
  return createBackend({
    appRoot: APP_ROOT,
    userData: app.getPath('userData'),
    resourcesPath: app.isPackaged ? process.resourcesPath : null,
    version: app.getVersion(),
    runtime: 'electron',
    startMock: START_MOCK,
    send,
    dialogs: {
      openFolder: async title => {
        const result = await dialog.showOpenDialog(window, { title: title || 'Open Folder', properties: ['openDirectory'] });
        return result.canceled ? null : result.filePaths[0];
      },
      openFile: async (options = {}) => {
        const result = await dialog.showOpenDialog(window, { title: options.title, defaultPath: options.defaultPath, filters: options.filters, properties: ['openFile'] });
        return result.canceled ? null : result.filePaths[0];
      },
      saveFile: async (options = {}) => {
        const result = await dialog.showSaveDialog(window, { title: options.title, defaultPath: options.defaultPath, filters: options.filters });
        return result.canceled ? null : result.filePath;
      },
    },
    openExternal: url => shell.openExternal(url),
    showItem: file => shell.showItemInFolder(file),
    openPath: folder => shell.openPath(folder),
    reloadUi: () => window?.webContents.reload(),
  });
}

function registerIpc() {
  for (const channel of Object.keys(backend.handlers)) {
    ipcMain.handle(channel, (_event, ...args) => backend.invoke(channel, args));
  }
}

// ---------------------------------------------------------------- protocol & window
function serveFile(file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

function registerProtocol() {
  protocol.handle('studio', request => {
    const url = new URL(request.url);
    const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
    if (url.host === 'app') {
      const file = path.resolve(RENDERER_ROOT, ...(parts.length ? parts : ['index.html']));
      return serveFile(file.startsWith(RENDERER_ROOT + path.sep) ? file : null);
    }
    if (url.host === 'plugins' && parts.length >= 2) return serveFile(backend.plugins.resolveAsset(parts[0], parts.slice(1).join('/')));
    return new Response('Not found', { status: 404 });
  });
}


/**
 * Taskbar / Alt-Tab icon. Windows cannot load an .ico from inside app.asar, so packaged
 * builds use the copy that electron-builder places next to it (extraResources).
 */
function windowIcon() {
  const name = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const unpacked = app.isPackaged ? path.join(process.resourcesPath, name) : null;
  return unpacked && fs.existsSync(unpacked) ? unpacked : path.join(APP_ROOT, 'assets', name);
}

function createWindow() {
  const bounds = backend.settings().windowBounds || {};
  window = new BrowserWindow({
    width: bounds.width || 1480, height: bounds.height || 940, x: bounds.x, y: bounds.y,
    minWidth: 960, minHeight: 600, show: false, backgroundColor: '#14171c', title: 'Embedded Studio',
    autoHideMenuBar: true,
    icon: windowIcon(),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('studio://app/')) event.preventDefault(); });
  window.on('close', () => backend.saveSettings({ windowBounds: window.getBounds() }));
  window.on('closed', () => { window = null; });
  window.once('ready-to-show', () => window.show());
  window.loadURL('studio://app/index.html');
  if (process.env.STUDIO_SCREENSHOT) scheduleSmokeCapture(window);
}

/**
 * Smoke-test hook (scripts/smoke.mjs): optionally run a renderer script, then save
 * a PNG of the window and quit. Inactive unless STUDIO_SCREENSHOT is set.
 */
function scheduleSmokeCapture(target) {
  target.webContents.once('did-finish-load', async () => {
    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (process.env.STUDIO_SMOKE_SCRIPT) {
        const result = await target.webContents.executeJavaScript(fs.readFileSync(process.env.STUDIO_SMOKE_SCRIPT, 'utf8'));
        if (result !== undefined) console.log(`smoke: ${JSON.stringify(result)}`);
      }
      await new Promise(resolve => setTimeout(resolve, Number(process.env.STUDIO_SCREENSHOT_DELAY || 1000)));
      const image = await target.webContents.capturePage();
      fs.writeFileSync(process.env.STUDIO_SCREENSHOT, image.toPNG());
      console.log(`smoke: saved ${process.env.STUDIO_SCREENSHOT}`);
    } catch (error) {
      console.error(`smoke: ${error.stack || error.message}`);
      process.exitCode = 1;
    }
    app.quit();
  });
  target.webContents.on('console-message', (event, legacyLevel, legacyMessage) => {
    const level = event.level ?? legacyLevel, message = event.message ?? legacyMessage;
    if (level === 'warning' || level === 'error' || level >= 2) console.error(`renderer: ${message}`);
  });
}

app.whenReady().then(() => {
  backend = createElectronBackend();
  registerIpc();
  registerProtocol();
  backend.loadPlugins();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

let quitting = false;
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  (backend ? backend.shutdown() : Promise.resolve()).finally(() => app.quit());
});
