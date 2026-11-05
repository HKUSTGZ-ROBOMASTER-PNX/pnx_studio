// Bootstrap: build the shell, register built-in views and commands, load plugins.
import { h, icon, basename } from './lib/dom.js';
import { bus } from './lib/emitter.js';
import { initShell, workbench, registerSidebar, showSidebar, toggleRegion, notify, modal } from './shell.js';
import { session } from './session.js';
import { workspace } from './workspace.js';
import { t, setLanguage, language } from './i18n.js';
import { createToolbar, createStatusBar, openConnectDialog, quickConnect, flashFirmware, connectWith, connectionProfile } from './views/connection.js';
import { createExplorer } from './views/explorer.js';
import { createSymbols, loadOfflineSymbols } from './views/symbols.js';
import { createPeripherals } from './views/peripherals.js';
import { createRegisters } from './views/registers.js';
import { createWatch } from './views/watch.js';
import { createCallStack } from './views/callstack.js';
import { createConsole } from './views/console.js';
import { createMemory } from './views/memory.js';
import { createWelcome } from './views/welcome.js';
import { createPluginsView } from './views/plugins.js';
import { openPalette } from './views/palette.js';
import { THEMES, applyTheme, currentTheme, toggleTheme, restoreTheme } from './themes.js';
import { initSourceRouting } from './views/source.js';
import { initPlots, openPlot } from './views/plot-board.js';
import { createPlotsPane } from './views/plots-pane.js';
import { registerCommand, loadRendererPlugins, executeCommand } from './plugin-api.js';

const host = window.host;

/** Theme cards apply immediately, like VS Code's color theme picker. */
function themePicker() {
  const cards = THEMES.map(theme => {
    const [frame, surface, pane, accent, keyword, string] = theme.preview;
    const lines = [[keyword, 30], [string, 55], [accent, 40], [keyword, 22]];
    return h('button', { type: 'button', class: 'theme-card', dataset: { id: theme.id }, title: theme.label, onclick: () => { applyTheme(theme.id); mark(); } },
      h('span', { class: 'theme-preview', style: { background: frame } },
        h('span', { class: 'theme-preview-side', style: { background: pane } }, h('i', { style: { background: accent } })),
        h('span', { class: 'theme-preview-main', style: { background: surface } }, ...lines.map(([color, width]) => h('i', { style: { background: color, width: `${width}%` } })))),
      h('span', { class: 'theme-name' }, theme.label),
      h('span', { class: 'theme-kind faint' }, theme.kind === 'light' ? t('Light') : t('Dark')));
  });
  const mark = () => cards.forEach(card => card.classList.toggle('on', card.dataset.id === currentTheme().id));
  mark();
  return h('div', { class: 'theme-grid' }, cards);
}

function openSettings(hostInfo) {
  const lang = h('select', null, [['auto', t('Follow system')], ['en', 'English'], ['zh', '简体中文']].map(([value, label]) => h('option', { value, selected: (localStorage.getItem('studio.language') || 'auto') === value }, label)));
  const close = modal({
    title: t('Settings'),
    width: '640px',
    body: [
      h('div', { class: 'field' }, h('span', null, t('Color theme')), themePicker()),
      h('label', { class: 'field' }, h('span', null, t('Language')), lang),
      h('div', { class: 'field' }, h('span', null, t('Data folder')), h('code', { class: 'mono muted path' }, hostInfo.userData)),
      h('div', { class: 'field' }, h('span', null, t('Rust core')), h('code', { class: 'mono muted path' }, hostInfo.adapter || t('not found'))),
      h('div', { class: 'field' }, h('span', null, t('Versions')), h('span', { class: 'muted' }, `Embedded Studio ${hostInfo.version} · Electron ${hostInfo.electron} · ${hostInfo.kind}/${hostInfo.arch}`)),
    ],
    footer: [h('button', { class: 'btn primary', onclick: () => {
      const changedLanguage = lang.value !== (localStorage.getItem('studio.language') || 'auto');
      try { localStorage.setItem('studio.language', lang.value); } catch { /* ignore */ }
      close();
      if (changedLanguage) location.reload();
    } }, t('Save'))],
  });
}

function bindKeys() {
  window.addEventListener('keydown', event => {
    const mod = event.ctrlKey || event.metaKey;
    const run = (fn) => { event.preventDefault(); Promise.resolve().then(fn).catch(error => notify(error.message, 'error')); };
    if (mod && event.shiftKey && event.key.toLowerCase() === 'p') return run(openPalette);
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'b') return run(() => toggleRegion('sidebar'));
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'j') return run(() => toggleRegion('panel'));
    if (mod && event.shiftKey && event.key === 'F5') return run(() => session.debug('restart'));
    switch (event.key) {
      case 'F5': return run(() => event.shiftKey ? session.disconnect() : session.halted ? session.debug('continue') : quickConnect());
      case 'F6': return run(() => session.debug('pause'));
      case 'F10': return run(() => session.halted && session.debug('next'));
      case 'F11': return run(() => session.halted && session.debug(event.shiftKey ? 'stepOut' : 'stepIn'));
      default: return undefined;
    }
  });
}

