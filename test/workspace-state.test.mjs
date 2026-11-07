import test from 'node:test';
import assert from 'node:assert/strict';

test('workspace migrates settings, serializes writes and isolates projects', async () => {
  const files = new Map();
  const writes = [];
  let release;
  const firstWrite = new Promise(resolve => { release = resolve; });
  let app = { projects: { A: { connection: { elf: 'old.elf' } } } };
  globalThis.window = { host: {
    settings: { get: async () => app, set: async patch => (app = { ...app, ...patch }) },
    fs: { listDir: async () => [] },
    workspace: {
      readConfig: async root => files.get(root) ?? null,
      writeConfig: async (root, settings) => {
        writes.push({ root, settings });
        if (writes.length === 1) await firstWrite;
        files.set(root, settings);
      },
    },
  } };
  const { workspace } = await import('../renderer/js/workspace.js');
  const closing = [];
  workspace.on('closing', ({ folder }) => closing.push(folder));
  await workspace.init();
  await workspace.open('A');
  const newer = workspace.saveSettings({ plots: { p: { color: '#112233' } } });
  await Promise.resolve();
  assert.equal(writes.length, 1);
  release();
  await newer;
  assert.equal(files.get('A').plots.p.color, '#112233');
  await workspace.open('B');
  assert.deepEqual(workspace.settings, {});
  await workspace.saveSettings({ plots: { q: {} } });
  await workspace.open('A');
  assert.equal(workspace.settings.connection.elf, 'old.elf');
  assert.equal(workspace.settings.plots.p.color, '#112233');
  assert.deepEqual(files.get('B'), { plots: { q: {} } });
  assert.deepEqual(closing, ['A', 'B']);

  let reported;
  workspace.on('config:error', payload => { reported = payload; });
  window.host.workspace.writeConfig = async () => { throw new Error('read only'); };
  await workspace.saveSettings({ watch: [] });
  assert.equal(reported.folder, 'A');
  assert.equal(reported.error.message, 'read only');
});
