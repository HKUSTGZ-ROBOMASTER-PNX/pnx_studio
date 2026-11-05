// Command palette (Ctrl/Cmd+Shift+P): fuzzy-ish search over core and plugin commands and views.
import { h, icon } from '../lib/dom.js';
import { commands, pluginViews, executeCommand } from '../plugin-api.js';
import { notify } from '../shell.js';
import { t } from '../i18n.js';

let open = null;

export function openPalette() {
  if (open) return;
  const entries = () => [
    ...[...commands.values()].map(command => ({ label: command.title, hint: command.source === 'core' ? '' : command.source, icon: 'chevronRight', run: () => executeCommand(command.id) })),
    ...[...pluginViews.values()].map(view => ({ label: `${t('Open view')}: ${view.title}`, hint: view.pluginId, icon: view.icon, run: () => view.open() })),
  ];
  const input = h('input', { type: 'search', placeholder: t('Type a command…'), spellcheck: false });
  const list = h('div', { class: 'palette-list' });
  let selected = 0, shown = [];
  const render = () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    shown = entries().filter(entry => words.every(word => `${entry.label} ${entry.hint}`.toLowerCase().includes(word))).slice(0, 50);
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((entry, index) => h('div', { class: `item${index === selected ? ' selected' : ''}`, onmousedown: event => { event.preventDefault(); run(entry); } },
      icon(entry.icon), h('span', { class: 'grow' }, entry.label), entry.hint ? h('span', { class: 'hint' }, entry.hint) : null)));
  };
  const run = entry => { close(); Promise.resolve().then(entry.run).catch(error => notify(error.message, 'error')); };
  const close = () => { backdrop.remove(); open = null; };
  input.addEventListener('input', () => { selected = 0; render(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowDown') { selected = Math.min(shown.length - 1, selected + 1); render(); event.preventDefault(); }
    else if (event.key === 'ArrowUp') { selected = Math.max(0, selected - 1); render(); event.preventDefault(); }
    else if (event.key === 'Enter' && shown[selected]) run(shown[selected]);
  });
  const backdrop = h('div', { class: 'backdrop palette-backdrop', onmousedown: event => { if (event.target === backdrop) close(); } }, h('div', { class: 'palette' }, input, list));
  document.getElementById('overlay').append(backdrop);
  open = close;
  render();
  input.focus();
}