function registerCoreCommands(hostInfo) {
  const commands = [
    ['studio.connect', t('Connect to target…'), () => openConnectDialog()],
    ['studio.connectMock', t('Connect to simulated target'), () => connectWith({ ...connectionProfile(), mock: true })],
    ['studio.disconnect', t('Disconnect'), () => session.disconnect()],
    ['studio.flash', t('Flash firmware'), flashFirmware],
    ['studio.continue', t('Continue'), () => session.debug('continue')],
    ['studio.pause', t('Pause'), () => session.debug('pause')],
    ['studio.stepOver', t('Step over'), () => session.debug('next')],
    ['studio.stepIn', t('Step into'), () => session.debug('stepIn')],
    ['studio.stepOut', t('Step out'), () => session.debug('stepOut')],
    ['studio.reset', t('Reset target'), () => session.debug('restart')],
    ['studio.newPlot', t('New plot'), () => openPlot()],
    ['studio.openFolder', t('Open folder…'), () => workspace.choose()],
    ['studio.welcome', t('Show welcome page'), () => openWelcome(hostInfo)],
    ['studio.toggleSidebar', t('Toggle sidebar'), () => toggleRegion('sidebar')],
    ['studio.togglePanel', t('Toggle bottom panel'), () => toggleRegion('panel')],
    ['studio.toggleInspector', t('Toggle inspector'), () => toggleRegion('inspector')],
    ['studio.toggleTheme', t('Toggle theme'), toggleTheme],
    ...THEMES.map(theme => [`studio.theme.${theme.id}`, `${t('Color theme')}: ${theme.label}`, () => applyTheme(theme.id)]),
    ['studio.settings', t('Settings'), () => openSettings(hostInfo)],
    ['studio.reload', t('Reload window'), () => host.reload()],
  ];
  for (const [id, title, run] of commands) registerCommand(id, title, run);
}

function openWelcome(hostInfo) {
  workbench.editor.open({ id: 'welcome', title: t('Welcome'), icon: 'info', create: () => createWelcome(hostInfo) });
}

async function main() {
  restoreTheme();
  setLanguage(localStorage.getItem('studio.language') || 'auto');
  document.documentElement.lang = language();

  const hostInfo = await host.info();
  const layout = initShell();
  createToolbar(document.getElementById('toolbar'), {
    onToggleTheme: toggleTheme,
    onSettings: () => openSettings(hostInfo),
  });
  createStatusBar(document.getElementById('statusbar'), hostInfo);

  let pluginDescription = null;
  const pluginsView = { current: null };
  registerSidebar({ id: 'explorer', title: t('Explorer'), label: t('Files'), icon: 'files', create: createExplorer });
  registerSidebar({ id: 'symbols', title: t('Symbols'), label: t('Variables'), icon: 'symbol', create: createSymbols });
  registerSidebar({ id: 'plots', title: t('Plots'), label: t('Plots'), icon: 'waves', create: createPlotsPane });
  registerSidebar({ id: 'peripherals', title: t('Peripherals'), label: t('Periph.'), icon: 'chip', create: createPeripherals });
  registerSidebar({ id: 'plugins', title: t('Plugins'), label: t('Plugins'), icon: 'plugin', bottom: true, create: () => (pluginsView.current = createPluginsView(() => pluginDescription)) });

  workbench.editor.actions.prepend(h('button', { class: 'btn small ghost new-plot', title: t('New plot'), onclick: () => openPlot() }, icon('chartAdd'), t('New plot')));

  workbench.inspector.open({ id: 'registers', title: t('Registers'), closable: false, create: createRegisters });
  workbench.inspector.open({ id: 'watch', title: t('Watch'), closable: false, create: createWatch }, { activate: false });
  workbench.inspector.open({ id: 'callstack', title: t('Call Stack'), closable: false, create: createCallStack }, { activate: false });
  workbench.panel.open({ id: 'console', title: t('Console'), closable: false, create: createConsole });
  workbench.panel.open({ id: 'memory', title: t('Memory'), closable: false, create: createMemory }, { activate: false });

  initSourceRouting();
  initPlots();
  openWelcome(hostInfo);
  registerCoreCommands(hostInfo);
  bindKeys();

  // Inspector follows the debug state: registers when halted.
  session.on('stopped', () => { if (workbench.inspector.active === 'watch') return; workbench.inspector.activate('registers'); });
  bus.on('elf:selected', elf => {
    workspace.saveSettings({ connection: { ...(workspace.settings.connection || {}), elf } });
    notify(t('Firmware set to {file}', { file: basename(elf) }), 'ok', 2500);
  });
  workspace.on('opened', ({ quiet }) => {
    document.title = `${basename(workspace.root)} — Embedded Studio`;
    if (!quiet) showSidebar('explorer');
    const elf = workspace.settings.connection?.elf;
    if (elf) loadOfflineSymbols(elf);
  });

  showSidebar(layout.sidebar === null ? 'explorer' : layout.sidebar || 'explorer');
  if (layout.sidebar === null) toggleRegion('sidebar', false);
  await workspace.init();

  try { pluginDescription = await loadRendererPlugins(); pluginsView.current?.render(); }
  catch (error) { notify(`${t('Plugins')}: ${error.message}`, 'error'); }

  // Handle for devtools and scripts/smoke.mjs; not part of the plugin API.
  window.studioDebug = { session, workbench, workspace, bus, openPlot, showSidebar, applyTheme, executeCommand };

  if (!hostInfo.adapter) notify(t('Rust core not found — run `npm run build:native`.'), 'error', 0);
  if (hostInfo.startMock) connectWith({ ...connectionProfile(), mock: true, mode: 'attach' });
}

main().catch(error => {
  document.body.append(h('pre', { class: 'fatal' }, `Embedded Studio failed to start:\n${error.stack || error.message}`));
});
