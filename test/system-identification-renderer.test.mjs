import test from 'node:test';
import assert from 'node:assert/strict';
import { activate } from '../plugins/system-identification/renderer.js';

// Model the distinction between the app's h() helper (which flattens arrays)
// and native append()/replaceChildren() (which stringify non-Node arguments).
class Element {
  constructor(tag, props = {}) {
    this.tagName = tag.toUpperCase(); this.children = []; this.props = props || {}; this.value = String(this.props.value ?? '');
    this.disabled = !!this.props.disabled; this.hidden = !!this.props.hidden; this.dataset = this.props.dataset || {};
    this.events = {}; this.classes = new Set((this.props.class || '').split(/\s+/).filter(Boolean));
    this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name), toggle: (name, force) => { const set = force === undefined ? !this.classes.has(name) : force; set ? this.classes.add(name) : this.classes.delete(name); } };
  }
  append(...items) { for (const item of items) this.children.push(item instanceof Element ? item : String(item)); }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  addEventListener(name, fn) { this.events[name] = fn; }
  get textContent() { return this.children.map(item => item instanceof Element ? item.textContent : item).join(''); }
  set textContent(value) { this.children = [String(value)]; }
  walk() { return [this, ...this.children.flatMap(child => child instanceof Element ? child.walk() : [])]; }
  querySelectorAll(selector) { return this.walk().slice(1).filter(element => selector.split(',').some(tag => element.tagName.toLowerCase() === tag.trim())); }
  fire(name) { const event = { target: this }; const fn = this.events[name] || this.props[`on${name}`]; return fn?.(event); }
}
function create(tag, props, ...children) {
  const el = new Element(tag, props);
  const append = values => values.forEach(value => {
    if (value == null || value === false) return;
    if (Array.isArray(value)) append(value);
    else el.append(value);
  });
  append(children);
  return el;
}
function harness() {
  const head = new Element('head');
  globalThis.document = { head, getElementById: id => head.walk().find(node => node.props.id === id) || null };
  globalThis.requestAnimationFrame = () => 1;
  const calls = [], views = new Map(), notices = [];
  let message, modalOptions, state = { phase: 'idle' };
  const studio = {
    ui: { h: create, icon: name => new Element('i', { title: name }), notify: (...args) => notices.push(args),
      modal: options => { modalOptions = options; return () => { const active = modalOptions; modalOptions = null; active.onClose(); }; }, addToolbarButton() {} },
    i18n: { t: text => text, addTranslations() {} },
    main: { onMessage: fn => { message = fn; }, invoke: async (name, args) => {
      calls.push({ name, args });
      if (name === 'ports') return [{ path: 'COM8', description: 'mock' }];
      if (name === 'state') return state;
      if (name === 'analyze') return (state = { phase: 'analyzing', file: args.file });
      if (name === 'start') return (state = { phase: 'starting', file: args.file, port: args.port });
      if (name === 'abort') return (state = { ...state, phase: 'stopping' });
      return {};
    } },
    host: { dialog: { openFile: async () => '/tmp/raw.csv', saveFile: async () => '/tmp/output.csv' } },
    views: { register: (name, view) => views.set(name, view), open() {} },
    commands: { register() {} },
  };
  activate(studio);
  const container = new Element('main');
  const view = views.get('view').render(container);
  const nodes = () => container.walk();
  const button = text => nodes().find(node => node.tagName === 'BUTTON' && node.textContent === text);
  const input = selector => nodes().find(node => node.tagName === 'INPUT' && selector(node.props));
  const setState = next => { state = next; message({ type: 'state', state: next }); };
  return { studio, container, view, calls, notices, nodes, button, input, setState, get modal() { return modalOptions; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('view contains real inputs and offline analysis sends the chosen file', async () => {
  const h = harness(); await tick();
  assert.ok(h.input(props => props.list === 'auto-id-ports'));
  assert.ok(h.input(props => props.type === 'number'));
  assert.ok(h.button('Start experiment'));
  assert.ok(h.button('Analyze existing V1 raw.csv'));
  assert.doesNotMatch(h.container.textContent, /\[object HTMLElement\]|\[object Object\]/);
  await h.button('Analyze existing V1 raw.csv').fire('click');
  assert.deepEqual(h.calls.find(call => call.name === 'analyze').args, { file: '/tmp/raw.csv', kTau: null });
  assert.equal(h.button('Start experiment').disabled, true);
});

test('starting requires confirmation, stop requests abort, and closing an active view aborts', async () => {
  const h = harness(); await tick();
  const port = h.input(props => props.list === 'auto-id-ports'); port.value = 'COM8'; port.fire('input');
  const pending = h.button('Start experiment').fire('click'); await tick();
  assert.ok(h.modal);
  assert.match(h.modal.body.textContent, /moves the gimbal/);
  h.modal.footer.find(button => button.textContent === 'Cancel').fire('click');
  await pending;
  assert.equal(h.calls.filter(call => call.name === 'start').length, 0);
  const next = h.button('Start experiment').fire('click'); await tick();
  h.modal.footer.find(button => button.textContent === 'Start').fire('click');
  await next;
  assert.deepEqual(h.calls.find(call => call.name === 'start').args, { port: 'COM8', baud: 921600, file: '/tmp/output.csv', kTau: null });
  h.setState({ phase: 'running', file: '/tmp/output.csv' });
  await h.button('Abort experiment').fire('click');
  assert.equal(h.calls.filter(call => call.name === 'abort').length, 1);
  h.setState({ phase: 'running', file: '/tmp/output.csv' });
  h.view.dispose(); await tick();
  assert.equal(h.calls.filter(call => call.name === 'abort').length, 2);
});

test('finished results expose metrics and real plot canvases', async () => {
  const h = harness(); await tick();
  h.setState({ phase: 'finished', samples: 1000, result: { summary: {
    K: -0.0003, T_s: 0.08, Td_s: 0.01, fit_percent: 81.6, rmse: 0.1, J: null, B: null, sample_count: 1000, dropped_samples: null, saturation_ratio_percent: 1,
  }, signals: { time_s: [8, 9], measured_speed_rad_s: [0, 1], model_speed_rad_s: [0, 0.9] },
  rawSignals: { time_s: [0, 1], yaw_pos_ref_rad: [0, 0], yaw_pos_fdb_rad: [0, 0], yaw_speed_fdb_rad_s: [0, 0], yaw_current_cmd: [0, 0] } } });
  assert.match(h.container.textContent, /Gain K/);
  assert.match(h.container.textContent, /81\.600 %/);
  assert.match(h.container.textContent, /Unavailable/);
  assert.equal(h.nodes().filter(node => node.tagName === 'CANVAS').length, 4);
  assert.ok(h.button('Save result JSON'));
  assert.doesNotMatch(h.container.textContent, /\[object HTMLElement\]|\[object Object\]/);
});
