const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const cp = require('node:child_process');

test('setup streams progress, relays prompts and reports exit status', async () => {
  const original = cp.spawn; let spawned, captured;
  cp.spawn = (file, args, options) => {
    captured = { file, args, options };
    spawned = new EventEmitter();
    spawned.stdout = new PassThrough(); spawned.stderr = new PassThrough(); spawned.stdin = new PassThrough();
    return spawned;
  };
  const name = require.resolve('../plugins/embedded-setup/main.cjs'); delete require.cache[name];
  const plugin = require(name); cp.spawn = original;
  const commands = {}, messages = [], consoleLines = [];
  plugin.activate({ commands: { register: (id, fn) => { commands[id] = fn; } }, postMessage: message => messages.push(message), log: (text, level) => consoleLines.push({ text, level }) });
  const directory = require('node:path').resolve('toolchain with spaces');
  commands.start({ mode: 'install', directory });
  assert.ok(captured.args.includes(directory));
  assert.equal(captured.options.shell, undefined);
  assert.throws(() => commands.start({ mode: 'scan', directory }), /already running/);
  spawned.stdout.write('[SCAN 1s] dirs=10 tools=1 denied=0 err=0 queue=2 | C:\\tools\n');
  assert.equal(commands.state().progress.directories, 10);
  assert.equal(commands.state().progress.found, 1);
  spawned.stdout.write('[CANDIDATE] C:\\tools\\cmake.exe\n');
  assert.deepEqual(commands.state().progress.candidates, ['C:\\tools\\cmake.exe']);
  spawned.stdout.write('[SCAN DONE 2s] directories=10 candidates=1 denied=2 errors=3\n');
  assert.equal(commands.state().progress.stage, 'scanned');
  assert.equal(commands.state().progress.denied, 2);
  spawned.stderr.write('[ASK] Continue?\n');
  assert.equal(commands.state().prompt, 'Continue?');
  assert.ok(consoleLines.some(item => item.text.includes('dirs=10') && item.level === 'info'));
  assert.ok(consoleLines.some(item => item.text === '[ASK] Continue?' && item.level === 'info'));
  spawned.stderr.write('[ERROR] failure example\n');
  assert.ok(consoleLines.some(item => item.text === '[ERROR] failure example' && item.level === 'error'));
  let answer = ''; spawned.stdin.on('data', chunk => { answer += chunk; });
  assert.throws(() => commands.respond({ value: 'yes\nno' }), /Invalid/);
  commands.respond({ value: 'y' }); assert.equal(answer, 'y\n');
  spawned.stdout.end(); spawned.stderr.end(); spawned.emit('close', 1, null);
  assert.equal(commands.state().phase, 'finished'); assert.equal(commands.state().code, 1);
  assert.ok(messages.length >= 4);
  plugin.deactivate(); delete require.cache[name];
});

test('rejects relative paths and invalid modes', () => {
  const plugin = require('../plugins/embedded-setup/main.cjs'), commands = {};
  plugin.activate({ commands: { register: (id, fn) => { commands[id] = fn; } }, postMessage() {} });
  assert.throws(() => commands.start({ mode: 'scan', directory: 'relative' }), /absolute/);
  assert.throws(() => commands.start({ mode: 'bad', directory: require('node:path').resolve('.') }), /Invalid/);
  assert.throws(() => commands.start({ mode: 'install', directory: require('node:path').resolve('.'), components: { cmake: 'reinstall' } }), /Invalid component/);
  plugin.deactivate();
});

