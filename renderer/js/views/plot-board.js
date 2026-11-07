// Plot board: several plots in one tab, tiled FreeMASTER-style. Drag a plot's grip onto
// another plot's edge to split it there (centre swaps the two), drag the gutters to resize.
// Plots on a board share one clock. With linked axes the plots act as subplots: pan/zoom/pause
// and the crosshair follow along, only the bottom row shows time labels, per-plot toolbars
// shrink to a hover toolbar, and window/pause/rate/export live on the board toolbar.
import { h, icon, iconButton, cssVar, basename } from '../lib/dom.js';
import { bus } from '../lib/emitter.js';
import { session } from '../session.js';
import { workspace } from '../workspace.js';
import { workbench, menu, notify } from '../shell.js';
import { PlotView, WINDOWS, RATES } from './plot.js';
import { channelsToCsv } from '../lib/csv.js';
import { t } from '../i18n.js';
import { leaf, panesOf, removePane, insertPane, swapPanes, presetLayout, equalize } from '../lib/layout-tree.js';

const PANE_MIME = 'application/x-studio-plot-pane';
const MIN_SIZE = 0.08; // smallest share of a split a gutter drag may leave

let paneCounter = 0;
const newPaneId = () => `p${Date.now().toString(36)}${(paneCounter++).toString(36)}`;

/** Side of `rect` nearest to the pointer, or 'center' away from the edges. */
function dropZone(event, rect) {
  const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
  const [side, distance] = [['left', x], ['right', 1 - x], ['top', y], ['bottom', 1 - y]].sort((a, b) => a[1] - b[1])[0];
  return distance < 0.28 ? side : 'center';
}

/** Board settings, upgrading a single plot saved by earlier versions. */
function normalizeConfig(config = {}) {
  if (config.layout) return config;
  const pane = newPaneId();
  return { linked: true, layout: leaf(pane), panes: { [pane]: { windowSec: config.windowSec, rate: config.rate, traces: config.traces || [] } } };
}

// ---------------------------------------------------------------- board
export class PlotBoard {
  constructor(id, config) {
    const settings = normalizeConfig(config);
    this.id = id;
    this.linked = settings.linked !== false;
    this.layout = settings.layout;
    this.clock = { t0: null, latest: 0 };
    this.plots = new Map();  // pane -> PlotView
    this.paneEls = new Map();
    this.ready = false;

    this.linkButton = h('button', { class: `btn small ghost${this.linked ? ' active' : ''}`, title: t('Pan, zoom, pause and the crosshair follow across plots'), onclick: () => this.setLinked(!this.linked) }, icon('link'), t('Sync time axes'));
    // Shared controls while linked.
    this.pauseButton = iconButton('pause', `${t('Pause')} (Space)`, () => { const plot = this.focusedPlot(); plot.setPaused(!plot.paused); });
    this.windowSelect = h('select', { title: t('Time window'), onchange: event => {
      const plot = this.focusedPlot();
      plot.applyView({ windowSec: Number(event.target.value), paused: plot.paused, viewEnd: plot.viewEnd });
      this.syncView(plot);
      this.persist();
    } }, WINDOWS.map(value => h('option', { value }, `${value}s`)));
    this.rateSelect = h('select', { title: t('Requested sample rate'), onchange: event => { for (const plot of this.plots.values()) plot.setRate(Number(event.target.value)); } },
      RATES.map(value => h('option', { value }, value >= 1000 ? `${value / 1000} kHz` : `${value} Hz`)));
    this.sharedTools = h('div', { class: 'row board-shared' },
      h('div', { class: 'sep' }), this.pauseButton, iconButton('refresh', t('Clear data'), () => this.clearAll()),
      this.windowSelect, this.rateSelect,
      h('div', { class: 'sep' }),
      iconButton('download', t('Export all plots as one CSV'), () => this.exportCsv()),
      iconButton('image', t('Export the board as one PNG'), () => this.exportPng()));
    this.body = h('div', { class: 'board-body' });
    this.el = h('div', { class: 'plot-board' },
      h('div', { class: 'view-toolbar board-toolbar' },
        h('button', { class: 'btn small', onclick: () => this.addPane() }, icon('chartAdd'), t('Add plot')),
        h('button', { class: 'btn small ghost', onclick: event => this.layoutMenu(event.currentTarget) }, icon('layout'), t('Layout'), icon('chevronDown')),
        this.linkButton,
        this.sharedTools,
        h('span', { class: 'grow' }),
        h('span', { class: 'faint board-hint' }, icon('grip'), t('Drag the grip onto another plot to rearrange'))),
      this.body);

    for (const pane of panesOf(this.layout)) this.createPlot(pane, settings.panes?.[pane]);
    this.focused = panesOf(this.layout)[0];
    this.offs = [session.on('connected', () => { this.clock.t0 = null; this.clock.latest = 0; })];
    this.resizeObserver = new ResizeObserver(() => this.updateTimeAxes());
    this.resizeObserver.observe(this.body);
    this.ready = true;
    this.applyLinkedMode();
    this.render();
  }

