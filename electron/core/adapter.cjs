'use strict';
// Client for the Rust `studio-adapter` process.
//
// Control plane: Debug Adapter Protocol (Content-Length framed JSON) over stdio,
// extended with `studio/*` requests and `studio.*` events.
// Data plane:    a localhost TCP socket carrying binary `CKIT` sample batches.
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const net = require('node:net');

const MAX_FRAME = 32 * 1024 * 1024;
const DEBUG_COMMANDS = new Set(['pause', 'continue', 'next', 'stepIn', 'stepOut', 'restart']);

function runCli(adapterPath, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!adapterPath) { reject(new Error('studio-adapter binary not found; run `npm run build:native`')); return; }
    const child = spawn(adapterPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error(`${args[0]} timed out`)); }, timeoutMs);
    child.stdout.on('data', chunk => { out += chunk; if (out.length > 64 * 1024 * 1024) { child.kill(); finish(new Error('output too large')); } });
    child.stderr.on('data', chunk => { err = (err + chunk).slice(-8192); });
    child.on('error', finish);
    child.on('exit', code => {
      if (code !== 0) { finish(new Error(err.trim() || `${args[0]} failed (${code})`)); return; }
      try { finish(null, JSON.parse(out)); } catch (error) { finish(error); }
    });
  });
}

function probeFamily(item) {
  const text = `${item.probeType || ''} ${item.identifier || ''}`;
  if (/cmsis.?dap|daplink/i.test(text)) return 'CMSIS-DAP';
  if (/st.?link/i.test(text)) return 'ST-Link';
  if (/j.?link/i.test(text)) return 'J-Link';
  return String(item.probeType || 'Other').replaceAll('"', '');
}

async function listProbes(adapterPath) {
  const raw = await runCli(adapterPath, ['--list-probes']);
  if (!Array.isArray(raw)) throw new Error('Invalid probe list');
  return raw.filter(item => item && typeof item.selector === 'string' && item.selector)
    .map(item => ({ selector: item.selector, identifier: String(item.identifier || item.selector), serialNumber: item.serialNumber || null, family: probeFamily(item) }));
}

const targetCache = new Map();
async function listTargets(adapterPath) {
  if (!targetCache.has(adapterPath)) targetCache.set(adapterPath, runCli(adapterPath, ['--list-targets'], 30000).catch(error => { targetCache.delete(adapterPath); throw error; }));
  return targetCache.get(adapterPath);
}

function loadSvd(adapterPath, svdPath) {
  return runCli(adapterPath, ['--inspect-svd', svdPath], 60000);
}

function inspectElf(adapterPath, elfPath) {
  return runCli(adapterPath, ['--inspect-elf', elfPath], 60000);
}

function decodeBatch(payload) {
  let offset = 0;
  const take = count => { if (offset + count > payload.length) throw new Error('Truncated batch'); const at = offset; offset += count; return at; };
  const string = () => { const n = payload.readUInt16LE(take(2)); const at = take(n); return payload.toString('utf8', at, at + n); };
  if (payload.toString('latin1', take(4), 4) !== 'CKIT') throw new Error('Wrong sample magic');
  if (payload.readUInt16LE(take(2)) !== 1) throw new Error('Unsupported sample version');
  const sessionId = string();
  const programGeneration = Number(payload.readBigUInt64LE(take(8)));
  const streamEpoch = Number(payload.readBigUInt64LE(take(8)));
  const batchSequence = Number(payload.readBigUInt64LE(take(8)));
  const sampleCount = payload.readUInt32LE(take(4));
  const startTimestampNs = Number(payload.readBigUInt64LE(take(8)));
  const samplePeriodNs = Number(payload.readBigUInt64LE(take(8)));
  const droppedFrames = Number(payload.readBigUInt64LE(take(8)));
  const channelCount = payload.readUInt16LE(take(2));
  if (sampleCount > 100000 || channelCount > 256 || sampleCount * channelCount > 1000000) throw new Error('Batch too large');
  const channelIds = Array.from({ length: channelCount }, string);
  const values = new Float64Array(sampleCount * channelCount);
  for (let i = 0; i < values.length; i++) values[i] = payload.readDoubleLE(take(8));
  if (offset !== payload.length) throw new Error('Trailing sample bytes');
  return { sessionId, programGeneration, streamEpoch, batchSequence, sampleCount, startTimestampNs, samplePeriodNs, droppedFrames, channelIds, values };
}

