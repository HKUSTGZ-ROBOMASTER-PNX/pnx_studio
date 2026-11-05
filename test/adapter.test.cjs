'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { AdapterSession, decodeBatch, probeFamily, listTargets } = require('../electron/core/adapter.cjs');
const { resolveAdapter } = require('../electron/core/platform.cjs');

const ADAPTER = resolveAdapter(path.join(__dirname, '..'), null);

// Mirror of `write_batch` in native/crates/studio-adapter/src/protocol.rs (without the length prefix).
function encodeBatch(batch) {
  const parts = [];
  const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); parts.push(b); };
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); parts.push(b); };
  const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); parts.push(b); };
  const str = s => { u16(Buffer.byteLength(s)); parts.push(Buffer.from(s)); };
  parts.push(Buffer.from('CKIT')); u16(1); str(batch.sessionId);
  u64(batch.programGeneration); u64(batch.streamEpoch); u64(batch.batchSequence); u32(batch.sampleCount);
  u64(batch.startTimestampNs); u64(batch.samplePeriodNs); u64(batch.droppedFrames);
  u16(batch.channelIds.length); batch.channelIds.forEach(str);
  for (const v of batch.values) { const b = Buffer.alloc(8); b.writeDoubleLE(v); parts.push(b); }
  return Buffer.concat(parts);
}

test('decodeBatch reads the binary sample frame', () => {
  const batch = { sessionId: 's1', programGeneration: 1, streamEpoch: 2, batchSequence: 3, sampleCount: 2, startTimestampNs: 1000, samplePeriodNs: 500, droppedFrames: 0, channelIds: ['a', 'b'], values: [1, 2, 3, 4] };
  const decoded = decodeBatch(encodeBatch(batch));
  assert.deepEqual(decoded.channelIds, ['a', 'b']);
  assert.equal(decoded.sampleCount, 2);
  assert.deepEqual([...decoded.values], [1, 2, 3, 4]);
  assert.ok(decoded.values instanceof Float64Array);
});

test('decodeBatch rejects truncated and foreign frames', () => {
  const good = encodeBatch({ sessionId: 's', programGeneration: 0, streamEpoch: 0, batchSequence: 0, sampleCount: 1, startTimestampNs: 0, samplePeriodNs: 1, droppedFrames: 0, channelIds: ['x'], values: [1] });
  assert.throws(() => decodeBatch(good.subarray(0, good.length - 3)), /Truncated/);
  const foreign = Buffer.from(good); foreign.write('XXXX', 0);
  assert.throws(() => decodeBatch(foreign), /magic/);
});

test('probeFamily classifies common probes', () => {
  assert.equal(probeFamily({ probeType: 'CmsisDap', identifier: 'DAPLink CMSIS-DAP' }), 'CMSIS-DAP');
  assert.equal(probeFamily({ probeType: 'StLink', identifier: 'STLink V3' }), 'ST-Link');
  assert.equal(probeFamily({ probeType: 'JLink', identifier: 'J-Link' }), 'J-Link');
});

test('mock adapter: connect, sample, step, registers, memory', { skip: !ADAPTER && 'studio-adapter not built', timeout: 30000 }, async () => {
  const session = new AdapterSession(ADAPTER);
  const dap = [];
  session.on('dap', message => dap.push(message.event));
  try {
    const { catalog, state } = await session.start({ mock: true, mode: 'attach' });
    assert.ok(catalog.length > 0, 'mock catalog is populated');
    assert.ok(state.targetState, 'state is reported');

    const batches = [];
    session.on('samples', batch => batches.push(batch));
    await session.subscribe(['mock.sine', 'mock.ramp'], 1000);
    await session.debug('continue');
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.ok(batches.length > 0, 'sample batches arrive over the data channel');
    assert.deepEqual([...new Set(batches.flatMap(batch => batch.channelIds))].sort(), ['mock.ramp', 'mock.sine']);

    await session.debug('pause');
    const before = (await session.request('studio/coreRegisters')).registers.find(r => r.name === 'PC').value;
    await session.debug('next');
    const after = (await session.request('studio/coreRegisters')).registers.find(r => r.name === 'PC').value;
    assert.notEqual(before, after, 'step advances PC');
    assert.ok(dap.includes('stopped'), 'stopped event emitted');

    const memory = await session.request('readMemory', { memoryReference: '0x20010000', count: 64 });
    assert.ok(Buffer.from(memory.data, 'base64').some(byte => byte !== 0), 'frame buffer readable');

    const regs = await session.request('studio/readRegisters', { registers: [{ id: 'x', address: '0x20010000', sizeBits: 32 }] });
    assert.equal(regs.values.length, 1);

    await session.request('studio/writeValue', { id: 'mock.ramp', value: '12.5' });
    const values = await session.request('studio/readValues', { ids: ['mock.ramp'] });
    assert.equal(values.values[0].value, 12.5);
  } finally {
    await session.stop();
  }
});

test('adapter lists targets', { skip: !ADAPTER && 'studio-adapter not built', timeout: 30000 }, async () => {
  const targets = await listTargets(ADAPTER);
  assert.ok(targets.some(name => /^STM32F4/.test(name)), 'STM32F4 family present');
});
