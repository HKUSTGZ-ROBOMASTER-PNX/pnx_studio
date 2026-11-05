'use strict';

// Independent implementation of the first-order-plus-delay model described by
// auto_system_identification/gimbal_auto_id. Input is the V1 telemetry format.
const COLUMNS = ['time_ms', 'yaw_pos_ref_rad', 'yaw_pos_fdb_rad', 'yaw_speed_fdb_rad_s', 'yaw_current_cmd', 'yaw_current_saturated'];
const MAX_DELAY = 0.05;
const MAX_TIME_CONSTANT = 5;

function csvFields(line) {
  const fields = [];
  let value = '', quoted = false, closed = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else value += char;
    } else if (char === ',') { fields.push(value); value = ''; closed = false; }
    else if (char === '"' && value === '' && !closed) quoted = true;
    else if (closed) return null;
    else value += char;
  }
  if (quoted) return null;
  fields.push(value);
  return fields;
}
function parseRawCsv(text) {
  if (typeof text !== 'string') throw new Error('CSV must be text');
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const header = csvFields(lines.shift() || '');
  if (!header || header.length !== COLUMNS.length || header.some((value, i) => value !== COLUMNS[i])) {
    throw new Error(`Unexpected CSV columns; expected ${COLUMNS.join(',')}`);
  }
  const samples = [], malformedRows = [], gaps = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i] && i === lines.length - 1) continue;
    const fields = csvFields(lines[i]);
    if (!fields || fields.length !== COLUMNS.length) { malformedRows.push(i + 2); continue; }
    const values = fields.map(value => value.trim() === '' ? NaN : Number(value));
    if (values.some(value => !Number.isFinite(value))) throw new Error(`CSV line ${i + 2} contains a non-finite or invalid number`);
    if (samples.length) {
      const previous = samples[samples.length - 1].time_ms;
      if (values[0] <= previous) throw new Error(`CSV line ${i + 2}: time_ms must be strictly monotonically increasing (duplicate or reversed timestamp)`);
      if (values[0] - previous > 1) gaps.push([previous, values[0]]);
    }
    samples.push(Object.fromEntries(COLUMNS.map((column, index) => [column, values[index]])));
  }
  if (!samples.length) throw new Error('CSV contains no valid samples');
  return { samples, malformedRows, gaps };
}

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }

