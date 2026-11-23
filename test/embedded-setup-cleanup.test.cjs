'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const os = require('node:os');

const candidates = process.platform === 'win32'
  ? [path.join(process.env.ProgramFiles || '', 'Git', 'bin', 'bash.exe'), 'D:\\Apps\\Git\\bin\\bash.exe']
  : ['/bin/bash'];
const bash = candidates.find(file => fs.existsSync(file));

for (const platform of ['linux', 'macos']) {
  test(`${platform} archive cleanup handles success and failure without touching other staging`, { skip: !bash }, () => {
    const source = fs.readFileSync(path.join(__dirname, `../plugins/embedded-setup/install-${platform}.sh`), 'utf8');
    const cleanup = source.slice(source.indexOf('clear_owned_stage() {'), source.indexOf('\nfinish() {'));
    const archive = source.slice(source.indexOf('install_archive() ('), source.indexOf('\nas_root() {'));
    assert.ok(cleanup.startsWith('clear_owned_stage() {'));
    assert.ok(archive.startsWith('install_archive() ('));
    const script = `set -u\nset -o pipefail
ROOT=$(mktemp -d) || exit 1
trap 'rm -rf -- "$ROOT"' EXIT
WRITE_AUTHORIZED=1
${cleanup}
${archive}
mkdir -p "$ROOT/.staging.foreign" "$ROOT/fixture/bin"
printf 'keep' > "$ROOT/.staging.foreign/keep"
printf '#!/bin/sh\\necho fixture-ninja\\n' > "$ROOT/fixture/bin/ninja"
chmod +x "$ROOT/fixture/bin/ninja"
tar -cf "$ROOT/source.tar" -C "$ROOT/fixture" . || exit 2
download() { cp "$ROOT/source.tar" "$2"; }
installed=$(install_archive ninja 'https://example.invalid/source.tar' '^fixture-ninja') || exit 3
[ -x "$installed" ] || exit 4
download() { printf broken > "$2"; return 1; }
if install_archive other 'https://example.invalid/other.tar' '^x'; then exit 5; fi
[ "$(cat "$ROOT/.staging.foreign/keep")" = keep ] || exit 6
for item in "$ROOT"/.staging.*; do [ "$item" = "$ROOT/.staging.foreign" ] || exit 7; done
echo cleanup-ok
`;
    const result = spawnSync(bash, ['-s'], { input: script, encoding: 'utf8', timeout: 15000, windowsHide: true });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error || ''}`);
    assert.match(result.stdout, /cleanup-ok/);
  });

  test(`${platform} exit cleanup removes runtime and installer staging but keeps unrelated files`, { skip: !bash }, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-finish-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const folder of ['.staging.runtime.test', '.staging.cubemx.test', '.staging.foreign']) {
      fs.mkdirSync(path.join(root, folder)); fs.writeFileSync(path.join(root, folder, 'item'), 'fixture');
    }
    fs.writeFileSync(path.join(root, '.env.test'), 'partial');
    const source = fs.readFileSync(path.join(__dirname, `../plugins/embedded-setup/install-${platform}.sh`), 'utf8');
    const functions = source.slice(source.indexOf('clear_owned_stage() {'), source.indexOf('\ntrap finish EXIT'));
    let shellRoot = root;
    if (process.platform === 'win32') {
      const converted = spawnSync(bash, ['-c', 'cygpath -u "$1"', 'convert', root], { encoding: 'utf8', timeout: 5000 });
      assert.equal(converted.status, 0, converted.stderr); shellRoot = converted.stdout.trim();
    }
    const script = `set -u\nROOT=$CLEAN_ROOT\nSCAN_LINE=0\nNO_PAUSE=1\nSCAN_WORK="$ROOT/.staging.runtime.test"\nCUBE_WORK="$ROOT/.staging.cubemx.test"\nENV_TEMP="$ROOT/.env.test"\n${functions}\ntrap finish EXIT\nexit 0\n`;
    const result = spawnSync(bash, ['-s'], { input: script, encoding: 'utf8', timeout: 15000, windowsHide: true, env: { ...process.env, CLEAN_ROOT: shellRoot } });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(fs.readdirSync(root), ['.staging.foreign']);
    assert.equal(fs.readFileSync(path.join(root, '.staging.foreign', 'item'), 'utf8'), 'fixture');
  });

  test(`${platform} download-only CubeMX keeps installer payload without the archive`, { skip: !bash }, () => {
    const source = fs.readFileSync(path.join(__dirname, `../plugins/embedded-setup/install-${platform}.sh`), 'utf8');
    const cleanup = source.slice(source.indexOf('clear_owned_stage() {'), source.indexOf('\nfinish() {'));
    const cube = source.slice(source.indexOf('install_cube() {'), source.indexOf('\nsave_path() {'));
    assert.ok(cube.startsWith('install_cube() {'));
    const script = `set -u\nset -o pipefail
ROOT=$(mktemp -d) || exit 1
trap 'rm -rf -- "$ROOT"' EXIT
PLATFORM=Darwin
CUBE_INSTALLER=''
CUBE_WORK=''
STATUS=()
${cleanup}
${cube}
mkdir -p "$ROOT/fixture"
printf installer > "$ROOT/fixture/SetupSTM32CubeMX-test"
printf runtime > "$ROOT/fixture/runtime.dat"
tar -czf "$ROOT/source.tar" -C "$ROOT/fixture" . || exit 2
uname() { printf arm64; }
ask() { REPLY=2; }
banner() { :; }
ui_status() { :; }
download() { cp "$ROOT/source.tar" "$2"; }
install_cube || exit 3
[ -f "$CUBE_INSTALLER" ] || exit 4
case "$CUBE_INSTALLER" in "$ROOT"/CubeMX-installer-*/SetupSTM32CubeMX-test) ;; *) exit 5 ;; esac
[ -f "${'${CUBE_INSTALLER%/*}'}/runtime.dat" ] || exit 6
clear_owned_stage "$CUBE_WORK" || exit 7
[ ! -e "$CUBE_WORK" ] && [ -f "$CUBE_INSTALLER" ] || exit 8
echo cube-cleanup-ok
`;
    const result = spawnSync(bash, ['-s'], { input: script, encoding: 'utf8', timeout: 15000, windowsHide: true });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error || ''}`);
    assert.match(result.stdout, /cube-cleanup-ok/);
  });
}
