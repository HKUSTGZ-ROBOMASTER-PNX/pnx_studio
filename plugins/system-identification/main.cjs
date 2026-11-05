'use strict';
// The adapter owns the serial port and writes raw telemetry directly to disk. The
// plugin never infers a torque conversion or writes to a target via the probe.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn, execFile } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { resolveAdapter } = require('../../electron/core/platform.cjs');

const V1_METADATA = Object.freeze({ pitch_rad: 0, T: 40, buffer_ratio: 0.2, f_start: 1, f_end: 50, amp_max: 0.05, omega_max: 1.7, alpha_max: 100, current_limit: 25000 });
const APP_ROOT = path.resolve(__dirname, '../..');
let state = { phase: 'idle', file: null, port: null, samples: 0, metadata: null, stats: null, error: null, result: null };
let contextRef = null;
let child = null;
let worker = null;
let generation = 0;
let shuttingDown = false;
const busy = () => !!child || !!worker;
const emit = patch => {
  state = { ...state, ...patch };
  contextRef?.postMessage({ type: 'state', state });
  return state;
};
function adapter() {
  const executable = resolveAdapter(APP_ROOT, process.resourcesPath || null);
  if (!executable) throw new Error('Studio adapter not found; build the native backend first');
  return executable;
}
function checkFile(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Choose an absolute CSV file path');
  return file;
}
function torque(value) {
  if (value === undefined || value === null || value === '') return null;
  const v = Number(value);
  if (!Number.isFinite(v)) throw new Error('Torque conversion must be a finite number');
  return v;
}
function metadataFromSidecar(file) {
  const meta = `${file}.meta.json`;
  try {
    const data = JSON.parse(fs.readFileSync(meta, 'utf8'));
    if (!data.metadata || typeof data.metadata !== 'object') throw new Error('missing metadata');
    return { metadata: data.metadata, stats: data.stats || {}, metadataSource: 'capture' };
  } catch (error) {
    if (error.code === 'ENOENT') return { metadata: { ...V1_METADATA }, stats: null, metadataSource: 'v1-default' };
    throw new Error(`Invalid capture metadata ${meta}: ${error.message}`);
  }
}
function saveSidecar(file, metadata, stats, samples, status) {
  const text = JSON.stringify({ metadata, stats, samples, status }, null, 2) + '\n';
  fs.writeFileSync(`${file}.meta.json`, text, { flag: 'wx' });
}
function runAnalysis(file, metadata, stats, kTau, expectedGeneration) {
  emit({ phase: 'analyzing', metadata, stats, error: null, result: null });
  const active = new Worker(path.join(__dirname, 'analysis-worker.cjs'), { workerData: {
    file, metadata, droppedSamples: Number.isInteger(stats?.dropped) ? stats.dropped : null, kTau,
  } });
  worker = active;
  let settled = false;
  const fail = error => {
    if (settled) return;
    settled = true;
    if (worker === active) worker = null;
    if (expectedGeneration === generation && !shuttingDown) emit({ phase: 'error', error: error.message || String(error) });
  };
  active.once('message', message => {
    if (settled) return;
    if (!message?.ok) { fail(new Error(message?.error || 'Analysis failed')); return; }
    settled = true;
    if (worker === active) worker = null;
    if (expectedGeneration === generation && !shuttingDown) emit({
      phase: 'finished', result: message.result, error: null,
      samples: state.port ? state.samples : message.result.summary.sample_count,
    });
  });
  active.once('error', fail);
  active.once('exit', code => { if (!settled) fail(new Error(`Analysis worker exited before completion (${code})`)); });
}
function clearForNew(phase, file, port) {
  return emit({ phase, file, port, samples: 0, metadata: null, stats: null, error: null, result: null, metadataSource: null });
}
function ports() {
  if (busy()) throw new Error('Identification is already running');
  return new Promise((resolve, reject) => execFile(adapter(), ['--auto-id-list'], { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
    if (error) return reject(new Error(stderr.trim() || error.message));
    try {
      const list = JSON.parse(stdout);
      if (!Array.isArray(list)) throw new Error('Expected an array');
      resolve(list);
    } catch (e) { reject(new Error(`Could not list serial ports: ${e.message}`)); }
  }));
}
function analyze({ file, kTau } = {}) {
  if (busy()) throw new Error('Identification is already running');
  file = checkFile(file);
  if (!fs.statSync(file).isFile()) throw new Error('Choose a raw CSV file');
  const scale = torque(kTau);
  const { metadata, stats, metadataSource } = metadataFromSidecar(file);
  const sequence = ++generation;
  clearForNew('analyzing', file, null);
  emit({ metadataSource });
  runAnalysis(file, metadata, stats, scale, sequence);
  return state;
}
function start({ port, baud = 921600, file, kTau } = {}) {
  if (busy()) throw new Error('Identification is already running');
  if (typeof port !== 'string' || !port.trim() || port.length > 1024 || /[\r\n\0]/.test(port)) throw new Error('Choose a serial port');
  baud = Number(baud);
  if (!Number.isInteger(baud) || baud < 1 || baud > 4000000) throw new Error('Invalid baud rate');
  file = checkFile(file);
  if (fs.existsSync(file) || fs.existsSync(`${file}.meta.json`)) throw new Error('Output file already exists; choose a new path');
  if (!fs.statSync(path.dirname(file)).isDirectory()) throw new Error('Output directory does not exist');
  const scale = torque(kTau);
  const executable = adapter();
  const sequence = ++generation;
  clearForNew('starting', file, port);
  const process = spawn(executable, ['--auto-id-capture', '--port', port, '--baud', String(baud), '--output', file], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child = process;
  let terminal = null, stderr = '';
  process.stdin.on('error', () => {});
  process.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-8192); });
  const lines = readline.createInterface({ input: process.stdout, crlfDelay: Infinity });
  lines.on('line', line => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (sequence !== generation || !event || typeof event !== 'object') return;
    if (event.type === 'started') emit({ phase: state.phase === 'stopping' ? 'stopping' : 'running', metadata: event.metadata, metadataSource: 'capture' });
    else if (event.type === 'progress') emit({ samples: event.samples });
    else if (['finished', 'aborted', 'error'].includes(event.type)) terminal = event;
  });
  process.once('error', error => { stderr = error.message; });
  process.once('close', code => {
    lines.close();
    if (child === process) child = null;
    if (sequence !== generation) return;
    const metadata = terminal?.metadata || state.metadata;
    const stats = terminal?.stats || {};
    const samples = terminal?.samples ?? state.samples;
    if (shuttingDown) {
      if (metadata && Object.keys(metadata).length && fs.existsSync(file)) {
        try { saveSidecar(file, metadata, stats, samples, terminal?.type || 'error'); } catch { /* keep the raw file */ }
      }
      return;
    }
    if (terminal?.type === 'finished' && code === 0) {
      try { saveSidecar(file, metadata, stats, samples, 'finished'); }
      catch (error) { emit({ phase: 'error', error: `Capture complete but metadata could not be saved: ${error.message}`, samples, metadata, stats }); return; }
      emit({ samples, metadata, stats, metadataSource: 'capture' });
      runAnalysis(file, metadata, stats, scale, sequence);
    } else {
      if (metadata && Object.keys(metadata).length && fs.existsSync(file)) {
        try { saveSidecar(file, metadata, stats, samples, terminal?.type || 'error'); }
        catch (error) { stderr = `${stderr}\nCould not save metadata: ${error.message}`.trim(); }
      }
      const aborted = terminal?.type === 'aborted';
      emit({ phase: aborted ? 'aborted' : 'error', samples, metadata, stats, error: aborted ? null : terminal?.message || stderr.trim() || `Capture exited (${code})` });
    }
  });
  return state;
}
function abort() {
  if (child) {
    try { child.stdin.write('abort\n'); } catch { /* child already closing */ }
    return emit({ phase: 'stopping' });
  }
  if (worker) {
    const active = worker; worker = null; generation++;
    active.terminate().catch(() => {});
    return emit({ phase: 'aborted', error: null });
  }
  return state;
}
function saveResult({ file } = {}) {
  file = checkFile(file);
  if (!state.result) throw new Error('No identification result to save');
  const normalized = value => {
    try { return fs.realpathSync(value); } catch { return path.resolve(value); }
  };
  if (state.file && [state.file, `${state.file}.meta.json`].some(value => normalized(file) === normalized(value))) {
    throw new Error('Choose a different output file to preserve the raw capture and metadata');
  }
  fs.writeFileSync(file, JSON.stringify({ ...state.result, metadata: state.metadata, stats: state.stats, metadataSource: state.metadataSource }, null, 2) + '\n');
  return { file };
}
exports.activate = context => {
  contextRef = context; shuttingDown = false;
  for (const [name, handler] of Object.entries({ ports, state: () => state, start, abort, analyze, 'save-result': saveResult })) context.commands.register(name, handler);
};
exports.deactivate = async () => {
  shuttingDown = true;
  if (worker) { const active = worker; worker = null; await active.terminate().catch(() => {}); }
  if (child) {
    const active = child;
    try { active.stdin.write('abort\n'); } catch { /* already closed */ }
    await new Promise(resolve => {
      const timeout = setTimeout(() => { active.kill(); resolve(); }, 4000);
      active.once('close', () => { clearTimeout(timeout); resolve(); });
    });
    if (child === active) child = null;
  }
  generation++; contextRef = null;
  state = { phase: 'idle', file: null, port: null, samples: 0, metadata: null, stats: null, error: null, result: null };
};
