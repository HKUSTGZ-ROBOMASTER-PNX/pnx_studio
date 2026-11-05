'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const plugin = require('../plugins/system-identification/main.cjs');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-autoid-main-'));
  const handlers = {}, events = [];
  plugin.activate({ commands: { register: (name, callback) => { handlers[name] = callback; } }, postMessage: event => events.push(event) });
  t.after(async () => { await plugin.deactivate(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, handlers, events };
}
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for state');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('offline errors are asynchronous and the selected CSV is never changed', async t => {
  const { root, handlers } = setup(t);
  const file = path.join(root, 'bad.csv');
  fs.writeFileSync(file, 'not a valid file\n');
  assert.equal(handlers.analyze({ file }).phase, 'analyzing');
  await until(() => handlers.state().phase === 'error');
  assert.match(handlers.state().error, /Unexpected CSV columns/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'not a valid file\n');
  assert.equal(handlers.state().metadataSource, 'v1-default');
});

test('capture handles a serial process and waits for abort acknowledgement', { skip: process.platform === 'win32' }, async t => {
  const { root, handlers } = setup(t);
  const executable = path.join(root, 'fake-adapter');
  fs.writeFileSync(executable, `#!/bin/sh
if [ "$1" = "--auto-id-list" ]; then
  printf '%s\\n' '[{"path":"mock-port","description":"fake"}]'
  exit 0
fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--port" ]; then shift; port="$1"; fi
  if [ "$1" = "--output" ]; then shift; output="$1"; break; fi
  shift
done
printf '%s\\n' 'time_ms,yaw_pos_ref_rad,yaw_pos_fdb_rad,yaw_speed_fdb_rad_s,yaw_current_cmd,yaw_current_saturated' > "$output"
printf '%s\\n' '{"type":"started","metadata":{"T":40,"buffer_ratio":0.2,"pitch_rad":0}}'
IFS= read -r line
if [ "$line" = "abort" ]; then
  if [ "$port" = "unacknowledged" ]; then
    printf '%s\\n' '{"type":"error","message":"Abort was sent but MCU did not acknowledge it"}'
    exit 1
  fi
  printf '%s\\n' '{"type":"aborted","metadata":{"T":40,"buffer_ratio":0.2,"pitch_rad":0},"stats":{"dropped":2},"samples":0}'
fi
`);
  fs.chmodSync(executable, 0o755);
  const old = process.env.STUDIO_ADAPTER;
  const testContext = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  process.env.STUDIO_ADAPTER = executable;
  t.after(() => {
    if (old === undefined) delete process.env.STUDIO_ADAPTER; else process.env.STUDIO_ADAPTER = old;
    if (testContext !== undefined) process.env.NODE_TEST_CONTEXT = testContext;
  });
  assert.deepEqual(await handlers.ports(), [{ path: 'mock-port', description: 'fake' }]);
  const file = path.join(root, 'raw.csv');
  assert.equal(handlers.start({ port: 'mock-port', file }).phase, 'starting');
  assert.throws(() => handlers.start({ port: 'mock-port', file }), /already running/);
  await until(() => handlers.state().phase === 'running');
  assert.equal(handlers.abort().phase, 'stopping');
  await until(() => handlers.state().phase === 'aborted');
  assert.ok(fs.existsSync(file));
  const meta = JSON.parse(fs.readFileSync(`${file}.meta.json`, 'utf8'));
  assert.equal(meta.status, 'aborted');
  assert.equal(meta.stats.dropped, 2);
  assert.throws(() => handlers.start({ port: 'mock-port', file }), /already exists/);
  handlers.start({ port: 'unacknowledged', file: path.join(root, 'unacknowledged.csv') });
  await until(() => handlers.state().phase === 'running');
  handlers.abort();
  await until(() => handlers.state().phase === 'error');
  assert.match(handlers.state().error, /did not acknowledge/);
});

