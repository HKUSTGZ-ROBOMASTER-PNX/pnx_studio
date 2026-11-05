// Source breakpoints, kept across sessions and pushed to the core on connect/change.
import { Emitter } from './lib/emitter.js';
import { session } from './session.js';

const KEY = 'studio.breakpoints.v1';

class Breakpoints extends Emitter {
  constructor() {
    super();
    /** path -> Map(line -> { verified: boolean|null, message?: string }) */
    this.files = new Map();
    try {
      for (const [file, lines] of Object.entries(JSON.parse(localStorage.getItem(KEY)) || {}))
        this.files.set(file, new Map(lines.map(line => [line, { verified: null }])));
    } catch { /* first run */ }
    session.on('connected', () => { for (const file of this.files.keys()) this.sync(file); });
    session.on('status', status => { if (status === 'disconnected') this.markAll(null); });
  }

  lines(file) { return this.files.get(file) || new Map(); }

  toggle(file, line) {
    const lines = this.files.get(file) || new Map();
    if (lines.has(line)) lines.delete(line); else lines.set(line, { verified: null });
    if (lines.size) this.files.set(file, lines); else this.files.delete(file);
    this.persist();
    this.emit('changed', file);
    this.sync(file);
  }

  clearAll() {
    const files = [...this.files.keys()];
    this.files.clear();
    this.persist();
    for (const file of files) { this.emit('changed', file); this.sync(file, []); }
  }

  list() {
    return [...this.files].flatMap(([file, lines]) => [...lines].map(([line, state]) => ({ file, line, ...state })));
  }

  async sync(file, override) {
    if (!session.connected || session.monitorOnly) return;
    const lines = override ?? [...this.lines(file).keys()].sort((a, b) => a - b);
    try {
      const result = await session.request('setBreakpoints', { source: { path: file }, breakpoints: lines.map(line => ({ line })) });
      const current = this.files.get(file);
      if (!current) return;
      (result.breakpoints || []).forEach((item, index) => {
        const state = current.get(lines[index]);
        if (state) { state.verified = !!item.verified; state.message = item.message; state.resolvedLine = item.line; }
      });
      this.emit('changed', file);
    } catch (error) {
      session.emit('log', { level: 'error', text: `Breakpoints: ${error.message}`, time: Date.now() });
    }
  }

  markAll(verified) {
    for (const [file, lines] of this.files) { for (const state of lines.values()) state.verified = verified; this.emit('changed', file); }
  }

  persist() {
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...this.files].map(([file, lines]) => [file, [...lines.keys()]])))); } catch { /* storage unavailable */ }
  }
}

export const breakpoints = new Breakpoints();
