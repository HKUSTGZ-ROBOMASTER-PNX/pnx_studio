import test from 'node:test';
import assert from 'node:assert/strict';
import { channelsToCsv } from '../renderer/js/lib/csv.js';

const channel = samples => ({ length: samples.length, time: i => samples[i][0], value: i => samples[i][1] });

test('channels merge on one time column; gaps stay blank', () => {
  const csv = channelsToCsv([
    { label: 'a', channel: channel([[0, 1], [0.001, 2], [0.002, 3]]) },
    { label: 'b', channel: channel([[0.001, 20], [0.003, 40]]) }, // added later, sampled once more
  ]);
  assert.equal(csv, 'time_s,a,b\n0.000000000,1,\n0.001000000,2,20\n0.002000000,3,\n0.003000000,,40\n');
});

test('empty channels give only the header', () => {
  assert.equal(channelsToCsv([{ label: 'x', channel: channel([]) }]), 'time_s,x\n');
});