/**
 * Events: 'dap' ({event, body}), 'samples' (batch), 'log' ({level, text}), 'closed' (Error).
 */
class AdapterSession extends EventEmitter {
  constructor(adapterPath) {
    super();
    this.adapterPath = adapterPath;
    this.pending = new Map();
    this.waiters = [];
    this.backlog = [];
    this.seq = 1;
    this.input = Buffer.alloc(0);
    this.sampleInput = Buffer.alloc(0);
    this.closed = false;
    this.catalog = [];
    this.capabilities = {};
  }

  /**
   * @param {object} options
   * @param {'attach'|'monitor'|'launch'} options.mode  attach = debug a running target,
   *   monitor = read-only sampling (no halts/writes), launch = reset and run to main.
   *   With `flash`, attach and launch program the ELF first (unchanged images are skipped).
   */
  async start(options) {
    if (!this.adapterPath) throw new Error('studio-adapter binary not found; run `npm run build:native`');
    const mode = options.mode || 'attach';
    this.child = spawn(this.adapterPath, options.mock ? ['--mock'] : [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.exited = new Promise(resolve => this.child.once('close', resolve));
    this.child.stdout.on('data', data => this.acceptDap(data));
    this.child.stderr.on('data', data => this.log('warn', String(data).trim()));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', (code, signal) => this.fail(new Error(`Adapter exited (${signal ?? code})`)));
    this.capabilities = await this.request('initialize', { adapterID: 'embedded-studio', clientName: 'Embedded Studio' });
    const command = mode === 'launch' ? 'launch' : 'attach';
    await this.request(command, {
      chip: options.mock ? 'Cortex-M Mock' : options.chip,
      programBinary: options.elf || undefined,
      stopOnEntry: mode === 'launch' ? options.stopOnEntry !== false : !!options.haltOnConnect,
      runToEntryPoint: options.entryPoint || 'main',
      plotOnly: mode === 'monitor',
      probe: { selector: options.probe && options.probe !== 'auto' ? options.probe : undefined, protocol: options.protocol || 'swd', speedKHz: options.speedKHz || 4000, connectUnderReset: !!options.connectUnderReset },
      flashing: { enabled: mode !== 'monitor' && !!options.flash, verify: true, resetAfter: true },
    }, 120000);
    const ready = await this.event('studio.dataChannelReady');
    const catalog = await this.request('studio/getCatalog');
    this.catalog = catalog.variables || [];
    await this.openSamples(ready.body);
    await this.request('configurationDone', {}, 30000);
    return { catalog: this.catalog, state: await this.request('studio/getState') };
  }

  log(level, text) { if (text) this.emit('log', { level, text }); }

  request(command, args = {}, timeoutMs = 15000) {
    if (this.closed) return Promise.reject(new Error('Session closed'));
    const seq = this.seq++;
    const data = Buffer.from(JSON.stringify({ seq, type: 'request', command, arguments: args }));
    const frame = Buffer.concat([Buffer.from(`Content-Length: ${data.length}\r\n\r\n`), data]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(seq); reject(new Error(`${command} timed out`)); }, timeoutMs);
      this.pending.set(seq, { resolve, reject, timer });
      this.child.stdin.write(frame, error => {
        if (error && this.pending.delete(seq)) { clearTimeout(timer); reject(error); }
      });
    });
  }

  event(name, timeoutMs = 15000) {
    const index = this.backlog.findIndex(item => item.event === name);
    if (index >= 0) return Promise.resolve(this.backlog.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters = this.waiters.filter(item => item.resolve !== resolve); reject(new Error(`${name} timed out`)); }, timeoutMs);
      this.waiters.push({ name, resolve, reject, timer });
    });
  }

  acceptDap(data) {
    this.input = Buffer.concat([this.input, data]);
    for (;;) {
      const end = this.input.indexOf('\r\n\r\n');
      if (end < 0) return;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(this.input.toString('latin1', 0, end))?.[1]);
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_FRAME) { this.fail(new Error('Invalid DAP frame length')); return; }
      if (this.input.length < end + 4 + length) return;
      let message;
      try { message = JSON.parse(this.input.toString('utf8', end + 4, end + 4 + length)); }
      catch (error) { this.fail(error); return; }
      this.input = this.input.subarray(end + 4 + length);
      if (message.type === 'response') this.acceptResponse(message);
      else if (message.type === 'event') this.acceptEvent(message);
    }
  }

  acceptResponse(message) {
    const call = this.pending.get(message.request_seq);
    if (!call) return;
    this.pending.delete(message.request_seq);
    clearTimeout(call.timer);
    if (message.success) call.resolve(message.body ?? {});
    else call.reject(new Error(message.message || `${message.command} failed`));
  }

  acceptEvent(message) {
    const index = this.waiters.findIndex(item => item.name === message.event);
    if (index >= 0) {
      const [waiter] = this.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else if (message.event.startsWith('studio.')) {
      this.backlog.push(message);
      if (this.backlog.length > 32) this.backlog.shift();
    }
    if (message.event === 'studio.catalog') this.catalog = message.body?.variables || this.catalog;
    if (message.event === 'output' && message.body?.output) this.log(message.body.category === 'stderr' ? 'error' : 'info', message.body.output.trim());
    this.emit('dap', { event: message.event, body: message.body || {} });
  }

  async openSamples(info) {
    if (!info || !Number.isInteger(info.port) || info.port < 1 || info.port > 65535 || typeof info.token !== 'string') throw new Error('Invalid sample channel');
    this.socket = net.createConnection({ host: '127.0.0.1', port: info.port });
    await new Promise((resolve, reject) => { this.socket.once('connect', resolve); this.socket.once('error', reject); });
    this.socket.write(`${info.token}\n`);
    this.socket.on('data', data => this.acceptSamples(data));
    this.socket.on('error', error => this.log('warn', `Sample channel: ${error.message}`));
  }

  acceptSamples(data) {
    this.sampleInput = this.sampleInput.length ? Buffer.concat([this.sampleInput, data]) : data;
    while (this.sampleInput.length >= 4) {
      const length = this.sampleInput.readUInt32LE(0);
      if (!length || length > MAX_FRAME) { this.fail(new Error('Invalid sample frame length')); return; }
      if (this.sampleInput.length < length + 4) return;
      const payload = this.sampleInput.subarray(4, length + 4);
      this.sampleInput = this.sampleInput.subarray(length + 4);
      try { this.emit('samples', decodeBatch(payload)); } catch (error) { this.log('warn', `Sample decoding: ${error.message}`); }
    }
  }

  debug(command) {
    if (!DEBUG_COMMANDS.has(command)) return Promise.reject(new Error(`Unsupported debug command: ${command}`));
    return this.request(command, { threadId: 1 }, 30000);
  }

  subscribe(ids, rate) {
    const unique = [...new Set(ids)];
    if (unique.length > 256) return Promise.reject(new Error('At most 256 channels can be sampled at once'));
    return this.request('studio/setSubscriptions', { ids: unique, requestedSamplesPerSecond: Math.max(1, Math.min(100000, Math.floor(rate) || 1000)) });
  }

  async stop() {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      if (!this.closed) { try { await this.request('disconnect', {}, 3000); } catch { /* adapter already gone */ } }
      this.socket?.destroy();
      if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
        let timer;
        await Promise.race([this.exited, new Promise(resolve => { timer = setTimeout(resolve, 1500); })]);
        clearTimeout(timer);
        if (this.child.exitCode === null && this.child.signalCode === null) { this.child.kill(); await this.exited; }
      }
      this.fail(new Error('Session stopped'));
    })();
    return this.stopping;
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    this.socket?.destroy();
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(error); }
    this.pending.clear();
    for (const waiter of this.waiters) { clearTimeout(waiter.timer); waiter.reject(error); }
    this.waiters = [];
    this.emit('closed', error);
  }
}

module.exports = { AdapterSession, decodeBatch, listProbes, listTargets, loadSvd, inspectElf, probeFamily, runCli };
