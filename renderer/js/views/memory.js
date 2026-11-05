// Memory viewer: hex dump with 8/16/32-bit grouping, change highlighting and auto refresh.
import { h, iconButton, hex, parseNumber } from '../lib/dom.js';
import { bus } from '../lib/emitter.js';
import { session } from '../session.js';
import { workbench, notify } from '../shell.js';
import { t } from '../i18n.js';

export function createMemory() {
  const addressInput = h('input', { type: 'text', class: 'mono', value: '0x20000000', placeholder: t('Address or symbol'), style: { width: '180px' }, spellcheck: false });
  const lengthInput = h('input', { type: 'number', value: 256, min: 16, max: 65536, step: 16, style: { width: '90px' } });
  const groupSelect = h('select', null, [[1, '8-bit'], [2, '16-bit'], [4, '32-bit']].map(([value, label]) => h('option', { value, selected: value === 4 }, label)));
  const autoBox = h('input', { type: 'checkbox' });
  const dump = h('div', { class: 'hexdump mono' });
  let previous = null, previousAddress = null, timer = null;

  const resolveAddress = () => {
    const text = addressInput.value.trim();
    const number = parseNumber(text);
    if (number !== null) return number;
    const variable = session.variable(text);
    if (variable?.address != null) return variable.address;
    throw new Error(t('Unknown address or symbol: {text}', { text }));
  };

  const render = (address, bytes) => {
    const group = Number(groupSelect.value);
    const rows = [];
    for (let offset = 0; offset < bytes.length; offset += 16) {
      const cells = [];
      for (let i = offset; i < Math.min(offset + 16, bytes.length); i += group) {
        let value = 0, diff = false;
        for (let b = group - 1; b >= 0; b--) { value = value * 256 + (bytes[i + b] ?? 0); if (previous && previousAddress === address && previous[i + b] !== bytes[i + b]) diff = true; }
        cells.push(h('span', { class: diff ? 'changed' : value === 0 ? 'zero' : '' }, value.toString(16).padStart(group * 2, '0')));
      }
      const ascii = Array.from(bytes.subarray(offset, offset + 16), byte => byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '·').join('');
      rows.push(h('div', { class: 'hex-row' }, h('span', { class: 'addr' }, hex(address + offset)), h('span', { class: 'cells' }, cells), h('span', { class: 'ascii' }, ascii)));
    }
    dump.replaceChildren(...rows);
  };

  const read = async () => {
    clearTimeout(timer);
    if (!session.connected) { dump.replaceChildren(h('div', { class: 'tree-msg muted' }, t('Connect to read memory.'))); return; }
    try {
      const address = resolveAddress();
      const length = Math.max(16, Math.min(65536, Number(lengthInput.value) || 256));
      const bytes = await session.readMemory(address, length);
      render(address, bytes);
      previous = bytes; previousAddress = address;
    } catch (error) { dump.replaceChildren(h('div', { class: 'tree-msg err-text' }, error.message)); }
    if (autoBox.checked) timer = setTimeout(read, 500);
  };

  addressInput.addEventListener('keydown', event => { if (event.key === 'Enter') read(); });
  groupSelect.addEventListener('change', () => previous && render(previousAddress, previous));
  autoBox.addEventListener('change', read);
  session.on('stopped', () => { if (dump.isConnected) read(); });
  bus.on('memory:show', ({ address, length }) => {
    if (address == null) { notify(t('This symbol has no fixed address'), 'warn'); return; }
    addressInput.value = hex(address);
    if (length) lengthInput.value = Math.max(16, Math.ceil(length / 16) * 16);
    workbench.panel.activate('memory');
    read();
  });

  return {
    el: h('div', { class: 'memory' },
      h('div', { class: 'view-toolbar' }, addressInput, lengthInput, groupSelect, h('button', { class: 'btn small primary', onclick: read }, t('Read')),
        h('label', { class: 'row' }, autoBox, t('Auto refresh')), h('span', { class: 'grow' }),
        iconButton('download', t('Copy as hex'), () => previous && navigator.clipboard.writeText(Array.from(previous, b => b.toString(16).padStart(2, '0')).join(' ')), { class: 'small' })),
      dump),
    onShow: () => { if (session.connected && !previous) read(); },
  };
}
