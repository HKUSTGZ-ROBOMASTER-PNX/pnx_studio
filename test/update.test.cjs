'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createUpdater, newer, selectRelease } = require('../electron/core/update.cjs');

const name = 'windows-x64-Embedded-Studio-1.2.3.exe';
const release = { tag_name: 'v1.2.3', assets: [{ name }, { name: 'SHA256SUMS.txt' }] };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t, overrides = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-update-test-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const body = Buffer.from('package content');
  const fetcher = async url => {
    if (url.includes('/releases/latest')) return new Response(JSON.stringify(release));
    if (url.endsWith('SHA256SUMS.txt')) return new Response(`${overrides.checksum || sha(body)}  ${name}\n`);
    if (overrides.redirect) return new Response(null, { status: 302, headers: { location: overrides.redirect } });
    return new Response(body);
  };
  return { updater: createUpdater({ version: '1.1.0', platform: 'win32', arch: 'x64', userData, fetcher }), userData, body };
}
test('compares stable numeric versions and selects a unique platform package', () => {
  assert.equal(newer('v1.10.0', '1.9.9'), true);
  assert.equal(newer('v1.2.3', '1.2.3'), false);
  assert.throws(() => newer('v1.0.0-rc1', '1.0.0'));
  assert.equal(selectRelease(release, 'win32', 'x64').name, name);
  assert.throws(() => selectRelease({ ...release, assets: [...release.assets, { name: 'windows-x64-other.exe' }] }, 'win32', 'x64'), /ambiguous/);
});
test('downloads the checked release only after verifying its SHA256', async t => {
  const { updater, body } = fixture(t);
  await assert.rejects(updater.download(), /Check/);
  assert.equal((await updater.check()).available, true);
  const result = await updater.download();
  assert.deepEqual(fs.readFileSync(result.path), body);
  assert.equal(updater.downloaded(), result.path);
  assert.equal(await updater.verified(), result.path);
  fs.writeFileSync(result.path, 'modified after download');
  await assert.rejects(updater.verified(), /checksum/);
});
test('rejects bad checksums and untrusted redirects without leaving a package', async t => {
  for (const overrides of [{ checksum: '0'.repeat(64) }, { redirect: 'https://evil.example/package' }, { redirect: 'http://github.com/file' }]) {
    const { updater, userData } = fixture(t, overrides);
    await updater.check();
    await assert.rejects(updater.download());
    assert.throws(() => updater.downloaded());
    const dir = path.join(userData, 'updates');
    assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], []);
  }
});
