// Plugins sidebar: installed plugins, their views, enable/disable, errors.
import { h, icon, iconButton } from '../lib/dom.js';
import { notify } from '../shell.js';
import { pluginViews, commandEvents } from '../plugin-api.js';
import { t } from '../i18n.js';

const host = window.host;

export function createPluginsView(getDescription) {
  const list = h('div', { class: 'plugin-list' });
  let dirty = false;
  const reloadBar = h('div', { class: 'reload-bar', hidden: true }, h('span', { class: 'grow' }, t('Reload to apply plugin changes.')), h('button', { class: 'btn small primary', onclick: () => host.reload() }, t('Reload')));

  const render = () => {
    const description = getDescription();
    if (!description) return;
    const cards = description.plugins.map(plugin => {
      const toggle = h('input', { type: 'checkbox', checked: plugin.enabled, title: t('Enabled'), onchange: async event => {
        await host.plugins.setEnabled(plugin.id, event.target.checked);
        dirty = true; reloadBar.hidden = false;
      } });
      const views = [...pluginViews.values()].filter(view => view.pluginId === plugin.id);
      return h('div', { class: `plugin-card${plugin.enabled ? '' : ' disabled'}` },
        h('div', { class: 'row' }, icon('plugin'), h('b', { class: 'grow' }, plugin.name), h('span', { class: 'faint' }, `v${plugin.version}`), toggle),
        plugin.description ? h('div', { class: 'muted desc' }, plugin.description) : null,
        h('div', { class: 'row wrap tags' },
          h('span', { class: 'tag' }, plugin.source === 'builtin' ? t('built-in') : t('user')),
          plugin.hasMain ? h('span', { class: 'tag' }, 'main') : null,
          plugin.renderer ? h('span', { class: 'tag' }, 'renderer') : null,
          plugin.contributes.adapters?.length ? h('span', { class: 'tag' }, t('debug core')) : null),
        views.length ? h('div', { class: 'row wrap' }, views.map(view => h('button', { class: 'btn small', onclick: () => view.open() }, icon(view.icon), view.title))) : null);
    });
    const errors = (description.errors || []).map(item => h('div', { class: 'plugin-card error' }, icon('warn'), h('div', { class: 'grow err-text' }, item.error)));
    list.replaceChildren(...cards, ...errors, ...(cards.length ? [] : [h('div', { class: 'tree-msg muted' }, t('No plugins installed.'))]));
  };

  commandEvents.on('changed', render);
  return {
    el: h('div', { class: 'plugins' }, reloadBar, list,
      h('div', { class: 'plugin-help muted' }, t('Drop plugin folders into the user plugin folder, then reload. See docs/PLUGINS.md for the API.'))),
    actions: [
      iconButton('folderOpen', t('Open user plugin folder'), () => host.plugins.openFolder().catch(error => notify(error.message, 'error')), { class: 'small' }),
      iconButton('refresh', t('Reload window'), () => host.reload(), { class: 'small' }),
    ],
    onShow: render,
    render,
    get dirty() { return dirty; },
  };
}
