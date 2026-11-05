'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveAdapter } = require('../electron/core/platform.cjs');
const root = path.join(__dirname, '..');
const debug = path.join(root, 'native/target/debug/studio-adapter');
const adapter = fs.existsSync(debug) ? debug : resolveAdapter(root, null);
const python = spawnSync('python3', ['--version']);
const reason = process.platform !== 'linux' ? 'requires Linux pseudo-terminals'
  : !adapter ? 'studio-adapter not built' : python.error ? 'python3 unavailable' : false;

test('Auto-ID serial transport captures and aborts through a pseudo-terminal', { skip: reason, timeout: 25000 }, () => {
  const result = spawnSync('python3', [path.join(__dirname, 'fixtures/auto-id/serial-pty.py'), adapter], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error || ''}`);
  assert.match(result.stdout, /capture, abort, EOF and unconfirmed abort passed/);
});
