// Sidebar hub for real-time plots: create a plot, jump between open plots, see their signals.
import { h, icon, iconButton } from '../lib/dom.js';
import { bus } from '../lib/emitter.js';
import { workbench } from '../shell.js';
import { session } from '../session.js';
import { PlotBoard, openPlot } from './plot-board.js';
import { pickVariable } from './symbols.js';
import { t } from '../i18n.js';

const MAX_CHIPS = 6;

function openPlots() {
  return workbench.editor.order
    .map(id => ({ id, view: workbench.editor.get(id) }))
    .filter(entry => entry.view instanceof PlotBoard);
}

function plotTitle(id) {
  return workbench.editor.items.get(id)?.tab.querySelector('.name')?.textContent || t('Plot');
}

export function createPlotsPane() {
  const list = h('div', { class: 'plot-cards' });
  const el = h('div', { class: 'plots-pane' },
    h('div', { class: 'plots-hero' },
      h('button', { class: 'btn primary block', onclick: () => openPlot() }, icon('chartAdd'), t('New plot')),
      h('button', { class: 'btn block', onclick: event => pickVariable(event.currentTarget, item => bus.emit('plot:add', item)) }, icon('plus'), t('Add signal to plot'))),
    h('div', { class: 'section-title' }, t('Open plots')),
    list,
    h('div', { class: 'section-title' }, t('Adding signals')),
    h('ol', { class: 'plot-tips muted' },
      h('li', null, t('In Symbols, hover a variable and click the plot icon')),
      h('li', null, t('Or drag a variable onto a plot')),
      h('li', null, t('Signals stream while the target runs; pause the plot to pan back in time'))));

  const render = () => {
    const plots = openPlots();
    if (!plots.length) {
      list.replaceChildren(h('div', { class: 'plot-cards-empty muted' }, icon('waves'), h('span', null, t('No plots yet'))));
      return;
    }
    list.replaceChildren(...plots.map(({ id, view }) => {
      const shown = view.traces.slice(0, MAX_CHIPS);
      return h('div', {
        class: `plot-card${workbench.editor.active === id ? ' active' : ''}`, role: 'button', tabindex: 0,
        onclick: () => workbench.editor.activate(id),
      },
      h('div', { class: 'row' },
        icon('waves'),
        h('span', { class: 'grow title' }, plotTitle(id)),
        h('span', { class: 'faint count' }, [view.plots.size > 1 ? t('{n} plots', { n: view.plots.size }) : null, t('{n} signals', { n: view.traces.length })].filter(Boolean).join(' · ')),
        iconButton('close', t('Close'), event => { event.stopPropagation(); workbench.editor.close(id); }, { class: 'small' })),
      view.traces.length ? h('div', { class: 'plot-card-signals' },
        shown.map(trace => h('span', { class: `signal mono${trace.hidden ? ' off' : ''}` },
          h('i', { style: { background: trace.color } }), trace.label)),
        view.traces.length > shown.length ? h('span', { class: 'signal more' }, `+${view.traces.length - shown.length}`) : null)
        : h('div', { class: 'faint plot-card-hint' }, session.connected ? t('No signals — add one from Symbols') : t('Connect a target to stream signals')));
    }));
  };

  const offs = [bus.on('plots:changed', render), workbench.editor.on('change', render), workbench.editor.on('activate', render), session.on?.('status', render)].filter(Boolean);
  render();
  return {
    el,
    actions: [iconButton('plus', t('New plot'), () => openPlot(), { class: 'small' })],
    onShow: render,
    dispose: () => offs.forEach(off => off()),
  };
}
