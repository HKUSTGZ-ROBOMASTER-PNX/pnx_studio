// Toolbar (connection pill + debug controls), connect dialog and status bar.
import { brandMark } from '../lib/brand.js';
import { h, icon, iconButton, basename, formatValue } from '../lib/dom.js';
import { bus } from '../lib/emitter.js';
import { modal, notify, menu } from '../shell.js';
import { session } from '../session.js';
import { workspace } from '../workspace.js';
import { t } from '../i18n.js';

const host = window.host;
const PROFILE_KEY = 'studio.connection.v1';

function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch { return {}; }
}
function saveProfile(profile) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* ignore */ } }

export const toolbarExtras = h('div', { class: 'toolbar-group', hidden: true });

export function connectionProfile() { return { mode: 'attach', speedKHz: 4000, protocol: 'swd', probe: 'auto', ...loadProfile(), ...(workspace.settings.connection || {}) }; }

// ---------------------------------------------------------------- connect dialog
export async function openConnectDialog({ mock = false } = {}) {
  const profile = { ...connectionProfile(), mock };
  let probes = [];
  const probeSelect = h('select', { class: 'grow' }, h('option', { value: 'auto' }, t('Auto (single probe)')));
  const probeStatus = h('span', { class: 'faint' });
  const chipInput = h('input', { type: 'text', value: profile.chip || '', placeholder: 'e.g. STM32F407VGTx', list: 'studio-targets', spellcheck: false, class: 'grow' });
  const chipList = h('datalist', { id: 'studio-targets' });
  const elfInput = h('input', { type: 'text', value: profile.elf || '', placeholder: t('Firmware with DWARF debug info (.elf / .axf)'), spellcheck: false, class: 'grow' });
  const elfMenuButton = iconButton('chevronDown', t('Recent builds in workspace'), async event => {
    const files = workspace.root ? await host.workspace.findElfs(workspace.root) : [];
    if (!files.length) { notify(t('No .elf/.axf files found in the workspace'), 'warn'); return; }
    menu(event.currentTarget, files.slice(0, 12).map(file => ({ label: file.slice((workspace.root || '').length).replace(/^[\\/]/, ''), icon: 'file', run: () => { elfInput.value = file; } })));
  });
  const speedInput = h('input', { type: 'number', value: profile.speedKHz, min: 1, max: 100000, step: 100 });
  const protocolSelect = h('select', null, ['swd', 'jtag'].map(value => h('option', { value, selected: profile.protocol === value }, value.toUpperCase())));
  const underReset = h('input', { type: 'checkbox', checked: !!profile.connectUnderReset });
  const flashBox = h('input', { type: 'checkbox', checked: profile.flash !== false });
  const mockBox = h('input', { type: 'checkbox', checked: !!profile.mock });
  const adapterSelect = h('select', { class: 'grow' }, h('option', { value: 'builtin' }, t('Built-in Rust core (probe-rs)')));

  let mode = profile.mode;
  const modes = [
    ['attach', t('Debug'), () => flashBox.checked ? t('Flash, reset, keep running') : t('Attach, keep running')],
    ['launch', t('Launch'), () => flashBox.checked ? t('Flash, reset, run to main') : t('Reset, run to main')],
    ['monitor', t('Monitor'), () => t('Read-only, never halts')],
  ];
  const hints = modes.map(([, , hint]) => h('small', { class: 'muted' }, hint()));
  const renderModes = () => {
    modeButtons.forEach((button, i) => button.classList.toggle('on', modes[i][0] === mode));
    hints.forEach((hint, i) => { hint.textContent = modes[i][2](); });
    flashRow.hidden = mode === 'monitor';
  };
  const modeButtons = modes.map(([value, label], i) => h('button', { type: 'button', class: value === mode ? 'on' : '', onclick: () => { mode = value; renderModes(); } }, h('b', null, label), hints[i]));
  const flashRow = h('label', { class: 'row', hidden: mode === 'monitor' }, flashBox, t('Flash firmware before starting'));
  flashBox.addEventListener('change', renderModes);

  const refreshProbes = async () => {
    probeStatus.textContent = t('Scanning…');
    try {
      probes = await host.probes.list();
      probeSelect.replaceChildren(h('option', { value: 'auto' }, t('Auto (single probe)')),
        ...probes.map(probe => h('option', { value: probe.selector, selected: probe.selector === profile.probe }, `${probe.family} · ${probe.identifier}${probe.serialNumber ? ` · ${probe.serialNumber}` : ''}`)));
      probeStatus.textContent = probes.length ? t('{n} probe(s) found', { n: probes.length }) : t('No probe found');
      probeStatus.className = probes.length ? 'muted' : 'err-text';
    } catch (error) { probeStatus.textContent = error.message; probeStatus.className = 'err-text'; }
  };

  const connect = async () => {
    const options = {
      mode, mock: mockBox.checked, chip: chipInput.value.trim(), elf: elfInput.value.trim(),
      probe: probeSelect.value, speedKHz: Number(speedInput.value) || 4000, protocol: protocolSelect.value,
      connectUnderReset: underReset.checked, flash: flashBox.checked, adapter: adapterSelect.value,
    };
    if (!options.mock && !options.chip) { notify(t('Choose the target chip first'), 'warn'); chipInput.focus(); return; }
    if (mode === 'launch' && !options.elf) { notify(t('Launch needs a firmware ELF'), 'warn'); return; }
    saveProfile(options);
    workspace.saveSettings({ connection: { chip: options.chip, elf: options.elf, mode, flash: options.flash, speedKHz: options.speedKHz, protocol: options.protocol, probe: options.probe } });
    close();
    await connectWith(options);
  };

  const close = modal({
    title: t('Connect to target'),
    width: '600px',
    body: [
      h('div', { class: 'segmented' }, modeButtons),
      h('div', { class: 'field' }, h('span', null, t('Probe')), h('div', { class: 'row' }, probeSelect, iconButton('refresh', t('Rescan probes'), refreshProbes)), probeStatus),
      h('div', { class: 'field' }, h('span', null, t('Target chip')), h('div', { class: 'row' }, chipInput), chipList),
      h('div', { class: 'field' }, h('span', null, t('Firmware ELF')), h('div', { class: 'row' }, elfInput, elfMenuButton,
        h('button', { class: 'btn', onclick: async () => { const file = await host.dialog.openFile({ title: t('Choose firmware'), defaultPath: workspace.root || undefined, filters: [{ name: 'ELF', extensions: ['elf', 'axf', 'out'] }, { name: 'All', extensions: ['*'] }] }); if (file) elfInput.value = file; } }, t('Browse…')))),
      flashRow,
      h('div', { class: 'grid-2' },
        h('div', { class: 'field' }, h('span', null, t('Protocol')), protocolSelect),
        h('div', { class: 'field' }, h('span', null, t('Clock (kHz)')), speedInput)),
      h('div', { class: 'row wrap' },
        h('label', { class: 'row' }, underReset, t('Connect under reset')),
        h('label', { class: 'row', title: t('Simulated target, no hardware needed') }, mockBox, t('Simulated target'))),
      h('div', { class: 'field' }, h('span', null, t('Debug core')), adapterSelect),
    ],
    footer: [h('span', { class: 'grow faint' }, h('kbd', null, 'Enter'), ' ', t('to connect')), h('button', { class: 'btn ghost', onclick: () => close() }, t('Cancel')), h('button', { class: 'btn primary', onclick: connect }, icon('plug'), t('Connect'))],
  });
  chipInput.closest('.modal').addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') connect(); });
  refreshProbes();
  host.probes.targets().then(targets => chipList.replaceChildren(...targets.map(name => h('option', { value: name })))).catch(() => {});
  host.plugins.describe().then(({ adapters }) => adapterSelect.append(...adapters.map(item => h('option', { value: item.id, selected: item.id === profile.adapter }, item.label)))).catch(() => {});
}

