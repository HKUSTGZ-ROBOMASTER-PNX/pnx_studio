// Current workspace folder and its per-project settings (stored in the app settings file).
import { Emitter } from './lib/emitter.js';

const host = window.host;

class Workspace extends Emitter {
  constructor() {
    super();
    this.root = null;
    this.settings = {};
    this.appSettings = {};
  }

  async init() {
    this.appSettings = await host.settings.get();
    const last = this.appSettings.lastWorkspace;
    if (last) await this.open(last, { quiet: true }).catch(() => {});
  }

  async open(folder, { quiet = false } = {}) {
    await host.fs.listDir(folder);
    this.root = folder;
    this.settings = this.appSettings.projects?.[folder] || {};
    const recent = [folder, ...(this.appSettings.recent || []).filter(item => item !== folder)].slice(0, 8);
    this.appSettings = await host.settings.set({ lastWorkspace: folder, recent });
    this.emit('opened', { folder, quiet });
  }

  async choose() {
    const folder = await host.dialog.openFolder();
    if (folder) await this.open(folder);
    return folder;
  }

  async saveSettings(patch) {
    if (!this.root) return;
    this.settings = { ...this.settings, ...patch };
    const projects = { ...(this.appSettings.projects || {}), [this.root]: this.settings };
    this.appSettings = await host.settings.set({ projects });
  }

  get recent() { return this.appSettings.recent || []; }
}

export const workspace = new Workspace();
