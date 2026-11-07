'use strict';
// The only bridge between the sandboxed renderer and the main process.
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function subscribe(channel, handler) {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('host', {
  info: () => call('host:info'),
  settings: { get: () => call('settings:get'), set: patch => call('settings:set', patch) },
  update: { check: () => call('update:check'), download: () => call('update:download'), show: () => call('update:show'), apply: () => call('update:apply') },
  dialog: {
    openFolder: title => call('dialog:openFolder', title),
    openFile: options => call('dialog:openFile', options),
    saveFile: options => call('dialog:saveFile', options),
  },
  fs: {
    readText: file => call('fs:readText', file),
    writeText: (file, text) => call('fs:writeText', file, text),
    writeBinary: (file, data) => call('fs:writeBinary', file, data),
    listDir: dir => call('fs:listDir', dir),
    isFile: file => call('fs:isFile', file),
    roots: () => call('fs:roots'),
  },
  workspace: { findElfs: root => call('workspace:findElfs', root), findSvds: root => call('workspace:findSvds', root), readConfig: root => call('workspace:readConfig', root), writeConfig: (root, config) => call('workspace:writeConfig', root, config) },
  shell: { openExternal: url => call('shell:openExternal', url), showItem: file => call('shell:showItem', file) },
  probes: { list: () => call('probes:list'), targets: () => call('targets:list') },
  svd: { load: file => call('svd:load', file) },
  elf: { inspect: file => call('elf:inspect', file) },
  session: {
    start: options => call('session:start', options),
    stop: () => call('session:stop'),
    connected: () => call('session:connected'),
    describe: () => call('session:describe'),
    request: (command, args, timeoutMs) => call('session:request', command, args, timeoutMs),
    debug: command => call('session:debug', command),
    subscribe: (ids, rate) => call('session:subscribe', ids, rate),
    onDap: handler => subscribe('session:dap', handler),
    onSamples: handler => subscribe('session:samples', handler),
    onLog: handler => subscribe('session:log', handler),
    onClosed: handler => subscribe('session:closed', handler),
  },
  plugins: {
    describe: () => call('plugins:describe'),
    execute: (id, args) => call('plugins:execute', id, args),
    setEnabled: (id, enabled) => call('plugins:setEnabled', id, enabled),
    openFolder: () => call('plugins:openFolder'),
    onMessage: handler => subscribe('plugin:message', handler),
  },
  reload: () => call('app:reload'),
});
