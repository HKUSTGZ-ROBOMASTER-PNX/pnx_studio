// Workbench shell: tab groups, sidebar/activity bar, splitters, overlays.
import { brandMark } from './lib/brand.js';
import { h, icon, iconButton } from './lib/dom.js';
import { Emitter } from './lib/emitter.js';
import { t } from './i18n.js';

const LAYOUT_KEY = 'studio.layout.v1';
function loadLayout() { try { return JSON.parse(localStorage.getItem(LAYOUT_KEY)) || {}; } catch { return {}; } }
function saveLayout(patch) { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...loadLayout(), ...patch })); } catch { /* storage unavailable */ } }

/**
 * A strip of tabs over a stack of views. A view spec is
 *   { id, title, icon?, closable?, create(): { el, onShow?, onHide?, dispose?, title? } }
 */
export class TabGroup extends Emitter {
  constructor(root, { compact = false, actions = [], empty = null } = {}) {
    super();
    this.root = root;
    this.items = new Map();
    this.order = [];
    this.active = null;
    root.classList.toggle('compact', compact);
    this.tabs = h('div', { class: 'tabs', role: 'tablist' });
    this.actions = h('div', { class: 'actions' }, actions);
    this.body = h('div', { class: 'tabbody' });
    this.emptyEl = empty ? h('div', { class: 'view' }, empty) : null;
    root.append(h('div', { class: 'tabstrip' }, this.tabs, this.actions), this.body);
    if (this.emptyEl) this.body.append(this.emptyEl);
  }

  open(spec, { activate = true } = {}) {
    if (this.items.has(spec.id)) { if (activate) this.activate(spec.id); return this.items.get(spec.id).view; }
    const view = spec.create();
    const container = h('div', { class: 'view', hidden: true, dataset: { view: spec.id } }, view.el);
    const close = spec.closable === false ? null : iconButton('close', t('Close'), event => { event.stopPropagation(); this.close(spec.id); }, { class: 'small close' });
    const badge = h('span', { class: 'badge', hidden: true });
    const tab = h('div', {
      class: 'tab', role: 'tab', title: spec.tooltip || spec.title,
      onclick: () => this.activate(spec.id),
      onauxclick: event => { if (event.button === 1 && close) this.close(spec.id); },
    }, spec.icon ? icon(spec.icon) : null, h('span', { class: 'name' }, spec.title), badge, close);
    this.items.set(spec.id, { spec, view, tab, container, badge });
    this.order.push(spec.id);
    this.tabs.append(tab);
    this.body.append(container);
    if (activate || !this.active) this.activate(spec.id);
    this.updateEmpty();
    this.emit('change');
    return view;
  }

  activate(id) {
    const item = this.items.get(id);
    if (!item) return;
    if (this.active && this.active !== id) {
      const previous = this.items.get(this.active);
      if (previous) { previous.tab.classList.remove('active'); previous.container.hidden = true; previous.view.onHide?.(); }
    }
    this.active = id;
    item.tab.classList.add('active');
    item.container.hidden = false;
    item.tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    item.view.onShow?.();
    this.root.classList.remove('collapsed');
    this.emit('activate', id);
  }

  close(id) {
    const item = this.items.get(id);
    if (!item) return;
    if (item.view.canClose && item.view.canClose() === false) return;
    item.view.dispose?.();
    item.tab.remove();
    item.container.remove();
    this.items.delete(id);
    const index = this.order.indexOf(id);
    this.order.splice(index, 1);
    if (this.active === id) {
      this.active = null;
      const next = this.order[Math.min(index, this.order.length - 1)];
      if (next) this.activate(next);
    }
    this.updateEmpty();
    this.emit('change');
    this.emit('close', id);
  }

  has(id) { return this.items.has(id); }
  get(id) { return this.items.get(id)?.view; }
  setTitle(id, title) { const item = this.items.get(id); if (item) item.tab.querySelector('.name').textContent = title; }
  setBadge(id, value) {
    const item = this.items.get(id);
    if (!item) return;
    item.badge.hidden = !value;
    item.badge.textContent = value || '';
  }
  updateEmpty() { if (this.emptyEl) this.emptyEl.hidden = this.items.size > 0; }
}