  // ------------------------------------------------ plots
  createPlot(pane, config = {}) {
    const grip = h('span', { class: 'pane-grip', draggable: true, title: t('Drag onto another plot to rearrange') }, icon('grip'));
    grip.addEventListener('dragstart', event => {
      event.dataTransfer.setData(PANE_MIME, pane);
      event.dataTransfer.effectAllowed = 'move';
      this.el.classList.add('arranging');
    });
    grip.addEventListener('dragend', () => { this.el.classList.remove('arranging'); for (const el of this.paneEls.values()) el.querySelector('.drop-zone').hidden = true; });
    const close = iconButton('close', t('Remove plot'), () => this.closePane(pane), { class: 'small pane-close' });
    const plot = new PlotView(`${this.id}-${pane}`, config, {
      clock: this.clock,
      onPersist: () => this.persist(),
      onView: source => this.syncView(source),
      onHover: (source, time) => { if (this.linked) for (const other of this.plots.values()) if (other !== source) { other.linkedHoverTime = time; other.dirty = true; } },
      onClear: source => (this.linked ? this.clearAll() : source.clear()),
      toolbarStart: [grip],
      toolbarEnd: [close],
    });
    this.plots.set(pane, plot);
    plot.setCompact(this.linked);

    const zone = h('div', { class: 'drop-zone', hidden: true });
    const el = h('div', { class: 'board-pane' }, plot.el, zone);
    el.addEventListener('pointerdown', () => this.focus(pane), true);
    el.addEventListener('dragover', event => {
      if (!event.dataTransfer.types.includes(PANE_MIME)) return;
      event.preventDefault();
      zone.hidden = false;
      zone.dataset.zone = dropZone(event, el.getBoundingClientRect());
    });
    el.addEventListener('dragleave', event => { if (!el.contains(event.relatedTarget)) zone.hidden = true; });
    el.addEventListener('drop', event => {
      zone.hidden = true;
      const source = event.dataTransfer.getData(PANE_MIME);
      if (!source) return;
      event.preventDefault();
      if (source !== pane) this.movePane(source, pane, dropZone(event, el.getBoundingClientRect()));
    });
    this.paneEls.set(pane, el);
    return plot;
  }

  addPane() {
    const pane = newPaneId();
    const plot = this.createPlot(pane);
    if (this.linked) { const reference = this.focusedPlot(); plot.applyView({ windowSec: reference.windowSec, paused: reference.paused, viewEnd: reference.viewEnd }); }
    const rect = this.paneEls.get(this.focused)?.getBoundingClientRect();
    this.layout = insertPane(this.layout, this.focused, pane, rect && rect.width > rect.height * 1.3 ? 'right' : 'bottom');
    this.focus(pane);
    this.render();
    this.persist();
    return plot;
  }

  closePane(pane) {
    if (this.plots.size <= 1) return;
    this.plots.get(pane).dispose();
    this.plots.delete(pane);
    this.paneEls.delete(pane);
    this.layout = removePane(this.layout, pane);
    if (this.focused === pane) this.focused = panesOf(this.layout)[0];
    this.render();
    this.persist();
  }

  movePane(source, target, zone) {
    this.layout = zone === 'center' ? swapPanes(this.layout, source, target) : insertPane(removePane(this.layout, source), target, source, zone);
    this.render();
    this.persist();
  }

  focus(pane) {
    if (this.focused === pane) return;
    this.focused = pane;
    for (const [id, el] of this.paneEls) el.classList.toggle('focused', id === pane);
  }

  focusedPlot() { return this.plots.get(this.focused) || this.plots.values().next().value; }

  // ------------------------------------------------ linked time axes
  setLinked(linked) {
    this.linked = linked;
    this.applyLinkedMode();
    if (linked) this.syncView(this.focusedPlot());
    else for (const plot of this.plots.values()) { plot.linkedHoverTime = null; plot.dirty = true; }
    this.persist();
  }

