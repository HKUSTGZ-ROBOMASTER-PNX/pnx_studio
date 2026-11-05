// Symbols sidebar: global variables from the ELF's DWARF info, searchable,
// with quick actions to watch or plot. Works offline (ELF only) and online.
import { h, icon, iconButton, hex, basename, debounce } from '../lib/dom.js';
import { bus } from '../lib/emitter.js';
import { session } from '../session.js';
import { connectionProfile } from './connection.js';
import { notify, menu } from '../shell.js';
import { t } from '../i18n.js';

const host = window.host;
export const VAR_MIME = 'application/x-studio-var';

let offline = { elf: null, catalog: [] };

export function isScalar(item) {
  return item && !(item.children?.length) && (item.address != null || item.pointerAddress != null) && [1, 2, 4, 8].includes(item.byteWidth);
}

/** A struct, union or array with addressable members. */
export function isAggregate(item) { return !!item?.children?.length; }

export function currentCatalog() { return session.connected ? session.catalog : offline.catalog; }

function flatten(items, aggregates, out = []) {
  for (const item of items) { if (isScalar(item) || (aggregates && isAggregate(item))) out.push(item); if (item.children?.length) flatten(item.children, aggregates, out); }
  return out;
}

/** `aggregates` also returns structs/arrays (for the watch list), not only plottable scalars. */
export function searchVariables(query, limit = 300, { aggregates = false } = {}) {
  const needle = query.trim().toLowerCase();
  const all = flatten(currentCatalog(), aggregates);
  if (!needle) return all.slice(0, limit);
  const scored = [];
  for (const item of all) {
    const name = (item.expression || item.name).toLowerCase();
    const at = name.indexOf(needle);
    if (at >= 0) scored.push([at === 0 ? 0 : name.endsWith(needle) ? 1 : 2, name.length, item]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, limit).map(entry => entry[2]);
}

/** Popover to search and choose a scalar variable (or, with `aggregates`, a struct/array too). */
export function pickVariable(anchor, onPick, options = {}) {
  const input = h('input', { type: 'search', placeholder: t('Search variables…'), spellcheck: false });
  const list = h('div', { class: 'picker-list' });
  const render = () => {
    const results = searchVariables(input.value, 120, options);
    list.replaceChildren(...(results.length ? results.map(item => h('div', { class: 'picker-item', onmousedown: event => { event.preventDefault(); onPick(item); close(); } },
      h('span', { class: 'mono' }, item.expression || item.name), h('span', { class: 'faint' }, item.typeName))) : [h('div', { class: 'tree-msg muted' }, currentCatalog().length ? t('No match') : t('No symbols — choose an ELF or connect first'))]));
  };
  const box = h('div', { class: 'menu picker' }, input, list);
  const close = () => { box.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = event => { if (!box.contains(event.target)) close(); };
  input.addEventListener('input', debounce(render, 80));
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
    if (event.key === 'Enter') { const first = searchVariables(input.value, 1, options)[0]; if (first) { onPick(first); close(); } }
  });
  document.getElementById('overlay').append(box);
  const rect = anchor.getBoundingClientRect();
  box.style.left = `${Math.min(rect.left, window.innerWidth - 420)}px`;
  box.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 380)}px`;
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  render();
  input.focus();
}

export async function loadOfflineSymbols(elf) {
  if (!elf || offline.elf === elf) return;
  try {
    const catalog = await host.elf.inspect(elf);
    offline = { elf, catalog: Array.isArray(catalog) ? catalog : [] };
    bus.emit('symbols:offline', offline);
  } catch (error) { notify(`${t('Could not read symbols')}: ${error.message}`, 'error'); }
}

export function createSymbols() {
  const search = h('input', { type: 'search', placeholder: t('Filter variables'), spellcheck: false });
  const source = h('div', { class: 'symbols-source muted' });
  const tree = h('div', { class: 'tree' });
  const expanded = new Set();

  const row = (item, depth) => {
    const scalar = isScalar(item);
    const hasChildren = item.children?.length > 0;
    const el = h('div', {
      class: 'tree-row var-row', style: { paddingLeft: `${8 + depth * 14}px` }, draggable: scalar,
      title: `${item.expression || item.name}\n${item.typeName}${item.address != null ? ` @ ${hex(item.address)}` : ''}`,
      ondragstart: event => { event.dataTransfer.setData(VAR_MIME, JSON.stringify({ id: item.id, expression: item.expression || item.name })); event.dataTransfer.effectAllowed = 'copy'; },
      oncontextmenu: event => { event.preventDefault(); if (scalar || hasChildren) rowMenu({ x: event.clientX, y: event.clientY }, item, scalar); },
    },
    hasChildren ? icon(expanded.has(item.id) ? 'chevronDown' : 'chevronRight', 'twisty') : h('span', { class: 'twisty-spacer' }),
    h('span', { class: 'name mono' }, depth ? item.name : (item.expression || item.name)),
    h('span', { class: 'type faint' }, item.typeName),
    scalar ? h('span', { class: 'row-actions' },
      iconButton('eye', t('Add to watch'), event => { event.stopPropagation(); bus.emit('watch:add', item); }, { class: 'small' }),
      iconButton('chart', t('Plot'), event => { event.stopPropagation(); bus.emit('plot:add', item); }, { class: 'small' }))
      : hasChildren ? h('span', { class: 'row-actions' },
        iconButton('eye', t('Add to watch'), event => { event.stopPropagation(); bus.emit('watch:add', item); }, { class: 'small' })) : null);
    if (hasChildren) el.onclick = () => { expanded.has(item.id) ? expanded.delete(item.id) : expanded.add(item.id); render(); };
    else if (scalar) el.ondblclick = () => bus.emit('watch:add', item);
    return el;
  };

  const rowMenu = (at, item, scalar) => menu(at, [
    { label: t('Add to watch'), icon: 'eye', run: () => bus.emit('watch:add', item) },
    scalar ? { label: t('Plot in active chart'), icon: 'chart', run: () => bus.emit('plot:add', item) } : null,
    item.address != null ? { label: t('Show in memory view'), icon: 'memory', run: () => bus.emit('memory:show', { address: item.address, length: 64 }) } : null,
    '-',
    { label: t('Copy expression'), icon: 'link', run: () => navigator.clipboard.writeText(item.expression || item.name) },
  ].filter(Boolean));

  const render = () => {
    const catalog = currentCatalog();
    source.textContent = session.connected ? t('{n} globals · live target', { n: catalog.length }) : offline.elf ? t('{n} globals · {file} (offline)', { n: catalog.length, file: basename(offline.elf) }) : '';
    if (!catalog.length) {
      tree.replaceChildren(h('div', { class: 'empty-pane' }, h('p', { class: 'muted' }, t('Symbols come from the firmware ELF (DWARF).')),
        h('button', { class: 'btn', onclick: async () => {
          const elf = connectionProfile().elf || await host.dialog.openFile({ title: t('Choose firmware'), filters: [{ name: 'ELF', extensions: ['elf', 'axf', 'out'] }] });
          if (elf) loadOfflineSymbols(elf);
        } }, icon('file'), t('Load symbols from ELF'))));
      return;
    }
    const query = search.value.trim();
    if (query) { tree.replaceChildren(...searchVariables(query, 400).map(item => row({ ...item, name: item.expression || item.name }, 0))); return; }
    const rows = [];
    const walk = (items, depth) => {
      for (const item of items.slice(0, 2000)) {
        rows.push(row(item, depth));
        if (item.children?.length && expanded.has(item.id)) walk(item.children, depth + 1);
      }
    };
    walk([...catalog].sort((a, b) => (a.expression || a.name).localeCompare(b.expression || b.name)), 0);
    tree.replaceChildren(...rows);
  };

  search.addEventListener('input', debounce(render, 120));
  session.on('catalog', render);
  bus.on('symbols:offline', render);
  bus.on('elf:selected', elf => loadOfflineSymbols(elf));
  render();
  return {
    el: h('div', { class: 'symbols' }, h('div', { class: 'pane-search' }, search), source, tree),
    actions: [iconButton('refresh', t('Reload symbols from ELF'), () => { offline.elf = null; loadOfflineSymbols(connectionProfile().elf); }, { class: 'small' })],
    onShow: () => { if (!session.connected && !offline.elf && connectionProfile().elf) loadOfflineSymbols(connectionProfile().elf); },
  };
}
