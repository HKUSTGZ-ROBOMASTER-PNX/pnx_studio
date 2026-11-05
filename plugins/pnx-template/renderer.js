// Graphical editor for configs/user_config.json. The main-process companion owns
// project detection, resource discovery, validation, and conflict-safe writes.
const ZH = {
  'Template Configuration': '模板配置', 'Open Template Configuration': '打开模板配置',
  'PnX STM32 template': 'PnX STM32 模板', 'Open a template workspace to edit its configuration.': '打开模板工程文件夹以编辑配置。',
  'Configuration file': '配置文件', 'Workspace': '工作区', 'Current workspace': '当前工作区',
  'Reload': '重新加载', 'Save': '保存', 'Loading…': '正在加载…', 'Saving…': '正在保存…',
  'Saved': '已保存', 'Unsaved changes': '有未保存的更改', 'Invalid number': '请输入有效数字',
  'Fix invalid fields before saving.': '保存前请修正无效的输入。', 'Configuration saved.': '配置已保存。',
  'Discard changes?': '放弃更改？', 'Your edits have not been saved. Continue and discard them?': '当前修改尚未保存。继续将丢弃这些修改。',
  'Cancel': '取消', 'Discard': '放弃更改', 'Load current workspace': '加载当前工作区',
  'The workspace changed. Your unsaved edits below still belong to the previous workspace. Save them or load the current workspace.': '工作区已切换。下方未保存的修改仍属于之前的工程；请先保存，或加载当前工作区。',
  'Select a section to edit its settings.': '选择一个分组编辑设置。',
  'General': '常规', 'USB': 'USB', 'UI': '界面', 'PS2': 'PS2', 'Boards': '板卡',
  'DMIMU': 'DMIMU', 'AHRS': '姿态解算', 'Referee': '裁判系统', 'Remoter': '遥控器',
  'BMI088 heater': 'BMI088 加热', 'Application': '应用', 'RFID': 'RFID', 'BMI088 thermal': 'BMI088 温控', 'ESKF': 'ESKF',
  'Enabled': '启用', 'Timeout (ms)': '超时（毫秒）', 'Deadzone': '死区', 'SPI timeout (ms)': 'SPI 超时（毫秒）',
  'UI UART': '界面串口', 'DR16 UART': 'DR16 串口', 'VT03 UART': 'VT03 串口', 'PS2 chip select': 'PS2 片选',
  'PS2 SPI': 'PS2 SPI', 'DMIMU CAN': 'DMIMU CAN', 'AHRS device': '姿态传感器', 'Referee UART': '裁判系统串口',
  'DR16 enabled': '启用 DR16', 'VT03 enabled': '启用 VT03', 'PS2 enabled': '启用 PS2', 'BMI088 heater enabled': '启用 BMI088 加热',
  'RFID UART': 'RFID 串口', 'Buzzer timer': '蜂鸣器定时器', 'Buzzer channel': '蜂鸣器通道',
  'CAN ID': 'CAN ID', 'Master ID': '主机 ID', 'Mode': '模式', 'Assembly timeout (ms)': '组帧超时（毫秒）',
  'Offline timeout (ms)': '离线超时（毫秒）', 'Thread priority': '线程优先级', 'Sample period (ticks)': '采样周期（tick）',
  'Max dt': '最大时间步长', 'Retry period (ms)': '重试周期（毫秒）', 'Warmup timeout (ms)': '预热超时（毫秒）',
  'Calibrate on start': '启动时校准', 'Gyro offset': '陀螺仪偏移', 'Accel offset': '加速度偏移', 'IMU offset': 'IMU 偏移',
  'Period (ms)': '周期（毫秒）', 'Period (ticks)': '周期（tick）', 'Stack size': '栈大小', 'Target': '目标',
  'Target temperature (°C)': '目标温度（°C）', 'Warm-up duty': '预热占空比', 'Reheat duty': '补热占空比',
  'Approach start duty': '接近目标时的初始占空比', 'Approach end duty': '接近目标时的最终占空比', 'Hold maximum duty': '恒温最大占空比',
  'PID proportional gain (Kp)': 'PID 比例增益（Kp）', 'PID integral gain (Ki)': 'PID 积分增益（Ki）',
  'PID derivative gain (Kd)': 'PID 微分增益（Kd）', 'PID maximum output': 'PID 最大输出',
  'DMIMU wait (ticks)': 'DMIMU 等待（tick）', 'DMIMU request period (ms)': 'DMIMU 请求周期（毫秒）',
  'DMIMU queue (frames)': 'DMIMU 队列（帧）', 'BMI088 stack size (bytes)': 'BMI088 栈大小（字节）', 'DMIMU stack size (bytes)': 'DMIMU 栈大小（字节）',
  'Gyroscope noise (rad/s/√Hz)': '陀螺仪噪声（rad/s/√Hz）', 'Gyroscope bias random walk (rad/s²/√Hz)': '陀螺仪零偏随机游走（rad/s²/√Hz）',
  'Gravity direction noise (rad·√s)': '重力方向噪声（rad·√s）', 'Acceleration magnitude gain (rad²/g²)': '加速度幅值增益（rad²/g²）',
  'NIS gate threshold': 'NIS 门限', 'Rejection timeout (s)': '拒绝超时（秒）', 'Impact jerk threshold (g/s)': '冲击变化率阈值（g/s）',
  'Impact hold time (s)': '冲击保持时间（秒）', 'Static acceleration tolerance (g)': '静止加速度容差（g）',
  'Static gyroscope tolerance (rad/s)': '静止角速度容差（rad/s）', 'Static filter time constant (s)': '静止检测滤波时间常数（秒）',
  'Zero-rate minimum time (s)': '零角速度最短持续时间（秒）', 'Initial tilt standard deviation (rad)': '初始倾角标准差（rad）',
  'Initial yaw standard deviation (rad)': '初始航向角标准差（rad）', 'Initial bias standard deviation (rad/s)': '初始零偏标准差（rad/s）',
  'Minimum bias standard deviation (rad/s)': '最小零偏标准差（rad/s）', 'PS2 period (ms)': 'PS2 周期（毫秒）',
  'Stable time (ms)': '稳定持续时间（毫秒）', 'Stable temperature tolerance (°C)': '温度稳定容差（°C）',
  'RFID address': 'RFID 地址', 'RFID block': 'RFID 数据块', 'Baud rate (bit/s)': '波特率（bit/s）', 'Priority': '优先级',
  'Startup delay (ms)': '启动延迟（毫秒）', 'Polling period (ms)': '轮询周期（毫秒）', 'Recovery delay (ms)': '恢复延迟（毫秒）',
  'Buzzer period (µs)': '蜂鸣器周期（微秒）', 'Buzzer on time (ms)': '蜂鸣器响铃时间（毫秒）', 'Buzzer gap (ms)': '蜂鸣器间隔（毫秒）',
  'Stack size (bytes)': '栈大小（字节）', 'Maximum time step (s)': '最大时间步长（秒）',
  'Configuration changed on disk; reload before saving': '配置文件已在磁盘上更改；请重新加载后再保存。',
  'Open a template workspace first': '请先打开模板工程文件夹。',
  'This workspace does not contain configs/user_config.json': '当前工作区没有 configs/user_config.json 配置文件。',
  'Configuration must be a JSON object': '配置文件必须为 JSON 对象。',
  'ps2.deadzone must be less than 1': 'ps2.deadzone 必须小于 1。',
  'rfid.block must be an ordinary S50 data block': 'rfid.block 必须是普通 S50 数据块。',
  'dmimu.mode must be active or request': 'dmimu.mode 必须为 active 或 request。',
  'dmimu assembly timeout must not exceed offline timeout': 'DMIMU 组帧超时不能超过离线超时。',
  'bmi088_heater.period_ms must be 125': 'BMI088 加热周期必须为 125 毫秒。',
  'bmi088_heater.timeout_ms must exceed period_ms': 'BMI088 加热超时必须大于加热周期。',
  'expected a boolean': '需要布尔值', 'expected an object': '需要对象', 'expected three numbers in [-100, 100]': '需要三个范围在 [-100, 100] 的数字',
  'expected none, bmi088 or dmimu': '请选择 none、bmi088 或 dmimu', 'DMIMU requires CAN': 'DMIMU 需要 CAN',
  'RFID needs a UART and buzzer timer': 'RFID 需要串口和蜂鸣器定时器', 'buzzer timer channel is unavailable': '蜂鸣器定时器通道不可用',
  'buzzer conflicts with BMI088 heater timer': '蜂鸣器与 BMI088 加热器使用了同一定时器',
  'DR16 requires a UART': 'DR16 需要串口', 'VT03 requires a UART': 'VT03 需要串口',
  'DR16 and VT03 cannot share a UART': 'DR16 与 VT03 不能共用串口', 'referee and remoter cannot share RX': '裁判系统与遥控器不能共用串口接收',
  'PS2 requires CS and SPI': 'PS2 需要片选和 SPI', 'RFID UART conflicts with another device': 'RFID 串口与其他设备冲突', 'RFID UART requires RX DMA': 'RFID 串口需要 RX DMA',
  'expected an integer in [{min}, {max}]': '需要范围在 [{min}, {max}] 的整数', 'expected a number in [{min}, {max}]': '需要范围在 [{min}, {max}] 的数字',
  'unknown {type} resource': '未知的 {type} 资源',
};
const LABELS = {
  usb: 'USB', ui: 'UI', ps2: 'PS2', boards: 'Boards', dmimu: 'DMIMU', ahrs: 'AHRS', referee: 'Referee', remoter: 'Remoter',
  bmi088_heater: 'BMI088 heater', application: 'Application', rfid: 'RFID', bmi088_thermal: 'BMI088 thermal', eskf: 'ESKF',
  enabled: 'Enabled', timeout_ms: 'Timeout (ms)', deadzone: 'Deadzone', spi_timeout_ms: 'SPI timeout (ms)',
  ui_uart: 'UI UART', dr16_uart: 'DR16 UART', vt03_uart: 'VT03 UART', ps2_cs: 'PS2 chip select', ps2_spi: 'PS2 SPI',
  dmimu_can: 'DMIMU CAN', ahrs_device: 'AHRS device', referee_uart: 'Referee UART', remoter_dr16_enabled: 'DR16 enabled',
  remoter_vt03_enabled: 'VT03 enabled', remoter_ps2_enabled: 'PS2 enabled', bmi088_heater_enabled: 'BMI088 heater enabled',
  rfid_uart: 'RFID UART', buzzer_timer: 'Buzzer timer', buzzer_channel: 'Buzzer channel', can_id: 'CAN ID', master_id: 'Master ID',
  mode: 'Mode', assembly_timeout_ms: 'Assembly timeout (ms)', offline_timeout_ms: 'Offline timeout (ms)', thread_priority: 'Thread priority',
  sample_period_ticks: 'Sample period (ticks)', retry_period_ms: 'Retry period (ms)', warmup_timeout_ms: 'Warmup timeout (ms)',
  calibrate_on_start: 'Calibrate on start', gyro_offset: 'Gyro offset', accel_offset: 'Accel offset', imu_offset: 'IMU offset',
  period_ms: 'Period (ms)', period_ticks: 'Period (ticks)',
  target: 'Target temperature (°C)', boost: 'Warm-up duty', reboost: 'Reheat duty', approach_start: 'Approach start duty',
  approach_end: 'Approach end duty', hold_max: 'Hold maximum duty', kp: 'PID proportional gain (Kp)', ki: 'PID integral gain (Ki)',
  kd: 'PID derivative gain (Kd)', max_out: 'PID maximum output', dmimu_wait_ticks: 'DMIMU wait (ticks)',
  dmimu_request_period_ms: 'DMIMU request period (ms)', dmimu_queue_frames: 'DMIMU queue (frames)',
  bmi088_stack_size: 'BMI088 stack size (bytes)', dmimu_stack_size: 'DMIMU stack size (bytes)',
  gyro_noise: 'Gyroscope noise (rad/s/√Hz)', gyro_bias_walk: 'Gyroscope bias random walk (rad/s²/√Hz)',
  accel_noise: 'Gravity direction noise (rad·√s)', accel_magnitude_gain: 'Acceleration magnitude gain (rad²/g²)', nis_gate: 'NIS gate threshold',
  reject_timeout: 'Rejection timeout (s)', impact_jerk: 'Impact jerk threshold (g/s)', impact_hold: 'Impact hold time (s)',
  static_accel_tolerance: 'Static acceleration tolerance (g)', static_gyro_tolerance: 'Static gyroscope tolerance (rad/s)',
  static_filter_time_constant: 'Static filter time constant (s)', zero_rate_min_time: 'Zero-rate minimum time (s)',
  initial_tilt_stddev: 'Initial tilt standard deviation (rad)', initial_yaw_stddev: 'Initial yaw standard deviation (rad)',
  initial_bias_stddev: 'Initial bias standard deviation (rad/s)', min_bias_stddev: 'Minimum bias standard deviation (rad/s)',
  ps2_period_ms: 'PS2 period (ms)', stable_time_ms: 'Stable time (ms)', stable_tolerance: 'Stable temperature tolerance (°C)',
  address: 'RFID address', block: 'RFID block', baud: 'Baud rate (bit/s)', priority: 'Priority', startup_ms: 'Startup delay (ms)',
  poll_ms: 'Polling period (ms)', recovery_ms: 'Recovery delay (ms)', buzzer_period_us: 'Buzzer period (µs)',
  buzzer_on_ms: 'Buzzer on time (ms)', buzzer_gap_ms: 'Buzzer gap (ms)', stack_size: 'Stack size (bytes)', max_dt: 'Maximum time step (s)',
};
const STYLES = `
.pnx-template { flex:1; min-height:0; display:flex; flex-direction:column; }
.pnx-template .pt-banner { padding:10px 16px; border-bottom:1px solid var(--line); background:var(--accent-soft); color:var(--fg-1); font-size:12px; line-height:1.5; }
.pnx-template .pt-body { display:flex; flex:1; min-height:0; }
.pnx-template .pt-nav { width:204px; flex:none; overflow:auto; padding:12px 8px; border-right:1px solid var(--line); }
.pnx-template .pt-nav-label { padding:10px 10px 4px; color:var(--fg-3); text-transform:uppercase; letter-spacing:.08em; font-size:10px; font-weight:700; }
.pnx-template .pt-nav button { display:block; text-align:left; width:100%; padding:7px 10px; background:transparent; border:0; border-radius:6px; color:var(--fg-2); cursor:pointer; font:inherit; font-size:12px; }
.pnx-template .pt-nav button:hover { background:var(--bg-3); color:var(--fg-0); }
.pnx-template .pt-nav button.active { background:var(--accent-soft); color:var(--accent); font-weight:600; }
.pnx-template .pt-content { flex:1; min-width:0; overflow:auto; padding:24px 28px 36px; }
.pnx-template .pt-content h2 { margin:0 0 4px; font-size:18px; color:var(--fg-0); }
.pnx-template .pt-content h3 { margin:0 0 16px; font-size:13px; color:var(--fg-1); }
.pnx-template .pt-card { max-width:1000px; padding:18px; margin:20px 0; border:1px solid var(--line); background:var(--bg-2); border-radius:10px; }
.pnx-template .pt-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%, 220px),1fr)); gap:16px; }
.pnx-template .pt-field { display:flex; min-width:0; flex-direction:column; gap:6px; color:var(--fg-2); font-size:12px; }
.pnx-template .pt-field input:not([type=checkbox]), .pnx-template .pt-field select, .pnx-template .pt-field textarea { width:100%; box-sizing:border-box; }
.pnx-template .pt-field .pt-key { color:var(--fg-3); font-size:10px; overflow-wrap:anywhere; }
.pnx-template .pt-vector { display:flex; gap:6px; }
.pnx-template .pt-vector label { flex:1; min-width:0; color:var(--fg-3); font-size:10px; }
.pnx-template .pt-switch { display:flex; align-items:center; min-height:30px; }
.pnx-template .pt-error { border-color:var(--err)!important; }
.pnx-template .pt-empty { padding:32px; color:var(--fg-2); line-height:1.6; }
@media(max-width:650px) { .pnx-template .pt-nav { width:150px; } .pnx-template .pt-content { padding:16px; } }
`;

