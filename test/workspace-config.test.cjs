'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const workspace = require('../electron/core/workspace.cjs');

test('workspace config round trips in the project and rejects malformed files', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-config-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  assert.equal(workspace.readConfig(folder), null);
  const settings = { connection: { elf: '/firmware/main.elf' }, plots: { plot: { traces: [{ key: 'x', color: '#123456' }] } } };
  workspace.writeConfig(folder, settings);
  assert.deepEqual(workspace.readConfig(folder), settings);
  assert.deepEqual(fs.readdirSync(folder), ['.embedded-studio.json']);
  fs.writeFileSync(path.join(folder, '.embedded-studio.json'), '{invalid');
  assert.throws(() => workspace.readConfig(folder), SyntaxError);
  assert.equal(fs.readFileSync(path.join(folder, '.embedded-studio.json'), 'utf8'), '{invalid');
});

test('project ELF path survives moving the folder; external paths remain absolute', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-portable-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const original = path.join(parent, 'original');
  const moved = path.join(parent, 'moved');
  fs.mkdirSync(original);
  workspace.writeConfig(original, { connection: { elf: path.join(original, 'build', 'app.elf') } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(original, '.embedded-studio.json'))).connection.elf, 'build/app.elf');
  fs.renameSync(original, moved);
  assert.equal(workspace.readConfig(moved).connection.elf, path.join(moved, 'build', 'app.elf'));
  const external = path.join(parent, 'other.elf');
  workspace.writeConfig(moved, { connection: { elf: external } });
  assert.equal(workspace.readConfig(moved).connection.elf, external);
});