export async function connectWith(options) {
  try {
    await session.connect(options);
    notify(options.mock ? t('Connected to simulated target') : t('Connected to {chip}', { chip: options.chip }), 'ok');
    return true;
  } catch (error) {
    notify(`${t('Connection failed')}: ${error.message}`, 'error', 12000);
    return false;
  }
}

export async function quickConnect() {
  if (session.connected || session.status === 'connecting') return;
  const profile = connectionProfile();
  if (profile.mock || profile.chip) await connectWith(profile);
  else openConnectDialog();
}

/**
 * Flashing always (re)starts the session: programming under a live, possibly
 * halted debug session leaves stale breakpoints, frames and symbols behind.
 * A connected Debug/Launch session keeps its mode; otherwise Launch is used.
 */
export async function flashFirmware() {
  if (session.status === 'connecting') return;
  const base = session.connected ? session.options : connectionProfile();
  const elf = base.elf || await host.dialog.openFile({ title: t('Choose firmware'), filters: [{ name: 'ELF', extensions: ['elf', 'axf', 'out', 'hex', 'bin'] }] });
  if (!elf) return;
  const mode = session.connected && base.mode !== 'monitor' ? base.mode : 'launch';
  notify(t('Flashing {file}…', { file: basename(elf) }));
  if (session.connected) await session.disconnect();
  if (await connectWith({ ...base, elf, mode, flash: true })) notify(t('Flash complete'), 'ok');
}

async function debugAction(command) {
  try { await session.debug(command); } catch (error) { notify(error.message, 'error'); }
}

