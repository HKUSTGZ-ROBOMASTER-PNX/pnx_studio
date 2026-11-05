// In-page file/folder picker for browser mode, where native dialogs are unavailable.
// Browses the *server's* file system through host.fs.listDir.
import { h, icon, iconButton } from '../lib/dom.js';
import { modal } from '../shell.js';
import { workspace } from '../workspace.js';
import { t } from '../i18n.js';

const LAST_DIR = 'studio.picker.lastDir';
const sep = p => (/^[a-z]:\\|\\\\/i.test(p) || (p.includes('\\') && !p.includes('/')) ? '\\' : '/');
const parentOf = p => {
  const s = sep(p);
  const trimmed = p.length > 1 && p.endsWith(s) && !/^[a-z]:\\$/i.test(p) ? p.slice(0, -1) : p;
  const index = trimmed.lastIndexOf(s);
  if (index < 0) return trimmed;
  if (index === 0) return s;
  return /^[a-z]:$/i.test(trimmed.slice(0, index)) ? trimmed.slice(0, index + 1) : trimmed.slice(0, index);
};
const join = (dir, name) => (dir.endsWith(sep(dir)) ? dir + name : dir + sep(dir) + name);

function matchesFilters(name, filters) {
  const extensions = (filters || []).flatMap(filter => filter.extensions || []);
  if (!extensions.length || extensions.includes('*')) return true;
  const lower = name.toLowerCase();
  return extensions.some(ext => lower.endsWith(`.${ext.toLowerCase()}`));
}

/**
 * kind: 'folder' | 'file' | 'save'. Resolves to an absolute path or null when cancelled.
 */
export async function pickPath(kind, options = {}) {
  const info = await window.host.info();
  const roots = await window.host.fs.roots().catch(() => []);
  let stored = null;
  try { stored = localStorage.getItem(LAST_DIR); } catch { /* storage unavailable */ }
  const defaultPath = options.defaultPath || '';
  const startDir = (defaultPath && /[\\/]/.test(defaultPath) ? (kind === 'folder' ? defaultPath : parentOf(defaultPath)) : null)
    || workspace.root || stored || info.home;

  return new Promise(resolve => {
    let current = startDir;
    let selected = null;
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      if (value) { try { localStorage.setItem(LAST_DIR, kind === 'folder' ? value : parentOf(value)); } catch { /* ignore */ } }
      close();
      resolve(value);
    };

    const pathInput = h('input', { type: 'text', class: 'mono grow', spellcheck: false, onkeydown: event => { if (event.key === 'Enter') navigate(pathInput.value.trim()); } });
    const nameInput = kind === 'save'
      ? h('input', { type: 'text', class: 'mono grow', value: defaultPath.split(/[\\/]/).pop() || '', onkeydown: event => { if (event.key === 'Enter') confirm(); } })
      : null;
    const list = h('div', { class: 'picker-files' });
    const status = h('div', { class: 'faint picker-status' });

    async function navigate(dir) {
      if (!dir) return;
      let entries;
      try { entries = await window.host.fs.listDir(dir); }
      catch (error) { status.textContent = error.message; return; }
      current = dir;
      selected = null;
      pathInput.value = dir;
      status.textContent = '';
      const visible = entries.filter(entry => entry.dir || (kind !== 'folder' && matchesFilters(entry.name, options.filters)));
      list.replaceChildren(
        h('div', { class: 'picker-file', ondblclick: () => navigate(parentOf(current)), onclick: () => navigate(parentOf(current)) },
          icon('folderOpen'), h('span', { class: 'name' }, '..')),
        ...visible.map(entry => {
          const row = h('div', {
            class: `picker-file${entry.dir ? ' dir' : ''}`,
            onclick: () => {
              if (entry.dir) { navigate(entry.path); return; }
              list.querySelector('.picker-file.selected')?.classList.remove('selected');
              row.classList.add('selected');
              selected = entry.path;
              if (nameInput) nameInput.value = entry.name;
            },
            ondblclick: () => { if (!entry.dir) finish(entry.path); },
          }, icon(entry.dir ? 'folder' : 'file'), h('span', { class: 'name' }, entry.name));
          return row;
        }));
      if (!visible.length) list.append(h('div', { class: 'faint picker-empty' }, t('Empty folder')));
    }

    function confirm() {
      if (kind === 'folder') finish(current);
      else if (kind === 'save') { const name = nameInput.value.trim(); if (name) finish(/^([a-z]:\\|\/)/i.test(name) ? name : join(current, name)); }
      else if (selected) finish(selected);
      else status.textContent = t('Select a file');
    }

    const body = h('div', { class: 'path-picker' },
      h('div', { class: 'row' }, iconButton('chevronRight', t('Up'), () => navigate(parentOf(current)), { class: 'small up' }), pathInput),
      roots.length ? h('div', { class: 'picker-roots' }, roots.map(root => h('button', { class: 'btn small ghost', onclick: () => navigate(root.path) }, root.name))) : null,
      list,
      nameInput ? h('label', { class: 'field' }, h('span', null, t('File name')), nameInput) : null,
      status);
    const close = modal({
      title: options.title || (kind === 'folder' ? t('Open Folder') : kind === 'save' ? t('Save as') : t('Open file')),
      width: 'min(680px, calc(100vw - 32px))',
      body,
      footer: [
        h('span', { class: 'faint grow picker-host' }, t('Browsing files on {host}', { host: info.hostname })),
        h('button', { class: 'btn', onclick: () => finish(null) }, t('Cancel')),
        h('button', { class: 'btn primary', onclick: confirm }, kind === 'folder' ? t('Select folder') : kind === 'save' ? t('Save') : t('Open')),
      ],
      onClose: () => { if (!settled) { settled = true; resolve(null); } },
    });
    navigate(startDir);
  });
}
