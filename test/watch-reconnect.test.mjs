import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the real Watch and Session modules with a small DOM and a mock host.
class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.events = {};
    this.className = '';
    this.classList = {
      toggle: (name, enabled) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        if (enabled) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(' ');
      },
    };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, handler) { this.events[name] = handler; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  get textContent() { return this.children.map(child => child instanceof Element ? child.textContent : String(child)).join(''); }
  set textContent(value) { this.children = [String(value)]; }
  walk() { return [this, ...this.children.flatMap(child => child instanceof Element ? child.walk() : [])]; }
  querySelector(selector) {
    return this.walk().find(element => selector.startsWith('.')
      ? element.className.split(/\s+/).includes(selector.slice(1))
      : element.tag === selector) || null;
  }
}

test('Watch resolves saved variables and resumes polling after flashing and catalog changes', async t => {
  globalThis.Node = Element;
  globalThis.document = {
    createElement: tag => new Element(tag),
    createElementNS: (_namespace, tag) => new Element(tag),
  };

  const scalar = (id, address) => ({
    id, name: 'tick', expression: 'state.tick', typeName: 'uint32_t',
    address, byteWidth: 4, writable: true, children: [],
  });
  const structure = (id, address) => ({
    id: 'state', name: 'state', expression: 'state', typeName: 'State',
    address, byteWidth: 4, children: [scalar(id, address)],
  });
  let catalog = [structure('old-id', 0x20000000)];
  let value = 7;
  let onDap;
  let deferNextRead;
  const reads = [];
  globalThis.window = { host: { session: {
    onDap: callback => { onDap = callback; },
    onSamples() {}, onLog() {}, onClosed() {},
    start: async () => {
      // A stop can arrive while startup is still fetching the symbol catalog.
      onDap({ event: 'stopped', body: { reason: 'entry' } });
      onDap({ event: 'studio.catalog', body: { variables: catalog } });
      return { catalog, state: { targetState: 'running' } };
    },
    stop: async () => {},
    subscribe: async () => {},
    request: async (command, args) => {
      if (command === 'stackTrace') return { stackFrames: [] };
      assert.equal(command, 'studio/readValues');
      reads.push(args.ids);
      if (deferNextRead) {
        const pending = deferNextRead;
        deferNextRead = null;
        return pending;
      }
      return { values: args.ids.map(id => ({ id, value })) };
    },
  } } };

  const { session } = await import('../renderer/js/session.js');
  const { workspace } = await import('../renderer/js/workspace.js');
  const { createWatch } = await import('../renderer/js/views/watch.js');
  const view = createWatch();
  t.after(() => session.disconnect());
  workspace.settings = { watch: { groups: [{ id: 'saved', name: 'Watch', items: [
    { key: 'state.tick' }, { key: 'state' }, { key: 'missing' },
  ] }], active: 'saved' } };
  workspace.emit('opened', {});

  const row = name => view.el.walk().find(element => element.className.split(/\s+/).includes('watch-row')
    && element.querySelector('.watch-name')?.textContent === name);
  const cell = name => row(name)?.querySelector('.watch-value')?.textContent;
  const settle = () => new Promise(resolve => setImmediate(resolve));

  await session.connect({ mock: true, mode: 'launch' });
  await settle();
  assert.equal(cell('state.tick'), '7', 'saved variables become live on connection');
  assert.equal(cell('missing'), 'not found', 'symbols absent from the catalog remain marked missing');
  row('state').events.click();
  await settle();
  assert.equal(cell('tick'), '7', 'expanded structure members are polled');

  await session.disconnect();
  assert.equal(cell('state.tick'), '—');
  catalog = [structure('new-id', 0x20000100)];
  value = 42;
  await session.connect({ mock: true, mode: 'launch', flash: true });
  await settle();
  assert.equal(cell('state.tick'), '42', 'reconnecting after a flash uses the new catalog');
  assert.equal(cell('tick'), '42', 'expanded members are rebound after reconnecting');
  assert.match(row('state.tick').querySelector('.watch-name').attributes.title, /0x20000100/);
  assert.ok(reads.some(ids => ids.includes('new-id')), 'the new symbol id is polled');

  session.setCatalog([]);
  assert.equal(cell('state.tick'), 'not found', 'a removed symbol is immediately marked missing');
  value = 45;
  session.setCatalog(catalog);
  await settle();
  assert.equal(cell('state.tick'), '45', 'a later catalog restarts polling when no ids were available');

  let releaseOldRead;
  deferNextRead = new Promise(resolve => { releaseOldRead = resolve; });
  session.setCatalog(catalog);
  await session.disconnect();
  value = 88;
  await session.connect({ mock: true, mode: 'launch', flash: true });
  await settle();
  assert.equal(cell('state.tick'), '88');
  releaseOldRead({ values: [{ id: 'new-id', value: 999 }] });
  await settle();
  assert.equal(cell('state.tick'), '88', 'a read started before disconnect cannot overwrite the new session');
});
