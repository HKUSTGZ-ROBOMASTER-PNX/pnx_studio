'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PluginHost, discover } = require('../electron/core/plugins.cjs');
const platform = require('../electron/core/platform.cjs');

function tempPlugins(manifests) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-plugins-'));
  for (const [dir, manifest, files = {}] of manifests) {
    fs.mkdirSync(path.join(root, dir));
    fs.writeFileSync(path.join(root, dir, 'plugin.json'), JSON.stringify(manifest));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, dir, name), text);
  }
  return root;
}

test('bundled plugins have valid manifests', () => {
  const { plugins, errors } = discover([{ directory: path.join(__dirname, '..', 'plugins'), source: 'builtin' }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(plugins.map(p => p.id).sort(), ['csv-recorder', 'imu-attitude', 'memory-image']);
});

test('discover rejects bad ids, API mismatches and escaping entry points', () => {
  const root = tempPlugins([
    ['ok', { id: 'ok', apiVersion: 1 }],
    ['bad-id', { id: 'Bad Id', apiVersion: 1 }],
    ['old', { id: 'old', apiVersion: 0 }],
    ['escape', { id: 'escape', apiVersion: 1, main: '../../evil.cjs' }],
  ]);
  const { plugins, errors } = discover([{ directory: root, source: 'user' }]);
  assert.deepEqual(plugins.map(p => p.id), ['ok']);
  assert.equal(errors.length, 3);
});

test('main-process plugin commands and core events', async () => {
  const root = tempPlugins([['echo', { id: 'echo', apiVersion: 1, main: 'main.cjs' }, {
    'main.cjs': `exports.activate = ctx => {
      let seen = 0;
      ctx.core.on('samples', () => { seen++; });
      ctx.commands.register('seen', () => seen);
    };`,
  }]]);
  const logs = [];
  const host = new PluginHost({ session: () => null, broadcast: () => {}, log: (level, text) => logs.push(text), storageRoot: root });
  host.load([{ directory: root, source: 'user' }]);
  host.emit('samples', {});
  host.emit('samples', {});
  assert.equal(await host.execute('echo:seen'), 2);
  await assert.rejects(host.execute('echo:missing'), /Unknown command/);
  await host.deactivateAll();
  host.emit('samples', {});
  assert.deepEqual(logs, []);
});

test('disabled plugins are not activated and assets stay inside the plugin', () => {
  const root = tempPlugins([['p', { id: 'p', apiVersion: 1, main: 'main.cjs', renderer: 'r.js' }, { 'main.cjs': 'throw new Error("should not load")', 'r.js': '' }]]);
  const host = new PluginHost({ session: () => null, broadcast: () => {}, log: () => {}, storageRoot: root });
  host.load([{ directory: root, source: 'user' }], ['p']);
  assert.equal(host.describe().plugins[0].enabled, false);
  assert.equal(host.describe().plugins[0].renderer, null);
  assert.equal(host.resolveAsset('p', 'r.js'), null);
  host.load([{ directory: root, source: 'user' }], ['nothing']);
  assert.equal(host.resolveAsset('p', '../../etc/passwd'), null);
});

test('plugin-contributed debug cores resolve per platform', () => {
  const triple = `${process.platform}-${process.arch}`;
  const root = tempPlugins([['cores', { id: 'cores', apiVersion: 1, contributes: { adapters: [
    { id: 'a', label: 'A', executable: { [triple]: 'bin/a', default: 'bin/fallback' } },
    { id: 'b', executable: { 'plan9-mips': 'nope' } },
    { id: 'c', executable: 'c.exe' },
  ] } }]]);
  const host = new PluginHost({ session: () => null, broadcast: () => {}, log: () => {}, storageRoot: root });
  host.load([{ directory: root, source: 'user' }]);
  const adapters = host.adapters();
  assert.deepEqual(adapters.map(a => a.id), ['cores:a', 'cores:c']);
  assert.ok(adapters[0].executable.endsWith(path.join('cores', 'bin', 'a')));
});

test('platform hints exist for every host kind', () => {
  for (const kind of ['windows', 'macos', 'linux', 'wsl']) assert.ok(platform.probeAccessHints(kind).length > 0, kind);
  assert.ok(platform.probeAccessHints('wsl').some(hint => hint.includes('usbipd')));
  const candidates = platform.adapterCandidates('/app', '/res');
  assert.ok(candidates[0].startsWith(path.join('/res', 'bin')));
});

test('csv recorder writes only the chosen columns, in order, with quoted labels', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-csv-'));
  const host = new PluginHost({ session: () => null, broadcast: () => {}, log: () => {}, storageRoot: storage });
  host.load([{ directory: path.join(__dirname, '..', 'plugins'), source: 'builtin' }]);
  const file = path.join(storage, 'out.csv');
  await host.execute('csv-recorder:start', { file, columns: [{ id: 'b', label: 'imu.yaw' }, { id: 'a', label: 'odd,"label"' }] });
  // Interleaved per sample: a, x, b; channel x is someone else's subscription.
  host.emit('samples', { channelIds: ['a', 'x', 'b'], sampleCount: 2, startTimestampNs: 1000, samplePeriodNs: 500, values: [1, 9, 2, 3, 9, 4] });
  host.emit('samples', { channelIds: ['x'], sampleCount: 1, startTimestampNs: 2000, samplePeriodNs: 500, values: [9] });
  const state = await host.execute('csv-recorder:stop');
  await host.deactivateAll();
  assert.equal(state.rows, 2);
  assert.equal(fs.readFileSync(file, 'utf8'), 'time_s,imu.yaw,"odd,""label"""\n0.000000000,2,1\n0.000000500,4,3\n');
});
