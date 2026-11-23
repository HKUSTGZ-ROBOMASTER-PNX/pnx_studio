'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { restoreWindowBounds } = require('../electron/core/window-bounds.cjs');
const displays = [{ workArea: { x: 0, y: 0, width: 1440, height: 852 } }, { workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }];
test('restores accessible windows, including negative coordinates on a connected display', () => {
  const saved = { x: -1800, y: 40, width: 1200, height: 700 };
  assert.deepEqual(restoreWindowBounds(saved, displays), saved);
});
test('lets the system center a window after its display is disconnected', () => {
  assert.deepEqual(restoreWindowBounds({ x: -2056, y: -8, width: 1440, height: 852 }, displays.slice(0, 1)), { width: 1440, height: 852 });
  assert.deepEqual(restoreWindowBounds({ x: 0, y: -700, width: 1200, height: 800 }, displays.slice(0, 1)), { width: 1200, height: 800 });
});
test('falls back safely when settings are invalid', () => {
  assert.deepEqual(restoreWindowBounds({ x: NaN, y: 0, width: -1, height: 0 }, displays), { width: 1480, height: 940 });
});
