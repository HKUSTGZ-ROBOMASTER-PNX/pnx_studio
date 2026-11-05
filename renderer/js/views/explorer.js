// File explorer sidebar: lazily expanded folder tree of the workspace.
import { h, icon, iconButton, basename } from '../lib/dom.js';
import { bus } from '../lib/emitter.js';
import { workspace } from '../workspace.js';
import { notify } from '../shell.js';
import { t } from '../i18n.js';

const host = window.host;
const SOURCE_EXT = /\.(c|h|cc|cpp|cxx|hpp|hh|s|asm|ld|cmake|txt|md|json|py|rs|ini|cfg|yaml|yml|toml|svd|map|lst)$/i;

export function createExplorer() {
  const tree = h('div', { class: 'tree' });
  const expanded = new Set();
  const el = h('div', { class: 'explorer' }, tree);

  async function renderDir(dir, container, depth) {
    let entries;
    try { entries = await host.fs.listDir(dir); } catch (error) { container.replaceChildren(h('div', { class: 'tree-msg err-text' }, error.message)); return; }
    container.replaceChildren(...entries.map(entry => {
      const row = h('div', { class: 'tree-row', style: { paddingLeft: `${8 + depth * 14}px` }, title: entry.path, draggable: !entry.dir },
        entry.dir ? icon(expanded.has(entry.path) ? 'chevronDown' : 'chevronRight', 'twisty') : h('span', { class: 'twisty-spacer' }),
        icon(entry.dir ? (expanded.has(entry.path) ? 'folderOpen' : 'folder') : 'file', entry.dir ? 'folder-icon' : 'file-icon'),
        h('span', { class: 'name' }, entry.name));
      const children = h('div', { class: 'tree-children' });
      if (entry.dir) {
        row.onclick = async () => {
          if (expanded.has(entry.path)) { expanded.delete(entry.path); children.replaceChildren(); }
          else { expanded.add(entry.path); await renderDir(entry.path, children, depth + 1); }
          row.querySelector('.twisty').replaceWith(icon(expanded.has(entry.path) ? 'chevronDown' : 'chevronRight', 'twisty'));
          row.querySelector('.folder-icon').replaceWith(icon(expanded.has(entry.path) ? 'folderOpen' : 'folder', 'folder-icon'));
        };
        if (expanded.has(entry.path)) renderDir(entry.path, children, depth + 1);
      } else {
        row.onclick = () => {
          tree.querySelectorAll('.tree-row.selected').forEach(item => item.classList.remove('selected'));
          row.classList.add('selected');
          if (/\.(elf|axf|out)$/i.test(entry.name)) bus.emit('elf:selected', entry.path);
          else if (/\.svd$/i.test(entry.name)) bus.emit('svd:load', entry.path);
          else if (SOURCE_EXT.test(entry.name) || !/\.[a-z0-9]+$/i.test(entry.name)) bus.emit('source:open', { path: entry.path });
          else notify(t('No viewer for {name}', { name: entry.name }));
        };
      }
      return [row, children];
    }).flat());
  }

  function render() {
    if (!workspace.root) {
      tree.replaceChildren(h('div', { class: 'empty-pane' },
        h('p', { class: 'muted' }, t('No folder opened.')),
        h('button', { class: 'btn primary', onclick: () => workspace.choose() }, icon('folderOpen'), t('Open Folder'))));
      return;
    }
    const rootRow = h('div', { class: 'tree-root', title: workspace.root }, icon('folderOpen'), h('span', null, basename(workspace.root)));
    const container = h('div');
    tree.replaceChildren(rootRow, container);
    renderDir(workspace.root, container, 0);
  }

  workspace.on('opened', () => { expanded.clear(); render(); });
  render();
  return {
    el,
    actions: [
      iconButton('folderOpen', t('Open Folder'), () => workspace.choose(), { class: 'small' }),
      iconButton('refresh', t('Refresh'), render, { class: 'small' }),
    ],
  };
}
