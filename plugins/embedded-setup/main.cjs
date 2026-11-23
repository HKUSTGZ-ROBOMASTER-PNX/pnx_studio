'use strict';
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
let context, child = null;
let state = { phase: 'idle', prompt: null, code: null };
const platform = () => ({ platform: process.platform, arch: process.arch, release: os.release(), defaultDir: process.platform === 'win32' ? path.join(os.homedir(), 'embedded_toolchain') : path.join(os.homedir(), '.local', 'opt', 'embedded_toolchain') });
function emit(patch) { state = { ...state, ...patch }; context?.postMessage({ type: 'state', state }); return state; }
function line(value, isStderr = false) {
  const text = value.replace(/\r/g, '').trimEnd();
  if (!text) return;
  const level = /^\[(?:ERROR|SCAN ERROR)\]/.test(text) ? 'error' :
    (/^\[(?:DENIED|WARN)\]/.test(text) || (isStderr && !/^\[ASK\]/.test(text)) ? 'warn' : 'info');
  context?.log?.(text, level);
  const ask = /^\[ASK\]\s*(.*)$/.exec(text);
  if (ask) { emit({ prompt: ask[1] }); return; }
  const progress = { ...state.progress };
  let match = /^\[SCAN (\d+)s\] dirs=(\d+) tools=(\d+)(?: denied=(\d+))?(?: err=(\d+))?(?: queue=(\d+))?\s*\|\s*(.*)$/.exec(text);
  if (match) {
    Object.assign(progress, { stage: 'scanning', seconds: +match[1], directories: +match[2], found: +match[3], denied: +(match[4] || 0), errors: +(match[5] || 0), current: match[7] || '' });
    emit({ progress }); return;
  }
  match = /^\[SCAN DONE (\d+)s\] directories=(\d+) candidates=(\d+) denied=(\d+) errors=(\d+)/.exec(text);
  if (match) {
    Object.assign(progress, { stage: 'scanned', seconds: +match[1], directories: +match[2], found: +match[3], denied: +match[4], errors: +match[5], current: '' });
    emit({ progress }); return;
  }
  match = /^\[CANDIDATE\]\s*(.+)$/.exec(text);
  if (match) {
    progress.candidates = [...new Set([...(progress.candidates || []), match[1]])].slice(-500);
    emit({ progress }); return;
  }
  if (/^\[READ ONLY\] Discovery complete/.test(text)) { progress.stage = 'scanned'; emit({ progress }); return; }
  if (/^\s*>> Summary\s*$/.test(text)) { progress.stage = 'summary'; emit({ progress }); return; }
  if (progress.stage === 'summary') {
    match = /^(cmake|git|arm-none-eabi-gcc|openocd|STM32CubeMX|ninja)\s+(.+)$/i.exec(text);
    if (match) { progress.results = { ...progress.results, [match[1]]: match[2] }; emit({ progress }); return; }
  }
  if (/^\[(?:ERROR|SCAN ERROR)\]/.test(text)) {
    progress.issues = [...(progress.issues || []), text].slice(-20); emit({ progress }); return;
  }
}
const TOOLS = ['cmake', 'git', 'arm-none-eabi-gcc', 'openocd', 'STM32CubeMX', 'ninja'];
function start({ mode, directory, components } = {}) {
  if (child) throw new Error('A setup operation is already running.');
  if (!['scan', 'install', 'direct'].includes(mode)) throw new Error('Invalid operation.');
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || /[\r\n\0]/.test(directory)) throw new Error('Choose an absolute installation directory.');
  const choices = components ?? Object.fromEntries(TOOLS.map(name => [name, 'reuse']));
  if (!choices || typeof choices !== 'object' || Array.isArray(choices) || Object.keys(choices).some(name => !TOOLS.includes(name)) || TOOLS.some(name => !['skip', 'reuse', 'reinstall'].includes(choices[name])) || choices.STM32CubeMX === 'reinstall') throw new Error('Invalid component selection.');
  const selected = TOOLS.filter(name => choices[name] !== 'skip');
  const reinstall = TOOLS.filter(name => choices[name] === 'reinstall');
  if (mode !== 'scan' && selected.length === 0) throw new Error('Select at least one component.');
  const names = { win32: 'install-windows.ps1', linux: 'install-linux.sh', darwin: 'install-macos.sh' };
  const name = names[process.platform];
  if (!name) throw new Error('Unsupported platform.');
  if (process.platform === 'win32' && process.arch !== 'x64') throw new Error('The Windows setup script requires x64.');
  const script = path.join(__dirname, name);
  const args = process.platform === 'win32'
    ? ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-InstallDir', directory, '-NoPause', ...(mode === 'scan' ? ['-ScanOnly'] : [])]
    : [script, '--install-dir', directory, '--no-pause', ...(mode === 'scan' ? ['--scan-only'] : [])];
  const executable = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/bin/bash';
  state = { phase: 'running', prompt: null, code: null, mode,
    progress: { stage: mode === 'direct' ? 'direct' : 'scanning', seconds: 0, directories: 0, found: 0, denied: 0, errors: 0, current: '', candidates: [], results: {}, issues: [] } };
  const active = spawn(executable, args, { windowsHide: true, env: { ...process.env, TERM: 'dumb', NO_COLOR: '1', STUDIO_SETUP_GUI: '1', STUDIO_SETUP_DIRECT: mode === 'direct' ? '1' : '0', STUDIO_SETUP_COMPONENTS: selected.join(','), STUDIO_SETUP_REINSTALL: reinstall.join(',') }, stdio: ['pipe', 'pipe', 'pipe'] });
  child = active; emit({});
  for (const stream of [active.stdout, active.stderr]) {
    const decoder = new StringDecoder('utf8'); let pending = '';
    stream.on('data', chunk => { pending += decoder.write(chunk); const lines = pending.split('\n'); pending = lines.pop(); lines.forEach(value => line(value, stream === active.stderr)); });
    stream.on('end', () => { pending += decoder.end(); if (pending) line(pending, stream === active.stderr); });
  }
  active.once('error', error => { line(`[ERROR] ${error.message}`); });
  active.once('close', (code, signal) => {
    if (child === active) child = null;
    context?.log?.(`Setup process exited: ${code ?? signal ?? 'unknown'}`, code === 0 ? 'info' : 'error');
    emit({ phase: 'finished', prompt: null, code, signal });
  });
  return state;
}
function respond({ value } = {}) {
  if (!child || !state.prompt) throw new Error('No question is awaiting an answer.');
  if (typeof value !== 'string' || /[\r\n\0]/.test(value) || value.length > 4096) throw new Error('Invalid response.');
  child.stdin.write(`${value}\n`); return emit({ prompt: null });
}
exports.activate = ctx => { context = ctx; for (const [name, fn] of Object.entries({ platform, state: () => state, start, respond })) ctx.commands.register(name, fn); };
exports.deactivate = () => { if (child) { child.stdin.end(); } context = null; };
