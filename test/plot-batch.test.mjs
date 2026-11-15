import test from 'node:test';
import assert from 'node:assert/strict';

test('batch plot additions deduplicate and update the subscription once', async () => {
  globalThis.window = { host: { session: { onDap() {}, onSamples() {}, onLog() {}, onClosed() {} } } };
  globalThis.document = { createElement: () => ({ setAttribute() {}, append() {} }) };
  const { PlotView } = await import('../renderer/js/views/plot.js');
  const calls = [];
  const plot = Object.assign(Object.create(PlotView.prototype), {
    traces: [{ key: 'existing' }],
    resolveTraces: () => calls.push('resolve'),
    subscribe: () => calls.push('subscribe'),
    renderLegend: () => calls.push('legend'),
    persist: () => calls.push('persist'),
  });
  plot.addTraces([{ expression: 'existing' }, { expression: 'a' }, { id: 'b' }, { expression: 'a' }]);
  assert.deepEqual(plot.traces.map(trace => trace.key), ['existing', 'a', 'b']);
  assert.deepEqual(calls, ['resolve', 'subscribe', 'legend', 'persist']);
  calls.length = 0;
  plot.addTrace({ expression: 'a' });
  assert.deepEqual(calls, []);
  plot.addTrace({ expression: 'c' }, { color: '#123456', hidden: true });
  assert.equal(plot.traces.at(-1).color, '#123456');
  assert.equal(plot.traces.at(-1).hidden, true);
});