export function activate(studio) {
  const { h, icon, notify, modal } = studio.ui;
  const { t, addTranslations } = studio.i18n;
  addTranslations('zh', ZH);
  if (!document.getElementById('pnx-template-styles')) document.head.append(h('style', { id: 'pnx-template-styles' }, STYLES));

  const state = { root: null, config: null, revision: null, resources: {}, baseline: '', invalid: new Map(), section: null, busy: false, error: '', generation: 0, pendingWorkspace: false };
  let repaint = () => {};
  const label = key => t(LABELS[key] || String(key).replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()));
  const formatError = error => {
    const message = String(error?.message || error);
    const split = message.indexOf(': ');
    if (split < 0) return t(message);
    const prefix = message.slice(0, split), detail = message.slice(split + 2);
    const number = /^expected (an integer|a number) in \[([^,]+), ([^\]]+)\]$/.exec(detail);
    if (number) return `${prefix}: ${t(`expected ${number[1]} in [{min}, {max}]`, { min: number[2], max: number[3] })}`;
    const resource = /^unknown (\w+) resource$/.exec(detail);
    if (resource) return `${prefix}: ${t('unknown {type} resource', { type: resource[1] })}`;
    return `${prefix}: ${t(detail)}`;
  };
  const dirty = () => !!state.config && (state.invalid.size > 0 || JSON.stringify(state.config) !== state.baseline);
  const setAt = (path, value) => {
    let target = state.config;
    for (const part of path.slice(0, -1)) target = target[part];
    target[path.at(-1)] = value;
  };
  const askDiscard = () => new Promise(resolve => {
    if (!dirty()) { resolve(true); return; }
    let answer = false;
    let close;
    close = modal({
      title: t('Discard changes?'), body: h('p', null, t('Your edits have not been saved. Continue and discard them?')),
      footer: [h('button', { class: 'btn', onclick: () => close() }, t('Cancel')),
        h('button', { class: 'btn danger', onclick: () => { answer = true; close(); } }, t('Discard'))],
      onClose: () => resolve(answer),
    });
  });
  function settleWorkspace() {
    if (!state.pendingWorkspace || state.busy) return;
    state.pendingWorkspace = false;
    if (dirty()) { repaint(); return; }
    if (studio.workspace.root) load(studio.workspace.root, false);
    else { state.root = null; state.config = null; state.error = ''; repaint(); }
  }
  async function load(root, confirm = true) {
    if (state.busy || !root || (confirm && !(await askDiscard()))) return;
    const generation = ++state.generation;
    state.busy = true; state.error = ''; repaint();
    try {
      const result = await studio.main.invoke('load', { root });
      if (generation !== state.generation) return;
      state.root = root; state.config = result.config; state.revision = result.revision; state.resources = result.resources || {};
      state.baseline = JSON.stringify(state.config); state.invalid.clear(); state.section = null;
    } catch (error) { if (generation === state.generation) state.error = formatError(error); }
    finally { if (generation === state.generation) { state.busy = false; repaint(); settleWorkspace(); } }
  }
  async function save() {
    if (state.busy || !state.config) return;
    if (state.invalid.size) { notify(t('Fix invalid fields before saving.'), 'error'); return; }
    state.busy = true; state.error = ''; repaint();
    try {
      const result = await studio.main.invoke('save', { root: state.root, config: state.config, revision: state.revision });
      state.config = result.config; state.revision = result.revision; state.resources = result.resources || {};
      state.baseline = JSON.stringify(state.config); state.invalid.clear(); notify(t('Configuration saved.'), 'ok');
    } catch (error) { state.error = formatError(error); notify(state.error, 'error'); }
    finally { state.busy = false; repaint(); settleWorkspace(); }
  }

  studio.views.register('configuration', {
    title: t('Template Configuration'), icon: 'settings', location: 'editor',
    render(container) {
      container.classList.add('pnx-template');
      const toolbar = h('div', { class: 'view-toolbar' });
      const banner = h('div', { class: 'pt-banner', hidden: true });
      const body = h('div', { class: 'pt-body' });
      const nav = h('nav', { class: 'pt-nav', 'aria-label': t('Template Configuration') });
      const content = h('div', { class: 'pt-content' });
      const info = h('span', { class: 'faint mono' });
      const refreshStatus = () => {
        info.textContent = state.busy ? t('Saving…') : dirty() ? t('Unsaved changes') : t('Saved');
        const button = toolbar.querySelector('[data-action="save"]');
        if (button) button.disabled = state.busy || !dirty() || state.invalid.size > 0;
      };
      const optionsFor = (path, current) => {
        const key = path.at(-1);
        if (path[0] === 'dmimu' && key === 'mode') return ['active', 'request'];
        if (path[0] !== 'boards' || path.length !== 3) return null;
        if (key === 'ahrs_device') return ['none', 'bmi088', 'dmimu'];
        const kind = key.endsWith('_uart') ? 'usart' : key.endsWith('_spi') ? 'spi' : key.endsWith('_cs') ? 'gpio' : key.endsWith('_timer') ? 'pwm' : key === 'dmimu_can' ? 'can' : null;
        if (!kind) return null;
        let available = state.resources?.[path[1]]?.[kind];
        if (!Array.isArray(available) && kind === 'can') available = path[1] === 'h723_mc02' ? ['fdcan1', 'fdcan2', 'fdcan3'] : ['can1', 'can2'];
        if (!Array.isArray(available)) return null; // Keep unknown/new template resources editable.
        return [...new Set(['none', ...available, current])];
      };
      const numeric = (path, value) => {
        const key = path.join('.');
        const invalid = state.invalid.has(key);
        const input = h('input', { type: 'text', inputmode: 'decimal', value: invalid ? state.invalid.get(key) : String(value), class: invalid ? 'mono pt-error' : 'mono', title: invalid ? t('Invalid number') : '', 'aria-label': path.join('.') });
        input.addEventListener('input', () => {
          const raw = input.value.trim();
          const valid = raw !== '' && Number.isFinite(Number(raw));
          input.classList.toggle('pt-error', !valid); input.title = valid ? '' : t('Invalid number');
          if (valid) { state.invalid.delete(key); setAt(path, Number(raw)); } else state.invalid.set(key, raw);
          refreshStatus();
        });
        return input;
      };
      const field = (path, value) => {
        const name = path.at(-1), key = path.join('.');
        let control;
        if (typeof value === 'boolean') {
          control = h('div', { class: 'pt-switch' }, h('input', { type: 'checkbox', checked: value, 'aria-label': label(name), onchange: e => { setAt(path, e.target.checked); refreshStatus(); } }));
        } else if (typeof value === 'number') control = numeric(path, value);
        else if (Array.isArray(value) && value.every(v => typeof v === 'number')) {
          control = h('div', { class: 'pt-vector' }, value.map((v, i) => h('label', null, ['X', 'Y', 'Z'][i] || String(i + 1), numeric([...path, i], v))));
        } else if (typeof value === 'string') {
          const choices = optionsFor(path, value);
          if (choices) control = h('select', { 'aria-label': label(name), onchange: e => { setAt(path, e.target.value); refreshStatus(); } }, choices.map(v => h('option', { value: v, selected: v === value }, v)));
          else control = h('input', { type: 'text', value, 'aria-label': label(name), oninput: e => { setAt(path, e.target.value); refreshStatus(); } });
        } else {
          // Preserve unfamiliar values while allowing forward-compatible edits.
          control = h('textarea', { rows: 3, class: state.invalid.has(key) ? 'mono pt-error' : 'mono', 'aria-label': label(name), oninput: e => {
            try { setAt(path, JSON.parse(e.target.value)); state.invalid.delete(key); e.target.classList.remove('pt-error'); }
            catch { state.invalid.set(key, e.target.value); e.target.classList.add('pt-error'); }
            refreshStatus();
          } }, state.invalid.has(key) ? state.invalid.get(key) : JSON.stringify(value, null, 2));
        }
        return h('div', { class: 'pt-field' }, h('span', null, label(name)), control, h('span', { class: 'pt-key mono' }, key));
      };
      const renderGroup = (object, path, heading) => {
        const primitives = [], nested = [];
        for (const [key, value] of Object.entries(object)) {
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) nested.push([key, value]);
          else primitives.push(field([...path, key], value));
        }
        const cards = [];
        if (primitives.length) cards.push(h('section', { class: 'pt-card' }, h('h3', null, heading), h('div', { class: 'pt-grid' }, primitives)));
        for (const [key, value] of nested) cards.push(...renderGroup(value, [...path, key], label(key)));
        return cards;
      };
      repaint = () => {
        const hasConfig = !!state.config;
        toolbar.replaceChildren(icon('settings'), h('strong', null, t('Template Configuration')), h('span', { class: 'grow' }),
          ...(hasConfig ? [info] : []),
          h('button', { class: 'btn small', disabled: state.busy || !studio.workspace.root, onclick: () => load(studio.workspace.root) }, icon('refresh'), t('Reload')),
          h('button', { class: 'btn small primary', dataset: { action: 'save' }, disabled: state.busy || !hasConfig || !dirty() || state.invalid.size > 0, onclick: save }, t('Save')));
        const mismatch = hasConfig && state.root !== studio.workspace.root;
        banner.hidden = !mismatch;
        if (mismatch) banner.replaceChildren(h('span', null, t('The workspace changed. Your unsaved edits below still belong to the previous workspace. Save them or load the current workspace.')), ' ',
          h('button', { class: 'btn small', disabled: state.busy || !studio.workspace.root, onclick: () => load(studio.workspace.root) }, t('Load current workspace')));
        body.replaceChildren();
        if (!hasConfig) {
          body.append(h('div', { class: 'pt-empty' }, state.busy ? t('Loading…') : state.error || t('Open a template workspace to edit its configuration.')));
          return;
        }
        const sections = [];
        for (const [key, value] of Object.entries(state.config)) {
          if (key === 'boards' && value && typeof value === 'object' && !Array.isArray(value)) {
            for (const [board, config] of Object.entries(value)) sections.push({ path: ['boards', board], title: board, category: 'Boards', value: config });
          } else sections.push({ path: [key], title: label(key), category: 'General', value });
        }
        sections.sort((a, b) => Number(a.category === 'Boards') - Number(b.category === 'Boards'));
        if (!sections.some(section => section.path.join('.') === state.section)) state.section = sections[0]?.path.join('.');
        let category = null;
        nav.replaceChildren(...sections.flatMap(section => {
          const items = [];
          if (category !== section.category) { category = section.category; items.push(h('div', { class: 'pt-nav-label' }, t(category))); }
          const selected = section.path.join('.') === state.section;
          items.push(h('button', { class: selected ? 'active' : '', onclick: () => { state.section = section.path.join('.'); repaint(); } }, section.title));
          return items;
        }));
        const selected = sections.find(section => section.path.join('.') === state.section);
        content.replaceChildren(h('h2', null, selected?.title || t('Template Configuration')),
          h('div', { class: 'faint mono', style: { fontSize: '11px', overflowWrap: 'anywhere' } }, `${t('Configuration file')}: ${state.root}/configs/user_config.json`),
          ...(state.error ? [h('p', { class: 'err-text' }, state.error)] : []),
          ...(selected ? (selected.value && typeof selected.value === 'object' && !Array.isArray(selected.value)
            ? renderGroup(selected.value, selected.path, selected.title)
            : [h('section', { class: 'pt-card' }, field(selected.path, selected.value))]) : []));
        if (state.busy) for (const element of content.querySelectorAll('input, select, textarea')) element.disabled = true;
        body.append(nav, content); refreshStatus();
      };
      container.append(toolbar, banner, body); repaint();
      if (!state.config && !state.busy && studio.workspace.root) load(studio.workspace.root, false);
      return { onShow: repaint, dispose: () => { repaint = () => {}; } };
    },
  });

  studio.workspace.on('opened', () => {
    if (state.busy) { state.pendingWorkspace = true; repaint(); return; }
    if (!dirty()) {
      if (studio.workspace.root) load(studio.workspace.root, false);
      else { state.root = null; state.config = null; state.error = ''; repaint(); }
    } else repaint();
  });
  studio.commands.register('open', t('Open Template Configuration'), () => studio.views.open('configuration'));
  studio.ui.addToolbarButton({ title: t('Template Configuration'), icon: 'settings', run: () => studio.views.open('configuration') });
}