// Bounded Nelder-Mead with logarithmic time constant and normalized delay.
// Gain is solved exactly by least squares for each candidate (variable projection).
function optimize(evaluate, lowerT, maxIterations = 160) {
  const lo = Math.log(lowerT), hi = Math.log(MAX_TIME_CONSTANT);
  const normalize = p => [clamp(p[0], lo, hi), clamp(p[1], 0, 1)];
  let evaluations = 0;
  const evalPoint = p => { p = normalize(p); evaluations++; return { p, loss: evaluate(Math.exp(p[0]), p[1] * MAX_DELAY).loss }; };
  const grid = [];
  for (const T of [lowerT, 0.01, 0.05, 0.15, 0.5, 1, 5]) for (const d of [0, 0.25, 0.5, 0.75, 1]) grid.push(evalPoint([Math.log(Math.max(T, lowerT)), d]));
  grid.sort((a, b) => a.loss - b.loss);
  if (!Number.isFinite(grid[0].loss)) return { loss: Infinity, converged: false, evaluations };
  // Several starts guard against local minima caused by interpolated delays.
  const starts = [];
  for (const point of grid) {
    if (starts.every(x => Math.abs(x.p[0] - point.p[0]) > 0.35 || Math.abs(x.p[1] - point.p[1]) > 0.15)) starts.push(point);
    if (starts.length === 3) break;
  }
  let best = null;
  for (const start of starts) {
    const tStep = start.p[0] > hi - 0.2 ? -0.2 : 0.2;
    const simplex = [start, evalPoint([start.p[0] + tStep, start.p[1]]), evalPoint([start.p[0], start.p[1] + (start.p[1] > 0.9 ? -0.1 : 0.1)])];
    let converged = false, iterations = 0;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      iterations = iteration + 1;
      simplex.sort((a, b) => a.loss - b.loss);
      if (simplex.slice(1).every(point => Math.abs(point.p[0] - simplex[0].p[0]) < 1e-7 && Math.abs(point.p[1] - simplex[0].p[1]) < 1e-7)) { converged = true; break; }
      const mid = [(simplex[0].p[0] + simplex[1].p[0]) / 2, (simplex[0].p[1] + simplex[1].p[1]) / 2];
      const reflect = evalPoint([2 * mid[0] - simplex[2].p[0], 2 * mid[1] - simplex[2].p[1]]);
      if (reflect.loss < simplex[0].loss) {
        const expand = evalPoint([mid[0] + 2 * (reflect.p[0] - mid[0]), mid[1] + 2 * (reflect.p[1] - mid[1])]);
        simplex[2] = expand.loss < reflect.loss ? expand : reflect;
      } else if (reflect.loss < simplex[1].loss) simplex[2] = reflect;
      else {
        const point = reflect.loss < simplex[2].loss ? reflect.p : simplex[2].p;
        const contract = evalPoint([mid[0] + 0.5 * (point[0] - mid[0]), mid[1] + 0.5 * (point[1] - mid[1])]);
        if (contract.loss < Math.min(reflect.loss, simplex[2].loss)) simplex[2] = contract;
        else for (let i = 1; i < 3; i++) simplex[i] = evalPoint([(simplex[0].p[0] + simplex[i].p[0]) / 2, (simplex[0].p[1] + simplex[i].p[1]) / 2]);
      }
    }
    simplex.sort((a, b) => a.loss - b.loss);
    if (!best || simplex[0].loss < best.loss) best = { ...simplex[0], converged, iterations };
  }
  return { T: Math.exp(best.p[0]), delay: best.p[1] * MAX_DELAY, loss: best.loss, converged: best.converged, iterations: best.iterations, evaluations };
}

