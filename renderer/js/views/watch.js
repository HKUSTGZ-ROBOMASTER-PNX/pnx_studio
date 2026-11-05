// Watch list: polled values of chosen globals, editable in place. Structs and
// arrays expand in place; only the visible scalar members are polled.
// Variables live in groups; a group or a single variable can be paused, which
// keeps it listed (with its last value) but stops polling it, so long lists do
// not slow the probe down.
import { h, icon, iconButton, hex, formatValue } from '../lib/dom.js';
import { bus } from '../lib/emitter.js';
import { session } from '../session.js';
import { workspace } from '../workspace.js';
import { notify, menu } from '../shell.js';
import { pickVariable, isScalar, isAggregate, VAR_MIME } from './symbols.js';
import { t } from '../i18n.js';

const WATCH_MIME = 'application/x-studio-watch';
const MAX_POLLED = 256;

let groupCounter = 0;
const newGroupId = () => `g${Date.now().toString(36)}${(groupCounter++).toString(36)}`;

/** Settings → groups; earlier versions stored a flat list of keys. */
export function loadGroups(saved) {
  if (Array.isArray(saved)) return { groups: [{ id: newGroupId(), name: t('Watch'), enabled: true, collapsed: false, items: saved.map(key => ({ key, enabled: true })) }], active: null };
  const groups = (saved?.groups || []).map(group => ({ id: group.id || newGroupId(), name: group.name || t('Group'), enabled: group.enabled !== false, collapsed: !!group.collapsed, items: (group.items || []).map(item => ({ key: item.key, enabled: item.enabled !== false })) }));
  if (!groups.length) groups.push({ id: newGroupId(), name: t('Watch'), enabled: true, collapsed: false, items: [] });
  return { groups, active: saved?.active || null };
}