// ---------------------------------------------------------------- sidebar
const sidebarViews = new Map();
let activeSidebar = null;
let sidebarEl, activityEl;

export function registerSidebar(spec) {
  // Icon plus a short caption so every activity is recognizable without hovering.
  const button = h('button', { class: 'activity-item', title: spec.title, 'aria-label': spec.title, onclick: () => toggleSidebarView(spec.id) },
    icon(spec.icon), h('span', { class: 'caption' }, spec.label || spec.title));
  button.dataset.id = spec.id;
  (spec.bottom ? activityEl.querySelector('.bottom') : activityEl.querySelector('.top')).append(button);
  sidebarViews.set(spec.id, { spec, button, view: null, el: null });
}

function toggleSidebarView(id) {
  if (activeSidebar === id && !sidebarEl.classList.contains('collapsed')) { sidebarEl.classList.add('collapsed'); refreshActivity(); saveLayout({ sidebar: null }); return; }
  showSidebar(id);
}

export function showSidebar(id) {
  const entry = sidebarViews.get(id);
  if (!entry) return;
  if (!entry.view) {
    entry.view = entry.spec.create();
    entry.el = h('div', { class: 'pane-view' },
      h('div', { class: 'pane-header' }, h('span', { class: 'title' }, entry.spec.title), entry.view.actions || []),
      h('div', { class: 'pane-body' }, entry.view.el));
    sidebarEl.append(entry.el);
  }
  for (const [otherId, other] of sidebarViews) if (other.el) other.el.hidden = otherId !== id;
  activeSidebar = id;
  sidebarEl.classList.remove('collapsed');
  entry.view.onShow?.();
  refreshActivity();
  saveLayout({ sidebar: id });
}

function refreshActivity() {
  const open = !sidebarEl.classList.contains('collapsed');
  for (const [id, entry] of sidebarViews) entry.button.classList.toggle('active', open && id === activeSidebar);
}

// ---------------------------------------------------------------- splitters
function initSplitters() {
  const layout = loadLayout();
  for (const splitter of document.querySelectorAll('.splitter')) {
    const target = document.getElementById(splitter.dataset.target);
    const edge = splitter.dataset.edge;
    const horizontal = edge === 'bottom';
    const saved = layout[`size.${target.id}`];
    if (saved) target.style[horizontal ? 'height' : 'width'] = `${saved}px`;
    splitter.addEventListener('pointerdown', event => {
      event.preventDefault();
      splitter.setPointerCapture(event.pointerId);
      splitter.classList.add('dragging');
      const start = horizontal ? event.clientY : event.clientX;
      const initial = horizontal ? target.offsetHeight : target.offsetWidth;
      const sign = edge === 'left' ? 1 : -1;
      const move = moveEvent => {
        const delta = ((horizontal ? moveEvent.clientY : moveEvent.clientX) - start) * sign;
        const size = Math.max(horizontal ? 80 : 180, Math.min(initial + delta, (horizontal ? window.innerHeight : window.innerWidth) * 0.7));
        target.style[horizontal ? 'height' : 'width'] = `${size}px`;
        window.dispatchEvent(new Event('studio:layout'));
      };
      const up = () => {
        splitter.classList.remove('dragging');
        splitter.removeEventListener('pointermove', move);
        saveLayout({ [`size.${target.id}`]: horizontal ? target.offsetHeight : target.offsetWidth });
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', up, { once: true });
    });
  }
}

export function toggleRegion(id, force) {
  const el = document.getElementById(id);
  const collapsed = force === undefined ? !el.classList.contains('collapsed') : !force;
  el.classList.toggle('collapsed', collapsed);
  document.querySelector(`.splitter[data-target="${id}"]`)?.classList.toggle('hidden', collapsed);
  if (id === 'sidebar') refreshActivity();
  saveLayout({ [`collapsed.${id}`]: collapsed });
  window.dispatchEvent(new Event('studio:layout'));
}

// ---------------------------------------------------------------- overlays
const overlay = () => document.getElementById('overlay');

export function modal({ title, body, footer = [], width, onClose }) {
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey, true); onClose?.(); };
  const onKey = event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
  const dialog = h('div', { class: 'modal', role: 'dialog', 'aria-label': title, style: width ? { width } : null },
    h('header', null, h('h2', null, title), iconButton('close', t('Close'), () => close())),
    h('div', { class: 'body' }, body),
    footer.length ? h('footer', null, footer) : null);
  const backdrop = h('div', { class: 'backdrop', onmousedown: event => { if (event.target === backdrop) close(); } }, dialog);
  overlay().append(backdrop);
  document.addEventListener('keydown', onKey, true);
  queueMicrotask(() => dialog.querySelector('input, select, button.primary')?.focus());
  return close;
}

