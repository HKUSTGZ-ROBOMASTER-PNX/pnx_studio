'use strict';
// CSV Recorder — example main-process plugin half.
// Subscribes to raw sample batches from the core and appends them to a file stream,
// so recordings of any length never pass through the window. `start` takes an
// optional fixed column list ({ id, label }); without one, every sampled channel
// in the first batch becomes a column.
const fs = require('node:fs');
const path = require('node:path');

let stream = null;
let state = { recording: false, file: null, rows: 0, columns: [] };
let columnIndex = new Map();
let t0 = null;

const csvCell = text => (/[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
function header(labels) { return `time_s,${labels.map(csvCell).join(',')}\n`; }

exports.activate = context => {
  const publish = () => context.postMessage({ type: 'state', state });

  context.commands.register('start', async ({ file, columns } = {}) => {
    if (stream) throw new Error('Already recording');
    const target = file || path.join(context.storagePath, `recording-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    stream = fs.createWriteStream(target);
    state = { recording: true, file: target, rows: 0, columns: [], fixed: Array.isArray(columns) && columns.length > 0 };
    columnIndex = new Map();
    t0 = null;
    if (state.fixed) {
      state.columns = columns.map(column => String(column.id));
      state.columns.forEach((id, index) => columnIndex.set(id, index));
      stream.write(header(columns.map(column => String(column.label || column.id))));
    }
    context.log(`recording to ${target}`);
    publish();
    return state;
  });

  context.commands.register('stop', async () => {
    if (!stream) return state;
    await new Promise(resolve => stream.end(resolve));
    stream = null;
    state = { ...state, recording: false };
    context.log(`stopped, ${state.rows} rows written`);
    publish();
    return state;
  });

  context.commands.register('state', () => state);

  context.core.on('samples', batch => {
    if (!stream) return;
    // The first batch fixes the column set; later channels are ignored to keep the CSV rectangular.
    if (!state.fixed && !state.columns.length) {
      state.columns = [...batch.channelIds];
      state.columns.forEach((id, index) => columnIndex.set(id, index));
      stream.write(header(state.columns));
    }
    if (t0 === null) t0 = batch.startTimestampNs;
    const count = batch.channelIds.length;
    // Batches can carry other consumers' channels; skip those without any recorded column.
    if (state.fixed && !batch.channelIds.some(id => columnIndex.has(id))) return;
    let chunk = '';
    for (let s = 0; s < batch.sampleCount; s++) {
      const row = new Array(state.columns.length).fill('');
      for (let c = 0; c < count; c++) {
        const index = columnIndex.get(batch.channelIds[c]);
        if (index !== undefined) row[index] = batch.values[s * count + c];
      }
      chunk += `${((batch.startTimestampNs - t0 + s * batch.samplePeriodNs) / 1e9).toFixed(9)},${row.join(',')}\n`;
    }
    stream.write(chunk);
    state.rows += batch.sampleCount;
  });

  context.core.on('disconnected', () => { if (stream) context.log('target disconnected; recording continues when it reconnects'); });

  const ticker = setInterval(() => { if (stream) publish(); }, 1000);
  context.subscriptions.push(() => clearInterval(ticker));
};

exports.deactivate = async () => {
  if (stream) await new Promise(resolve => stream.end(resolve));
  stream = null;
};