function identify(samples, metadata = { T: 40, buffer_ratio: 0.2, pitch_rad: 0 }, options = {}) {
  if (!Array.isArray(samples) || !samples.length) throw new Error('No samples to identify');
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid metadata or options');
  const duration = metadata.T, ratio = metadata.buffer_ratio, pitch = metadata.pitch_rad ?? 0;
  const nominalPeriodMs = metadata.sample_period_ms ?? 1; // The V1 firmware emits a sample every millisecond.
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(ratio) || ratio <= 0 || ratio >= 1 || !Number.isFinite(pitch) || !Number.isFinite(nominalPeriodMs) || nominalPeriodMs <= 0) throw new Error('Invalid experiment duration, baseline ratio, pitch or sample period');
  const kTau = options.kTau == null ? null : options.kTau;
  if (kTau !== null && !Number.isFinite(kTau)) throw new Error('kTau must be finite');
  if (options.droppedSamples != null && (!Number.isInteger(options.droppedSamples) || options.droppedSamples < 0)) throw new Error('droppedSamples must be a non-negative integer or null');
  const maxIterations = options.maxIterations ?? 160;
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10000) throw new Error('maxIterations must be an integer between 1 and 10000');
  const times = [], current = [], speed = [], saturated = [], steps = [], baselineSpeed = [], baselineCurrent = [];
  let identificationCount = 0, identificationSaturated = 0, fullSaturated = 0;
  for (const sample of samples) {
    if (COLUMNS.some(column => typeof sample[column] !== 'number' || !Number.isFinite(sample[column]))) throw new Error('Samples contain invalid numeric values');
    const t = sample.time_ms / 1000;
    if (times.length && t <= times[times.length - 1]) throw new Error('time_ms must be strictly monotonically increasing (duplicate or reversed timestamp)');
    if (times.length && t > times[times.length - 1]) steps.push(t - times[times.length - 1]);
    times.push(t); current.push(sample.yaw_current_cmd); speed.push(sample.yaw_speed_fdb_rad_s);
    const sat = sample.yaw_current_saturated !== 0; saturated.push(sat); if (sat) fullSaturated++;
    if (t >= 0 && t < duration * ratio) { baselineSpeed.push(sample.yaw_speed_fdb_rad_s); baselineCurrent.push(sample.yaw_current_cmd); }
    if (t >= duration * ratio && t < duration) { identificationCount++; if (sat) identificationSaturated++; }
  }
  if (baselineSpeed.length < 2) throw new Error('Baseline region contains fewer than two samples');
  if (identificationCount < 100) throw new Error('Identification region contains too few samples');
  if (!steps.length) throw new Error('Identification timestamps do not advance');
  steps.sort((a, b) => a - b);
  const middle = Math.floor(steps.length / 2);
  const dt = steps.length % 2 ? steps[middle] : (steps[middle - 1] + steps[middle]) / 2;
  const lowerT = Math.max(1e-5, dt / 10);
  if (lowerT > MAX_TIME_CONSTANT) throw new Error('Sampling interval too large');
  // Exclude the delay horizon after gaps; never simulate across a gap.
  const fit = [], cutoff = duration * ratio;
  let gaps = 0, nominalGaps = 0, estimatedMissing = 0, gapsInIdentification = 0;
  let excludedUntil = -Infinity;
  for (let i = 0; i < times.length; i++) {
    const step = i ? times[i] - times[i - 1] : 0;
    if (i && step > 1.5 * nominalPeriodMs / 1000) {
      nominalGaps++;
      estimatedMissing += Math.max(1, Math.round(step * 1000 / nominalPeriodMs) - 1);
    }
    if (i && step > 1.5 * dt) {
      excludedUntil = times[i] + MAX_DELAY;
      gaps++;
      if (times[i] > cutoff && times[i - 1] < duration) gapsInIdentification++;
    }
    if (times[i] >= cutoff && times[i] < duration && times[i] > excludedUntil) fit.push(i);
  }
  if (fit.length < 100) throw new Error('Too few valid samples remain after telemetry gaps');
  const fitTime = fit.map(i => times[i]), fitSpeed = fit.map(i => speed[i]);
  const segments = fit.map((index, j) => j === 0 || times[index] - times[fit[j - 1]] > 1.5 * dt);
  let minimumCurrent = Infinity, maximumCurrent = -Infinity;
  for (const index of fit) { const value = current[index]; minimumCurrent = Math.min(minimumCurrent, value); maximumCurrent = Math.max(maximumCurrent, value); }
  const inputSpan = maximumCurrent - minimumCurrent;
  if (!Number.isFinite(inputSpan) || inputSpan <= Number.EPSILON * Math.max(1, Math.abs(minimumCurrent), Math.abs(maximumCurrent)) * 32) throw new Error('Insufficient current excitation in identification window');
  const average = mean(fitSpeed), variance = fitSpeed.reduce((sum, value) => sum + (value - average) ** 2, 0);
  if (variance <= Number.EPSILON) throw new Error('Insufficient speed response for identification');
  function model(T, delay, withSignals = false) {
    const delayed = new Float64Array(fit.length);
    let cursor = 0;
    for (let j = 0; j < fit.length; j++) {
      const query = fitTime[j] - delay;
      while (cursor + 1 < times.length && times[cursor + 1] <= query) cursor++;
      if (query <= times[0]) delayed[j] = current[0];
      else if (cursor + 1 >= times.length) delayed[j] = current[times.length - 1];
      else { const span = times[cursor + 1] - times[cursor]; delayed[j] = span <= 0 ? current[cursor + 1] : current[cursor] + (current[cursor + 1] - current[cursor]) * (query - times[cursor]) / span; }
    }
    const free = new Float64Array(fit.length), response = new Float64Array(fit.length);
    let numerator = 0, denominator = 0;
    for (let j = 0; j < fit.length; j++) {
      if (segments[j]) free[j] = fitSpeed[j];
      else {
        const pole = Math.exp(-(fitTime[j] - fitTime[j - 1]) / T);
        free[j] = pole * free[j - 1];
        response[j] = pole * response[j - 1] + (1 - pole) * delayed[j - 1];
      }
      numerator += response[j] * (fitSpeed[j] - free[j]); denominator += response[j] * response[j];
    }
    if (denominator <= 1e-24) return { loss: Infinity, gain: 0 };
    const gain = numerator / denominator;
    let loss = 0;
    const prediction = withSignals ? new Array(fit.length) : null;
    for (let j = 0; j < fit.length; j++) { const y = free[j] + gain * response[j]; const error = fitSpeed[j] - y; loss += error * error; if (prediction) prediction[j] = y; }
    return { loss, gain, prediction };
  }
  const optimum = optimize(model, lowerT, maxIterations);
  if (!Number.isFinite(optimum.loss)) throw new Error('Insufficient current excitation for identification');
  const modeled = model(optimum.T, optimum.delay, true), K = modeled.gain;
  const fitPercent = variance > Number.EPSILON ? 100 * (1 - Math.sqrt(modeled.loss / variance)) : null;
  const B = kTau === null || Math.abs(K) <= Number.EPSILON ? null : kTau / K;
  const baselineMean = mean(baselineSpeed);
  const expectedCount = duration * (1 - ratio) * 1000 / nominalPeriodMs;
  const coverage = Math.min(100, 100 * identificationCount / expectedCount);
  const qualityWarnings = [];
  if (!optimum.converged) qualityWarnings.push('Optimizer did not converge; parameters may be unreliable');
  if (coverage < 90) qualityWarnings.push('Less than 90% of the identification window is covered by received samples');
  if (dt * 1000 > 1.5 * nominalPeriodMs) qualityWarnings.push('Observed sample interval exceeds the expected V1 sample period');
  if (gapsInIdentification) qualityWarnings.push('Telemetry gaps affect the identification window; fitting restarts after each gap');
  if (options.droppedSamples > 0) qualityWarnings.push('Firmware reported dropped samples');
  if (optimum.delay >= MAX_DELAY - 1e-6) qualityWarnings.push('Delay reached the 50 ms search limit');
  if (optimum.T >= MAX_TIME_CONSTANT - 1e-5 || optimum.T <= lowerT * (1 + 1e-5)) qualityWarnings.push('Time constant reached a search limit');
  return {
    result: { pitch_rad: pitch, K, T_s: optimum.T, Td_s: optimum.delay, fit_percent: fitPercent,
      rmse: Math.sqrt(modeled.loss / fit.length), J: B === null ? null : optimum.T * B, B,
      sample_count: samples.length, identification_sample_count: identificationCount,
      dropped_samples: options.droppedSamples ?? null, saturation_sample_count: identificationSaturated,
      saturation_ratio_percent: 100 * identificationSaturated / identificationCount,
      full_run_saturation_sample_count: fullSaturated, full_run_saturation_ratio_percent: 100 * fullSaturated / samples.length,
      baseline_speed_mean_rad_s: baselineMean, baseline_speed_std_rad_s: Math.sqrt(mean(baselineSpeed.map(x => (x - baselineMean) ** 2))),
      baseline_current_mean: mean(baselineCurrent), optimizer_success: optimum.converged,
      optimizer_message: optimum.converged ? 'Bounded variable-projection least squares converged' : 'Iteration limit reached without convergence',
      optimizer_iterations: optimum.iterations, optimizer_evaluations: optimum.evaluations,
      fit_sample_count: fit.length, fit_excluded_samples: identificationCount - fit.length,
      identification_coverage_percent: coverage, expected_sample_period_ms: nominalPeriodMs, observed_sample_period_ms: dt * 1000,
      sample_gap_count: gaps, nominal_gap_count: nominalGaps, identification_gap_count: gapsInIdentification,
      estimated_missing_samples: estimatedMissing, quality_warnings: qualityWarnings },
    signals: { time_s: fitTime, measured_speed_rad_s: fitSpeed, model_speed_rad_s: modeled.prediction },
  };
}

module.exports = { COLUMNS, parseRawCsv, identify };
