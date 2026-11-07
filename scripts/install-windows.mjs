// From WSL: build the Windows x64 app and install it into the Windows user profile,
// with Start-menu and desktop shortcuts so it launches from Explorer like any app.
//
// Usage (inside WSL, repo root):  node scripts/install-windows.mjs [--skip-native] [--no-shortcuts] [--plugins=all|none|id,id]
//
// Needs: the Rust target x86_64-pc-windows-gnu and a MinGW-w64 gcc
// (`x86_64-w64-mingw32-gcc` on PATH, or unpacked under ~/.local/opt/mingw/usr/bin).
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PLUGINS, parseSelection, readSelection, formatSelection } from './plugin-selection.mjs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const RUST_TARGET = 'x86_64-pc-windows-gnu';
const APP_NAME = 'Embedded Studio';

function step(message) { console.log(`\n▸ ${message}`); }
function run(command, commandArgs, options = {}) {
  execFileSync(command, commandArgs, { stdio: 'inherit', cwd: root, ...options });
}
function windows(command, commandArgs) {
  // Windows executables run from a \\wsl$ cwd print a UNC warning; run them from C:.
  return execFileSync(command, commandArgs, { cwd: '/mnt/c', encoding: 'utf8' }).replace(/\r/g, '').trim();
}

if (!/microsoft/i.test(os.release()) && !process.env.WSL_DISTRO_NAME) {
  console.error('This script installs a Windows build from WSL. On Windows itself run `npm run dist` instead.');
  process.exit(2);
}

// Read the previous choice before replacing the installation. Non-interactive runs
// preserve it, or install all plugins on a fresh install.
const localAppData = windows('cmd.exe', ['/d', '/c', 'echo %LOCALAPPDATA%']);
const installWin = `${localAppData}\\Programs\\${APP_NAME}`;
const installWsl = windows('wslpath', ['-u', installWin]);
const selectionFile = path.join(installWsl, 'resources', 'plugin-selection.ini');
let selected = new Set(PLUGINS.map(([id]) => id));
if (existsSync(selectionFile)) {
  try { selected = readSelection(readFileSync(selectionFile, 'utf8')); }
  catch (error) { console.error(`Cannot read plugin selection: ${error.message}`); process.exit(1); }
}
const selectionArg = args.find(arg => arg.startsWith('--plugins='));
if (selectionArg) {
  try { selected = parseSelection(selectionArg.slice('--plugins='.length)); }
  catch (error) { console.error(error.message); process.exit(2); }
} else if (stdin.isTTY && stdout.isTTY) {
  console.log('Optional plugins (comma-separated numbers, all, none; Enter keeps current choice):');
  PLUGINS.forEach(([id, name], i) => console.log(`  ${i + 1}. [${selected.has(id) ? 'x' : ' '}] ${name} (${id})`));
  const prompt = createInterface({ input: stdin, output: stdout });
  const answer = (await prompt.question('Selection: ')).trim();
  prompt.close();
  if (answer) {
    try {
      const choices = answer === 'all' || answer === 'none' ? answer : answer.split(',').map(part => {
        const index = Number(part.trim()) - 1;
        if (!Number.isInteger(index) || !PLUGINS[index]) throw new Error(`Invalid plugin number: ${part}`);
        return PLUGINS[index][0];
      }).join(',');
      selected = parseSelection(choices);
    } catch (error) { console.error(error.message); process.exit(2); }
  }
}

