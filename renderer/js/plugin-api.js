// Renderer half of the plugin system. Each enabled plugin's `renderer` module is
// imported from studio://plugins/<id>/… and its `activate(studio)` receives the API below.
// Keep this surface stable: it is versioned by `apiVersion` (see docs/PLUGINS.md).
import { h, icon, iconButton, hex, formatValue, parseNumber } from './lib/dom.js';
import { Emitter } from './lib/emitter.js';
import { workbench, notify, registerSidebar, showSidebar, modal, menu } from './shell.js';
import { session } from './session.js';
import { workspace } from './workspace.js';
import { pickVariable } from './views/symbols.js';
import { toolbarExtras } from './views/connection.js';
import { t, language, addTranslations } from './i18n.js';

const host = window.host;
export const API_VERSION = 1;

// ---------------------------------------------------------------- commands
export const commands = new Map(); // id -> { title, run, source }
export const commandEvents = new Emitter();

export function registerCommand(id, title, run, source = 'core') {
  commands.set(id, { id, title, run, source });
  commandEvents.emit('changed');
  return () => { commands.delete(id); commandEvents.emit('changed'); };
}

export async function executeCommand(id, args) {
  const command = commands.get(id);
  if (command) return command.run(args);
  return host.plugins.execute(id, args); // main-process plugin command
}

// ---------------------------------------------------------------- views
export const pluginViews = new Map(); // full id -> { pluginId, title, icon, location, open() }

function mountView(spec, pluginId) {
  return () => {
    const el = h('div', { class: 'plugin-view' });
    let handle = {};
    try { handle = spec.render(el, { pluginId }) || {}; }
    catch (error) { el.replaceChildren(h('div', { class: 'tree-msg err-text' }, `${pluginId}: ${error.message}`)); }
    return { el, onShow: () => handle.onShow?.(), onHide: () => handle.onHide?.(), dispose: () => handle.dispose?.() };
  };
}

function registerView(plugin, viewId, spec) {
  const id = `${plugin.id}.${viewId}`;
  const location = spec.location || 'editor';
  const create = mountView(spec, plugin.id);
  const entry = { id, pluginId: plugin.id, title: spec.title || viewId, icon: spec.icon || 'plugin', location };
  if (location === 'sidebar') {
    registerSidebar({ id, title: entry.title, icon: entry.icon, create });
    entry.open = () => showSidebar(id);
  } else {
    const group = location === 'panel' ? workbench.panel : location === 'inspector' ? workbench.inspector : workbench.editor;
    entry.open = () => group.open({ id, title: entry.title, icon: entry.icon, create });
    if (location !== 'editor') group.open({ id, title: entry.title, icon: entry.icon, closable: false, create }, { activate: false });
  }
  pluginViews.set(id, entry);
  commandEvents.emit('changed');
  return entry;
}

// ---------------------------------------------------------------- API factory
function createApi(plugin) {
  const disposers = [];
  const storageKey = key => `studio.plugin.${plugin.id}.${key}`;
  const api = {
    apiVersion: API_VERSION,
    plugin: { id: plugin.id, version: plugin.version, name: plugin.name },
    views: {
      /** spec: { title, icon?, location?: 'editor'|'panel'|'inspector'|'sidebar', render(container, ctx) → { dispose?, onShow?, onHide? } } */
      register: (viewId, spec) => registerView(plugin, viewId, spec),
      open: viewId => pluginViews.get(viewId.includes('.') ? viewId : `${plugin.id}.${viewId}`)?.open(),
    },
    commands: {
      register: (id, title, run) => { const off = registerCommand(id.includes(':') ? id : `${plugin.id}:${id}`, title, run, plugin.id); disposers.push(off); return off; },
      execute: executeCommand,
    },
    session: {
      get status() { return session.status; },
      get connected() { return session.connected; },
      get halted() { return session.halted; },
      get catalog() { return session.catalog; },
      variable: key => session.variable(key),
      request: (command, args, timeoutMs) => session.request(command, args, timeoutMs),
      debug: command => session.debug(command),
      readMemory: (address, length) => session.readMemory(address, length),
      writeMemory: (address, bytes) => session.writeMemory(address, bytes),
      readValues: ids => session.readValues(ids),
      /** Stream channels to this plugin (merged with other consumers by the session). */
      subscribe: (ids, rate = 1000) => session.setSubscription(`plugin:${plugin.id}`, ids, rate),
      unsubscribe: () => session.setSubscription(`plugin:${plugin.id}`, []),
      /** Events: status, connected, stopped, continued, samples, catalog, coreState, frame, log. */
      on: (event, handler) => { const off = session.on(event, handler); disposers.push(off); return off; },
    },
    ui: {
      h, icon, iconButton, hex, formatValue, parseNumber, notify, modal, menu, pickVariable,
      addToolbarButton: ({ title, icon: iconName = 'plugin', run }) => {
        const button = iconButton(iconName, title, run);
        toolbarExtras.hidden = false;
        toolbarExtras.append(button);
        disposers.push(() => button.remove());
        return button;
      },
    },
    main: {
      /** Call a command registered by this plugin's main-process half. */
      invoke: (command, args) => host.plugins.execute(command.includes(':') ? command : `${plugin.id}:${command}`, args),
      onMessage: handler => {
        const off = host.plugins.onMessage(({ pluginId, payload }) => { if (pluginId === plugin.id) handler(payload); });
        disposers.push(off);
        return off;
      },
    },
    storage: {
      get: (key, fallback = null) => { try { const raw = localStorage.getItem(storageKey(key)); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; } },
      set: (key, value) => { try { localStorage.setItem(storageKey(key), JSON.stringify(value)); } catch { /* storage unavailable */ } },
    },
    workspace: {
      get root() { return workspace.root; },
      on: (event, handler) => { const off = workspace.on(event, handler); disposers.push(off); return off; },
    },
    host: { dialog: host.dialog, fs: host.fs },
    /** Plugins ship their own strings: `addTranslations('zh', { 'English': '中文' })`, then `t('English')`. */
    i18n: { t, language, addTranslations },
  };
  return { api: Object.freeze(api), disposers };
}

export async function loadRendererPlugins() {
  const description = await host.plugins.describe();
  for (const plugin of description.plugins) {
    if (!plugin.renderer) continue;
    try {
      const module = await import(plugin.renderer);
      const { api } = createApi(plugin);
      await module.activate?.(api);
    } catch (error) {
      notify(`${plugin.name}: ${error.message}`, 'error');
      description.errors.push({ directory: plugin.id, error: `${plugin.id} (renderer): ${error.message}` });
    }
  }
  return description;
}
