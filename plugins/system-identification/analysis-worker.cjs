'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const { parseRawCsv, identify } = require('./analysis.cjs');

try {
  const parsed = parseRawCsv(fs.readFileSync(workerData.file, 'utf8'));
  const fitted = identify(parsed.samples, workerData.metadata, { droppedSamples: workerData.droppedSamples, kTau: workerData.kTau });
  const signals = {};
  const indices = [];
  const length = fitted.signals.time_s.length;
  const step = Math.max(1, Math.ceil(length / 3000));
  for (let i = 0; i < length; i += step) indices.push(i);
  if (length && indices.at(-1) !== length - 1) indices.push(length - 1);
  for (const key of ['time_s', 'measured_speed_rad_s', 'model_speed_rad_s']) signals[key] = indices.map(i => fitted.signals[key][i]);
  const rawSamples = parsed.samples;
  // A 1 kHz V1 capture decimated by at most four retains >=250 Hz, above
  // twice the firmware's 50 Hz maximum excitation frequency.
  const rawStep = Math.max(1, Math.ceil(rawSamples.length / 12000));
  const rawIndices = [];
  for (let i = 0; i < rawSamples.length; i += rawStep) rawIndices.push(i);
  if (rawSamples.length && rawIndices.at(-1) !== rawSamples.length - 1) rawIndices.push(rawSamples.length - 1);
  const rawSignals = { time_s: rawIndices.map(i => rawSamples[i].time_ms / 1000) };
  for (const key of ['yaw_pos_ref_rad', 'yaw_pos_fdb_rad', 'yaw_speed_fdb_rad_s', 'yaw_current_cmd', 'yaw_current_saturated']) {
    rawSignals[key] = rawIndices.map(i => rawSamples[i][key]);
  }
  const summary = { ...fitted.result, malformed_rows: parsed.malformedRows?.length || 0, sample_gaps: parsed.gaps?.length || 0 };
  parentPort.postMessage({ ok: true, result: { summary, signals, rawSignals } });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.message || String(error) });
}