// ---------------------------------------------------------------- 1. Rust core for Windows
if (!args.includes('--skip-native')) {
  step('Building the Rust core for Windows (x86_64-pc-windows-gnu)');
  const env = { ...process.env };
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const localMingw = path.join(os.homedir(), '.local', 'opt', 'mingw', 'usr', 'bin');
  env.PATH = [cargoBin, existsSync(localMingw) ? localMingw : null, env.PATH].filter(Boolean).join(path.delimiter);
  const gcc = 'x86_64-w64-mingw32-gcc';
  if (spawnSync(gcc, ['--version'], { env }).status !== 0) {
    console.error(`${gcc} not found. Install mingw-w64 (sudo apt install gcc-mingw-w64-x86-64) or unpack it under ${localMingw}.`);
    process.exit(1);
  }
  env.CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = gcc;
  env.CC_x86_64_pc_windows_gnu = gcc;
  env.AR_x86_64_pc_windows_gnu = 'x86_64-w64-mingw32-ar';
  run(process.execPath, ['scripts/build-native.mjs', '--target', RUST_TARGET], { env });
}
if (!existsSync(path.join(root, 'bin', 'win32-x64', 'studio-adapter.exe'))) {
  console.error('bin/win32-x64/studio-adapter.exe is missing; run without --skip-native.');
  process.exit(1);
}

// ---------------------------------------------------------------- 2. Electron app for Windows
step('Packaging the Windows Electron app');
// Executable resource editing (rcedit) needs Wine on Linux; the shortcut carries the icon instead.
run(process.execPath, [path.join(root, 'node_modules', 'electron-builder', 'cli.js'),
  '--win', 'dir', '--x64', '--publish', 'never', '-c.win.signAndEditExecutable=false']);
const unpacked = path.join(root, 'dist', 'win-unpacked');

// ---------------------------------------------------------------- 3. Install into %LOCALAPPDATA%\Programs
step(`Installing to ${installWin}`);
const running = windows('tasklist.exe', ['/FI', `IMAGENAME eq ${APP_NAME}.exe`, '/NH']);
if (running.toLowerCase().includes(`${APP_NAME.toLowerCase()}.exe`)) {
  console.error(`Close ${APP_NAME} before installing, then run this command again.`);
  process.exit(1);
}
// Retry if a recently closed application has not yet released its files.
rmSync(installWsl, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
cpSync(unpacked, installWsl, { recursive: true });
for (const [id] of PLUGINS) if (!selected.has(id)) rmSync(path.join(installWsl, 'resources', 'plugins', id), { recursive: true, force: true });
writeFileSync(selectionFile, formatSelection(selected));

// ---------------------------------------------------------------- 3b. Optional: exe icon + version info
// The window/taskbar icon is set at runtime. To also brand the .exe file itself, place
// rcedit-x64.exe (github.com/electron/rcedit releases) in ~/.cache/embedded-studio/.
const rcedit = path.join(os.homedir(), '.cache', 'embedded-studio', 'rcedit-x64.exe');
if (existsSync(rcedit)) {
  step('Embedding icon and version info into the .exe (rcedit)');
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  execFileSync(rcedit, [`${installWin}\\${APP_NAME}.exe`, '--set-icon', `${installWin}\\resources\\icon.ico`,
    '--set-version-string', 'FileDescription', APP_NAME, '--set-version-string', 'ProductName', APP_NAME,
    '--set-file-version', version, '--set-product-version', version], { cwd: '/mnt/c', stdio: 'inherit' });
}

// ---------------------------------------------------------------- 4. Shortcuts
if (!args.includes('--no-shortcuts')) {
  step('Creating Start-menu and desktop shortcuts');
  const exe = `${installWin}\\${APP_NAME}.exe`;
  const iconFile = `${installWin}\\resources\\icon.ico`;
  const ps = `
$shell = New-Object -ComObject WScript.Shell
$targets = @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))
foreach ($dir in $targets) {
  $link = $shell.CreateShortcut((Join-Path $dir '${APP_NAME}.lnk'))
  $link.TargetPath = '${exe}'
  $link.WorkingDirectory = '${installWin}'
  $link.IconLocation = '${iconFile},0'
  $link.Description = 'Embedded debug studio (registers, live plots, stepping)'
  $link.Save()
}`;
  windows('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps]);
}

console.log(`\n✓ Installed. Launch "${APP_NAME}" from the Start menu or desktop, or run:\n  ${installWin}\\${APP_NAME}.exe`);