export function menu(anchor, items) {
  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, bottom: anchor.y, top: anchor.y };
  const el = h('div', { class: 'menu', role: 'menu' }, items.map(item => item === '-' ? h('div', { class: 'sep' }) : h('div', {
    class: 'item', role: 'menuitem', onclick: () => { dismiss(); item.run(); },
  }, item.icon ? icon(item.icon) : null, item.label, item.hint ? h('span', { class: 'hint' }, item.hint) : null)));
  const dismiss = () => { el.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = event => { if (!el.contains(event.target)) dismiss(); };
  overlay().append(el);
  const width = el.offsetWidth, height = el.offsetHeight;
  el.style.left = `${Math.min(rect.left, window.innerWidth - width - 8)}px`;
  el.style.top = `${rect.bottom + height + 8 > window.innerHeight ? rect.top - height - 4 : rect.bottom + 4}px`;
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  return dismiss;
}

let toastBox;
export function notify(text, level = 'info', timeout = level === 'error' ? 8000 : 4000) {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', 'aria-live': 'polite' }); overlay().append(toastBox); }
  const iconName = { error: 'warn', warn: 'warn', ok: 'check' }[level] || 'info';
  const toast = h('div', { class: `toast ${level}` }, icon(iconName), h('div', { class: 'text' }, text), iconButton('close', t('Close'), () => toast.remove(), { class: 'small' }));
  toastBox.append(toast);
  if (timeout) setTimeout(() => toast.remove(), timeout);
  while (toastBox.children.length > 5) toastBox.firstChild.remove();
}

let tip;
export function showTooltip(x, y, text) {
  if (!tip) { tip = h('div', { class: 'tooltip' }); overlay().append(tip); }
  tip.hidden = false;
  tip.textContent = text;
  const width = tip.offsetWidth, height = tip.offsetHeight;
  tip.style.left = `${Math.min(x + 12, window.innerWidth - width - 8)}px`;
  tip.style.top = `${y + 16 + height > window.innerHeight ? y - height - 8 : y + 16}px`;
}
export function hideTooltip() { if (tip) tip.hidden = true; }

// ---------------------------------------------------------------- init
export const workbench = {};

export function initShell() {
  sidebarEl = document.getElementById('sidebar');
  activityEl = document.getElementById('activitybar');
  activityEl.append(h('div', { class: 'top', style: { display: 'contents' } }), h('div', { class: 'bottom' }));
  workbench.editor = new TabGroup(document.getElementById('editor'), { empty: h('div', { class: 'empty-state' }, brandMark('logo-big'), h('p', { class: 'muted' }, t('Open a source file, a plot or the welcome page.'))) });
  workbench.panel = new TabGroup(document.getElementById('panel'), { compact: true, actions: [iconButton('close', t('Hide panel'), () => toggleRegion('panel', false), { class: 'small' })] });
  workbench.inspector = new TabGroup(document.getElementById('inspector'), { compact: true, actions: [iconButton('close', t('Hide inspector'), () => toggleRegion('inspector', false), { class: 'small' })] });
  initSplitters();
  const layout = loadLayout();
  for (const id of ['panel', 'inspector']) if (layout[`collapsed.${id}`]) toggleRegion(id, false);
  return layout;
}
