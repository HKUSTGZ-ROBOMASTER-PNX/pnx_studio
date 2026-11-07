// Welcome page: start actions, recent folders, host/probe setup hints, shortcuts.
import { brandMark } from '../lib/brand.js';
import { h, icon, basename } from '../lib/dom.js';
import { workspace } from '../workspace.js';
import { openConnectDialog, connectWith, connectionProfile } from './connection.js';
import { openPlot } from './plot-board.js';
import { t } from '../i18n.js';
import { modal, notify } from '../shell.js';

async function checkUpdates(hostInfo) {
  try {
    const result = await window.host.update.check();
    if (!result.available) { notify(t('You are using the latest version.'), 'ok'); return; }
    const status = h('p', { class: 'muted' }, t('Update {latest} is available (current: {current}).', result));
    const download = h('button', { class: 'btn primary', onclick: async () => {
      download.disabled = true;
      status.textContent = t('Downloading and verifying update…');
      try {
        const file = await window.host.update.download();
        status.textContent = t('Update downloaded and verified: {file}', { file: file.path });
        download.hidden = true;
        show.hidden = false;
        if (hostInfo.canInstallUpdate) install.hidden = false;
        else status.textContent += ` ${t('Open the downloaded package to install it.')}`;
      } catch (error) { status.textContent = `${t('Update failed')}: ${error.message}`; download.disabled = false; }
    } }, t('Download update'));
    const show = h('button', { class: 'btn', hidden: true, onclick: () => window.host.update.show().catch(error => notify(error.message, 'error')) }, t('Show downloaded file'));
    const install = h('button', { class: 'btn primary', hidden: true, onclick: () => {
      const closeConfirm = modal({ title: t('Install update'), body: h('p', null, t('The application will close and install the update. Disconnect your target and save your work first.')), footer: [
        h('button', { class: 'btn', onclick: () => closeConfirm() }, t('Cancel')),
        h('button', { class: 'btn primary', onclick: async () => { try { await window.host.update.apply(); closeConfirm(); } catch (error) { notify(`${t('Update failed')}: ${error.message}`, 'error'); } } }, t('Install and quit')),
      ] });
    } }, t('Install update'));
    modal({ title: t('Check for updates'), body: status, footer: [show, download, install] });
  } catch (error) { notify(`${t('Update failed')}: ${error.message}`, 'error'); }
}

const SHORTCUTS = [
  ['F5', 'Connect / Continue'], ['Shift+F5', 'Disconnect'], ['F6', 'Pause'], ['F10', 'Step over'],
  ['F11', 'Step into'], ['Shift+F11', 'Step out'], ['Ctrl+Shift+P', 'Command palette'], ['Ctrl+B', 'Toggle sidebar'],
];

export function createWelcome(hostInfo) {
  const recent = h('div', { class: 'welcome-list' });
  const renderRecent = () => recent.replaceChildren(...(workspace.recent.length ? workspace.recent.map(folder => h('a', { class: 'welcome-link', title: folder, onclick: () => workspace.open(folder).catch(error => workspace.emit('config:error', { folder, error })) }, icon('folder'), h('span', null, basename(folder)), h('span', { class: 'faint path' }, folder))) : [h('p', { class: 'faint' }, t('No recent folders.'))]));
  workspace.on('opened', renderRecent);
  renderRecent();

  const action = (iconName, title, hint, run) => h('button', { class: 'welcome-action', onclick: run }, icon(iconName), h('span', null, h('b', null, title), h('small', { class: 'muted' }, hint)));

  const el = h('div', { class: 'welcome' },
    h('div', { class: 'welcome-inner' },
      h('div', { class: 'welcome-hero' }, brandMark('logo-big'), h('div', null, h('h1', null, 'Embedded Studio'),
        h('p', { class: 'muted' }, t('Registers, live plots and source-level stepping for Cortex-M targets over DAPLink / CMSIS-DAP and ST-Link.')))),
      h('div', { class: 'welcome-grid' },
        h('section', null, h('h3', null, t('Start')),
          action('folderOpen', t('Open folder…'), t('Firmware project with sources and ELF'), () => workspace.choose()),
          action('plug', t('Connect to target…'), t('Choose probe, chip and firmware'), () => openConnectDialog()),
          action('chip', t('Try the simulated target'), t('No hardware needed — explore every view'), () => connectWith({ ...connectionProfile(), mock: true, mode: 'attach' })),
          action('chart', t('New plot'), t('Stream variables at up to tens of kHz'), () => openPlot()),
          action('refresh', t('Check for updates'), t('Download the latest release'), () => checkUpdates(hostInfo)),
          h('h3', null, t('Recent')), recent),
        h('section', null,
          h('h3', null, t('This machine')),
          h('div', { class: 'host-card' },
            h('div', { class: 'row' }, h('b', null, { windows: 'Windows', macos: 'macOS', linux: 'Linux', wsl: 'WSL 2' }[hostInfo.kind] || hostInfo.kind), h('span', { class: 'faint' }, `${hostInfo.arch} · ${hostInfo.release}`)),
            h('div', { class: 'row' }, icon(hostInfo.adapter ? 'check' : 'warn'), hostInfo.adapter ? h('span', { class: 'muted mono path' }, hostInfo.adapter) : h('span', { class: 'err-text' }, t('Rust core not found — run `npm run build:native`.'))),
            h('ul', { class: 'hints' }, hostInfo.hints.map(hint => h('li', null, hint)))),
          h('h3', null, t('Keyboard')),
          h('div', { class: 'shortcuts' }, SHORTCUTS.map(([keys, label]) => h('div', { class: 'row' }, h('span', { class: 'grow muted' }, t(label)), h('kbd', null, keys))))))));
  return { el };
}
