import test from 'node:test';
import assert from 'node:assert/strict';
import { PLUGINS, parseSelection, readSelection, formatSelection } from '../scripts/plugin-selection.mjs';

test('plugin selection survives a reinstall, including an empty choice', () => {
  for (const selection of ['all', 'none', 'csv-recorder,pnx-template']) {
    const selected = parseSelection(selection);
    assert.deepEqual(readSelection(formatSelection(selected)), selected);
  }
  assert.equal(parseSelection('all').size, PLUGINS.length);
});

test('rejects invalid selections instead of silently changing installed plugins', () => {
  assert.throws(() => parseSelection('not-a-plugin'), /Unknown plugin/);
  assert.throws(() => readSelection('[plugins]\ncsv-recorder=1\n'), /Invalid plugin selection/);
});
