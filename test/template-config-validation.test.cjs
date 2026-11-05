'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const plugin = require('../plugins/pnx-template/main.cjs');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/template-config/user_config.json'), 'utf8'));
const header = {
  h723_mc02: `
inline constexpr usart::config uart5{usart::handle::uart5, {true, false}};
inline constexpr usart::config uart7{usart::handle::uart7, {true, true}};
inline constexpr usart::config uart4{usart::handle::uart4, {false, true}};
inline constexpr usart::config usart1{usart::handle::usart1, {true, true}};
inline constexpr usart::config usart10{usart::handle::usart10, {true, false}};
inline constexpr spi::config spi1{spi::handle::spi1, {false, false}, true};
inline constexpr gpio::config ps2_cs{gpio::port::e, 15, active_level::low};
inline constexpr pwm::config tim3{260000000U, pwm::handle::tim3, 0x08U};
inline constexpr pwm::config tim12{260000000U, pwm::handle::tim12, 0x02U};
`,
  f407_cboard: `
inline constexpr usart::config usart1{usart::handle::usart1, {true, true}};
inline constexpr usart::config usart2{usart::handle::usart2, {true, true}};
inline constexpr usart::config usart3{usart::handle::usart3, {true, false}};
inline constexpr usart::config usart6{usart::handle::usart6, {true, true}};
inline constexpr spi::config spi1{spi::handle::spi1, {true, true}, false};
inline constexpr gpio::config pc8{gpio::port::c, 8};
inline constexpr pwm::config tim4{84000000U, pwm::handle::tim4, 0x04U};
inline constexpr pwm::config tim10{168000000U, pwm::handle::tim10, 0x01U};
`,
};

function project(t, config = fixture, resources = header) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pnx-template-validation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'configs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'configs/user_config.json'), JSON.stringify(config, null, 2) + '\n');
  for (const [board, contents] of Object.entries(resources)) {
    const directory = path.join(root, 'boards/wrapper', board, 'include');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'config.hpp'), contents);
  }
  const commands = {};
  plugin.activate({ commands: { register(name, fn) { commands[name] = fn; } } });
  return { root, commands };
}
function set(config, dotted, value) {
  const parts = dotted.split('.');
  const key = parts.pop();
  const obj = parts.reduce((parent, part) => parent[part], config);
  obj[key] = value;
}

test('template configuration is accepted and unknown fields survive a save', t => {
  const config = structuredClone(fixture);
  config.application.custom = { value: 'keep' };
  const { root, commands } = project(t, config);
  const loaded = commands.load({ root });
  const saved = commands.save({ root, revision: loaded.revision, config: { ui: { timeout_ms: 200 } } });
  assert.equal(saved.config.ui.timeout_ms, 200);
  assert.deepEqual(saved.config.application.custom, { value: 'keep' });
  assert.deepEqual(saved.config.boards, config.boards);
});

test('invalid scalar values, vectors and conflicting board assignments cannot be saved', t => {
  const { root, commands } = project(t);
  const original = commands.load({ root });
  const cases = [
    ['usb.enabled', 1], ['ui.timeout_ms', -1], ['ps2.deadzone', 1], ['ps2.spi_timeout_ms', 0],
    ['rfid.address', 256], ['rfid.block', 3], ['rfid.baud', 1199], ['rfid.stack_size', 1024],
    ['rfid.poll_ms', 0], ['referee.thread_priority', 32], ['remoter.stack_size', 1023],
    ['dmimu.can_id', 256], ['dmimu.mode', 'other'], ['dmimu.assembly_timeout_ms', 101],
    ['ahrs.max_dt', 0], ['ahrs.dmimu_queue_frames', 3], ['ahrs.calibrate_on_start', 'false'],
    ['ahrs.eskf.gyro_noise', 0], ['ahrs.eskf.nis_gate', -1], ['ahrs.gyro_offset', [0, 0]],
    ['ahrs.accel_offset', [0, 101, 0]], ['application.imu_offset', [0, '0', 0]],
    ['bmi088_heater.period_ms', 126], ['bmi088_heater.timeout_ms', 125], ['bmi088_heater.stable_tolerance', 0],
    ['boards.h723_mc02.ui_uart', 'does_not_exist'], ['boards.h723_mc02.dmimu_can', 'can1'],
    ['boards.h723_mc02.ahrs_device', 'other'], ['boards.h723_mc02.bmi088_thermal.target', 61],
    ['boards.h723_mc02.bmi088_thermal.boost', 1.1], ['boards.h723_mc02.buzzer_channel', 1],
    ['boards.h723_mc02.buzzer_timer', 'tim3'], ['boards.h723_mc02.remoter_dr16_enabled', 'true'],
    ['boards.h723_mc02.dr16_uart', 'none'], ['boards.h723_mc02.vt03_uart', 'uart5'],
    ['boards.h723_mc02.referee_uart', 'uart5'], ['boards.h723_mc02.ps2_spi', 'none'],
    ['boards.h723_mc02.rfid_uart', 'usart1'], ['boards.h723_mc02.rfid_uart', 'uart4'],
    ['boards.f407_cboard.rfid_uart', 'none'],
  ];
  for (const [field, value] of cases) {
    const config = structuredClone(original.config);
    set(config, field, value);
    assert.throws(() => commands.save({ root, revision: original.revision, config }), undefined, `${field}: ${JSON.stringify(value)} should be rejected`);
    assert.equal(commands.load({ root }).revision, original.revision, `${field} changed the file despite validation failure`);
  }
  const noCan = structuredClone(original.config);
  noCan.boards.h723_mc02.ahrs_device = 'dmimu';
  noCan.boards.h723_mc02.dmimu_can = 'none';
  assert.throws(() => commands.save({ root, revision: original.revision, config: noCan }), /DMIMU/);
  const heaterConflict = structuredClone(original.config);
  heaterConflict.boards.f407_cboard.buzzer_timer = 'tim10';
  heaterConflict.boards.f407_cboard.buzzer_channel = 1;
  heaterConflict.boards.f407_cboard.bmi088_heater_enabled = true;
  assert.throws(() => commands.save({ root, revision: original.revision, config: heaterConflict }), /heater timer/);
});

test('stale revisions are rejected without overwriting external edits', t => {
  const { root, commands } = project(t);
  const initial = commands.load({ root });
  const file = path.join(root, 'configs/user_config.json');
  const external = structuredClone(initial.config);
  external.ui.timeout_ms = 123;
  fs.writeFileSync(file, JSON.stringify(external));
  assert.throws(() => commands.save({ root, revision: initial.revision, config: { ui: { timeout_ms: 999 } } }), /changed on disk/);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).ui.timeout_ms, 123);
});

