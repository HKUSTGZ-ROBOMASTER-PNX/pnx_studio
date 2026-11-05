'use strict';
// Everything the UI talks to, independent of how it is hosted: settings, the Rust
// adapter session, file access, plugins. Used by the Electron main process (IPC)
// and by server/serve.cjs (HTTP + server-sent events for a regular browser).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const platform = require('./platform.cjs');
const core = require('./adapter.cjs');
const { PluginHost } = require('./plugins.cjs');
const workspace = require('./workspace.cjs');

/**
 * @param {object} host
 * @param {string} host.appRoot          repository / app.asar root
 * @param {string} host.userData         writable per-user directory
 * @param {string|null} host.resourcesPath packaged resources directory, if any
 * @param {string} host.version
 * @param {'electron'|'web'} host.runtime
 * @param {(channel: string, payload: any) => void} host.send   push an event to the UI
 * @param {object} [host.dialogs]        native { openFolder, openFile, saveFile }; omitted in the browser
 * @param {(url: string) => any} host.openExternal
 * @param {(file: string) => any} host.showItem
 * @param {(folder: string) => any} host.openPath
 * @param {() => any} host.reloadUi
 * @param {string} [host.assetBase]      URL prefix for plugin renderer modules
 * @param {boolean} [host.startMock]
 */
