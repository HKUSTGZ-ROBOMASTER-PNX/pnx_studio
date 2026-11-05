'use strict';
// Browser mode (server/serve.cjs): token-gated API over HTTP on loopback.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const SERVE = path.join(__dirname, '..', 'server', 'serve.cjs');

function startServer() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-web-'));
  const child = spawn(process.execPath, [SERVE, '--no-open', '--port', '0'], {
    env: { ...process.env, STUDIO_USER_DATA: userData, STUDIO_TOKEN: 'test-token' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 10000);
    child.stdout.on('data', chunk => {
      out += chunk;
      const match = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(out);
      if (match) { clearTimeout(timer); resolve({ child, port: Number(match[1]) }); }
    });
    child.on('exit', code => reject(new Error(`server exited ${code}: ${out}`)));
  });
}

function request(port, { method = 'GET', path: urlPath = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const call = (port, channel, args, token = 'test-token') => request(port, {
  method: 'POST', path: '/api/call', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token },
  body: JSON.stringify({ channel, args }),
});

test('browser mode serves the UI and guards the API', async t => {
  const { child, port } = await startServer();
  t.after(() => child.kill());

  const index = await request(port);
  assert.strictEqual(index.status, 200);
  assert.match(index.body, /web-host\.js/);

  assert.strictEqual((await call(port, 'host:info', [], 'wrong')).status, 401);
  assert.strictEqual((await request(port, { headers: { Host: 'evil.example' } })).status, 403);

  const info = JSON.parse((await call(port, 'host:info', [])).body);
  assert.strictEqual(info.ok, true);
  assert.strictEqual(info.value.runtime, 'web');

  // JSON turns an omitted argument into null; handlers must still see their defaults.
  const settings = JSON.parse((await call(port, 'settings:set', [{ probe: 'auto' }, null])).body);
  assert.strictEqual(settings.ok, true);
  assert.strictEqual(settings.value.probe, 'auto');

  const unknown = JSON.parse((await call(port, 'nope', [])).body);
  assert.strictEqual(unknown.ok, false);
});