test('component choices are passed to the setup script without shell interpolation', () => {
  const original = cp.spawn; let options, child;
  cp.spawn = (_file, _args, opts) => {
    options = opts; child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    return child;
  };
  const modulePath = require.resolve('../plugins/embedded-setup/main.cjs'); delete require.cache[modulePath];
  const plugin = require(modulePath); cp.spawn = original;
  const commands = {}; plugin.activate({ commands: { register: (name, fn) => { commands[name] = fn; } }, postMessage() {} });
  commands.start({ mode: 'install', directory: require('node:path').resolve('.'), components: {
    cmake: 'reinstall', git: 'skip', 'arm-none-eabi-gcc': 'skip', openocd: 'skip', STM32CubeMX: 'reuse', ninja: 'skip',
  } });
  assert.equal(options.env.STUDIO_SETUP_COMPONENTS, 'cmake,STM32CubeMX');
  assert.equal(options.env.STUDIO_SETUP_REINSTALL, 'cmake');
  child.stdout.end(); child.stderr.end(); child.emit('close', 0, null); plugin.deactivate(); delete require.cache[modulePath];
});

test('Windows script accepts graphical input on a redirected stream', { skip: process.platform !== 'win32' }, async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-bridge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = fs.readFileSync(path.join(__dirname, '../plugins/embedded-setup/install-windows.ps1'), 'utf8');
  const marker = 'Discover-Tools\nShow-Plan\nif ($ScanOnly)';
  assert.ok(script.replace(/\r\n/g, '\n').includes(marker));
  const adapted = script.replace(/\r\n/g, '\n').replace(marker, "Write-Host '[SCAN 1s] dirs=1 tools=0'\nif ($ScanOnly)");
  const file = path.join(root, 'setup.ps1'); fs.writeFileSync(file, adapted, 'utf8');
  const result = cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, '-NoPause'], { input: 'Q\n', encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[SCAN 1s\]/); assert.match(result.stdout, /\[ASK\]/);
});

