#!/usr/bin/env node
'use strict';
// Browser mode: serve the Embedded Studio UI over HTTP on 127.0.0.1 and open it in the
// default browser. Useful under WSL, where a Windows browser renders crisper than WSLg.
//
//   node server/serve.cjs [--port 7420] [--no-open] [--mock]
//
// The UI talks to the same backend as the desktop app: POST /api/call for requests and
// GET /api/events (server-sent events) for pushed messages. Every API call must carry the
// per-run token printed in the URL; the server only listens on loopback.
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const platform = require('../electron/core/platform.cjs');
const { createBackend } = require('../electron/core/backend.cjs');

const APP_ROOT = path.join(__dirname, '..');
const RENDERER_ROOT = path.join(APP_ROOT, 'renderer');
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const PORT = Number(option('--port', process.env.STUDIO_PORT || 7420));
const OPEN = !args.includes('--no-open');
const TOKEN = process.env.STUDIO_TOKEN || crypto.randomBytes(18).toString('base64url');
const MAX_BODY = 64 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function userDataDir() {
  if (process.env.STUDIO_USER_DATA) return path.resolve(process.env.STUDIO_USER_DATA);
  // Share settings with the desktop app (Electron's userData for productName "Embedded Studio").
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'Embedded Studio');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Embedded Studio');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Embedded Studio');
}

// ---------------------------------------------------------------- events (SSE)
const clients = new Set();
// Typed arrays (sample values) would otherwise serialize as index-keyed objects.
const jsonReplacer = (_key, value) => (ArrayBuffer.isView(value) ? Array.from(value) : value);
function send(channel, payload) {
  if (!clients.size) return;
  const frame = `data: ${JSON.stringify({ channel, payload }, jsonReplacer)}\n\n`;
  for (const client of clients) client.write(frame);
}

function openBrowser(url) {
  const kind = platform.hostKind();
  const fail = error => { if (error) console.log(`Open ${url} in your browser.`); };
  if (kind === 'wsl' || kind === 'windows') {
    // From WSL this launches the Windows default browser; WSL2 forwards localhost.
    const cmd = kind === 'wsl' ? 'cmd.exe' : 'cmd';
    execFile(cmd, ['/d', '/c', 'start', '', url.replaceAll('&', '^&')], { cwd: kind === 'wsl' ? '/mnt/c' : undefined, windowsHide: true }, fail);
  } else if (kind === 'macos') execFile('open', [url], fail);
  else execFile('xdg-open', [url], fail);
}

function showInFileManager(file) {
  const kind = platform.hostKind();
  if (kind === 'windows') spawn('explorer.exe', [`/select,${file}`], { detached: true });
  else if (kind === 'wsl') execFile('wslpath', ['-w', file], (error, out) => { if (!error) spawn('explorer.exe', [`/select,${out.trim()}`], { cwd: '/mnt/c', detached: true }); });
  else if (kind === 'macos') spawn('open', ['-R', file], { detached: true });
  else spawn('xdg-open', [path.dirname(file)], { detached: true });
}

const backend = createBackend({
  appRoot: APP_ROOT,
  userData: userDataDir(),
  resourcesPath: process.resourcesPath || null,
  version: JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version,
  runtime: 'web',
  startMock: args.includes('--mock'),
  assetBase: '/plugins',
  send,
  openExternal: url => openBrowser(url),
  showItem: file => showInFileManager(file),
  openPath: folder => showInFileManager(folder),
  reloadUi: () => send('app:reload', {}),
});

// ---------------------------------------------------------------- HTTP
function serveFile(res, file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error('Request too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function authorized(req, url) {
  const supplied = req.headers['x-studio-token'] || url.searchParams.get('token') || '';
  const a = Buffer.from(String(supplied)), b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  // Reject DNS-rebinding style requests: only loopback host names are served.
  const hostName = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostName)) { res.writeHead(403).end('Forbidden host'); return; }
  const url = new URL(req.url, 'http://127.0.0.1');
  const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);

  if (parts[0] === 'api') {
    if (!authorized(req, url)) { res.writeHead(401).end('Missing or wrong token'); return; }
    if (parts[1] === 'events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clearInterval(keepAlive); clients.delete(res); });
      return;
    }
    if (parts[1] === 'call' && req.method === 'POST') {
      let message;
      try { message = JSON.parse(await readBody(req)); } catch (error) { res.writeHead(400).end(error.message); return; }
      // JSON turns undefined arguments (e.g. an omitted timeout) into null; restore them.
      const callArgs = Array.isArray(message.args) ? message.args.map(value => (value === null ? undefined : value)) : [];
      const result = await backend.invoke(String(message.channel), callArgs);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result, jsonReplacer));
      return;
    }
    res.writeHead(404).end('Unknown API');
    return;
  }
  if (parts[0] === 'plugins' && parts.length >= 3) { serveFile(res, backend.plugins.resolveAsset(parts[1], parts.slice(2).join('/'))); return; }
  if (parts[0] === 'favicon.ico') { serveFile(res, path.join(APP_ROOT, 'assets', 'icon.ico')); return; }
  const file = path.resolve(RENDERER_ROOT, ...(parts.length ? parts : ['index.html']));
  serveFile(res, file.startsWith(RENDERER_ROOT + path.sep) ? file : null);
});

function listen(port) {
  server.once('error', error => {
    if (error.code === 'EADDRINUSE' && port !== 0) { console.log(`Port ${port} is busy; picking a free one.`); listen(0); }
    else { console.error(error.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    const address = `http://127.0.0.1:${server.address().port}/?token=${TOKEN}`;
    console.log(`Embedded Studio (browser mode) running at\n  ${address}\nPress Ctrl+C to stop.`);
    if (OPEN) openBrowser(address);
  });
}

backend.loadPlugins();
listen(PORT);

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('\nStopping…');
    for (const client of clients) client.end();
    server.close();
    backend.shutdown().finally(() => process.exit(0));
  });
}
