// Renderer-side session controller: connection lifecycle, debug state,
// variable catalog and sample fan-out. Views talk to the target only via this module.
import { Emitter } from './lib/emitter.js';

const host = window.host;

function targetStateName(targetState) {
  if (!targetState) return 'unknown';
  return typeof targetState === 'string' ? targetState : Object.keys(targetState)[0];
}

class Session extends Emitter {
  constructor() {
    super();
    /** 'disconnected' | 'connecting' | 'running' | 'halted' */
    this.status = 'disconnected';
    this.options = null;
    this.catalog = [];
    this.index = new Map();
    this.coreState = null;
    this.frame = null;
    this.stopId = 0;
    this.subscribers = new Map();
    this.syncTimer = null;
    host.session.onDap(message => this.onDap(message));
    host.session.onSamples(batches => { for (const batch of batches) this.emit('samples', batch); });
    host.session.onLog(entry => this.emit('log', entry));
    host.session.onClosed(({ message }) => {
      if (this.status === 'disconnected') return;
      this.reset();
      this.emit('log', { level: 'warn', text: message, time: Date.now() });
    });
    this.adoptExisting();
  }

  /** A browser tab opened (or refreshed) while the backend already has a target attached. */
  async adoptExisting() {
    try {
      const existing = await host.session.describe?.();
      if (!existing || this.status !== 'disconnected') return;
      this.options = existing.options;
      this.setCatalog(existing.catalog);
      this.applyCoreState(await host.session.request('studio/getState', {}));
      this.emit('connected', this.options);
      this.syncSubscriptions();
      if (this.halted) this.refreshFrame();
    } catch (error) { console.warn('could not adopt running session:', error); }
  }

  get connected() { return this.status === 'running' || this.status === 'halted'; }
  get halted() { return this.status === 'halted'; }
  get monitorOnly() { return this.options?.mode === 'monitor'; }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }

  reset() {
    this.options = null;
    this.catalog = [];
    this.index.clear();
    this.coreState = null;
    this.frame = null;
    this.setStatus('disconnected');
    this.emit('catalog', []);
  }

  async connect(options) {
    // Set before starting: DAP events (stopped/continued) arrive while start() is pending.
    this.options = options;
    this.setStatus('connecting');
    try {
      const result = await host.session.start(options);
      this.setCatalog(result.catalog);
      this.applyCoreState(result.state);
      this.emit('connected', options);
      this.syncSubscriptions();
      if (this.halted) this.refreshFrame();
      return result;
    } catch (error) {
      this.reset();
      throw error;
    }
  }

  async disconnect() {
    await host.session.stop().catch(() => {});
    this.reset();
  }

  request(command, args, timeoutMs) { return host.session.request(command, args, timeoutMs); }

  async debug(command) {
    if (!this.connected) return;
    if (command !== 'pause' && command !== 'continue' && this.monitorOnly) throw new Error('Monitor-only session: reconnect in Debug mode to step');
    await host.session.debug(command);
  }

  setCatalog(variables) {
    this.catalog = variables || [];
    this.index.clear();
    const walk = items => { for (const item of items) { this.index.set(item.id, item); if (item.expression) this.index.set(item.expression, item); walk(item.children || []); } };
    walk(this.catalog);
    this.emit('catalog', this.catalog);
  }

  variable(id) { return this.index.get(id); }

  onDap({ event, body }) {
    switch (event) {
      case 'studio.state': this.applyCoreState(body); break;
      case 'studio.catalog': this.setCatalog(body.variables); break;
      case 'stopped': this.markStopped(body); break;
      case 'continued':
        this.frame = null;
        this.setStatus('running');
        this.emit('continued', body);
        this.emit('frame', null);
        break;
      default: break;
    }
    this.emit('dap', { event, body });
  }

  applyCoreState(state) {
    if (!state) return;
    this.coreState = state;
    const name = targetStateName(state.targetState);
    if (name === 'halted' && this.status !== 'halted') {
      // The adapter normally follows with a DAP `stopped` event; only synthesize
      // one if it does not arrive (e.g. attaching to an already halted core).
      this.setStatus('halted');
      const stopId = this.stopId;
      setTimeout(() => {
        if (this.stopId === stopId && this.halted) this.markStopped({ reason: state.targetState.halted?.reason });
      }, 200);
    } else if ((name === 'running' || name === 'sleeping') && this.status !== 'running') {
      this.frame = null;
      this.setStatus('running');
      this.emit('frame', null);
    }
    this.emit('coreState', state);
  }

  markStopped(body) {
    this.setStatus('halted');
    this.stopId++;
    this.emit('stopped', body);
    this.refreshFrame();
  }

  async refreshFrame() {
    try {
      const trace = await this.request('stackTrace', { threadId: 1, startFrame: 0, levels: 20 });
      this.frame = trace.stackFrames?.[0] || null;
      this.emit('frame', this.frame, trace.stackFrames || []);
      this.emit('stack', trace.stackFrames || []);
    } catch (error) {
      this.emit('log', { level: 'warn', text: `Stack trace: ${error.message}`, time: Date.now() });
    }
  }

  /**
   * Each consumer (plot, recorder plugin, …) declares the channel ids it needs;
   * the session sends the union to the core at the fastest requested rate.
   */
  setSubscription(owner, ids, rate = 1000) {
    if (!ids?.length) this.subscribers.delete(owner);
    else this.subscribers.set(owner, { ids: [...ids], rate });
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.syncSubscriptions(), 60);
  }

  async syncSubscriptions() {
    if (!this.connected) return;
    const ids = new Set();
    let rate = 1;
    for (const entry of this.subscribers.values()) {
      for (const id of entry.ids) if (this.index.has(id)) ids.add(this.index.get(id).id);
      rate = Math.max(rate, entry.rate);
    }
    try { await host.session.subscribe([...ids], ids.size ? rate : 1); }
    catch (error) { this.emit('log', { level: 'error', text: `Subscribe: ${error.message}`, time: Date.now() }); }
  }

  async readValues(ids) {
    if (!this.connected || !ids.length) return new Map();
    const result = await this.request('studio/readValues', { ids });
    return new Map((result.values || []).map(item => [item.id, item.value]));
  }

  async readMemory(address, count) {
    const result = await this.request('readMemory', { memoryReference: `0x${address.toString(16)}`, count });
    const binary = atob(result.data || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async writeMemory(address, bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return this.request('writeMemory', { memoryReference: `0x${address.toString(16)}`, data: btoa(binary) });
  }
}

export const session = new Session();
export { targetStateName };
