'use strict';

// Exercise the shell actually embedded in the workflow, without GitHub or a
// YAML parser. GitHub runs the publish job on Linux; a small portable checksum
// shim lets these same tests run on macOS too.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const skip = process.platform === 'win32' ? 'workflow shell tests require bash' : false;
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/build.yml'), 'utf8');

function workflowScript(name) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf(`      - name: ${name}`);
  assert.notEqual(start, -1, `workflow step not found: ${name}`);
  let run = start + 1;
  while (run < lines.length && !lines[run].startsWith('      - ') && lines[run] !== '        run: |') run++;
  assert.equal(lines[run], '        run: |', `block shell script missing for ${name}`);
  const script = [];
  for (let i = run + 1; i < lines.length; i++) {
    if (lines[i] && !lines[i].startsWith('          ')) break;
    script.push(lines[i].slice(10));
  }
  assert.ok(script.length, `empty workflow script: ${name}`);
  return script.join('\n');
}

const classify = workflowScript('Determine whether this is a release tag push');
const collect = workflowScript('Collect platform-specific release files');
const publish = workflowScript('Verify all packages and publish release');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-release-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function run(script, cwd, env = {}) {
  return spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
    cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30000,
  });
}
function succeeds(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error || ''}`);
}
function write(dir, name, content = name) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

test('only stable version tag pushes qualify for release', { skip }, t => {
  const dir = temporary(t);
  const cases = [
    ['push', 'tag', 'v1.2.3', true],
    ['push', 'tag', 'v0.0.0', true],
    ['push', 'tag', 'v01.2.3', false],
    ['push', 'tag', 'v1.2.3-rc.1', false],
    ['push', 'branch', 'main', false],
    ['pull_request', 'branch', 'main', false],
    ['workflow_dispatch', 'tag', 'v1.2.3', false],
  ];
  for (const [event, type, name, expected] of cases) {
    const output = path.join(dir, 'output');
    fs.writeFileSync(output, '');
    succeeds(run(classify, dir, { EVENT_NAME: event, REF_TYPE: type, REF_NAME: name, GITHUB_OUTPUT: output }));
    assert.equal(fs.readFileSync(output, 'utf8').trim(), `publish=${expected}`, `${event} ${type} ${name}`);
  }
});

test('release collection requires each package type and rejects normalized name collisions', { skip }, t => {
  const dir = temporary(t);
  write(dir, 'dist/Embedded Studio.exe');
  let result = run(collect, dir, { ASSET_PLATFORM: 'windows-x64' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing windows-x64 package/);
  write(dir, 'dist/Embedded Studio.zip');
  fs.rmSync(path.join(dir, 'release'), { recursive: true, force: true });
  succeeds(run(collect, dir, { ASSET_PLATFORM: 'windows-x64' }));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'release')).sort(), ['windows-x64-Embedded-Studio.exe', 'windows-x64-Embedded-Studio.zip']);
  fs.rmSync(path.join(dir, 'release'), { recursive: true, force: true });
  write(dir, 'dist/Embedded?Studio.exe');
  result = run(collect, dir, { ASSET_PLATFORM: 'windows-x64' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /collision after normalization/);
});

test('four platform packages are verified and releases create or update with valid checksums', { skip }, t => {
  const dir = temporary(t);
  for (const file of ['Embedded Studio.exe', 'Embedded Studio.zip', 'Embedded Studio.AppImage', 'Embedded Studio.tar.gz', 'Embedded Studio.dmg']) {
    write(dir, `dist/${file}`, `content of ${file}`);
  }
  for (const platform of ['windows-x64', 'linux-x64', 'macos-x64', 'macos-arm64']) {
    succeeds(run(collect, dir, { ASSET_PLATFORM: platform }));
    fs.mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
    fs.renameSync(path.join(dir, 'release'), path.join(dir, 'artifacts', `embedded-studio-${platform}`));
  }

  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const checksum = write(dir, 'checksum.cjs', `
const fs = require('node:fs');
const crypto = require('node:crypto');
for (const file of process.argv.slice(2).filter(arg => arg !== '--')) {
  console.log(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') + '  ' + file);
}
`);
  const gh = write(dir, 'gh.cjs', `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_GH_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'release' && args[1] === 'view' && !fs.existsSync(process.env.TEST_GH_STATE)) process.exit(1);
if (args[0] === 'release' && args[1] === 'create') fs.writeFileSync(process.env.TEST_GH_STATE, 'created');
`);
  for (const [name, script] of [['sha256sum', checksum], ['gh', gh]]) {
    const wrapper = write(dir, `bin/${name}`, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    fs.chmodSync(wrapper, 0o755);
  }
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, RELEASE_TAG: 'v1.2.3', TEST_GH_LOG: path.join(dir, 'gh.log'), TEST_GH_STATE: path.join(dir, 'gh.state') };
  succeeds(run(publish, dir, env));
  const release = path.join(dir, 'release');
  const files = fs.readdirSync(release).sort();
  assert.equal(files.length, 7); // six platform packages and checksum file
  assert.ok(files.every(file => /^[A-Za-z0-9._-]+$/.test(file)), 'asset names are GitHub-safe ASCII');
  const sums = fs.readFileSync(path.join(release, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
  assert.equal(sums.length, 6);
  for (const line of sums) {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    assert.ok(match, `invalid checksum entry ${line}`);
    assert.equal(match[1], crypto.createHash('sha256').update(fs.readFileSync(path.join(release, match[2]))).digest('hex'));
  }
  fs.rmSync(release, { recursive: true, force: true });
  succeeds(run(publish, dir, env));
  const ghCalls = fs.readFileSync(env.TEST_GH_LOG, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const created = ghCalls.find(args => args[1] === 'create');
  const uploaded = ghCalls.find(args => args[1] === 'upload');
  assert.ok(created?.includes('--verify-tag'));
  assert.ok(uploaded?.includes('--clobber'));
  assert.equal(created.filter(arg => arg.startsWith('release/')).length, 7);
  assert.equal(uploaded.filter(arg => arg.startsWith('release/')).length, 7);

  fs.rmSync(release, { recursive: true, force: true });
  fs.rmSync(path.join(dir, 'artifacts/embedded-studio-windows-x64/windows-x64-Embedded-Studio.exe'));
  const missing = run(publish, dir, env);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Missing package \*\.exe/);
  assert.equal(fs.readFileSync(env.TEST_GH_LOG, 'utf8').trim().split('\n').length, ghCalls.length, 'missing package must not invoke gh');
});
