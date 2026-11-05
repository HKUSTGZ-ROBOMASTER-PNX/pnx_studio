import test from 'node:test';
import assert from 'node:assert/strict';
import { leaf, panesOf, removePane, insertPane, swapPanes, presetLayout, equalize } from '../renderer/js/lib/layout-tree.js';

test('insertPane splits the target on the requested side', () => {
  const right = insertPane(leaf('a'), 'a', 'b', 'right');
  assert.equal(right.dir, 'row');
  assert.deepEqual(panesOf(right), ['a', 'b']);
  const top = insertPane(right, 'b', 'c', 'top');
  assert.deepEqual(panesOf(top), ['a', 'c', 'b']);
  assert.equal(top.children[1].dir, 'column');
});

test('removePane collapses single-child splits and renormalises sizes', () => {
  const tree = presetLayout(['a', 'b', 'c'], 'stack');
  tree.sizes = [0.5, 0.25, 0.25];
  const without = removePane(tree, 'a');
  assert.deepEqual(panesOf(without), ['b', 'c']);
  assert.deepEqual(without.sizes, [0.5, 0.5]);
  assert.deepEqual(removePane(insertPane(leaf('a'), 'a', 'b', 'left'), 'b'), leaf('a'));
  assert.equal(removePane(leaf('a'), 'a'), null);
});

test('moving a pane = remove + insert; swap exchanges positions', () => {
  const tree = presetLayout(['a', 'b', 'c'], 'side');
  const moved = insertPane(removePane(tree, 'c'), 'a', 'c', 'bottom');
  assert.deepEqual(panesOf(moved), ['a', 'c', 'b']);
  assert.deepEqual(panesOf(swapPanes(tree, 'a', 'c')), ['c', 'b', 'a']);
});

test('grid preset and equalize', () => {
  const grid = presetLayout(['a', 'b', 'c', 'd', 'e'], 'grid');
  assert.equal(grid.dir, 'column');
  assert.deepEqual(grid.children.map(row => panesOf(row).length), [3, 2]);
  const skewed = { ...grid, sizes: [0.9, 0.1] };
  assert.deepEqual(equalize(skewed).sizes, [0.5, 0.5]);
  assert.deepEqual(presetLayout(['a'], 'grid'), leaf('a'));
});

test('inserting along the parent direction adds a sibling instead of nesting', () => {
  const row = insertPane(insertPane(leaf('a'), 'a', 'b', 'right'), 'a', 'c', 'left');
  assert.equal(row.children.length, 3);
  assert.deepEqual(panesOf(row), ['c', 'a', 'b']);
  assert.deepEqual(row.sizes, [0.25, 0.25, 0.5]);
});
