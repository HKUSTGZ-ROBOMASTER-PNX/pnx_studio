'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const boards = ['h723_mc02', 'f407_cboard'];
const resourceFields = { ui_uart: 'usart', dr16_uart: 'usart', vt03_uart: 'usart', referee_uart: 'usart', rfid_uart: 'usart', ps2_cs: 'gpio', ps2_spi: 'spi', buzzer_timer: 'pwm', dmimu_can: 'can' };
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

function fileWithin(root, relative) {
  const actual = fs.realpathSync(path.join(root, relative));
  const rel = path.relative(root, actual);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error(`Path outside workspace: ${relative}`);
  return actual;
}
function workspace(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Open a template workspace first');
  return fs.realpathSync(root);
}
function readProject(root) {
  root = workspace(root);
  let configPath;
  try { configPath = fileWithin(root, 'configs/user_config.json'); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('This workspace does not contain configs/user_config.json'); throw error; }
  const text = fs.readFileSync(configPath, 'utf8');
  let config;
  try { config = JSON.parse(text); } catch (error) { throw new Error(`Invalid configs/user_config.json: ${error.message}`); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Configuration must be a JSON object');
  const resources = {};
  const details = {};
  for (const board of boards) {
    const source = fs.readFileSync(fileWithin(root, `boards/wrapper/${board}/include/config.hpp`), 'utf8');
    const choices = { spi: ['none'], usart: ['none'], gpio: ['none'], pwm: ['none'], can: board === 'h723_mc02' ? ['none', 'fdcan1', 'fdcan2', 'fdcan3'] : ['none', 'can1', 'can2'] };
    const definitions = {};
    for (const match of source.matchAll(/inline\s+constexpr\s+(spi|usart|gpio|pwm)::config\s+([a-z][a-z0-9_]*)\s*\{([^;]*)\}\s*;/g)) {
      choices[match[1]].push(match[2]);
      definitions[`${match[1]}:${match[2]}`] = match[3];
    }
    resources[board] = choices;
    details[board] = definitions;
  }
  return { root, configPath, text, config, revision: hash(text), resources, details };
}
function merge(oldValue, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = { ...(oldValue && typeof oldValue === 'object' && !Array.isArray(oldValue) ? oldValue : {}) };
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error('Invalid configuration key');
    result[key] = merge(result[key], item);
  }
  return result;
}
function validate(config, resources, details) {
  function get(key) { return key.split('.').reduce((value, part) => value?.[part], config); }
  function number(key, min, max, integer = false) {
    const value = get(key);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw new Error(`${key}: expected ${integer ? 'an integer' : 'a number'} in [${min}, ${max}]`);
    }
  }
  function bool(key) { if (typeof get(key) !== 'boolean') throw new Error(`${key}: expected a boolean`); }
  function vector(key) { const value = get(key); if (!Array.isArray(value) || value.length !== 3 || value.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < -100 || v > 100)) throw new Error(`${key}: expected three numbers in [-100, 100]`); }
  function check(condition, message) { if (!condition) throw new Error(message); }
  const int = (key, min, max) => number(key, min, max, true);
  const max = 2147483647;
  bool('usb.enabled'); int('ui.timeout_ms', 0, max);
  number('ps2.deadzone', 0, 1); check(get('ps2.deadzone') < 1, 'ps2.deadzone must be less than 1'); int('ps2.spi_timeout_ms', 1, max);
  for (const [key, min, limit] of [['address', 0, 255], ['block', 1, 62], ['baud', 1200, 1000000], ['priority', 1, 31], ['stack_size', 2048, 16384]]) int(`rfid.${key}`, min, limit);
  check(get('rfid.block') % 4 !== 3, 'rfid.block must be an ordinary S50 data block');
  for (const key of ['startup_ms', 'poll_ms', 'timeout_ms', 'recovery_ms', 'buzzer_period_us', 'buzzer_on_ms', 'buzzer_gap_ms']) int(`rfid.${key}`, 1, 60000);
  for (const section of ['referee', 'remoter']) {
    int(`${section}.stack_size`, section === 'referee' ? 2048 : 1024, 16384);
    int(`${section}.thread_priority`, 0, 31); int(`${section}.period_ticks`, 1, max); int(`${section}.offline_timeout_ms`, 1, max);
  }
  int('remoter.ps2_period_ms', 1, max);
  for (const key of ['can_id', 'master_id']) int(`dmimu.${key}`, 0, 255);
  for (const key of ['assembly_timeout_ms', 'offline_timeout_ms']) int(`dmimu.${key}`, 1, max);
  check(['active', 'request'].includes(get('dmimu.mode')), 'dmimu.mode must be active or request');
  check(get('dmimu.assembly_timeout_ms') <= get('dmimu.offline_timeout_ms'), 'dmimu assembly timeout must not exceed offline timeout');
  int('ahrs.thread_priority', 0, 31); int('ahrs.sample_period_ticks', 1, max); number('ahrs.max_dt', 0.000001, 1);
  for (const key of ['retry_period_ms', 'warmup_timeout_ms', 'dmimu_wait_ticks', 'dmimu_request_period_ms']) int(`ahrs.${key}`, 1, max);
  bool('ahrs.calibrate_on_start'); int('ahrs.dmimu_queue_frames', 4, 256); int('ahrs.bmi088_stack_size', 2048, 32768); int('ahrs.dmimu_stack_size', 1024, 16384);
  for (const key of ['period_ms', 'timeout_ms', 'stable_time_ms']) int(`bmi088_heater.${key}`, 1, 60000);
  int('bmi088_heater.thread_priority', 1, 31); int('bmi088_heater.stack_size', 1024, 16384); number('bmi088_heater.stable_tolerance', 0.01, 5);
  check(get('bmi088_heater.period_ms') === 125, 'bmi088_heater.period_ms must be 125');
  check(get('bmi088_heater.timeout_ms') > 125, 'bmi088_heater.timeout_ms must exceed period_ms');
  for (const key of ['gyro_noise', 'accel_noise', 'impact_jerk', 'static_accel_tolerance', 'static_gyro_tolerance', 'static_filter_time_constant', 'initial_tilt_stddev', 'initial_yaw_stddev', 'initial_bias_stddev', 'min_bias_stddev']) number(`ahrs.eskf.${key}`, 0.000000001, 10000);
  for (const key of ['gyro_bias_walk', 'accel_magnitude_gain', 'nis_gate', 'reject_timeout', 'impact_hold', 'zero_rate_min_time']) number(`ahrs.eskf.${key}`, 0, 10000);
  for (const key of ['ahrs.gyro_offset', 'ahrs.accel_offset', 'application.imu_offset']) vector(key);
  for (const board of boards) {
    const prefix = `boards.${board}`;
    const b = get(prefix);
    check(b && typeof b === 'object' && !Array.isArray(b), `${prefix}: expected an object`);
    for (const [field, type] of Object.entries(resourceFields)) check(resources[board][type].includes(b[field]), `${prefix}.${field}: unknown ${type} resource`);
    check(['none', 'bmi088', 'dmimu'].includes(b.ahrs_device), `${prefix}.ahrs_device: expected none, bmi088 or dmimu`);
    check(b.ahrs_device !== 'dmimu' || b.dmimu_can !== 'none', `${prefix}: DMIMU requires CAN`);
    for (const key of ['bmi088_heater_enabled', 'remoter_dr16_enabled', 'remoter_vt03_enabled', 'remoter_ps2_enabled']) bool(`${prefix}.${key}`);
    number(`${prefix}.bmi088_thermal.target`, 20, 60);
    for (const key of ['boost', 'reboost', 'approach_start', 'approach_end', 'hold_max']) number(`${prefix}.bmi088_thermal.${key}`, 0, 1);
    for (const key of ['kp', 'ki', 'kd']) number(`${prefix}.bmi088_thermal.${key}`, 0, 10000);
    number(`${prefix}.bmi088_thermal.max_out`, 0, 999); int(`${prefix}.buzzer_channel`, 1, 4);
    check(b.rfid_uart !== 'none' && b.buzzer_timer !== 'none', `${prefix}: RFID needs a UART and buzzer timer`);
    const timer = details[board][`pwm:${b.buzzer_timer}`] || '';
    const mask = /,\s*(0x[0-9a-f]+)U/i.exec(timer);
    check(mask && (parseInt(mask[1], 16) & (1 << (b.buzzer_channel - 1))), `${prefix}: buzzer timer channel is unavailable`);
    check(!((board === 'h723_mc02' && b.buzzer_timer === 'tim3') || (board === 'f407_cboard' && b.buzzer_timer === 'tim10' && b.bmi088_heater_enabled)), `${prefix}: buzzer conflicts with BMI088 heater timer`);
    check(!b.remoter_dr16_enabled || b.dr16_uart !== 'none', `${prefix}: DR16 requires a UART`);
    check(!b.remoter_vt03_enabled || b.vt03_uart !== 'none', `${prefix}: VT03 requires a UART`);
    check(!b.remoter_dr16_enabled || !b.remoter_vt03_enabled || b.dr16_uart !== b.vt03_uart, `${prefix}: DR16 and VT03 cannot share a UART`);
    check(!(b.remoter_dr16_enabled && b.referee_uart === b.dr16_uart) && !(b.remoter_vt03_enabled && b.referee_uart === b.vt03_uart), `${prefix}: referee and remoter cannot share RX`);
    check(!b.remoter_ps2_enabled || (b.ps2_cs !== 'none' && b.ps2_spi !== 'none'), `${prefix}: PS2 requires CS and SPI`);
    check(b.rfid_uart !== b.referee_uart && b.rfid_uart !== b.ui_uart && !(b.remoter_dr16_enabled && b.rfid_uart === b.dr16_uart) && !(b.remoter_vt03_enabled && b.rfid_uart === b.vt03_uart), `${prefix}: RFID UART conflicts with another device`);
    check(/\{\s*true\s*,/.test(details[board][`usart:${b.rfid_uart}`] || ''), `${prefix}: RFID UART requires RX DMA`);
  }
}
function result(project) { return { config: project.config, revision: project.revision, resources: project.resources }; }
function save({ root, config, revision } = {}) {
  const project = readProject(root);
  if (typeof revision !== 'string' || revision !== project.revision) throw new Error('Configuration changed on disk; reload before saving');
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Configuration must be a JSON object');
  const merged = merge(project.config, config);
  validate(merged, project.resources, project.details);
  const indent = /^([ \t]+)"/m.exec(project.text)?.[1] || '  ';
  const text = `${JSON.stringify(merged, null, indent)}\n`;
  if (text !== project.text) {
    // Keep the file mode and replace atomically; do not write through a path outside the workspace.
    const temp = path.join(path.dirname(project.configPath), `.user_config.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
      fs.writeFileSync(temp, text, { flag: 'wx', mode: fs.statSync(project.configPath).mode & 0o777 });
      if (hash(fs.readFileSync(project.configPath, 'utf8')) !== revision) throw new Error('Configuration changed on disk; reload before saving');
      fs.renameSync(temp, project.configPath);
    } finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
  return result(readProject(root));
}
exports.activate = context => {
  context.commands.register('load', ({ root } = {}) => result(readProject(root)));
  context.commands.register('save', save);
};