function createBackend(host) {
  const settingsFile = path.join(host.userData, 'settings.json');
  let settings = {};
  const loadSettings = () => { try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { settings = {}; } };
  const saveSettings = () => {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  };

  let session = null;
  let sessionInfo = null; // { options, catalog } of the live session, for UIs that attach later
  const adapterPath = () => platform.resolveAdapter(host.appRoot, host.resourcesPath);
  const log = (level, text) => host.send('session:log', { level, text, time: Date.now() });
  const pluginFolder = path.join(host.userData, 'plugins');

  const plugins = new PluginHost({
    session: () => session,
    broadcast: host.send,
    log,
    storageRoot: path.join(host.userData, 'plugin-data'),
    assetBase: host.assetBase,
  });

  // Batches arrive every ~10 ms; forward them to the UI at display rate.
  let pendingBatches = [];
  let flushTimer = null;
  function queueBatch(batch) {
    pendingBatches.push(batch);
    plugins.emit('samples', batch);
    if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; host.send('session:samples', pendingBatches); pendingBatches = []; }, 33);
  }

  async function startSession(options) {
    // Replace a live session quietly: broadcasting session:closed here would make the UI
    // drop the options of the connection it is in the middle of establishing.
    if (session) {
      const previous = session;
      session = null;
      sessionInfo = null;
      await previous.stop().catch(() => {});
    }
    const executable = options.adapter && options.adapter !== 'builtin'
      ? plugins.adapters().find(item => item.id === options.adapter)?.executable
      : adapterPath();
    const next = new core.AdapterSession(executable);
    next.on('dap', message => { host.send('session:dap', message); plugins.emit('dap', message); });
    next.on('samples', queueBatch);
    next.on('log', entry => log(entry.level, entry.text));
    next.on('closed', error => {
      if (session !== next) return;
      session = null;
      sessionInfo = null;
      host.send('session:closed', { message: error.message });
      plugins.emit('disconnected', { reason: error.message });
    });
    session = next;
    try {
      const result = await next.start(options);
      sessionInfo = { options, catalog: result.catalog };
      plugins.emit('connected', { options, state: result.state });
      return result;
    } catch (error) {
      session = null;
      await next.stop().catch(() => {});
      throw error;
    }
  }

  async function stopSession() {
    const current = session;
    session = null;
    sessionInfo = null;
    if (current) await current.stop();
    host.send('session:closed', { message: 'Disconnected' });
  }

  function requireSession() {
    if (!session) throw new Error('No target connected');
    return session;
  }

  function nativeDialog(name) {
    return (...args) => {
      if (!host.dialogs?.[name]) throw new Error('Native dialogs are not available in the browser');
      return host.dialogs[name](...args);
    };
  }

  function loadPlugins() {
    plugins.load([
      { directory: path.join(host.appRoot, 'plugins'), source: 'builtin' },
      { directory: pluginFolder, source: 'user' },
    ], settings.disabledPlugins || []);
  }

  /** channel → handler(...args). Callers wrap results as { ok, value } / { ok, error }. */
  const handlers = {
    'host:info': () => ({
      ...platform.describeHost(),
      version: host.version,
      runtime: host.runtime,
      electron: process.versions.electron || null,
      adapter: adapterPath(),
      startMock: !!host.startMock,
      userData: host.userData,
      home: os.homedir(),
      pluginFolder,
    }),
    'settings:get': () => settings,
    'settings:set': patch => { settings = { ...settings, ...patch }; saveSettings(); return settings; },
    'dialog:openFolder': nativeDialog('openFolder'),
    'dialog:openFile': nativeDialog('openFile'),
    'dialog:saveFile': nativeDialog('saveFile'),
    'fs:readText': file => workspace.readText(file),
    'fs:writeText': (file, text) => workspace.writeText(file, text),
    'fs:writeBinary': (file, data) => workspace.writeBinary(file, data),
    'fs:listDir': dir => workspace.listDir(dir),
    'fs:roots': () => workspace.roots(),
    'workspace:findElfs': root => workspace.findFiles(root, /\.(elf|axf|out)$/i),
    'workspace:findSvds': root => workspace.findFiles(root, /\.svd$/i),
    'shell:openExternal': url => { if (/^https:\/\//.test(url)) return host.openExternal(url); throw new Error('Only https links can be opened'); },
    'shell:showItem': file => host.showItem(file),
    'probes:list': () => core.listProbes(adapterPath()),
    'targets:list': () => core.listTargets(adapterPath()),
    'svd:load': file => core.loadSvd(adapterPath(), file),
    'elf:inspect': file => core.inspectElf(adapterPath(), file),
    'session:start': options => startSession(options),
    'session:stop': () => stopSession(),
    'session:connected': () => !!session,
    'session:describe': () => (session && sessionInfo ? sessionInfo : null),
    'session:request': (command, args, timeoutMs) => requireSession().request(command, args, timeoutMs),
    'session:debug': command => requireSession().debug(command),
    'session:subscribe': (ids, rate) => requireSession().subscribe(ids, rate),
    'plugins:describe': () => ({ ...plugins.describe(), adapters: plugins.adapters().map(({ id, label }) => ({ id, label })) }),
    'plugins:execute': (id, args) => plugins.execute(id, args),
    'plugins:setEnabled': (id, enabled) => {
      const disabled = new Set(settings.disabledPlugins || []);
      enabled ? disabled.delete(id) : disabled.add(id);
      settings.disabledPlugins = [...disabled];
      saveSettings();
      return true;
    },
    'plugins:openFolder': () => {
      fs.mkdirSync(pluginFolder, { recursive: true });
      return host.openPath(pluginFolder);
    },
    'app:reload': async () => {
      await stopSession().catch(() => {});
      await plugins.deactivateAll();
      loadPlugins();
      return host.reloadUi();
    },
  };

  /** Invoke a channel and wrap the outcome so errors cross IPC/HTTP as plain data. */
  async function invoke(channel, args) {
    const handler = Object.hasOwn(handlers, channel) ? handlers[channel] : null;
    if (!handler) return { ok: false, error: `Unknown channel: ${channel}` };
    try { return { ok: true, value: await handler(...(Array.isArray(args) ? args : [])) }; }
    catch (error) { return { ok: false, error: error.message || String(error) }; }
  }

  loadSettings();
  return {
    handlers,
    invoke,
    plugins,
    loadPlugins,
    settings: () => settings,
    saveSettings: patch => { settings = { ...settings, ...patch }; saveSettings(); },
    shutdown: () => Promise.allSettled([stopSession(), plugins.deactivateAll()]),
  };
}

module.exports = { createBackend };