test('Windows scanner runs headless with redirected streams and reports real progress', { skip: process.platform !== 'win32' }, t => {
  const fs = require('node:fs'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(process.cwd(), '.scan-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scanRoot = path.join(root, 'tools'); fs.mkdirSync(scanRoot);
  fs.writeFileSync(path.join(scanRoot, 'cmake.exe'), 'fixture, never executed');
  let source = fs.readFileSync(path.join(__dirname, '../plugins/embedded-setup/install-windows.ps1'), 'utf8').replace(/\r\n/g, '\n');
  const marker = 'Discover-Tools\nShow-Plan\nif ($ScanOnly)';
  assert.ok(source.includes(marker));
  source = source.replace(marker, 'Scan-Roots -Roots @($InstallDir) | Out-Null\nif ($ScanOnly)');
  const file = path.join(root, 'setup.ps1'); fs.writeFileSync(file, source, 'utf8');
  const result = cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, '-NoPause', '-ScanOnly', '-InstallDir', scanRoot], {
    encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /\[SCAN \d+s\] dirs=\d+ tools=\d+/);
  assert.match(result.stdout, /\[CANDIDATE\].*cmake\.exe/);
  assert.match(result.stdout, /\[SCAN DONE \d+s\] directories=\d+ candidates=1/);
  assert.doesNotMatch(result.stdout, /The handle is invalid/);
});

test('Windows script selects only requested components and marks a requested reinstall', { skip: process.platform !== 'win32' }, t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(process.cwd(), '.setup-plan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let source = fs.readFileSync(path.join(__dirname, '../plugins/embedded-setup/install-windows.ps1'), 'utf8').replace(/\r\n/g, '\n');
  source = source.replace('Discover-Tools\nShow-Plan\nif ($ScanOnly)', "Write-Host '[SCAN] test'\nif ($ScanOnly)");
  source = source.replace('Check-DiscoveredVersions\n$skipExisting = @{}', "$found = @{ cmake='C:\\old\\cmake.exe'; git='C:\\old\\git.exe' }; $discovered = @('C:\\old\\cmake.exe','C:\\old\\git.exe')\n$skipExisting = @{}");
  const marker = 'Select-ForceReinstall\nShow-Plan';
  assert.ok(source.includes(marker));
  source = source.replace(marker, "Select-ForceReinstall\nWrite-Host ('SELECTED=' + (Is-Selected 'cmake') + ',' + (Is-Selected 'git'))\nWrite-Host ('FORCE=' + ($forceTools.Keys -join ','))\nexit 0");
  const file = path.join(root, 'setup.ps1'); fs.writeFileSync(file, source, 'utf8');
  const result = cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, '-NoPause', '-InstallDir', path.join(root, 'tools')], {
    input: 'I\ny\ny\n', encoding: 'utf8', timeout: 15000,
    env: { ...process.env, STUDIO_SETUP_GUI: '1', STUDIO_SETUP_COMPONENTS: 'cmake', STUDIO_SETUP_REINSTALL: 'cmake' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`); assert.match(result.stdout, /SELECTED=True,False/); assert.match(result.stdout, /FORCE=cmake/);
});

test('direct mode discovers only selected components without scanning drives', { skip: process.platform !== 'win32' }, t => {
  const fs = require('node:fs'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(process.cwd(), '.direct-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const toolRoot = path.join(root, 'tools');
  for (const name of ['cmake', 'git']) {
    fs.mkdirSync(path.join(toolRoot, name, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(toolRoot, name, 'bin', `${name}.exe`), 'fixture');
  }
  const file = path.join(__dirname, '../plugins/embedded-setup/install-windows.ps1');
  const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = cp.spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, '-NoPause', '-ScanOnly', '-InstallDir', toolRoot], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { ...process.env, PATH: process.env.SystemRoot + '\\System32', TERM: 'dumb', NO_COLOR: '1', STUDIO_SETUP_GUI: '1', STUDIO_SETUP_DIRECT: '1', STUDIO_SETUP_COMPONENTS: 'cmake', STUDIO_SETUP_REINSTALL: '' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /\[DIRECT\] Checking PATH/);
  assert.match(result.stdout, /\[CANDIDATE\].*cmake\.exe/i);
  assert.doesNotMatch(result.stdout, /\[CANDIDATE\].*git\.exe/i);
  assert.doesNotMatch(result.stdout, /Scanning all mounted filesystem drives|\[SCAN \d+s\]/);
});

test('direct installation processes only the selected missing tool', { skip: process.platform !== 'win32' }, t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const toolRoot = path.join(root, 'tools');
  fs.mkdirSync(path.join(toolRoot, '.staging-foreign'), { recursive: true });
  fs.writeFileSync(path.join(toolRoot, '.staging-foreign', 'keep.txt'), 'unrelated');
  let source = fs.readFileSync(path.join(__dirname, '../plugins/embedded-setup/install-windows.ps1'), 'utf8');
  const marker = "if (-not $InstallDir) { $InstallDir = 'D:\\embedded_toolchain' }";
  assert.ok(source.includes(marker));
  source = source.replace(marker, `function Download([string]$Url, [string]$File) { [IO.File]::WriteAllText($File, ('0' * 64) + '  cmake-3.22.6-windows-x86_64.zip') }
function Install-Zip([string]$Name, [string]$Url, [string]$VersionPattern, [string]$Digest = '') { Write-Host "MOCK-INSTALL $Name"; $script:found[$Name] = 'C:\\mock\\cmake.exe' }
function Remove-OldTool([string]$Name, [string]$NewExecutable) { }
function Add-ToolPath([string]$Executable) { }
function Save-Path { Write-Host 'MOCK-PATH' }
${marker}`);
  const script = path.join(root, 'setup.ps1'); fs.writeFileSync(script, source, 'utf8');
  const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = cp.spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-NoPause', '-InstallDir', toolRoot], {
    input: 'y\ny\n', encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { ...process.env, PATH: process.env.SystemRoot + '\\System32', TERM: 'dumb', NO_COLOR: '1', STUDIO_SETUP_GUI: '1', STUDIO_SETUP_DIRECT: '1', STUDIO_SETUP_COMPONENTS: 'cmake', STUDIO_SETUP_REINSTALL: '' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /MOCK-INSTALL cmake/);
  assert.match(result.stdout, /MOCK-PATH/);
  assert.doesNotMatch(result.stdout, /MOCK-INSTALL (git|ninja|openocd)/);
  assert.doesNotMatch(result.stdout, /Scanning all mounted filesystem drives/);
  assert.deepEqual(fs.readdirSync(toolRoot).filter(name => name.startsWith('.staging-')), ['.staging-foreign']);
  assert.equal(fs.readFileSync(path.join(toolRoot, '.staging-foreign', 'keep.txt'), 'utf8'), 'unrelated');
});

test('failed download or extraction removes only the current run temporary files', { skip: process.platform !== 'win32' }, t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-cleanup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const toolRoot = path.join(root, 'tools'); fs.mkdirSync(path.join(toolRoot, '.staging-foreign'), { recursive: true });
  let source = fs.readFileSync(path.join(__dirname, '../plugins/embedded-setup/install-windows.ps1'), 'utf8');
  const marker = "if (-not $InstallDir) { $InstallDir = 'D:\\embedded_toolchain' }";
  source = source.replace(marker, `function Release-Asset([string]$Repo, [string]$Pattern) { return @{ browser_download_url = 'https://example.invalid/ninja.zip'; digest = '' } }
function Download([string]$Url, [string]$File) { [IO.File]::WriteAllText($File, 'invalid archive') }
function Save-Path { }
${marker}`);
  const script = path.join(root, 'setup.ps1'); fs.writeFileSync(script, source, 'utf8');
  const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = cp.spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-NoPause', '-InstallDir', toolRoot], {
    input: 'y\ny\n', encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { ...process.env, PATH: process.env.SystemRoot + '\\System32', TERM: 'dumb', NO_COLOR: '1', STUDIO_SETUP_GUI: '1', STUDIO_SETUP_DIRECT: '1', STUDIO_SETUP_COMPONENTS: 'ninja', STUDIO_SETUP_REINSTALL: '' },
  });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /FAILED/);
  assert.deepEqual(fs.readdirSync(toolRoot).filter(name => name.startsWith('.staging-')), ['.staging-foreign']);
});

test('successful archive installation removes downloads but preserves installed files', { skip: process.platform !== 'win32' }, t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-success-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const toolRoot = path.join(root, 'tools');
  let source = fs.readFileSync(path.join(__dirname, '../plugins/embedded-setup/install-windows.ps1'), 'utf8');
  const versionLine = '$output = & $exe.FullName --version 2>&1'; assert.ok(source.includes(versionLine));
  source = source.replace(versionLine, "$output = 'fixture version'; $global:LASTEXITCODE = 0");
  const marker = "if (-not $InstallDir) { $InstallDir = 'D:\\embedded_toolchain' }";
  source = source.replace(marker, `function Release-Asset([string]$Repo, [string]$Pattern) { return @{ browser_download_url = 'https://example.invalid/ninja.zip'; digest = '' } }
function Download([string]$Url, [string]$File) { [IO.File]::WriteAllText($File, 'archive fixture') }
function Expand-Archive([string]$LiteralPath, [string]$DestinationPath) { New-Item -ItemType Directory -Path $DestinationPath | Out-Null; [IO.File]::WriteAllText((Join-Path $DestinationPath 'ninja.exe'), 'executable fixture') }
function Remove-OldTool([string]$Name, [string]$NewExecutable) { }
function Add-ToolPath([string]$Executable) { }
function Save-Path { }
${marker}`);
  const script = path.join(root, 'setup.ps1'); fs.writeFileSync(script, source, 'utf8');
  const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = cp.spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-NoPause', '-InstallDir', toolRoot], {
    input: 'y\ny\n', encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { ...process.env, PATH: process.env.SystemRoot + '\\System32', TERM: 'dumb', NO_COLOR: '1', STUDIO_SETUP_GUI: '1', STUDIO_SETUP_DIRECT: '1', STUDIO_SETUP_COMPONENTS: 'ninja', STUDIO_SETUP_REINSTALL: '' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /ninja\s+INSTALLED/);
  assert.ok(fs.existsSync(path.join(toolRoot, 'ninja', 'ninja.exe')));
  assert.ok(fs.existsSync(path.join(toolRoot, 'ninja', '.embedded-toolchain-owner.json')));
  assert.ok(!fs.readdirSync(toolRoot).some(name => name.startsWith('.staging-')));
});

test('download-only CubeMX retains its installer and removes the temporary archive', { skip: process.platform !== 'win32' }, t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-cube-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const toolRoot = path.join(root, 'tools');
  let source = fs.readFileSync(path.join(__dirname, '../plugins/embedded-setup/install-windows.ps1'), 'utf8');
  const marker = "if (-not $InstallDir) { $InstallDir = 'D:\\embedded_toolchain' }";
  source = source.replace(marker, `function Download([string]$Url, [string]$File) { [IO.File]::WriteAllText($File, 'temporary archive') }
function Expand-Archive([string]$LiteralPath, [string]$DestinationPath) { New-Item -ItemType Directory -Path $DestinationPath | Out-Null; [IO.File]::WriteAllText((Join-Path $DestinationPath 'SetupSTM32CubeMX-6.18.0.exe'), 'fixture'); [IO.File]::WriteAllText((Join-Path $DestinationPath 'runtime.dat'), 'runtime') }
function Save-Path { }
${marker}`);
  const script = path.join(root, 'setup.ps1'); fs.writeFileSync(script, source, 'utf8');
  const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = cp.spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-NoPause', '-InstallDir', toolRoot], {
    input: 'y\ny\n2\n', encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { ...process.env, PATH: process.env.SystemRoot + '\\System32', TERM: 'dumb', NO_COLOR: '1', STUDIO_SETUP_GUI: '1', STUDIO_SETUP_DIRECT: '1', STUDIO_SETUP_COMPONENTS: 'STM32CubeMX', STUDIO_SETUP_REINSTALL: '' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /READY \(not installed\)/);
  const entries = fs.readdirSync(toolRoot);
  assert.ok(!entries.some(name => name.startsWith('.staging-')));
  const saved = entries.find(name => name.startsWith('CubeMX-installer-')); assert.ok(saved);
  assert.ok(fs.existsSync(path.join(toolRoot, saved, 'SetupSTM32CubeMX-6.18.0.exe')));
  assert.ok(fs.existsSync(path.join(toolRoot, saved, 'runtime.dat')));
  assert.ok(!fs.existsSync(path.join(toolRoot, saved, 'CubeMX.zip')));
});

test('direct installation does not replace an incompatible existing tool unless requested', { skip: process.platform !== 'win32' }, t => {
  const fs = require('node:fs'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(process.cwd(), '.direct-existing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const toolRoot = path.join(root, 'tools'); const bin = path.join(toolRoot, 'cmake', 'bin');
  fs.mkdirSync(bin, { recursive: true }); fs.writeFileSync(path.join(bin, 'cmake.exe'), 'fixture');
  let source = fs.readFileSync(path.join(__dirname, '../plugins/embedded-setup/install-windows.ps1'), 'utf8');
  const marker = "if (-not $InstallDir) { $InstallDir = 'D:\\embedded_toolchain' }";
  source = source.replace(marker, `function Read-Version([string]$File) { return 'cmake version 9.0' }
function Download([string]$Url, [string]$File) { throw 'Unexpected download' }
function Remove-OldTool([string]$Name, [string]$NewExecutable) { throw 'Unexpected removal' }
function Save-Path { Write-Host 'MOCK-PATH' }
${marker}`);
  const script = path.join(root, 'setup.ps1'); fs.writeFileSync(script, source, 'utf8');
  const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = cp.spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-NoPause', '-InstallDir', toolRoot], {
    input: 'y\ny\n', encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { ...process.env, PATH: process.env.SystemRoot + '\\System32', TERM: 'dumb', NO_COLOR: '1', STUDIO_SETUP_GUI: '1', STUDIO_SETUP_DIRECT: '1', STUDIO_SETUP_COMPONENTS: 'cmake', STUDIO_SETUP_REINSTALL: '' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /SKIPPED \(existing version incompatible or unverifiable; choose reinstall\)/);
  assert.doesNotMatch(result.stdout, /Unexpected (download|removal)/);
});