  applyLinkedMode() {
    this.linkButton.classList.toggle('active', this.linked);
    this.el.classList.toggle('linked', this.linked);
    this.sharedTools.hidden = !this.linked;
    for (const plot of this.plots.values()) plot.setCompact(this.linked);
    const reference = this.focusedPlot();
    if (reference) { this.rateSelect.value = String(reference.rate); this.renderShared(reference); }
    this.updateTimeAxes();
  }

  renderShared(source) {
    this.pauseButton.replaceChildren(icon(source.paused ? 'play' : 'pause'));
    this.pauseButton.classList.toggle('active', source.paused);
    if (WINDOWS.includes(source.windowSec)) this.windowSelect.value = String(source.windowSec);
  }

  /** Linked subplots share the time axis: only plots on the bottom edge label it. */
  updateTimeAxes() {
    const bottom = this.body.getBoundingClientRect().bottom;
    for (const [pane, plot] of this.plots) {
      const rect = this.paneEls.get(pane)?.getBoundingClientRect();
      plot.setTimeAxis(!this.linked || !rect || rect.bottom >= bottom - 3);
    }
  }

  syncView(source) {
    if (!this.linked) return;
    const view = { windowSec: source.windowSec, paused: source.paused, viewEnd: source.viewEnd };
    for (const plot of this.plots.values()) if (plot !== source) plot.applyView(view);
    this.renderShared(source);
  }

