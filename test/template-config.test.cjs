'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const plugin = require('../plugins/pnx-template/main.cjs');
const original = fs.readFileSync(path.join(__dirname, 'fixtures/template-config/user_config.json'), 'utf8');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-template-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'configs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'configs/user_config.json'), original);
  const declarations = {
    h723_mc02: `
inline constexpr spi::config spi1{spi::handle::spi1, {false, false}, true};
inline constexpr usart::config usart1{usart::handle::usart1, {true, true}};
inline constexpr usart::config uart5{usart::handle::uart5, {true, false}};
inline constexpr usart::config uart7{usart::handle::uart7, {true, true}};
inline constexpr usart::config usart10{usart::handle::usart10, {true, false}};
inline constexpr pwm::config tim12{260000000U, pwm::handle::tim12, 0x02U};
inline constexpr gpio::config ps2_cs{gpio::port::e, 15, active_level::low};`,
    f407_cboard: `
inline constexpr spi::config spi1{spi::handle::spi1, {true, true}, false};
inline constexpr usart::config usart1{usart::handle::usart1, {true, true}};
inline constexpr usart::config usart3{usart::handle::usart3, {true, false}};
inline constexpr usart::config usart6{usart::handle::usart6, {true, true}};
inline constexpr pwm::config tim4{84000000U, pwm::handle::tim4, 0x04U};`
  };
  for (const [board, text] of Object.entries(declarations)) {
    const directory = path.join(root, 'boards/wrapper', board, 'include');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'config.hpp'), text);
  }
  const handlers = {};
  plugin.activate({ commands: { register(name, handler) { handlers[name] = handler; } } });
  return { root, ...handlers, file: path.join(root, 'configs/user_config.json') };
}

test('load exposes current template and board resource choices; save preserves unknown fields', t => {
  const f = fixture(t);
  const first = f.load({ root: f.root });
  assert.equal(first.config.boards.h723_mc02.ahrs_device, 'bmi088');
  assert.deepEqual(first.resources.h723_mc02.spi, ['none', 'spi1']);
  assert.ok(first.resources.f407_cboard.can.includes('can2'));
  const extended = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  extended.custom_extension = { keep: 123 };
  fs.writeFileSync(f.file, JSON.stringify(extended));
  const fresh = f.load({ root: f.root });
  const partial = { ui: { timeout_ms: 250 } };
  const saved = f.save({ root: f.root, config: partial, revision: fresh.revision });
  assert.equal(saved.config.ui.timeout_ms, 250);
  assert.deepEqual(saved.config.custom_extension, { keep: 123 });
  assert.notEqual(saved.revision, fresh.revision);
});

test('save rejects disk changes and leaves file untouched', t => {
  const f = fixture(t);
  const first = f.load({ root: f.root });
  fs.appendFileSync(f.file, ' ');
  assert.throws(() => f.save({ root: f.root, config: first.config, revision: first.revision }), /changed on disk/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), `${original} `);
});

test('save rejects invalid ranges and conflicting board resources without writing', t => {
  const f = fixture(t);
  const first = f.load({ root: f.root });
  first.config.dmimu.assembly_timeout_ms = first.config.dmimu.offline_timeout_ms + 1;
  assert.throws(() => f.save({ root: f.root, config: first.config, revision: first.revision }), /assembly timeout/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), original);
  first.config.dmimu.assembly_timeout_ms = 20;
  first.config.boards.h723_mc02.buzzer_channel = 1;
  assert.throws(() => f.save({ root: f.root, config: first.config, revision: first.revision }), /buzzer timer channel/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), original);
});

test('rejects a configuration symlink outside the workspace', t => {
  const f = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-template-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const target = path.join(outside, 'config.json');
  fs.writeFileSync(target, original);
  fs.unlinkSync(f.file);
  fs.symlinkSync(target, f.file);
  assert.throws(() => f.load({ root: f.root }), /outside workspace/);
  assert.equal(fs.readFileSync(target, 'utf8'), original);
});
