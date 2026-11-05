import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setReleaseVersion } from '../scripts/set-release-version.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'studio-release-version-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = { name: 'embedded-studio', version: '0.1.0', private: true, devDependencies: { electron: '38.8.6' } };
  const lock = { name: 'embedded-studio', version: '0.1.0', lockfileVersion: 3, packages: {
    '': { name: 'embedded-studio', version: '0.1.0', devDependencies: { electron: '38.8.6' } },
    'node_modules/electron': { version: '38.8.6', resolved: 'https://example.test/electron.tgz' },
  } };
  const files = [path.join(root, 'package.json'), path.join(root, 'package-lock.json')];
  writeFileSync(files[0], JSON.stringify(pkg, null, 2) + '\n');
  writeFileSync(files[1], JSON.stringify(lock, null, 2) + '\n');
  return { root, pkg, lock, files };
}

test('release version updates package and lockfile while preserving dependency metadata', t => {
  const { root, pkg, lock, files } = fixture(t);
  assert.equal(setReleaseVersion(root, 'v1.2.30'), '1.2.30');
  const actualPackage = JSON.parse(readFileSync(files[0], 'utf8'));
  const actualLock = JSON.parse(readFileSync(files[1], 'utf8'));
  pkg.version = '1.2.30';
  lock.version = '1.2.30';
  lock.packages[''].version = '1.2.30';
  assert.deepEqual(actualPackage, pkg);
  assert.deepEqual(actualLock, lock);
});

test('invalid tags fail without changing either file', t => {
  const { root, files } = fixture(t);
  const before = files.map(file => readFileSync(file, 'utf8'));
  for (const tag of [undefined, '', '1.2.3', 'v01.2.3', 'v1.02.3', 'v1.2.03', 'v1.2', 'v1.2.3-rc.1', 'v1.2.3+build', 'v1.2.3\n', ' v1.2.3', 'v1.2.3.4', 'v9007199254740992.0.0']) {
    assert.throws(() => setReleaseVersion(root, tag), /Expected a release tag/, String(tag));
    assert.deepEqual(files.map(file => readFileSync(file, 'utf8')), before);
  }
});

test('invalid lockfile is rejected before package.json is modified', t => {
  const { root, files, lock } = fixture(t);
  const packageBefore = readFileSync(files[0], 'utf8');
  delete lock.packages[''];
  writeFileSync(files[1], JSON.stringify(lock));
  assert.throws(() => setReleaseVersion(root, 'v1.2.3'), /root package entry/);
  assert.equal(readFileSync(files[0], 'utf8'), packageBefore);
  lock.packages[''] = { name: 'other', version: '0.1.0' };
  writeFileSync(files[1], JSON.stringify(lock));
  assert.throws(() => setReleaseVersion(root, 'v1.2.3'), /names do not match/);
  assert.equal(readFileSync(files[0], 'utf8'), packageBefore);
});
