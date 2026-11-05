// Real-time chart: ring-buffered channels, min/max decimation, crosshair readout,
// pan/zoom, CSV/PNG export. Fed by the core's binary sample stream.
import { h, icon, iconButton, formatValue, cssVar, basename } from '../lib/dom.js';
import { bus } from '../lib/emitter.js';
import { session } from '../session.js';
import { workspace } from '../workspace.js';
import { notify } from '../shell.js';
import { pickVariable, VAR_MIME } from './symbols.js';
import { t } from '../i18n.js';
import { channelsToCsv } from '../lib/csv.js';

const host = window.host;
const CAPACITY = 1 << 18; // samples per channel (~262k)
export const WINDOWS = [0.5, 1, 2, 5, 10, 30, 60, 120];
export const RATES = [50, 100, 500, 1000, 2000, 5000, 10000];
// top leaves room for the legend chips so they never cover data.
const PAD = { left: 64, right: 18, top: 48, bottom: 30 };

class Channel {
  constructor() { this.t = new Float64Array(CAPACITY); this.v = new Float64Array(CAPACITY); this.start = 0; this.length = 0; }
  push(time, value) {
    const index = (this.start + this.length) % CAPACITY;
    this.t[index] = time; this.v[index] = value;
    if (this.length < CAPACITY) this.length++; else this.start = (this.start + 1) % CAPACITY;
  }
  at(i) { const index = (this.start + i) % CAPACITY; return [this.t[index], this.v[index]]; }
  time(i) { return this.t[(this.start + i) % CAPACITY]; }
  value(i) { return this.v[(this.start + i) % CAPACITY]; }
  /** First index whose time >= target. */
  lowerBound(target) {
    let lo = 0, hi = this.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.time(mid) < target) lo = mid + 1; else hi = mid; }
    return lo;
  }
  clear() { this.start = 0; this.length = 0; }
  get last() { return this.length ? this.value(this.length - 1) : NaN; }
}

function niceStep(span, target) {
  const raw = span / Math.max(1, target);
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power;
}

/**
 * One chart. Standalone it persists itself; inside a board (see plot-board.js) `options` wires it up:
 *   clock        shared { t0, latest } so several plots use one time base
 *   onPersist()  the board saves the layout including this plot's `state()`
 *   onView(plot) / onHover(plot, time|null)  pan/zoom/pause and crosshair changes, for linked axes
 *   onClear(plot)  the clear button
 *   toolbarStart / toolbarEnd  extra toolbar nodes (drag grip, close)
 * In compact mode (subplots on a linked board) the toolbar is replaced by a small
 * hover toolbar and the board owns time window, pause, rate and export.
 */
