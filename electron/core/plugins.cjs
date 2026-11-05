'use strict';
// Plugin host (main-process side).
//
// A plugin is a directory containing `plugin.json`:
//   {
//     "id": "vendor.name", "name": "…", "version": "1.0.0", "apiVersion": 1,
//     "main": "main.cjs",          // optional, CommonJS, runs in the Electron main process
//     "renderer": "renderer.js",   // optional, ES module, runs in the studio window
//     "contributes": { "views": [...], "commands": [...], "adapters": [...] }
//   }
// Plugins are discovered in <app>/plugins (built-in) and <userData>/plugins (user).
// See docs/PLUGINS.md for the full API.
const fs = require('node:fs');
const path = require('node:path');

const API_VERSION = 1;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function readManifest(directory, source) {
  const file = path.join(directory, 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!ID_PATTERN.test(manifest.id || '')) throw new Error(`invalid plugin id in ${file}`);
  if (manifest.apiVersion !== API_VERSION) throw new Error(`${manifest.id} targets plugin API ${manifest.apiVersion}, host provides ${API_VERSION}`);
  for (const key of ['main', 'renderer']) {
    if (manifest[key] === undefined) continue;
    const resolved = path.resolve(directory, manifest[key]);
    if (!resolved.startsWith(path.resolve(directory) + path.sep)) throw new Error(`${manifest.id}: ${key} must stay inside the plugin folder`);
  }
  const contributes = manifest.contributes || {};
  return {
    id: manifest.id,
    name: String(manifest.name || manifest.id),
    version: String(manifest.version || '0.0.0'),
    description: String(manifest.description || ''),
    main: manifest.main || null,
    renderer: manifest.renderer || null,
    contributes: {
      views: Array.isArray(contributes.views) ? contributes.views : [],
      commands: Array.isArray(contributes.commands) ? contributes.commands : [],
      adapters: Array.isArray(contributes.adapters) ? contributes.adapters : [],
    },
    directory,
    source,
  };
}

function discover(roots) {
  const found = new Map();
  const errors = [];
  for (const { directory, source } of roots) {
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginDir = path.join(directory, entry.name);
      if (!fs.existsSync(path.join(pluginDir, 'plugin.json'))) continue;
      try {
        const manifest = readManifest(pluginDir, source);
        // User plugins may override a built-in of the same id.
        found.set(manifest.id, manifest);
      } catch (error) { errors.push({ directory: pluginDir, error: error.message }); }
    }
  }
  return { plugins: [...found.values()], errors };
}

class PluginHost {
  /**
   * @param {object} services  host services shared with plugins
   * @param {() => object|null} services.session  current AdapterSession or null
   * @param {(channel: string, payload: any) => void} services.broadcast  send to renderer
   * @param {(level: string, text: string) => void} services.log
   * @param {string} services.storageRoot
   */
  constructor(services) {
    this.services = services;
    this.plugins = [];
    this.errors = [];
    this.commands = new Map();
    this.listeners = new Map();
    this.active = new Map();
  }

  load(roots, disabled = []) {
    const { plugins, errors } = discover(roots);
    this.plugins = plugins;
    this.errors = errors;
    for (const plugin of plugins) {
      plugin.enabled = !disabled.includes(plugin.id);
      if (plugin.enabled && plugin.main) this.activate(plugin);
    }
  }

  activate(plugin) {
    const disposables = [];
    const context = {
      apiVersion: API_VERSION,
      plugin: { id: plugin.id, version: plugin.version, directory: plugin.directory },
      storagePath: path.join(this.services.storageRoot, plugin.id),
      log: (text, level = 'info') => this.services.log(level, `[${plugin.id}] ${text}`),
      commands: {
        register: (id, handler) => {
          const full = id.includes(':') ? id : `${plugin.id}:${id}`;
          this.commands.set(full, handler);
          disposables.push(() => this.commands.delete(full));
        },
      },
      core: {
        /** Send a raw DAP / studio/* request to the active adapter session. */
        request: (command, args, timeoutMs) => {
          const session = this.services.session();
          if (!session) return Promise.reject(new Error('No target connected'));
          return session.request(command, args, timeoutMs);
        },
        isConnected: () => !!this.services.session(),
        /** Events: 'samples', 'dap', 'connected', 'disconnected'. */
        on: (event, handler) => {
          if (!this.listeners.has(event)) this.listeners.set(event, new Set());
          this.listeners.get(event).add(handler);
          disposables.push(() => this.listeners.get(event)?.delete(handler));
        },
      },
      /** Push a message to this plugin's renderer half (received via studio.onMessage). */
      postMessage: payload => this.services.broadcast('plugin:message', { pluginId: plugin.id, payload }),
      subscriptions: disposables,
    };
    try {
      const module = require(path.join(plugin.directory, plugin.main));
      const result = module.activate?.(context);
      this.active.set(plugin.id, { module, context, disposables });
      if (result && typeof result.then === 'function') result.catch(error => this.fail(plugin, error));
    } catch (error) { this.fail(plugin, error); }
  }

  fail(plugin, error) {
    this.errors.push({ directory: plugin.directory, error: `${plugin.id}: ${error.message}` });
    this.services.log('error', `[${plugin.id}] activation failed: ${error.message}`);
  }

  emit(event, payload) {
    for (const handler of this.listeners.get(event) || []) {
      try { handler(payload); } catch (error) { this.services.log('error', `plugin listener for ${event}: ${error.message}`); }
    }
  }

  async execute(id, args) {
    const handler = this.commands.get(id);
    if (!handler) throw new Error(`Unknown command: ${id}`);
    return handler(args);
  }

  async deactivateAll() {
    for (const [id, entry] of this.active) {
      try { await entry.module.deactivate?.(); } catch (error) { this.services.log('error', `[${id}] deactivate: ${error.message}`); }
      for (const dispose of entry.disposables.splice(0)) dispose();
    }
    this.active.clear();
  }

  /** Serializable description for the renderer. */
  describe() {
    return {
      apiVersion: API_VERSION,
      plugins: this.plugins.map(plugin => ({
        id: plugin.id, name: plugin.name, version: plugin.version, description: plugin.description,
        source: plugin.source, enabled: plugin.enabled, hasMain: !!plugin.main,
        renderer: plugin.enabled && plugin.renderer ? `${this.services.assetBase || 'studio://plugins'}/${plugin.id}/${plugin.renderer.replaceAll('\\', '/')}` : null,
        contributes: plugin.contributes,
      })),
      errors: this.errors,
    };
  }

  /** Map a <assetBase>/<id>/<file> request to a file inside that plugin. */
  resolveAsset(id, relative) {
    const plugin = this.plugins.find(item => item.id === id && item.enabled);
    if (!plugin) return null;
    const file = path.resolve(plugin.directory, relative);
    return file.startsWith(path.resolve(plugin.directory) + path.sep) ? file : null;
  }

  adapters() {
    // `executable` is a path or a map keyed by "<platform>-<arch>" with an optional "default".
    const pick = executable => typeof executable === 'string' ? executable
      : executable?.[`${process.platform}-${process.arch}`] || executable?.default || null;
    return this.plugins.filter(plugin => plugin.enabled).flatMap(plugin => plugin.contributes.adapters
      .map(adapter => ({ adapter, file: pick(adapter.executable) }))
      .filter(({ file }) => file)
      .map(({ adapter, file }) => ({
        id: `${plugin.id}:${adapter.id}`,
        label: adapter.label || adapter.id,
        executable: path.resolve(plugin.directory, file),
      })));
  }
}

module.exports = { PluginHost, discover, readManifest, API_VERSION };
