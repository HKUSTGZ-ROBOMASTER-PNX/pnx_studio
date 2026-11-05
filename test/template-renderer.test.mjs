import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { activate } from '../plugins/pnx-template/renderer.js';

const template = JSON.parse(fs.readFileSync(new URL('./fixtures/template-config/user_config.json', import.meta.url), 'utf8'));

class Element {
  constructor(tag, props = {}, children = []) {
    this.tagName = tag.toUpperCase(); this.children = []; this.props = props || {}; this.value = this.props.value ?? '';
    this.disabled = !!this.props.disabled; this.hidden = !!this.props.hidden; this.checked = !!this.props.checked;
    this.title = this.props.title || ''; this.dataset = this.props.dataset || {};
    this.events = {}; this.classes = new Set((this.props.class || '').split(/\s+/).filter(Boolean));
    this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name), toggle: (name, force) => { const set = force === undefined ? !this.classes.has(name) : force; set ? this.classes.add(name) : this.classes.delete(name); } };
    // studio.ui.h flattens its own children and ignores empty placeholders.
    // Native Element.append / replaceChildren do neither.
    for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) this.append(child);
  }
  append(...items) { for (const item of items) this.children.push(item instanceof Element ? item : String(item)); }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  toString() { return '[object HTMLElement]'; }
  addEventListener(name, callback) { this.events[name] = callback; }
  get textContent() { return this.children.map(item => typeof item === 'string' ? item : item.textContent || '').join(''); }
  set textContent(value) { this.children = [String(value)]; }
  walk() { return [this, ...this.children.flatMap(child => child instanceof Element ? child.walk() : [])]; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    return this.walk().slice(1).filter(element => selector === '[data-action="save"]' ? element.dataset.action === 'save' : selector.split(',').some(tag => element.tagName.toLowerCase() === tag.trim()));
  }
  fire(name) { const event = { target: this }; const fn = this.events[name] || this.props[`on${name}`]; if (fn) return fn(event); }
}

function harness() {
  const head = new Element('head');
  globalThis.document = { head, getElementById: id => head.walk().find(node => node.props.id === id) || null };
  const views = new Map(), commands = new Map(), calls = [], notices = [];
  let onOpen, dialog;
  const resources = {
    h723_mc02: { usart: ['none', 'usart1', 'uart5', 'uart7', 'usart10'], gpio: ['none', 'ps2_cs'], spi: ['none', 'spi1'], pwm: ['none', 'tim12'], can: ['none', 'fdcan1'] },
    f407_cboard: { usart: ['none', 'usart1', 'usart3', 'usart6'], gpio: ['none'], spi: ['none'], pwm: ['none', 'tim4'], can: ['none', 'can1'] },
  };
  const copies = { '/first': structuredClone(template), '/second': structuredClone(template) };
  copies['/second'].ui.timeout_ms = 333;
  let revision = 0;
  const studio = {
    ui: { h: (tag, props, ...children) => new Element(tag, props, children), icon: name => new Element('i', { title: name }),
      notify: (message, level) => notices.push([message, level]), modal: options => { dialog = options; return () => { const current = dialog; dialog = null; current.onClose(); }; }, addToolbarButton: () => {} },
    i18n: { t: text => text, addTranslations: () => {} },
    views: { register: (id, def) => views.set(id, def), open: () => {} },
    commands: { register: (id, title, fn) => commands.set(id, fn) },
    workspace: { root: '/first', on: (event, handler) => { if (event === 'opened') onOpen = handler; } },
    main: { invoke: async (command, args) => { calls.push({ command, args: structuredClone(args) }); if (command === 'save') copies[args.root] = structuredClone(args.config); return { config: structuredClone(copies[args.root]), resources: structuredClone(resources), revision: `v${++revision}` }; } },
  };
  activate(studio);
  const container = new Element('main');
  views.get('configuration').render(container);
  const nodes = () => container.walk();
  const button = text => nodes().find(node => node.tagName === 'BUTTON' && node.textContent === text);
  const field = label => nodes().find(node => node.props['aria-label'] === label && ['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName));
  return { studio, container, calls, notices, button, field, onOpen: () => onOpen(), get dialog() { return dialog; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('configuration section mounts actual form elements without stringified placeholders', async () => {
  const h = harness(); await tick();
  assert.ok(h.field('Enabled'), 'USB enabled toggle is an element in the document');
  assert.doesNotMatch(h.container.textContent, /\[object HTMLElement\]|\bnull\b/);
  h.button('h723_mc02').fire('click');
  assert.ok(h.field('DMIMU CAN'), 'board resource selector is an element in the document');
  assert.doesNotMatch(h.container.textContent, /\[object HTMLElement\]|\bnull\b/);
});

test('view edits numeric fields, validates input and saves the active workspace', async () => {
  const h = harness(); await tick();
  assert.ok(h.button('USB'));
  h.button('UI').fire('click');
  let input = h.field('ui.timeout_ms');
  assert.equal(input.value, '100');
  input.value = '';
  input.fire('input');
  assert.equal(h.button('Save').disabled, true);
  assert.equal(h.calls.filter(call => call.command === 'save').length, 0);
  input.value = '250'; input.fire('input');
  assert.equal(h.button('Save').disabled, false);
  await h.button('Save').fire('click');
  const saved = h.calls.find(call => call.command === 'save');
  assert.equal(saved.args.root, '/first');
  assert.equal(saved.args.config.ui.timeout_ms, 250);
  assert.equal(h.button('Save').disabled, true);
  assert.deepEqual(h.notices.at(-1), ['Configuration saved.', 'ok']);
});

test('board resource select uses discovered options and saves selected value', async () => {
  const h = harness(); await tick();
  h.button('h723_mc02').fire('click');
  const field = h.field('DMIMU CAN');
  assert.equal(field.tagName, 'SELECT');
  assert.ok(field.children.some(option => option.value === 'fdcan1'));
  field.value = 'none'; field.fire('change');
  await h.button('Save').fire('click');
  assert.equal(h.calls.find(call => call.command === 'save').args.config.boards.h723_mc02.dmimu_can, 'none');
});

test('changing workspace keeps dirty draft until user chooses to discard', async () => {
  const h = harness(); await tick();
  h.button('UI').fire('click');
  const field = h.field('ui.timeout_ms'); field.value = '200'; field.fire('input');
  h.studio.workspace.root = '/second'; h.onOpen();
  assert.equal(h.field('ui.timeout_ms').value, '200');
  assert.ok(h.button('Load current workspace'));
  h.button('Load current workspace').fire('click'); await tick();
  assert.ok(h.dialog);
  h.dialog.footer.find(button => button.textContent === 'Cancel').fire('click'); await tick();
  assert.equal(h.field('ui.timeout_ms').value, '200');
  h.button('Load current workspace').fire('click'); await tick();
  h.dialog.footer.find(button => button.textContent === 'Discard').fire('click'); await tick();
  h.button('UI').fire('click');
  assert.equal(h.field('ui.timeout_ms').value, '333');
  assert.equal(h.calls.filter(call => call.command === 'save').length, 0);
});

test('saving a draft after a workspace change writes its original workspace', async () => {
  const h = harness(); await tick();
  h.button('UI').fire('click');
  const field = h.field('ui.timeout_ms'); field.value = '201'; field.fire('input');
  h.studio.workspace.root = '/second'; h.onOpen();
  await h.button('Save').fire('click');
  const saved = h.calls.find(call => call.command === 'save');
  assert.equal(saved.args.root, '/first');
  assert.equal(saved.args.config.ui.timeout_ms, 201);
  assert.ok(h.button('Load current workspace'));
});
