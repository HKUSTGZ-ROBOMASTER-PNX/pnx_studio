'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findElfs, isFile } = require('../electron/core/workspace.cjs');

test('findElfs filters by signature and ranks valid builds by modification time', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-elf-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const old = path.join(root, 'old.elf');
  const newest = path.join(root, 'new.axf');
  fs.writeFileSync(old, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  fs.writeFileSync(newest, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  fs.writeFileSync(path.join(root, 'not-elf.out'), 'text output');
  fs.utimesSync(old, 1, 1);
  assert.deepEqual(findElfs(root), [newest, old]);
  assert.equal(isFile(newest), true);
  assert.equal(isFile(root), false);
  assert.equal(isFile(path.join(root, 'missing')), false);
});
