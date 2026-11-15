import test from 'node:test';
import assert from 'node:assert/strict';
import { activate } from '../plugins/csv-recorder/renderer.js';

class Element {
  constructor(tag, props = {}, children = []) {
    this.tag = tag; this.props = props || {}; this.children = children.flat(Infinity).filter(v => v != null && v !== false);
    this.style = {}; this.classList = { toggle() {} }; this.events = {}; this.disabled = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, fn) { this.events[name] = fn; }
  get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent || '').join(''); }
  set textContent(value) { this.children = [value]; }
  walk() { return [this, ...this.children.flatMap(child => child instanceof Element ? child.walk() : [])]; }
}

test('recorder expands structure members, deduplicates and clears the list', async () => {
  const vars = { id: 's', expression: 's', children: [
    { id: 'a', expression: 's.a', address: 1, byteWidth: 4 },
    { id: 'nested', children: [{ id: 'b', expression: 's.n.b', pointerAddress: 2, byteWidth: 2 }, { id: 'invalid', address: 3, byteWidth: 3 }] },
  ] };
  let selected, options, config, view, onMessage;
  const studio = {
    ui: { h: (tag, props, ...children) => new Element(tag, props, children), icon: () => new Element('i'),
      iconButton: (name, title, fn) => new Element('button', { title, onclick: fn }), notify() {},
      addToolbarButton: () => new Element('button'), pickVariable: (anchor, cb, opts) => { selected = cb; options = opts; } },
    i18n: { t: text => text, addTranslations() {} }, storage: { get: () => ({}), set: (key, value) => { config = structuredClone(value); } },
    session: { connected: true, variable: key => key === 's' ? vars : null, on() {}, subscribe() {}, unsubscribe() {} },
    main: { onMessage: cb => { onMessage = cb; }, invoke: async () => ({ recording: false }) },
    host: { dialog: {} }, views: { register: (id, def) => { view = def; } }, commands: { register() {} },
  };
  activate(studio);
  const container = new Element('main'); view.render(container);
  const button = label => container.walk().find(el => el.tag === 'button' && el.textContent === label);
  button('Add variable').props.onclick({ currentTarget: {} });
  assert.equal(options.aggregates, true);
  selected(vars); selected(vars.children[0]);
  assert.deepEqual(config.keys, ['s.a', 's.n.b']);
  await Promise.resolve();
  onMessage({ type: 'state', state: { recording: true } });
  assert.equal(button('Clear list').disabled, true);
  button('Clear list').props.onclick();
  assert.equal(config.keys.length, 2);
  onMessage({ type: 'state', state: { recording: false } });
  button('Clear list').props.onclick();
  assert.deepEqual(config.keys, []);
});
