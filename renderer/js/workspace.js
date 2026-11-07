// Current workspace folder and its settings, stored alongside the project.
import { Emitter } from './lib/emitter.js';

const host = window.host;

class Workspace extends Emitter {
  constructor() {
    super();
    this.root = null;
    this.settings = {};
    this.appSettings = {};
    this.writes = new Map();
  }

  async init() {
    this.appSettings = await host.settings.get();
    const last = this.appSettings.lastWorkspace;
    if (last) await this.open(last, { quiet: true }).catch(error => this.emit('config:error', { folder: last, error }));
  }

  async open(folder, { quiet = false } = {}) {
    await host.fs.listDir(folder);
    // Do not read an older snapshot if this folder was just closed while a write was pending.
    await this.writes.get(folder);
    const saved = await host.workspace.readConfig(folder);
    const settings = saved ?? this.appSettings.projects?.[folder] ?? {};
    if (this.root) this.emit('closing', { folder: this.root });
    this.root = folder;
    this.settings = settings;
    const recent = [folder, ...(this.appSettings.recent || []).filter(item => item !== folder)].slice(0, 8);
    this.appSettings = await host.settings.set({ lastWorkspace: folder, recent });
    this.emit('opened', { folder, quiet });
    // Migrate settings from older releases to the project folder on first open.
    if (saved === null && Object.keys(settings).length) this.saveSettings({});
  }

  async choose() {
    const folder = await host.dialog.openFolder();
    if (folder) {
      try { await this.open(folder); }
      catch (error) { this.emit('config:error', { folder, error }); }
    }
    return folder;
  }

  async saveSettings(patch) {
    if (!this.root) return;
    this.settings = { ...this.settings, ...patch };
    const folder = this.root;
    // Capture a snapshot now and serialize writes so rapid changes cannot overwrite newer ones.
    const snapshot = JSON.parse(JSON.stringify(this.settings));
    const previous = this.writes.get(folder) || Promise.resolve();
    const write = previous.then(() => host.workspace.writeConfig(folder, snapshot))
      .catch(error => this.emit('config:error', { folder, error }));
    this.writes.set(folder, write);
    await write;
    if (this.writes.get(folder) === write) this.writes.delete(folder);
  }

  get recent() { return this.appSettings.recent || []; }
}

export const workspace = new Workspace();
