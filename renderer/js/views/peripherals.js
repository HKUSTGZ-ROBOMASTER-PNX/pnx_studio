// Peripheral registers from a CMSIS-SVD file: read, decode bit fields, edit.
import { h, icon, iconButton, hex, basename, debounce, parseNumber } from '../lib/dom.js';
import { bus } from '../lib/emitter.js';
import { session } from '../session.js';
import { workspace } from '../workspace.js';
import { notify, menu } from '../shell.js';
import { t } from '../i18n.js';

const host = window.host;

function fieldValue(value, field) {
  if (value === undefined || value === null) return null;
  return Number((BigInt(Math.trunc(value)) >> BigInt(field.bitOffset)) & ((1n << BigInt(field.bitWidth)) - 1n));
}

export function createPeripherals() {
  let tree = null;
  let svdPath = null;
  const expanded = new Set();     // peripheral names
  const openRegs = new Set();     // register addresses (fields shown)
  const values = new Map();       // address -> number
  const changed = new Set();
  let liveTimer = null;

  const filter = h('input', { type: 'search', placeholder: t('Filter peripherals / registers'), spellcheck: false });
  const header = h('div', { class: 'symbols-source muted' });
  const body = h('div', { class: 'tree' });
  const liveBox = h('input', { type: 'checkbox', onchange: () => schedule() });

  async function load(file, { quiet = false } = {}) {
    try {
      header.textContent = t('Loading {file}…', { file: basename(file) });
      tree = await host.svd.load(file);
      svdPath = file;
      expanded.clear(); openRegs.clear(); values.clear();
      workspace.saveSettings({ svd: file });
      render();
      if (!quiet) notify(t('Loaded {device}: {n} peripherals', { device: tree.deviceName, n: tree.peripherals.length }), 'ok');
    } catch (error) { header.textContent = ''; notify(`${t('SVD load failed')}: ${error.message}`, 'error'); }
  }

  async function choose(event) {
    const found = workspace.root ? await host.workspace.findSvds(workspace.root) : [];
    const browse = async () => { const file = await host.dialog.openFile({ title: t('Choose SVD file'), filters: [{ name: 'CMSIS-SVD', extensions: ['svd', 'xml'] }] }); if (file) load(file); };
    if (!found.length) { browse(); return; }
    menu(event.currentTarget, [...found.slice(0, 10).map(file => ({ label: basename(file), icon: 'file', run: () => load(file) })), '-', { label: t('Browse…'), icon: 'folderOpen', run: browse }]);
  }

  async function readPeripheral(peripheral) {
    if (!session.connected) return;
    try {
      const result = await session.request('studio/readRegisters', { registers: peripheral.registers.map(reg => ({ id: reg.name, address: reg.address, sizeBits: reg.sizeBits })) });
      for (const item of result.values || []) {
        const old = values.get(item.address);
        if (old !== undefined && old !== item.value) changed.add(item.address); else changed.delete(item.address);
        values.set(item.address, item.value);
      }
    } catch (error) { notify(`${peripheral.name}: ${error.message}`, 'error'); }
  }

  async function refreshExpanded() {
    if (!tree) return;
    for (const peripheral of tree.peripherals) if (expanded.has(peripheral.name)) await readPeripheral(peripheral);
    render();
  }

  function schedule() {
    clearTimeout(liveTimer);
    if (liveBox.checked && session.connected) liveTimer = setTimeout(async () => { await refreshExpanded(); schedule(); }, 500);
  }

  async function writeRegister(register, value) {
    if (session.monitorOnly) { notify(t('Monitor-only session: writes are disabled'), 'warn'); return; }
    const bytes = new Uint8Array(register.sizeBits / 8);
    let rest = BigInt(Math.trunc(value));
    for (let i = 0; i < bytes.length; i++) { bytes[i] = Number(rest & 0xffn); rest >>= 8n; }
    try {
      await session.writeMemory(register.address, bytes);
      const peripheral = tree.peripherals.find(item => item.registers.includes(register));
      await readPeripheral(peripheral);
      render();
    } catch (error) { notify(`${register.name}: ${error.message}`, 'error'); }
  }

  function editCell(cell, initial, onCommit) {
    if (!session.connected) return;
    const input = h('input', { type: 'text', value: initial, class: 'mono inline-edit' });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') render();
      if (event.key === 'Enter') { const value = parseNumber(input.value); if (value === null) notify(t('Not a number'), 'warn'); else onCommit(value); }
    });
    input.addEventListener('blur', () => render());
    cell.replaceChildren(input);
    input.select();
  }

  function registerRow(register) {
    const value = values.get(register.address);
    const digits = Math.max(2, register.sizeBits / 4);
    const readOnly = /read-only/.test(register.access || '');
    const valueCell = h('span', { class: `reg-value mono${changed.has(register.address) ? ' changed' : ''}`, title: readOnly ? t('read-only') : t('Double-click to edit') }, value === undefined ? '—' : hex(value, digits));
    if (!readOnly) valueCell.ondblclick = event => { event.stopPropagation(); editCell(valueCell, value === undefined ? '' : hex(value, digits), next => writeRegister(register, next)); };
    const isOpen = openRegs.has(register.address);
    const row = h('div', { class: 'tree-row svd-reg', style: { paddingLeft: '22px' }, title: `${register.description || ''}\n${hex(register.address)} · ${register.sizeBits} bit · ${register.access || 'read-write'}${register.resetValue != null ? ` · reset ${hex(register.resetValue, digits)}` : ''}`,
      onclick: () => { isOpen ? openRegs.delete(register.address) : openRegs.add(register.address); render(); } },
    register.fields.length ? icon(isOpen ? 'chevronDown' : 'chevronRight', 'twisty') : h('span', { class: 'twisty-spacer' }),
    h('span', { class: 'name mono' }, register.name), h('span', { class: 'faint mono addr' }, hex(register.address).slice(-4)), valueCell);
    const out = [row];
    if (isOpen) {
      if (value !== undefined) out.push(h('div', { class: 'bitbar', style: { marginLeft: '40px' } }, Array.from({ length: register.sizeBits }, (_, i) => {
        const bit = register.sizeBits - 1 - i;
        return h('span', { class: (BigInt(Math.trunc(value)) >> BigInt(bit)) & 1n ? 'on' : '', title: `bit ${bit}` });
      })));
      for (const field of register.fields) {
        const fv = fieldValue(value, field);
        const fieldReadOnly = readOnly || /read-only/.test(field.access || '');
        const cell = h('span', { class: 'reg-value mono' }, fv === null ? '—' : field.bitWidth === 1 ? String(fv) : `${fv} (${hex(fv, Math.ceil(field.bitWidth / 4))})`);
        if (!fieldReadOnly) {
          cell.ondblclick = event => {
            event.stopPropagation();
            if (field.bitWidth === 1 && value !== undefined) { writeRegister(register, Number(BigInt(Math.trunc(value)) ^ (1n << BigInt(field.bitOffset)))); return; }
            editCell(cell, fv ?? '', next => {
              const mask = ((1n << BigInt(field.bitWidth)) - 1n) << BigInt(field.bitOffset);
              writeRegister(register, Number((BigInt(Math.trunc(value ?? 0)) & ~mask) | ((BigInt(Math.trunc(next)) << BigInt(field.bitOffset)) & mask)));
            });
          };
          cell.title = field.bitWidth === 1 ? t('Double-click to toggle') : t('Double-click to edit');
        }
        out.push(h('div', { class: 'tree-row svd-field', style: { paddingLeft: '44px' }, title: field.description || '' },
          h('span', { class: 'name mono' }, field.name), h('span', { class: 'faint mono addr' }, field.bitWidth === 1 ? `[${field.bitOffset}]` : `[${field.bitOffset + field.bitWidth - 1}:${field.bitOffset}]`), cell));
      }
    }
    return out;
  }

  function render() {
    if (!tree) {
      header.textContent = '';
      body.replaceChildren(h('div', { class: 'empty-pane' }, h('p', { class: 'muted' }, t('Load the CMSIS-SVD file of your MCU to browse peripheral registers.')),
        h('button', { class: 'btn', onclick: choose }, icon('chip'), t('Load SVD…'))));
      return;
    }
    header.textContent = `${tree.deviceName} · ${basename(svdPath)}${session.connected ? '' : ` · ${t('offline')}`}`;
    const query = filter.value.trim().toLowerCase();
    const rows = [];
    for (const peripheral of tree.peripherals) {
      const regs = query && !peripheral.name.toLowerCase().includes(query) ? peripheral.registers.filter(reg => reg.name.toLowerCase().includes(query)) : peripheral.registers;
      if (query && !regs.length) continue;
      const open = expanded.has(peripheral.name) || (query && regs.length !== peripheral.registers.length);
      rows.push(h('div', { class: 'tree-row svd-periph', title: peripheral.description || '', onclick: async () => {
        if (expanded.has(peripheral.name)) expanded.delete(peripheral.name); else { expanded.add(peripheral.name); await readPeripheral(peripheral); }
        render();
      } }, icon(open ? 'chevronDown' : 'chevronRight', 'twisty'), h('span', { class: 'name' }, peripheral.name), h('span', { class: 'faint mono addr' }, hex(peripheral.baseAddress))));
      if (open) for (const register of regs) rows.push(...registerRow(register));
    }
    body.replaceChildren(...rows);
  }

  filter.addEventListener('input', debounce(render, 120));
  session.on('stopped', () => refreshExpanded());
  session.on('connected', () => { refreshExpanded(); schedule(); });
  session.on('status', status => { if (status === 'disconnected') { clearTimeout(liveTimer); render(); } });
  bus.on('svd:load', file => load(file));
  workspace.on('opened', () => { if (workspace.settings.svd) load(workspace.settings.svd, { quiet: true }); });
  render();
  return {
    el: h('div', { class: 'peripherals' }, h('div', { class: 'pane-search' }, filter), h('div', { class: 'row pane-sub' }, header, h('span', { class: 'grow' }), h('label', { class: 'row muted', title: t('Re-read expanded peripherals every 500 ms') }, liveBox, t('Live'))), body),
    actions: [iconButton('chip', t('Load SVD…'), choose, { class: 'small' }), iconButton('refresh', t('Read expanded'), refreshExpanded, { class: 'small' })],
  };
}