  // ------------------------------------------------ whole-board export
  async exportCsv() {
    // A variable plotted twice is one column.
    const seen = new Set();
    const series = [...this.plots.values()].flatMap(plot => plot.series()).filter(item => !seen.has(item.id) && seen.add(item.id));
    if (!series.length) { notify(t('Nothing to export yet'), 'warn'); return; }
    const file = await window.host.dialog.saveFile({ title: t('Export CSV'), defaultPath: `${this.id}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!file) return;
    await window.host.fs.writeText(file, channelsToCsv(series));
    notify(t('Saved {file}', { file: basename(file) }), 'ok');
  }

  async exportPng() {
    const file = await window.host.dialog.saveFile({ title: t('Export PNG'), defaultPath: `${this.id}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!file) return;
    for (const plot of this.plots.values()) plot.prepareExport();
    const dpr = window.devicePixelRatio || 1;
    const area = this.body.getBoundingClientRect();
    const out = document.createElement('canvas');
    out.width = Math.round(area.width * dpr); out.height = Math.round(area.height * dpr);
    const ctx = out.getContext('2d');
    ctx.fillStyle = cssVar('--line'); ctx.fillRect(0, 0, out.width, out.height);
    for (const plot of this.plots.values()) {
      const rect = plot.canvas.getBoundingClientRect();
      const x = Math.round((rect.left - area.left) * dpr), y = Math.round((rect.top - area.top) * dpr);
      ctx.fillStyle = cssVar('--bg-1'); ctx.fillRect(x, y, plot.canvas.width, plot.canvas.height);
      ctx.drawImage(plot.canvas, x, y);
      plot.paintLegend(ctx, x, y, dpr);
    }
    const blob = await new Promise(resolve => out.toBlob(resolve, 'image/png'));
    await window.host.fs.writeBinary(file, new Uint8Array(await blob.arrayBuffer()));
    notify(t('Saved {file}', { file: basename(file) }), 'ok');
  }

  clearAll() {
    for (const plot of this.plots.values()) plot.clear();
    this.clock.t0 = null;
    this.clock.latest = 0;
  }

  layoutMenu(anchor) {
    const apply = layout => { this.layout = layout; this.render(); this.persist(); };
    const panes = panesOf(this.layout);
    menu(anchor, [
      { label: t('Grid'), icon: 'layout', run: () => apply(presetLayout(panes, 'grid')) },
      { label: t('Stack vertically'), icon: 'stack', run: () => apply(presetLayout(panes, 'stack')) },
      { label: t('Side by side'), icon: 'panel', run: () => apply(presetLayout(panes, 'side')) },
      '-',
      { label: t('Equal sizes'), icon: 'zoomFit', run: () => apply(equalize(this.layout)) },
    ]);
  }

  // ------------------------------------------------ rendering
  render() {
    this.el.classList.toggle('single', this.plots.size === 1);
    for (const [id, el] of this.paneEls) el.classList.toggle('focused', id === this.focused && this.plots.size > 1);
    this.body.replaceChildren(this.renderNode(this.layout));
    requestAnimationFrame(() => this.updateTimeAxes());
    bus.emit('plots:changed');
  }

  renderNode(node) {
    if (node.type === 'leaf') return this.paneEls.get(node.pane);
    const box = h('div', { class: `board-split dir-${node.dir}` });
    node.children.forEach((child, i) => {
      if (i) box.append(this.gutter(node, i));
      box.append(h('div', { class: 'board-cell', style: { flex: `${node.sizes[i]} 1 0` } }, this.renderNode(child)));
    });
    return box;
  }

  gutter(node, index) {
    const gutter = h('div', { class: `board-gutter dir-${node.dir}` });
    gutter.addEventListener('pointerdown', event => {
      event.preventDefault();
      const box = gutter.parentElement;
      const extent = node.dir === 'row' ? box.clientWidth : box.clientHeight;
      const start = node.dir === 'row' ? event.clientX : event.clientY;
      const [a, b] = [node.sizes[index - 1], node.sizes[index]];
      const [before, after] = [gutter.previousElementSibling, gutter.nextElementSibling];
      gutter.setPointerCapture(event.pointerId);
      gutter.classList.add('dragging');
      const move = moveEvent => {
        const total = node.sizes.reduce((sum, size) => sum + size, 0);
        const delta = ((node.dir === 'row' ? moveEvent.clientX : moveEvent.clientY) - start) / extent * total;
        const shift = Math.max(MIN_SIZE - a, Math.min(b - MIN_SIZE, delta));
        node.sizes[index - 1] = a + shift;
        node.sizes[index] = b - shift;
        before.style.flex = `${node.sizes[index - 1]} 1 0`;
        after.style.flex = `${node.sizes[index]} 1 0`;
      };
      gutter.addEventListener('pointermove', move);
      gutter.addEventListener('pointerup', () => { gutter.removeEventListener('pointermove', move); gutter.classList.remove('dragging'); this.updateTimeAxes(); this.persist(); }, { once: true });
    });
    return gutter;
  }

  // ------------------------------------------------ persistence & view protocol
  persist() {
    if (!this.ready) return;
    const plots = { ...(workspace.settings.plots || {}) };
    plots[this.id] = { linked: this.linked, layout: this.layout, panes: Object.fromEntries([...this.plots].map(([pane, plot]) => [pane, plot.state()])) };
    workspace.saveSettings({ plots });
    bus.emit('plots:changed');
  }

  /** Every trace on the board (the sidebar lists them). */
  get traces() { return [...this.plots.values()].flatMap(plot => plot.traces); }
  /** Adds go to the plot last clicked. */
  addTrace(item) { return this.focusedPlot().addTrace(item); }
  get channels() { return this.focusedPlot().channels; }
  get latest() { return this.clock.latest; }

  onShow() { for (const plot of this.plots.values()) plot.onShow(); }
  onHide() { for (const plot of this.plots.values()) plot.onHide(); }
  dispose() {
    this.offs.forEach(off => off());
    this.resizeObserver.disconnect();
    for (const plot of this.plots.values()) plot.dispose();
    if (!this.closingWorkspace) {
      const plots = { ...(workspace.settings.plots || {}) };
      delete plots[this.id];
      workspace.saveSettings({ plots });
    }
    bus.emit('plots:changed');
  }
}

// ---------------------------------------------------------------- opening plots
let boardCounter = 0;

export function openPlot(id, config) {
  const boardId = id || `plot-${Date.now().toString(36)}`;
  boardCounter++;
  const title = config?.title || `${t('Plot')} ${boardCounter}`;
  return workbench.editor.open({ id: boardId, title, icon: 'chart', create: () => new PlotBoard(boardId, config) });
}

/** Board that receives "Plot" actions: the active one, else the first open, else a new one. */
function targetBoard() {
  const active = workbench.editor.get(workbench.editor.active);
  if (active instanceof PlotBoard) return active;
  for (const id of workbench.editor.order) { const view = workbench.editor.get(id); if (view instanceof PlotBoard) { workbench.editor.activate(id); return view; } }
  return openPlot();
}

export function initPlots() {
  bus.on('plot:add', item => targetBoard().addTrace(item));
  workspace.on('closing', () => {
    for (const [id, item] of [...workbench.editor.items]) {
      if (!(item.view instanceof PlotBoard)) continue;
      item.view.closingWorkspace = true;
      workbench.editor.close(id);
    }
  });
  workspace.on('opened', () => {
    for (const [id, config] of Object.entries(workspace.settings.plots || {})) if (!workbench.editor.has(id)) openPlot(id, config);
  });
}
