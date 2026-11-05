// Browser-mode bridge (server/serve.cjs). Provides the same `window.host` API as
// electron/preload.cjs, over fetch + server-sent events. Inert inside Electron.
(() => {
  if (window.host) return;
  const params = new URLSearchParams(location.search);
  let token = params.get('token');
  try {
    if (token) sessionStorage.setItem('studio.token', token);
    else token = sessionStorage.getItem('studio.token');
  } catch { /* storage unavailable */ }
  // Keep the token out of the visible address bar after the first load.
  if (params.has('token')) history.replaceState(null, '', location.pathname);

  const replacer = (_key, value) => (ArrayBuffer.isView(value) ? Array.from(value) : value);
  async function call(channel, ...args) {
    const response = await fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token || '' },
      body: JSON.stringify({ channel, args }, replacer),
    });
    if (response.status === 401) throw new Error('Not authorized: reopen the URL printed by `npm run web`');
    if (!response.ok) throw new Error(`${channel}: HTTP ${response.status}`);
    const result = await response.json();
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  const listeners = new Map();
  function subscribe(channel, handler) {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(handler);
    return () => listeners.get(channel)?.delete(handler);
  }
  const events = new EventSource(`/api/events?token=${encodeURIComponent(token || '')}`);
  events.onmessage = event => {
    const { channel, payload } = JSON.parse(event.data);
    if (channel === 'app:reload') { location.reload(); return; }
    for (const handler of listeners.get(channel) || []) {
      try { handler(payload); } catch (error) { console.error(error); }
    }
  };
  let warned = false;
  events.onerror = () => {
    if (events.readyState === EventSource.CLOSED && !warned) {
      warned = true;
      document.body.insertAdjacentHTML('beforeend', '<div class="server-gone">Embedded Studio server stopped. Restart <code>npm run web</code> and reload.</div>');
    }
  };

  // No native dialogs in a browser tab: use the in-page path picker.
  const picker = (kind, options) => import('./views/path-picker.js').then(module => module.pickPath(kind, options));

  window.host = {
    web: true,
    info: () => call('host:info'),
    settings: { get: () => call('settings:get'), set: patch => call('settings:set', patch) },
    dialog: {
      openFolder: title => picker('folder', { title }),
      openFile: options => picker('file', options),
      saveFile: options => picker('save', options),
    },
    fs: {
      readText: file => call('fs:readText', file),
      writeText: (file, text) => call('fs:writeText', file, text),
      writeBinary: (file, data) => call('fs:writeBinary', file, data),
      listDir: dir => call('fs:listDir', dir),
      roots: () => call('fs:roots'),
    },
    workspace: { findElfs: root => call('workspace:findElfs', root), findSvds: root => call('workspace:findSvds', root) },
    shell: { openExternal: url => window.open(url, '_blank', 'noopener'), showItem: file => call('shell:showItem', file) },
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
    reload: () => call('app:reload').then(() => location.reload()),
  };
})();