export class PlotView {
  constructor(id, config = {}, options = {}) {
    this.id = id;
    this.options = options;
    this.clock = options.clock || { t0: null, latest: 0 };
    this.traces = [];       // { key, label, color, hidden }
    this.channels = new Map(); // variable id -> Channel
    this.windowSec = config.windowSec || 10;
    this.rate = config.rate || 1000;
    this.paused = false;
    this.autoY = true;
    this.yRange = [-1, 1];
    this.viewEnd = 0;
    this.hoverX = null;
    this.linkedHoverTime = null; // crosshair driven by a linked plot
    this.showTimeAxis = true;    // a board hides it on subplots above the bottom row
    this.padBottom = PAD.bottom;
    this.compact = false;
    this.dirty = true;

    this.canvas = h('canvas', { class: 'plot-canvas' });
    this.legend = h('div', { class: 'plot-legend' });
    this.empty = h('div', { class: 'plot-empty' }, icon('chart'), h('p', null, t('Drag variables here from Symbols, or')), h('button', { class: 'btn', onclick: event => pickVariable(event.currentTarget, item => this.addTrace(item)) }, icon('plus'), t('Add signal')));
    this.readout = h('div', { class: 'plot-readout mono', hidden: true });
    this.stage = h('div', { class: 'plot-stage' }, this.canvas, this.legend, this.readout, this.empty);
    this.pauseButton = iconButton('pause', `${t('Pause')} (Space)`, () => this.setPaused(!this.paused));
    this.autoButton = iconButton('zoomFit', t('Auto-scale Y'), () => this.setAutoY(true), { class: 'active' });
    const windowSelect = this.windowSelect = h('select', { title: t('Time window'), onchange: event => { this.windowSec = Number(event.target.value); this.dirty = true; this.persist(); this.emitView(); } },
      WINDOWS.map(value => h('option', { value, selected: value === this.windowSec }, `${value}s`)));
    const rateSelect = this.rateSelect = h('select', { title: t('Requested sample rate'), onchange: event => this.setRate(Number(event.target.value)) },
      RATES.map(value => h('option', { value, selected: value === this.rate }, value >= 1000 ? `${value / 1000} kHz` : `${value} Hz`)));
    this.toolbar = h('div', { class: 'view-toolbar' },
      ...(options.toolbarStart || []),
      h('button', { class: 'btn small', onclick: event => pickVariable(event.currentTarget, item => this.addTrace(item)) }, icon('plus'), t('Signal')),
      h('div', { class: 'sep' }), this.pauseButton, this.autoButton,
      iconButton('refresh', t('Clear data'), () => (options.onClear ? options.onClear(this) : this.clear())),
      h('div', { class: 'sep' }), h('span', { class: 'faint' }, t('Window')), windowSelect, h('span', { class: 'faint' }, t('Rate')), rateSelect,
      h('span', { class: 'grow' }),
      iconButton('download', t('Export CSV'), () => this.exportCsv()),
      iconButton('image', t('Export PNG'), () => this.exportPng()),
      ...(options.toolbarEnd || []));
    this.miniStart = h('span', { class: 'row' });
    this.miniEnd = h('span', { class: 'row' });
    this.miniAuto = iconButton('zoomFit', t('Auto-scale Y'), () => this.setAutoY(true), { class: 'small active' });
    this.miniToolbar = h('div', { class: 'plot-mini-toolbar' }, this.miniStart,
      iconButton('plus', t('Add signal'), event => pickVariable(event.currentTarget, item => this.addTrace(item)), { class: 'small' }),
      this.miniAuto, this.miniEnd);
    this.el = h('div', { class: 'plot-view' }, this.toolbar, this.stage, this.miniToolbar);

    this.bindInput();
    this.offs = [
      session.on('samples', batch => this.ingest(batch)),
      session.on('catalog', () => { this.resolveTraces(); this.subscribe(); }),
      session.on('connected', () => { this.clear(); this.subscribe(); }),
    ];
    this.resizeObserver = new ResizeObserver(() => { this.dirty = true; });
    this.resizeObserver.observe(this.stage);
    for (const trace of config.traces || []) this.addTrace({ id: trace.key, expression: trace.key }, trace);
    this.loop = this.loop.bind(this);
    this.visible = true;
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------ data
  addTrace(item, saved = {}) {
    const key = item.expression || item.id;
    if (this.traces.some(trace => trace.key === key)) return;
    const palette = Array.from({ length: 8 }, (_, i) => `var(--plot-${i + 1})`);
    this.traces.push({ key, label: saved.label || key, color: saved.color || palette[this.traces.length % palette.length], hidden: !!saved.hidden, id: null });
    this.resolveTraces();
    this.subscribe();
    this.renderLegend();
    this.persist();
  }

  removeTrace(key) {
    this.traces = this.traces.filter(trace => trace.key !== key);
    this.subscribe();
    this.renderLegend();
    this.persist();
  }

  resolveTraces() {
    for (const trace of this.traces) trace.id = session.variable(trace.key)?.id || null;
    this.renderLegend();
  }

  subscribe() {
    session.setSubscription(`plot:${this.id}`, this.traces.map(trace => trace.key), this.rate);
  }

  get latest() { return this.clock.latest; }

  ingest(batch) {
    const count = batch.channelIds.length;
    const t0ns = batch.startTimestampNs;
    if (this.clock.t0 === null) this.clock.t0 = t0ns;
    const wanted = new Set(this.traces.map(trace => trace.id));
    for (let c = 0; c < count; c++) {
      const id = batch.channelIds[c];
      if (!wanted.has(id)) continue;
      let channel = this.channels.get(id);
      if (!channel) { channel = new Channel(); this.channels.set(id, channel); }
      for (let s = 0; s < batch.sampleCount; s++) {
        const time = (t0ns - this.clock.t0 + s * batch.samplePeriodNs) / 1e9;
        channel.push(time, batch.values[s * count + c]);
      }
    }
    if (batch.sampleCount && wanted.size) this.clock.latest = Math.max(this.clock.latest, (t0ns - this.clock.t0 + (batch.sampleCount - 1) * batch.samplePeriodNs) / 1e9);
    this.dirty = true;
  }

  clear() {
    for (const channel of this.channels.values()) channel.clear();
    // A shared clock belongs to the board, which resets it for all of its plots at once.
    if (!this.options.clock) { this.clock.t0 = null; this.clock.latest = 0; }
    this.viewEnd = 0;
    this.dirty = true;
  }

  setPaused(paused, { silent = false } = {}) {
    this.paused = paused;
    if (paused) this.viewEnd = this.latest;
    this.pauseButton.replaceChildren(icon(paused ? 'play' : 'pause'));
    this.pauseButton.classList.toggle('active', paused);
    this.dirty = true;
    if (!silent) this.emitView();
  }

  emitView() { this.options.onView?.(this); }

  setAutoY(on) {
    this.autoY = on;
    for (const button of [this.autoButton, this.miniAuto]) button.classList.toggle('active', on);
    this.dirty = true;
  }

  setRate(rate) {
    this.rate = rate;
    this.rateSelect.value = String(rate);
    this.subscribe();
    this.persist();
  }

  /** Subplot mode: hover toolbar instead of the full one; the grip and close nodes move along. */
  setCompact(compact) {
    this.compact = compact;
    this.el.classList.toggle('compact', compact);
    const start = this.options.toolbarStart || [], end = this.options.toolbarEnd || [];
    if (compact) { this.miniStart.replaceChildren(...start); this.miniEnd.replaceChildren(...end); }
    else { this.toolbar.prepend(...start); this.toolbar.append(...end); }
    this.dirty = true;
  }

  setTimeAxis(show) {
    if (this.showTimeAxis === show) return;
    this.showTimeAxis = show;
    this.dirty = true;
  }

  /** Follow a linked plot's time axis without echoing the change back. */
  applyView({ windowSec, paused, viewEnd }) {
    this.windowSec = windowSec;
    if (WINDOWS.includes(windowSec)) this.windowSelect.value = String(windowSec);
    if (paused !== this.paused) this.setPaused(paused, { silent: true });
    this.viewEnd = viewEnd;
    this.dirty = true;
  }

  state() {
    return { windowSec: this.windowSec, rate: this.rate, traces: this.traces.map(({ key, label, color, hidden }) => ({ key, label, color, hidden })) };
  }

  persist() {
    if (this.options.onPersist) { this.options.onPersist(); return; }
    const plots = { ...(workspace.settings.plots || {}) };
    plots[this.id] = this.state();
    workspace.saveSettings({ plots });
  }

  // ------------------------------------------------------------ legend
  renderLegend() {
    bus.emit('plots:changed');
    this.empty.hidden = this.traces.length > 0;
    this.legend.replaceChildren(...this.traces.map(trace => {
      const value = h('span', { class: 'value mono' });
      trace.valueEl = value;
      return h('div', { class: `chip${trace.hidden ? ' off' : ''}${trace.id || !session.connected ? '' : ' missing'}`, title: trace.id ? t('Click to show/hide') : t('Not found in current symbols') , onclick: () => { trace.hidden = !trace.hidden; this.renderLegend(); this.dirty = true; this.persist(); } },
        h('span', { class: 'swatch', style: { background: trace.color, color: trace.color } }), h('span', { class: 'name mono' }, trace.label), value,
        iconButton('close', t('Remove'), event => { event.stopPropagation(); this.removeTrace(trace.key); }, { class: 'small' }));
    }));
  }

  // ------------------------------------------------------------ input
  bindInput() {
    const stage = this.stage;
    stage.addEventListener('dragover', event => { if (event.dataTransfer.types.includes(VAR_MIME)) { event.preventDefault(); stage.classList.add('drop'); } });
    stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
    stage.addEventListener('drop', event => {
      stage.classList.remove('drop');
      const data = event.dataTransfer.getData(VAR_MIME);
      if (data) { event.preventDefault(); this.addTrace(JSON.parse(data)); }
    });
    this.canvas.addEventListener('mousemove', event => {
      this.hoverX = event.offsetX; this.dirty = true;
      const plotW = this.canvas.clientWidth - PAD.left - PAD.right;
      if (this.frame && plotW > 0) this.options.onHover?.(this, this.frame.tStart + (event.offsetX - PAD.left) / plotW * this.windowSec);
    });
    this.canvas.addEventListener('mouseleave', () => { this.hoverX = null; this.readout.hidden = true; this.dirty = true; this.options.onHover?.(this, null); });
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1.2 : 1 / 1.2;
      if (event.shiftKey || event.ctrlKey) {
        const [lo, hi] = this.yRange, mid = (lo + hi) / 2, half = (hi - lo) / 2 * factor;
        this.yRange = [mid - half, mid + half];
        this.setAutoY(false);
      } else {
        this.windowSec = Math.min(600, Math.max(0.01, this.windowSec * factor));
        this.emitView();
      }
      this.dirty = true;
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', event => {
      const startX = event.clientX, startY = event.clientY;
      const startEnd = this.paused ? this.viewEnd : this.latest;
      const [lo, hi] = this.yRange;
      const plotWidth = this.canvas.clientWidth - PAD.left - PAD.right;
      const plotHeight = this.canvas.clientHeight - PAD.top - this.padBottom;
      let moved = false;
      this.canvas.setPointerCapture(event.pointerId);
      const move = moveEvent => {
        const dx = moveEvent.clientX - startX, dy = moveEvent.clientY - startY;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        if (!moved) { moved = true; if (!this.paused) this.setPaused(true); }
        this.viewEnd = Math.min(this.latest, startEnd - dx / plotWidth * this.windowSec);
        if (!this.autoY || moveEvent.shiftKey) {
          const shift = dy / plotHeight * (hi - lo);
          this.yRange = [lo + shift, hi + shift];
          this.setAutoY(false);
        }
        this.dirty = true;
        this.emitView();
      };
      this.canvas.addEventListener('pointermove', move);
      this.canvas.addEventListener('pointerup', () => this.canvas.removeEventListener('pointermove', move), { once: true });
    });
    this.canvas.addEventListener('dblclick', () => { this.setAutoY(true); this.setPaused(false); });
    this.el.tabIndex = 0;
    this.el.addEventListener('keydown', event => { if (event.code === 'Space' && event.target === this.el) { event.preventDefault(); this.setPaused(!this.paused); } });
  }

  // ------------------------------------------------------------ rendering
  loop() {
    if (this.disposed) return;
    if (this.visible && this.dirty) { this.dirty = false; this.draw(); }
    requestAnimationFrame(this.loop);
  }

  draw() {
    const canvas = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const width = this.stage.clientWidth, height = this.stage.clientHeight;
    if (!width || !height) return;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const colors = { grid: cssVar('--line'), axis: cssVar('--line-strong'), text: cssVar('--fg-3'), cross: cssVar('--fg-2'), area: cssVar('--bg-2'), ring: cssVar('--bg-1') };
    // The legend wraps on narrow plots; push the plot area below however many rows it uses.
    PAD.top = this.compact ? Math.max(34, this.legend.offsetTop + this.legend.offsetHeight + 6) : Math.max(48, this.legend.offsetTop + this.legend.offsetHeight + 12);
    this.padBottom = this.showTimeAxis ? PAD.bottom : 8;
    const plotW = width - PAD.left - PAD.right, plotH = height - PAD.top - this.padBottom;
    // Until the first window fills, anchor at t=0 so data grows from the left edge.
    const tEnd = this.paused ? this.viewEnd : Math.max(this.latest, this.windowSec);
    const tStart = tEnd - this.windowSec;
    this.frame = { tStart };
    const visible = this.traces.filter(trace => !trace.hidden && trace.id && this.channels.get(trace.id)?.length);

    // Y range
    if (this.autoY) {
      let lo = Infinity, hi = -Infinity;
      for (const trace of visible) {
        const channel = this.channels.get(trace.id);
        const from = Math.max(0, channel.lowerBound(tStart) - 1), to = channel.lowerBound(tEnd + 1e-9);
        const stride = Math.max(1, Math.floor((to - from) / 20000));
        for (let i = from; i < to; i += stride) { const v = channel.value(i); if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
      }
      if (!Number.isFinite(lo)) { lo = -1; hi = 1; }
      if (hi - lo < 1e-12) { const pad = Math.abs(hi) * 0.1 || 1; lo -= pad; hi += pad; }
      const pad = (hi - lo) * 0.08;
      this.yRange = [lo - pad, hi + pad];
    }
    const [yLo, yHi] = this.yRange;
    const xOf = time => PAD.left + (time - tStart) / this.windowSec * plotW;
    const yOf = value => PAD.top + (1 - (value - yLo) / (yHi - yLo)) * plotH;

    // Plot area + grid + labels
    ctx.fillStyle = colors.area;
    ctx.beginPath(); ctx.roundRect(PAD.left, PAD.top, plotW, plotH, 6); ctx.fill();
    ctx.font = `10.5px ${cssVar('--font-mono')}`;
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.grid; ctx.fillStyle = colors.text;
    const yStep = niceStep(yHi - yLo, plotH / 40);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    // Integer tick indices avoid accumulated float drift (e.g. 5.55e-17 instead of 0).
    const yDecimals = Math.max(0, -Math.floor(Math.log10(yStep)));
    for (let k = Math.ceil(yLo / yStep); k * yStep <= yHi; k++) {
      const v = k * yStep;
      const y = Math.round(yOf(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(width - PAD.right, y); ctx.stroke();
      ctx.fillText(Math.abs(v) >= 1e6 || (v !== 0 && yDecimals > 6) ? v.toExponential(2) : v.toFixed(yDecimals), PAD.left - 8, y);
    }
    const xStep = niceStep(this.windowSec, plotW / 90);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const xDecimals = Math.max(0, -Math.floor(Math.log10(xStep)));
    for (let k = Math.ceil(tStart / xStep); k * xStep <= tEnd; k++) {
      const time = k * xStep;
      const x = Math.round(xOf(time)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + plotH); ctx.stroke();
      if (this.showTimeAxis) ctx.fillText(`${time.toFixed(xDecimals)}s`, x, PAD.top + plotH + 8);
    }
    if (yLo < 0 && yHi > 0) { ctx.strokeStyle = colors.axis; const y = Math.round(yOf(0)) + 0.5; ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(width - PAD.right, y); ctx.stroke(); }

    // Traces
    ctx.save();
    ctx.beginPath(); ctx.rect(PAD.left, PAD.top, plotW, plotH); ctx.clip();
    ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const trace of visible) {
      const channel = this.channels.get(trace.id);
      ctx.strokeStyle = this.resolveColor(trace.color);
      const from = Math.max(0, channel.lowerBound(tStart) - 1), to = Math.min(channel.length, channel.lowerBound(tEnd) + 1);
      ctx.beginPath();
      if (to - from <= plotW * 3) {
        let pen = false;
        for (let i = from; i < to; i++) {
          const v = channel.value(i);
          if (!Number.isFinite(v)) { pen = false; continue; }
          const x = xOf(channel.time(i)), y = yOf(v);
          pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          pen = true;
        }
      } else {
        // Min/max per pixel column keeps spikes visible at any zoom.
        let column = -1, min = 0, max = 0, first = true;
        const flush = () => { if (column < 0) return; const x = PAD.left + column + 0.5; if (first) { ctx.moveTo(x, yOf(max)); first = false; } else ctx.lineTo(x, yOf(max)); ctx.lineTo(x, yOf(min)); };
        for (let i = from; i < to; i++) {
          const v = channel.value(i);
          if (!Number.isFinite(v)) continue;
          const c = Math.floor(xOf(channel.time(i)) - PAD.left);
          if (c !== column) { flush(); column = c; min = max = v; } else { if (v < min) min = v; if (v > max) max = v; }
        }
        flush();
      }
      ctx.stroke();
    }
    ctx.restore();

    // Legend values + crosshair
    for (const trace of this.traces) if (trace.valueEl) trace.valueEl.textContent = trace.id && this.channels.get(trace.id)?.length ? formatValue(this.channels.get(trace.id).last, 5) : '';
    const hoverX = this.hoverX ?? (this.linkedHoverTime != null ? xOf(this.linkedHoverTime) : null);
    if (hoverX !== null && hoverX > PAD.left && hoverX < width - PAD.right && visible.length) {
      const time = tStart + (hoverX - PAD.left) / plotW * this.windowSec;
      ctx.strokeStyle = colors.cross; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(hoverX + 0.5, PAD.top); ctx.lineTo(hoverX + 0.5, PAD.top + plotH); ctx.stroke(); ctx.setLineDash([]);
      const lines = [`t = ${time.toFixed(4)} s`];
      for (const trace of visible) {
        const channel = this.channels.get(trace.id);
        let i = Math.min(channel.length - 1, channel.lowerBound(time));
        if (i > 0 && Math.abs(channel.time(i - 1) - time) < Math.abs(channel.time(i) - time)) i--;
        const v = channel.value(i);
        ctx.fillStyle = this.resolveColor(trace.color); ctx.strokeStyle = colors.ring; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(xOf(channel.time(i)), yOf(v), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        lines.push(`${trace.label}: ${formatValue(v, 7)}`);
      }
      this.readout.hidden = false;
      this.readout.textContent = lines.join('\n');
      this.readout.style.top = `${PAD.top + 6}px`;
      this.readout.style.left = hoverX > width / 2 ? 'auto' : `${hoverX + 14}px`;
      this.readout.style.right = hoverX > width / 2 ? `${width - hoverX + 14}px` : 'auto';
    } else this.readout.hidden = true;
    if (this.paused) { ctx.fillStyle = cssVar('--warn'); ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(t('PAUSED — drag to pan, double-click for live'), width - PAD.right - 4, PAD.top + 4); }
  }

  resolveColor(color) {
    if (!color.startsWith('var(')) return color;
    return cssVar(color.slice(4, -1));
  }

  // ------------------------------------------------------------ export
  /** Traces with data, as { label, channel } for channelsToCsv. */
  series() {
    return this.traces.filter(trace => trace.id && this.channels.get(trace.id)?.length).map(trace => ({ id: trace.id, label: trace.label, channel: this.channels.get(trace.id) }));
  }

  async exportCsv() {
    const series = this.series();
    if (!series.length) { notify(t('Nothing to export yet'), 'warn'); return; }
    const file = await host.dialog.saveFile({ title: t('Export CSV'), defaultPath: `${this.id}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!file) return;
    await host.fs.writeText(file, channelsToCsv(series));
    notify(t('Saved {file}', { file: basename(file) }), 'ok');
  }

  /** Redraw without the hover crosshair so exports show only data. */
  prepareExport() {
    this.hoverX = null;
    this.linkedHoverTime = null;
    this.readout.hidden = true;
    this.draw();
  }

  /** The legend is HTML on screen; exports paint it into the empty band above the plot area. */
  paintLegend(ctx, x0, y0, dpr) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, x0, y0);
    ctx.font = `600 11.5px ${cssVar('--font-mono')}`;
    ctx.textBaseline = 'middle';
    const right = this.canvas.clientWidth - PAD.right;
    let x = PAD.left + 4, y = 18;
    for (const trace of this.traces.filter(item => !item.hidden)) {
      const width = 16 + ctx.measureText(trace.label).width + 14;
      if (x + width > right && x > PAD.left + 4) { x = PAD.left + 4; y += 18; }
      ctx.fillStyle = this.resolveColor(trace.color);
      ctx.beginPath(); ctx.roundRect(x, y - 4, 8, 8, 2); ctx.fill();
      ctx.fillStyle = cssVar('--fg-1');
      ctx.fillText(trace.label, x + 14, y);
      x += width;
    }
    ctx.restore();
  }

  async exportPng() {
    const file = await host.dialog.saveFile({ title: t('Export PNG'), defaultPath: `${this.id}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!file) return;
    this.prepareExport();
    const out = document.createElement('canvas');
    out.width = this.canvas.width; out.height = this.canvas.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = cssVar('--bg-1'); ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(this.canvas, 0, 0);
    this.paintLegend(ctx, 0, 0, window.devicePixelRatio || 1);
    const blob = await new Promise(resolve => out.toBlob(resolve, 'image/png'));
    await host.fs.writeBinary(file, new Uint8Array(await blob.arrayBuffer()));
    notify(t('Saved {file}', { file: basename(file) }), 'ok');
  }

  onShow() { this.visible = true; this.dirty = true; }
  onHide() { this.visible = false; }
  dispose() {
    this.disposed = true;
    this.offs.forEach(off => off());
    this.resizeObserver.disconnect();
    session.setSubscription(`plot:${this.id}`, []);
    if (!this.options.onPersist) {
      const plots = { ...(workspace.settings.plots || {}) };
      delete plots[this.id];
      workspace.saveSettings({ plots });
    }
    bus.emit('plots:changed');
  }
}