export function createWatch() {
  let groups = loadGroups([]).groups;
  let activeId = groups[0].id;
  let values = new Map();
  let previous = new Map();
  let timer = null;
  let period = 200;
  const expanded = new Set(); // `${group}\0${key}` of open watch entries, ids of open members
  const list = h('div', { class: 'watch-list' });

  const activeGroup = () => groups.find(group => group.id === activeId) || groups[0];
  const persist = () => workspace.saveSettings({ watch: { groups, active: activeId } });
  const sampled = (group, item) => group.enabled && item.enabled;

  const add = (item, group = activeGroup()) => {
    const key = item.expression || item.id;
    if (isAggregate(item)) expanded.add(`${group.id}\0${key}`);
    if (group.items.some(entry => entry.key === key)) return;
    group.items.push({ key, enabled: true });
    group.collapsed = false;
    persist(); render(); poll();
  };
  const move = (fromId, key, to) => {
    const from = groups.find(group => group.id === fromId);
    const item = from?.items.find(entry => entry.key === key);
    if (!item || from === to) return;
    from.items = from.items.filter(entry => entry !== item);
    if (!to.items.some(entry => entry.key === key)) to.items.push(item);
    persist(); render(); poll();
  };

  const polledIds = () => {
    const ids = [];
    const walk = (variable, openKey) => {
      if (ids.length >= MAX_POLLED) return;
      if (isScalar(variable)) ids.push(variable.id);
      else if (isAggregate(variable) && expanded.has(openKey)) for (const child of variable.children) walk(child, child.id);
    };
    for (const group of groups) for (const item of group.items) {
      if (!sampled(group, item)) continue;
      const variable = session.variable(item.key);
      if (variable) walk(variable, `${group.id}\0${item.key}`);
    }
    return [...new Set(ids)];
  };

  const edit = (cell, name, variable) => {
    if (!variable?.writable) { notify(t('{name} is read-only', { name }), 'warn'); return; }
    if (session.monitorOnly) { notify(t('Monitor-only session: writes are disabled'), 'warn'); return; }
    const input = h('input', { type: 'text', value: String(values.get(variable.id) ?? ''), class: 'mono inline-edit' });
    const commit = async () => {
      try { await session.request('studio/writeValue', { id: variable.id, value: input.value.trim() }); notify(t('{name} written', { name }), 'ok', 1500); }
      catch (error) { notify(error.message, 'error'); }
      render(); poll();
    };
    input.addEventListener('keydown', event => { if (event.key === 'Enter') commit(); if (event.key === 'Escape') render(); });
    input.addEventListener('blur', () => render());
    cell.replaceChildren(input);
    input.select();
  };

  const rename = (label, group) => {
    const input = h('input', { type: 'text', value: group.name, class: 'inline-edit' });
    const commit = () => { group.name = input.value.trim() || group.name; persist(); render(); };
    input.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Enter') commit(); if (event.key === 'Escape') render(); });
    input.addEventListener('blur', commit);
    input.addEventListener('click', event => event.stopPropagation());
    label.replaceChildren(input);
    input.select();
  };

  const removeGroup = group => {
    if (groups.length === 1) { group.items = []; persist(); render(); return; }
    groups = groups.filter(entry => entry !== group);
    if (activeId === group.id) activeId = groups[0].id;
    persist(); render(); poll();
  };

  const groupMenu = (anchor, group) => menu(anchor, [
    { label: t('Add variables here'), icon: 'plus', run: () => { activeId = group.id; pickVariable(anchor, item => add(item, group), { aggregates: true }); } },
    { label: t('Rename'), icon: 'edit', run: () => rename(anchor.closest('.watch-group-head').querySelector('.group-name'), group) },
    '-',
    { label: t('Resume all variables'), icon: 'play', run: () => { group.items.forEach(item => { item.enabled = true; }); group.enabled = true; persist(); render(); poll(); } },
    { label: t('Pause all variables'), icon: 'pause', run: () => { group.items.forEach(item => { item.enabled = false; }); persist(); render(); poll(); } },
    '-',
    { label: groups.length > 1 ? t('Delete group') : t('Clear group'), icon: 'close', run: () => removeGroup(group) },
  ]);

  /** A group's header and body both accept variables (add) and watch rows (move). */
  const dropTarget = (el, group) => {
    el.addEventListener('dragover', event => {
      const types = event.dataTransfer.types;
      if (!types.includes(WATCH_MIME) && !types.includes(VAR_MIME)) return;
      event.preventDefault();
      el.closest('.watch-group').classList.add('drop');
    });
    el.addEventListener('dragleave', event => { if (!el.contains(event.relatedTarget)) el.closest('.watch-group').classList.remove('drop'); });
    el.addEventListener('drop', event => {
      el.closest('.watch-group').classList.remove('drop');
      const moved = event.dataTransfer.getData(WATCH_MIME);
      const variable = event.dataTransfer.getData(VAR_MIME);
      if (!moved && !variable) return;
      event.preventDefault();
      if (moved) { const { group: from, key } = JSON.parse(moved); move(from, key, group); }
      else add(JSON.parse(variable), group);
    });
  };

  const render = () => {
    list.replaceChildren(...groups.map(group => {
      const total = group.items.length;
      const live = group.enabled ? group.items.filter(item => item.enabled).length : 0;
      const label = h('span', { class: 'group-name', title: t('Double-click to rename') }, group.name);
      label.ondblclick = event => { event.stopPropagation(); rename(label, group); };
      const head = h('div', {
        class: `watch-group-head${group.id === activeId ? ' active' : ''}${group.enabled ? '' : ' paused'}`,
        title: t('Click to make this the group new variables go to'),
        onclick: () => { activeId = group.id; persist(); render(); },
      },
      iconButton(group.collapsed ? 'chevronRight' : 'chevronDown', group.collapsed ? t('Expand') : t('Collapse'), event => { event.stopPropagation(); group.collapsed = !group.collapsed; persist(); render(); }, { class: 'small' }),
      label,
      h('span', { class: 'faint group-count' }, group.enabled ? t('{live}/{total} sampled', { live, total }) : t('paused · {total}', { total })),
      h('span', { class: 'grow' }),
      iconButton(group.enabled ? 'pause' : 'play', group.enabled ? t('Pause sampling this group') : t('Resume sampling this group'), event => { event.stopPropagation(); group.enabled = !group.enabled; persist(); render(); poll(); }, { class: `small${group.enabled ? '' : ' active'}` }),
      iconButton('settings', t('Group actions'), event => { event.stopPropagation(); groupMenu(event.currentTarget, group); }, { class: 'small' }));

      const rows = [];
      const row = (variable, depth, item) => {
        const live = sampled(group, item);
        const name = depth ? variable.name : item.key;
        const expression = depth ? variable.expression || variable.name : item.key;
        const aggregate = isAggregate(variable);
        const scalar = isScalar(variable);
        const openKey = depth ? variable?.id : `${group.id}\0${item.key}`;
        const open = aggregate && expanded.has(openKey);
        const value = scalar ? values.get(variable.id) : undefined;
        const changed = live && scalar && previous.has(variable.id) && previous.get(variable.id) !== value;
        const text = !session.connected ? '—' : !variable ? t('not found') : aggregate ? (open ? '' : '{…}') : scalar ? (value === undefined ? '—' : formatValue(value, 8)) : '';
        const valueCell = h('span', { class: `watch-value mono${changed ? ' changed' : ''}${aggregate ? ' faint' : ''}`, title: scalar ? t('Double-click to edit') : '' }, text);
        if (scalar) valueCell.ondblclick = () => edit(valueCell, expression, variable);
        const toggle = () => { open ? expanded.delete(openKey) : expanded.add(openKey); render(); poll(); };
        const sampling = depth ? null : iconButton(item.enabled ? 'pause' : 'play', item.enabled ? t('Pause sampling (keep in list)') : t('Resume sampling'),
          () => { item.enabled = !item.enabled; persist(); render(); poll(); }, { class: `small${item.enabled ? '' : ' active'}` });
        rows.push(h('div', {
          class: `watch-row${live ? '' : ' paused'}`, draggable: scalar || !variable || !depth, onclick: aggregate ? toggle : null,
          ondragstart: event => {
            if (scalar || !variable) event.dataTransfer.setData(VAR_MIME, JSON.stringify({ id: variable?.id, expression }));
            if (!depth) event.dataTransfer.setData(WATCH_MIME, JSON.stringify({ group: group.id, key: item.key }));
          },
        },
        h('span', { class: 'watch-name mono', style: { paddingLeft: `${depth * 14}px` }, title: variable ? `${expression}\n${variable.typeName}${variable.address != null ? ` @ ${hex(variable.address)}` : ''}` : item.key },
          aggregate ? icon(open ? 'chevronDown' : 'chevronRight', 'twisty') : depth ? h('span', { class: 'twisty-spacer' }) : null, name),
        valueCell,
        h('span', { class: 'row-actions', onclick: event => event.stopPropagation() },
          sampling,
          scalar || !variable ? iconButton('chart', t('Plot'), () => bus.emit('plot:add', { id: variable?.id, expression }), { class: 'small' }) : null,
          depth ? null : iconButton('close', t('Remove'), () => { group.items = group.items.filter(entry => entry !== item); expanded.delete(openKey); persist(); render(); }, { class: 'small' }))));
        if (open) for (const child of variable.children.slice(0, 1000)) row(child, depth + 1, item);
      };
      if (!group.collapsed) for (const item of group.items) row(session.variable(item.key), 0, item);
      const body = h('div', { class: 'watch-group-body', hidden: group.collapsed },
        rows.length ? rows : h('div', { class: 'tree-msg muted' }, t('Add variables from Symbols (eye icon) or with +, or drag them here.')));
      const el = h('div', { class: 'watch-group' }, head, body);
      dropTarget(head, group);
      dropTarget(body, group);
      return el;
    }));
  };

  const poll = async () => {
    clearTimeout(timer);
    if (!session.connected) return;
    const ids = polledIds();
    if (!ids.length) { render(); return; }
    try {
      const next = await session.readValues(ids);
      // Paused entries keep their last value.
      previous = values;
      values = new Map(values);
      for (const [id, value] of next) values.set(id, value);
      render();
    } catch { /* target busy; next tick retries */ }
    timer = setTimeout(poll, session.halted ? 1000 : period);
  };

  const rateSelect = h('select', { title: t('Polling rate of sampled variables'), onchange: event => { period = Number(event.target.value); poll(); } },
    [[100, '10 Hz'], [200, '5 Hz'], [500, '2 Hz'], [1000, '1 Hz']].map(([value, label]) => h('option', { value, selected: value === period }, label)));

  const addGroup = () => {
    const group = { id: newGroupId(), name: t('Group {n}', { n: groups.length + 1 }), enabled: true, collapsed: false, items: [] };
    groups.push(group);
    activeId = group.id;
    persist(); render();
    rename(list.querySelector('.watch-group:last-child .group-name'), group);
  };

  bus.on('watch:add', item => add(item));
  workspace.on('opened', () => {
    const loaded = loadGroups(workspace.settings.watch);
    groups = loaded.groups;
    activeId = loaded.active && groups.some(group => group.id === loaded.active) ? loaded.active : groups[0].id;
    render(); poll();
  });
  session.on('connected', poll);
  session.on('stopped', () => { previous = values; poll(); });
  session.on('status', status => { if (status === 'disconnected') { clearTimeout(timer); values = new Map(); render(); } });
  render();
  return {
    el: h('div', { class: 'inspector-view' },
      h('div', { class: 'view-toolbar' },
        h('button', { class: 'btn small', title: t('Add to the highlighted group'), onclick: event => pickVariable(event.currentTarget, item => add(item), { aggregates: true }) }, icon('plus'), t('Add')),
        h('button', { class: 'btn small ghost', onclick: addGroup }, icon('folder'), t('New group')),
        h('span', { class: 'grow' }), rateSelect),
      list),
  };
}
