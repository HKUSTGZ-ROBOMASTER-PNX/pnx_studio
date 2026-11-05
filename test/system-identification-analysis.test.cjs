'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { COLUMNS, parseRawCsv, identify } = require('../plugins/system-identification/analysis.cjs');

function simulated({ gain = -0.00017, T = 0.052, delay = 0.017, gap = false } = {}) {
  const dt = 0.001, n = 14000, shift = Math.round(delay / dt);
  const current = new Array(n).fill(0), speed = new Array(n).fill(0);
  let seed = 91821, filtered = 0;
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    filtered = filtered * 0.9 + (seed / 0xffffffff - 0.5) * 0.1;
    if (i >= 2000) current[i] = 10000 * filtered;
    if (i > 0) {
      const a = Math.exp(-dt / T);
      speed[i] = a * speed[i - 1] + gain * (1 - a) * current[Math.max(0, i - shift - 1)];
    }
  }
  return Array.from({ length: n }, (_, i) => ({ time_ms: i, yaw_pos_ref_rad: 0, yaw_pos_fdb_rad: 0,
    yaw_speed_fdb_rad_s: speed[i], yaw_current_cmd: current[i], yaw_current_saturated: i >= 3000 && i < 3010 ? 1 : 0 }))
    .filter(row => !gap || row.time_ms < 6000 || row.time_ms >= 6010);
}

test('raw CSV skips malformed rows, records gaps, and rejects invalid numeric data', () => {
  const result = parseRawCsv(`${COLUMNS.join(',')}\n2594,0,0,0.1,-125,0\n2595,0,0,0.2,-264,0\n2596,0,0,0,0,0,extra\n2601,0,0,0.3,-492,1\n`);
  assert.deepEqual(result.malformedRows, [4]);
  assert.deepEqual(result.gaps, [[2595, 2601]]);
  assert.deepEqual(result.samples.map(s => s.time_ms), [2594, 2595, 2601]);
  assert.throws(() => parseRawCsv(`${COLUMNS.join(',')}\n0,0,0,NaN,0,0`), /invalid number/);
  assert.throws(() => parseRawCsv(`${COLUMNS.join(',')}\n2,0,0,1,0,0\n1,0,0,1,0,0`), /monotonically/);
  assert.throws(() => parseRawCsv(`${COLUMNS.join(',')}\n2,0,0,1,0,0\n2,0,0,1,0,0`), /duplicate/);
  assert.throws(() => parseRawCsv('wrong,header\n1,2'), /Unexpected CSV columns/);
});

test('recovers negative gain, time constant and delay, and reports saturation and calibrated J/B', { timeout: 20000 }, () => {
  const samples = simulated({ gap: true });
  const { result, signals } = identify(samples, { T: 14, buffer_ratio: 1 / 7, pitch_rad: 0.1 }, { kTau: -0.00034, droppedSamples: 10 });
  assert.ok(Math.abs((result.K + 0.00017) / 0.00017) < 0.03, `gain ${result.K}`);
  assert.ok(Math.abs((result.T_s - 0.052) / 0.052) < 0.06, `time constant ${result.T_s}`);
  assert.ok(Math.abs(result.Td_s - 0.017) < 0.002, `delay ${result.Td_s}`);
  assert.ok(result.fit_percent > 99, `fit ${result.fit_percent}`);
  assert.equal(result.optimizer_success, true);
  assert.ok(result.quality_warnings.includes('Telemetry gaps affect the identification window; fitting restarts after each gap'));
  assert.ok(result.quality_warnings.includes('Firmware reported dropped samples'));
  assert.ok(result.fit_excluded_samples > 0);
  assert.ok(result.estimated_missing_samples >= 10);
  assert.equal(result.dropped_samples, 10);
  assert.equal(result.saturation_sample_count, 10);
  assert.ok(Math.abs(result.B - 2) < 0.06);
  assert.ok(Math.abs(result.J - 0.104) < 0.008);
  assert.equal(signals.time_s.length, result.fit_sample_count);
  assert.ok(!signals.time_s.some(t => t >= 6.01 && t <= 6.06), 'delay horizon after gap excluded');
});

test('rejects insufficient samples or absent excitation', { timeout: 20000 }, () => {
  const samples = simulated();
  assert.throws(() => identify(samples.slice(0, 100), { T: 14, buffer_ratio: 1 / 7 }), /too few samples/);
  for (const sample of samples) sample.yaw_current_cmd = 0;
  assert.throws(() => identify(samples, { T: 14, buffer_ratio: 1 / 7 }), /Insufficient current excitation/);
});

test('rejects excitation confined to baseline, duplicate timestamps and malformed metadata', () => {
  const samples = simulated();
  for (const sample of samples) sample.yaw_current_cmd = sample.time_ms < 2000 ? Math.sin(sample.time_ms / 20) * 1000 : 42;
  assert.throws(() => identify(samples, { T: 14, buffer_ratio: 1 / 7 }), /current excitation in identification window/);
  const duplicate = simulated();
  duplicate[2001].time_ms = duplicate[2000].time_ms;
  assert.throws(() => identify(duplicate, { T: 14, buffer_ratio: 1 / 7 }), /duplicate/);
  for (const metadata of [null, {}, { T: '14', buffer_ratio: 0.2 }, { T: 14, buffer_ratio: 1 }, { T: 14, buffer_ratio: 0.2, sample_period_ms: 0 }]) {
    assert.throws(() => identify(samples, metadata), /Invalid/);
  }
  assert.throws(() => identify(samples, { T: 14, buffer_ratio: 0.2 }, { kTau: '' }), /kTau/);
});

test('reports incomplete data, systematic dropped samples and a non-converged optimizer', { timeout: 20000 }, () => {
  const metadata = { T: 14, buffer_ratio: 1 / 7 };
  const samples = simulated();
  const incomplete = identify(samples.filter(sample => sample.time_ms < 8000), metadata, { maxIterations: 1 }).result;
  assert.equal(incomplete.optimizer_success, false);
  assert.ok(incomplete.quality_warnings.includes('Optimizer did not converge; parameters may be unreliable'));
  assert.ok(incomplete.identification_coverage_percent < 51);
  assert.ok(incomplete.quality_warnings.includes('Less than 90% of the identification window is covered by received samples'));
  const everyOther = identify(samples.filter(sample => sample.time_ms % 2 === 0), metadata).result;
  assert.ok(everyOther.identification_coverage_percent < 51);
  assert.ok(everyOther.quality_warnings.includes('Observed sample interval exceeds the expected V1 sample period'));
  assert.ok(everyOther.estimated_missing_samples > 6000);
});
