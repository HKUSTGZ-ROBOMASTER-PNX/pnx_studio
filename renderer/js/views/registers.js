// Core register file (R0–R15, xPSR, special registers) with change highlighting.
import { h, iconButton, parseNumber } from '../lib/dom.js';
import { session } from '../session.js';
import { t } from '../i18n.js';

const XPSR_FLAGS = [['N', 31], ['Z', 30], ['C', 29], ['V', 28], ['Q', 27]];

function numeric(value) {
  const n = parseNumber(value);
  return n === null ? null : n >>> 0;
}

export function createRegisters() {
  let format = 'hex';
  let previous = new Map();
  let current = [];
  let lastStop = -1;
  let autoTimer = null;
  const table = h('div', { class: 'reg-table mono' });
  const status = h('div', { class: 'view-status muted' });
  const formatSelect = h('select', { onchange: event => { format = event.target.value; render(); } },
    h('option', { value: 'hex' }, 'Hex'), h('option', { value: 'dec' }, 'Dec'), h('option', { value: 'bin' }, 'Bin'));
  const autoBox = h('input', { type: 'checkbox', onchange: () => schedule() });

  const show = (value) => {
    const n = numeric(value);
    if (n === null) return value;
    if (format === 'dec') return String(n);
    if (format === 'bin') return n.toString(2).padStart(32, '0').replace(/(.{8})(?!$)/g, '$1 ');
    return `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;
  };

  const render = () => {
    if (!session.connected) { table.replaceChildren(); status.textContent = t('Connect to read core registers.'); return; }
    status.textContent = '';
    table.replaceChildren(...current.map(register => {
      const changed = previous.has(register.name) && previous.get(register.name) !== register.value;
      const extra = /^x?psr$/i.test(register.name) ? h('span', { class: 'flags' }, XPSR_FLAGS.map(([flag, bit]) => h('span', { class: (numeric(register.value) >>> bit) & 1 ? 'on' : '' }, flag))) : null;
      return h('div', { class: `reg-row${changed ? ' changed' : ''}`, title: `${register.name} = ${register.value}` },
        h('span', { class: 'reg-name' }, register.name), h('span', { class: 'reg-value' }, show(register.value)), extra);
    }));
  };

  const refresh = async () => {
    if (!session.connected) { render(); return; }
    try {
      const result = await session.request('studio/coreRegisters');
      if (session.stopId !== lastStop) { previous = new Map(current.map(item => [item.name, item.value])); lastStop = session.stopId; }
      current = result.registers || [];
      render();
    } catch (error) { status.textContent = error.message; }
  };

  const schedule = () => {
    clearTimeout(autoTimer);
    if (autoBox.checked && session.connected) autoTimer = setTimeout(async () => { await refresh(); schedule(); }, 500);
  };

  session.on('stopped', () => setTimeout(refresh, 30));
  session.on('connected', () => { previous.clear(); current = []; refresh(); schedule(); });
  session.on('status', status => { if (status === 'disconnected') { current = []; render(); } });
  render();
  return {
    el: h('div', { class: 'inspector-view' },
      h('div', { class: 'view-toolbar' }, formatSelect, h('label', { class: 'row', title: t('Poll every 500 ms; on some cores registers are only valid while halted') }, autoBox, t('Live')), h('span', { class: 'grow' }), iconButton('refresh', t('Refresh'), refresh, { class: 'small' })),
      status, table),
    onShow: refresh,
  };
}