test('successful analysis uses recorded drop statistics and exports the result', async t => {
  const { root, handlers } = setup(t);
  const file = path.join(root, 'raw.csv');
  const rows = ['time_ms,yaw_pos_ref_rad,yaw_pos_fdb_rad,yaw_speed_fdb_rad_s,yaw_current_cmd,yaw_current_saturated'];
  let speed = 0, previous = 0;
  const pole = Math.exp(-0.01 / 0.1);
  for (let i = 0; i < 4000; i++) {
    const current = i < 800 ? 0 : 1000 * Math.sin(i * 0.071);
    speed = pole * speed - 0.0002 * (1 - pole) * previous;
    rows.push(`${i * 10},0,0,${speed},${current},0`);
    previous = current;
  }
  fs.writeFileSync(file, rows.join('\n') + '\n');
  fs.writeFileSync(`${file}.meta.json`, JSON.stringify({ metadata: { T: 40, buffer_ratio: 0.2, pitch_rad: 0 }, stats: { dropped: 4 } }));
  handlers.analyze({ file, kTau: -0.00002 });
  await until(() => ['finished', 'error'].includes(handlers.state().phase));
  const state = handlers.state();
  assert.equal(state.phase, 'finished', state.error);
  assert.equal(state.result.summary.dropped_samples, 4);
  assert.equal(state.samples, 4000);
  assert.equal(state.metadataSource, 'capture');
  assert.ok(state.result.summary.fit_percent > 95);
  assert.ok(Number.isFinite(state.result.summary.J));
  assert.ok(state.result.signals.time_s.length > 100);
  assert.ok(state.result.rawSignals.yaw_current_cmd.length > 100);
  assert.throws(() => handlers['save-result']({ file }), /preserve the raw capture/);
  assert.throws(() => handlers['save-result']({ file: `${file}.meta.json` }), /preserve the raw capture/);
  assert.ok(fs.readFileSync(file, 'utf8').startsWith('time_ms,'));
  const output = path.join(root, 'summary.json');
  handlers['save-result']({ file: output });
  const saved = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(saved.summary.dropped_samples, 4);
  assert.equal(saved.metadata.T, 40);
  fs.unlinkSync(`${file}.meta.json`);
  handlers.analyze({ file });
  await until(() => ['finished', 'error'].includes(handlers.state().phase));
  assert.equal(handlers.state().phase, 'finished', handlers.state().error);
  assert.equal(handlers.state().metadataSource, 'v1-default');
  assert.equal(handlers.state().result.summary.dropped_samples, null);

  if (process.platform !== 'win32') {
    const adapter = path.join(root, 'capture-adapter');
    fs.writeFileSync(adapter, `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then shift; output="$1"; break; fi
  shift
done
cp "$TEST_AUTOID_SAMPLE" "$output"
printf '%s\\n' '{"type":"started","metadata":{"T":40,"buffer_ratio":0.2,"pitch_rad":0}}'
printf '%s\\n' '{"type":"finished","metadata":{"T":40,"buffer_ratio":0.2,"pitch_rad":0},"stats":{"dropped":4},"samples":4000}'
`);
    fs.chmodSync(adapter, 0o755);
    const oldAdapter = process.env.STUDIO_ADAPTER;
    const oldSample = process.env.TEST_AUTOID_SAMPLE;
    process.env.STUDIO_ADAPTER = adapter;
    process.env.TEST_AUTOID_SAMPLE = file;
    t.after(() => {
      if (oldAdapter === undefined) delete process.env.STUDIO_ADAPTER; else process.env.STUDIO_ADAPTER = oldAdapter;
      if (oldSample === undefined) delete process.env.TEST_AUTOID_SAMPLE; else process.env.TEST_AUTOID_SAMPLE = oldSample;
    });
    const captured = path.join(root, 'captured.csv');
    handlers.start({ port: 'mock-port', file: captured });
    await until(() => ['finished', 'error'].includes(handlers.state().phase));
    assert.equal(handlers.state().phase, 'finished', handlers.state().error);
    assert.equal(handlers.state().result.summary.dropped_samples, 4);
    assert.equal(JSON.parse(fs.readFileSync(`${captured}.meta.json`, 'utf8')).status, 'finished');
  }
});

test('serial listing reports an absent native adapter', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-autoid-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pluginDir = path.join(root, 'plugins/system-identification');
  const coreDir = path.join(root, 'electron/core');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(coreDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../plugins/system-identification/main.cjs'), path.join(pluginDir, 'main.cjs'));
  fs.copyFileSync(path.join(__dirname, '../electron/core/platform.cjs'), path.join(coreDir, 'platform.cjs'));
  const isolated = require(path.join(pluginDir, 'main.cjs'));
  const commands = {};
  isolated.activate({ commands: { register: (name, handler) => { commands[name] = handler; } }, postMessage: () => {} });
  const old = process.env.STUDIO_ADAPTER;
  delete process.env.STUDIO_ADAPTER;
  try { await assert.rejects(commands.ports(), /adapter not found/i); }
  finally { if (old !== undefined) process.env.STUDIO_ADAPTER = old; await isolated.deactivate(); }
});
