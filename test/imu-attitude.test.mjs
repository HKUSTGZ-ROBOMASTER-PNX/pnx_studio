import test from 'node:test';
import assert from 'node:assert/strict';
import { eulerToMatrix, axisMatrix } from '../plugins/imu-attitude/renderer.js';

const apply = (m, v) => [0, 1, 2].map(i => m[i * 3] * v[0] + m[i * 3 + 1] * v[1] + m[i * 3 + 2] * v[2]);
const close = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-9, `${actual} ≉ ${expected}`));

test('ZYX euler: positive yaw turns forward towards left, positive pitch tips the nose down', () => {
  close(apply(eulerToMatrix([0, 0, Math.PI / 2], 'ZYX'), [1, 0, 0]), [0, 1, 0]);
  close(apply(eulerToMatrix([0, Math.PI / 2, 0], 'ZYX'), [1, 0, 0]), [0, 0, -1]);
  close(apply(eulerToMatrix([Math.PI / 2, 0, 0], 'ZYX'), [0, 1, 0]), [0, 0, 1]);
});

test('rotation order matters once two axes rotate', () => {
  const angles = [0.3, 0.2, 1.1];
  assert.notDeepEqual(eulerToMatrix(angles, 'ZYX'), eulerToMatrix(angles, 'XYZ'));
});

test('axis mapping: default is identity, duplicates are rejected, mirrored mapping is left-handed', () => {
  assert.deepEqual(axisMatrix(['+F', '+L', '+U']), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.equal(axisMatrix(['+F', '-F', '+U']), null);
  const mirrored = axisMatrix(['+F', '-L', '+U']);
  const det = mirrored[0] * (mirrored[4] * mirrored[8] - mirrored[5] * mirrored[7]) - mirrored[1] * (mirrored[3] * mirrored[8] - mirrored[5] * mirrored[6]) + mirrored[2] * (mirrored[3] * mirrored[7] - mirrored[4] * mirrored[6]);
  assert.equal(det, -1);
});
