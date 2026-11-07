import test from 'node:test';
import assert from 'node:assert/strict';
import { createElfResolver } from '../renderer/js/auto-elf.js';

function fixture({ configured = '', existing = [], files = [] } = {}) {
  const workspace = { root: '/project', settings: { connection: { elf: configured, chip: 'chip' } }, saveSettings(patch) { Object.assign(this.settings, patch); } };
  const loaded = [];
  const detected = [];
  let scans = 0;
  const host = { fs: { isFile: async file => existing.includes(file) }, workspace: { findElfs: async () => { scans++; return files; } } };
  const resolve = createElfResolver({ workspace, host, loadSymbols: file => loaded.push(file), clearSymbols: () => loaded.push(null), onDetected: (...args) => detected.push(args) });
  return { workspace, host, resolve, loaded, detected, scans: () => scans };
}

test('keeps an existing configured ELF, even outside the project', async () => {
  const f = fixture({ configured: '/external/app.elf', existing: ['/external/app.elf'], files: ['/project/new.elf'] });
  await f.resolve('/project');
  assert.deepEqual(f.loaded, [null, '/external/app.elf']);
  assert.equal(f.scans(), 0);
});

test('detects newest firmware or clears a stale path', async () => {
  const f = fixture({ configured: '/old.elf', files: ['/project/new.elf', '/project/old.elf'] });
  await f.resolve('/project');
  assert.equal(f.workspace.settings.connection.elf, '/project/new.elf');
  assert.equal(f.workspace.settings.connection.chip, 'chip');
  assert.deepEqual(f.detected, [['/project/new.elf', 2]]);
  const empty = fixture({ configured: '/missing.elf' });
  await empty.resolve('/project');
  assert.equal(empty.workspace.settings.connection.elf, '');
});

test('ignores a scan after the user selects firmware or switches workspace', async () => {
  for (const change of ['selection', 'workspace']) {
    const f = fixture();
    let finish;
    f.host.workspace.findElfs = () => new Promise(resolve => { finish = resolve; });
    const pending = f.resolve('/project');
    if (change === 'selection') f.workspace.settings.connection.elf = '/chosen.elf';
    else f.workspace.root = '/other';
    finish(['/project/new.elf']);
    await pending;
    assert.deepEqual(f.loaded, [null]);
    assert.deepEqual(f.detected, []);
  }
});