// ---------------------------------------------------------------- toolbar
export function createToolbar(root, { onToggleTheme, onSettings }) {
  const pill = h('div', { class: 'conn-pill', role: 'button', tabindex: 0, title: t('Connection'), onclick: event => pillMenu(event.currentTarget) },
    h('span', { class: 'dot' }), h('span', { class: 'label' }), h('span', { class: 'detail' }));
  const connectButton = h('button', { class: 'btn primary', onclick: () => session.connected ? session.disconnect() : quickConnect() });

  const buttons = {
    continue: iconButton('play', `${t('Continue')} (F5)`, () => debugAction('continue'), { class: 'go' }),
    pause: iconButton('pause', `${t('Pause')} (F6)`, () => debugAction('pause'), { class: 'hold' }),
    next: iconButton('stepOver', `${t('Step over')} (F10)`, () => debugAction('next'), { class: 'step' }),
    stepIn: iconButton('stepInto', `${t('Step into')} (F11)`, () => debugAction('stepIn'), { class: 'step' }),
    stepOut: iconButton('stepOut', `${t('Step out')} (Shift+F11)`, () => debugAction('stepOut'), { class: 'step' }),
    restart: iconButton('restart', `${t('Reset target')} (Ctrl+Shift+F5)`, () => debugAction('restart'), { class: 'reset' }),
    stop: iconButton('stop', `${t('Disconnect')} (Shift+F5)`, () => session.disconnect(), { class: 'reset' }),
  };
  const flashButton = iconButton('flash', t('Flash firmware'), flashFirmware);
  const themeButton = iconButton('moon', t('Toggle theme'), onToggleTheme);

  root.append(
    h('div', { class: 'brand' }, brandMark('logo'), 'Embedded Studio'),
    pill, connectButton,
    h('div', { class: 'toolbar-group debug' }, Object.values(buttons)),
    h('div', { class: 'toolbar-group' }, flashButton),
    toolbarExtras,
    h('div', { class: 'toolbar-spacer' }),
    themeButton,
    iconButton('settings', t('Settings'), onSettings),
  );

  const render = () => {
    const status = session.status;
    pill.dataset.status = status;
    const options = session.options;
    pill.querySelector('.label').textContent = {
      disconnected: t('Not connected'), connecting: t('Connecting…'), running: t('Running'), halted: t('Halted'),
    }[status];
    pill.querySelector('.detail').textContent = options ? [options.mock ? t('Simulated') : options.chip, options.elf ? basename(options.elf) : null, options.mode === 'monitor' ? t('monitor') : null].filter(Boolean).join(' · ') : '';
    connectButton.replaceChildren(icon(session.connected ? 'unplug' : 'plug'), session.connected ? t('Disconnect') : t('Connect'));
    connectButton.className = session.connected ? 'btn' : 'btn primary';
    connectButton.disabled = status === 'connecting';
    const canStep = session.halted && !session.monitorOnly;
    buttons.continue.disabled = !session.halted;
    buttons.pause.disabled = status !== 'running';
    buttons.next.disabled = buttons.stepIn.disabled = buttons.stepOut.disabled = !canStep;
    buttons.restart.disabled = !session.connected || session.monitorOnly;
    buttons.stop.disabled = !session.connected;
    flashButton.disabled = status === 'connecting';
  };
  session.on('status', render);
  session.on('connected', render);
  render();
  bus.on('theme', theme => themeButton.replaceChildren(icon(theme.kind === 'light' ? 'moon' : 'sun')));
}

function pillMenu(anchor) {
  const items = session.connected
    ? [{ label: t('Disconnect'), icon: 'unplug', run: () => session.disconnect() }, { label: t('Reconnect…'), icon: 'plug', run: () => openConnectDialog() }]
    : [{ label: t('Connect…'), icon: 'plug', hint: 'F5', run: () => openConnectDialog() }, { label: t('Connect to simulated target'), icon: 'chip', run: () => connectWith({ ...connectionProfile(), mock: true }) }];
  menu(anchor, items);
}

// ---------------------------------------------------------------- status bar
export function createStatusBar(root, hostInfo) {
  const state = h('div', { class: 'item' });
  const rate = h('div', { class: 'item', title: t('Measured sample rate') });
  const dropped = h('div', { class: 'item' });
  const pc = h('div', { class: 'item mono' });
  root.append(state, pc, rate, dropped, h('div', { class: 'spacer' }),
    h('div', { class: 'item', title: hostInfo.adapter || t('studio-adapter not found') }, icon('chip'), hostInfo.adapter ? t('Rust core ready') : h('span', { class: 'err-text' }, t('Rust core missing'))),
    h('div', { class: 'item' }, `${hostInfo.kind.toUpperCase()} ${hostInfo.arch}`),
    h('div', { class: 'item faint' }, `v${hostInfo.version}`));
  const render = () => {
    root.dataset.status = session.status;
    state.replaceChildren(icon(session.connected ? 'plug' : 'unplug'), session.connected ? `${session.options?.mock ? t('Simulated') : session.options?.chip || t('Target')} — ${session.halted ? t('Halted') : t('Running')}` : t('Not connected'));
    if (!session.connected) { rate.textContent = ''; dropped.textContent = ''; pc.textContent = ''; }
  };
  session.on('status', render);
  session.on('connected', render);
  session.on('coreState', coreState => {
    const sps = coreState.actualSamplesPerSecond || 0;
    rate.textContent = sps ? `${formatValue(Math.round(sps))} S/s` : '';
    dropped.textContent = coreState.droppedFrames ? t('{n} dropped', { n: coreState.droppedFrames }) : '';
  });
  session.on('frame', frame => { pc.textContent = frame?.instructionPointerReference ? `PC ${frame.instructionPointerReference}` : ''; });
  render();
}
