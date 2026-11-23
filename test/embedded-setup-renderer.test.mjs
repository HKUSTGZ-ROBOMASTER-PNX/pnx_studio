import test from 'node:test';
import assert from 'node:assert/strict';
import { activate } from '../plugins/embedded-setup/renderer.js';
class Element {
  constructor(tag, props = {}) { this.tagName = tag.toUpperCase(); this.props = props || {}; this.children = []; this.value = this.props.value || ''; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  get textContent() { return this.children.map(c => c instanceof Element ? c.textContent : String(c ?? '')).join(''); }
  walk() { return [this, ...this.children.flatMap(c => c instanceof Element ? c.walk() : [])]; }
}
function h(tag, props, ...items) { const e = new Element(tag, props); e.append(...items.flat(Infinity).filter(x => x != null && x !== false)); return e; }
test('setup view exposes component choices and sends selected actions', async () => {
  let view, message; const calls = [];
  const studio = { ui: { h, notify() {} }, i18n: { t: s => s, addTranslations() {} },
    main: { onMessage: fn => { message = fn; }, invoke: async (name, args) => {
      calls.push({ name, args });
      if (name === 'platform') return { platform: 'win32', arch: 'x64', defaultDir: 'C:\\tools' };
      if (name === 'state') return { phase: 'idle', log: [] };
      return { phase: 'running', log: [] };
    } }, host: { dialog: { openFolder: async () => 'D:\\tools' } },
    views: { register: (_name, v) => { view = v; }, open() {} }, commands: { register() {} } };
  activate(studio); const root = new Element('main'); view.render(root); await new Promise(resolve => setImmediate(resolve));
  assert.ok(!root.walk().some(e => e.children.some(child => child === null)));
  const nodes = () => root.walk();
  const selects = nodes().filter(e => e.tagName === 'SELECT'); assert.equal(selects.length, 6);
  assert.equal(selects[0].children.length, 3); assert.equal(selects[4].children.length, 2);
  selects[0].props.onchange({ target: { value: 'reinstall' } }); selects[1].props.onchange({ target: { value: 'skip' } });
  await nodes().find(e => e.tagName === 'BUTTON' && e.textContent === 'Choose folder').props.onclick();
  await nodes().find(e => e.tagName === 'BUTTON' && e.textContent === 'Scan and configure').props.onclick();
  const args = calls.find(c => c.name === 'start').args;
  assert.equal(args.directory, 'D:\\tools'); assert.equal(args.components.cmake, 'reinstall'); assert.equal(args.components.git, 'skip');
  message({ type: 'state', state: { phase: 'idle' } });
  const checkboxes = nodes().filter(e => e.tagName === 'INPUT' && e.props.type === 'checkbox');
  assert.equal(checkboxes.length, 6);
  checkboxes[0].props.onchange({ target: { checked: true } });
  await nodes().find(e => e.tagName === 'BUTTON' && e.textContent === 'Direct install').props.onclick();
  const direct = calls.filter(c => c.name === 'start').at(-1).args;
  assert.equal(direct.mode, 'direct'); assert.equal(direct.components.cmake, 'reinstall'); assert.equal(direct.components.git, 'skip');
  message({ type: 'state', state: { phase: 'running', log: ['[SCAN 3s] dirs=42 tools=1'], progress: { stage: 'scanning', directories: 42, found: 1, seconds: 3, denied: 0, errors: 0, current: 'C:\\tools' } } });
  assert.match(root.textContent, /Scanned directories: 42/);
  assert.match(root.textContent, /Candidates found: 1/);
  assert.doesNotMatch(root.textContent, /\[SCAN 3s\] dirs=42 tools=1/);
  assert.ok(!nodes().some(e => e.tagName === 'PRE'));
  assert.ok(nodes().some(e => e.tagName === 'PROGRESS'));
  message({ type: 'state', state: { phase: 'running', prompt: 'I = Install', log: [] } });
  assert.ok(nodes().find(e => e.tagName === 'BUTTON' && e.textContent === 'Install'));
});
