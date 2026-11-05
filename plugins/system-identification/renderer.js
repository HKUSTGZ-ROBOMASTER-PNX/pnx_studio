// Yaw gimbal Auto-ID V1. Capture and fitting run in the main process / adapter;
// the view never sends motor commands directly.
const ZH = {
  'System Identification': '系统辨识', 'Open System Identification': '打开系统辨识',
  'Yaw gimbal · Auto-ID V1': '云台 Yaw 轴 · Auto-ID V1',
  'Identify the first-order speed response from current command. Requires firmware implementing the Auto-ID V1 UART protocol.': '根据电流指令和角速度辨识一阶模型。在线实验需要实现 Auto-ID V1 串口协议的固件。',
  'Online experiment': '在线实验', 'Serial port': '串口', 'Refresh ports': '刷新串口', 'No ports found; enter a port manually': '未发现串口；可手动输入端口', 'Baud rate': '波特率',
  'Start experiment': '开始实验', 'Abort experiment': '中止实验', 'Choose raw CSV location': '选择原始数据保存位置',
  'This command moves the gimbal for about 40 seconds. Make sure the mechanism is clear and the correct Auto-ID V1 firmware is running.': '此操作会驱动云台运动约 40 秒。请确认机械运动范围安全，且固件支持 Auto-ID V1。',
  'Abort sends a stop request to the firmware; it is not an emergency stop.': '中止会向固件发送停止请求，不能代替急停。',
  'Closing this view also requests an abort.': '关闭此视图也会请求中止实验。',
  'Start gimbal experiment?': '启动云台实验？', 'Start': '启动', 'Cancel': '取消',
  'Offline analysis': '离线分析', 'Analyze existing V1 raw.csv': '分析已有 V1 raw.csv',
  'Offline files use the V1 defaults (40 s, 20% baseline); firmware drop counts are unavailable unless metadata is present.': '离线文件默认使用 V1 参数（40 秒、20% 基线）；没有元数据时无法获取固件丢样数。',
  'Torque per command (optional)': '每单位指令的力矩（可选）', 'Signed, calibrated Kτ; required for J and B': '需填写已标定的有符号 Kτ，才能计算 J 和 B',
  'Enter a valid finite torque conversion.': '请输入有效的有限力矩换算值。', 'Select or enter a serial port.': '请选择或输入串口。',
  'Results': '辨识结果', 'Run an experiment or analyze an existing capture.': '运行实验或分析已有数据以查看结果。',
  'Model': '模型', 'Fit': '拟合度', 'RMSE': '均方根误差', 'Gain K': '增益 K', 'Time constant T': '时间常数 T', 'Delay Td': '延迟 Td',
  'Inertia J': '惯量 J', 'Damping B': '阻尼 B', 'Unavailable': '不可用', 'Samples': '样本数', 'Dropped samples': '丢失样本', 'Saturation': '饱和比例',
  'Malformed rows': '无效行', 'Sample gaps': '采样缺口', 'Firmware sample count differs from received samples.': '固件报告的样本数与接收数量不一致。',
  'Identification coverage': '辨识窗口覆盖率', 'Quality warnings': '质量提示',
  'Optimizer did not converge; parameters may be unreliable': '优化未收敛，参数可能不可靠。',
  'Less than 90% of the identification window is covered by received samples': '接收到的样本覆盖不到辨识窗口的 90%。',
  'Telemetry gaps affect the identification window; fitting restarts after each gap': '辨识窗口内存在数据缺口，拟合在每个缺口后重新开始。',
  'Firmware reported dropped samples': '固件报告了丢样。',
  'Delay reached the 50 ms search limit': '延迟达到 50 毫秒搜索上限。',
  'Time constant reached a search limit': '时间常数达到搜索边界。',
  'Observed sample interval exceeds the expected V1 sample period': '实际采样间隔大于 V1 预期周期。',
  'Stop is unconfirmed; check the device and use its emergency stop if needed.': '无法确认设备已停止；请检查设备，必要时使用急停。',
  'Measured': '实测', 'Modelled': '模型', 'Time (s)': '时间（秒）', 'Speed (rad/s)': '角速度（rad/s）',
  'Raw signals': '原始信号', 'Yaw position (rad)': 'Yaw 位置（rad）', 'Reference': '参考值', 'Feedback': '反馈值', 'Current command': '电流指令',
  'Save result JSON': '保存结果 JSON', 'Save identification result': '保存辨识结果',
  'Idle': '空闲', 'Starting': '正在启动', 'Running': '实验进行中', 'Stopping': '正在中止', 'Analyzing': '正在辨识', 'Finished': '已完成', 'Aborted': '已中止', 'Error': '出错',
  'Raw data': '原始数据', 'None': '无', 'Serial port': '串口', 'Output': '输出', 'Choose V1 raw CSV': '选择 V1 原始 CSV',
  'Experiment ended without a complete fit. Partial raw data is kept.': '实验未产生完整辨识结果，已保留原始数据。',
};

const CSS = `
.auto-id-view { display:flex; flex:1; min-height:0; flex-direction:column; }
.auto-id-view .aid-body { overflow:auto; padding:22px 26px 36px; }
.auto-id-view .aid-intro { max-width:950px; line-height:1.5; margin:0 0 18px; }
.auto-id-view .aid-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr)); gap:14px; max-width:1200px; }
.auto-id-view .aid-card { border:1px solid var(--line); background:var(--bg-2); border-radius:10px; padding:16px; min-width:0; }
.auto-id-view h2 { font-size:17px; margin:0 0 7px; }
.auto-id-view h3 { font-size:13px; margin:0 0 12px; }
.auto-id-view .aid-card p { font-size:12px; line-height:1.55; color:var(--fg-2); margin:0 0 12px; }
.auto-id-view .aid-fields { display:grid; gap:12px; }
.auto-id-view .aid-fields input, .auto-id-view .aid-fields select { width:100%; box-sizing:border-box; }
.auto-id-view .aid-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; }
.auto-id-view .aid-status { padding:10px 12px; border-radius:7px; background:var(--bg-1); margin-top:12px; line-height:1.5; overflow-wrap:anywhere; }
.auto-id-view .aid-warn { border-left:3px solid var(--warn); padding:8px 12px; background:var(--bg-1); }
.auto-id-view .aid-result { max-width:1200px; margin-top:14px; }
.auto-id-view .aid-metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(135px,1fr)); gap:10px; margin:14px 0; }
.auto-id-view .aid-metric { background:var(--bg-1); border:1px solid var(--line); border-radius:7px; padding:10px; }
.auto-id-view .aid-metric span { display:block; color:var(--fg-3); font-size:11px; margin-bottom:5px; }
.auto-id-view .aid-metric strong { font-size:14px; user-select:text; }
.auto-id-view .aid-chart { width:100%; height:240px; display:block; background:var(--bg-1); border:1px solid var(--line); border-radius:7px; }
.auto-id-view .aid-legend { display:flex; gap:16px; margin:10px 0; color:var(--fg-2); font-size:12px; }
`;

export function activate(studio) {
  const { h, icon, notify, modal } = studio.ui;
  const { t, addTranslations } = studio.i18n;
  addTranslations('zh', ZH);
  if (!document.getElementById('auto-id-style')) document.head.append(h('style', { id: 'auto-id-style' }, CSS));

  let state = { phase: 'idle' }, ports = [], portValue = '', baudValue = '921600', torqueValue = '';
  let repaint = () => {}, disposed = false;
  const busy = () => ['starting', 'running', 'stopping', 'analyzing'].includes(state.phase);
  const labelForPhase = phase => ({ idle: 'Idle', starting: 'Starting', running: 'Running', stopping: 'Stopping', analyzing: 'Analyzing', finished: 'Finished', aborted: 'Aborted', error: 'Error' })[phase] || phase;
  const readTorque = () => {
    const raw = torqueValue.trim();
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(t('Enter a valid finite torque conversion.'));
    return value;
  };
  const invoke = async (name, args) => {
    try { return await studio.main.invoke(name, args); }
    catch (error) { notify(error.message, 'error'); throw error; }
  };
  const refreshPorts = async () => { try { ports = await invoke('ports'); repaint(); } catch {} };
  const confirmStart = () => new Promise(resolve => {
    let accepted = false;
    let close;
    close = modal({ title: t('Start gimbal experiment?'),
      body: h('div', null, h('p', null, t('This command moves the gimbal for about 40 seconds. Make sure the mechanism is clear and the correct Auto-ID V1 firmware is running.')), h('p', null, t('Abort sends a stop request to the firmware; it is not an emergency stop.'))),
      footer: [h('button', { class: 'btn', onclick: () => close() }, t('Cancel')), h('button', { class: 'btn primary', onclick: () => { accepted = true; close(); } }, t('Start'))],
      onClose: () => resolve(accepted) });
  });
  const start = async () => {
    try {
      if (!portValue.trim()) throw new Error(t('Select or enter a serial port.'));
      const kTau = readTorque(), baud = Number(baudValue);
      if (!Number.isInteger(baud) || baud <= 0) throw new Error(t('Baud rate'));
      const file = await studio.host.dialog.saveFile({ title: t('Choose raw CSV location'), defaultPath: 'auto-id-raw.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (!file || !(await confirmStart())) return;
      state = await invoke('start', { port: portValue.trim(), baud, file, kTau }); repaint();
    } catch (error) { if (error.message === t('Select or enter a serial port.') || error.message === t('Enter a valid finite torque conversion.') || error.message === t('Baud rate')) notify(error.message, 'error'); }
  };
  const analyze = async () => {
    try {
      const kTau = readTorque();
      const file = await studio.host.dialog.openFile({ title: t('Choose V1 raw CSV'), filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (!file) return;
      state = await invoke('analyze', { file, kTau }); repaint();
    } catch (error) { if (error.message === t('Enter a valid finite torque conversion.')) notify(error.message, 'error'); }
  };
  const abort = async () => { try { state = await invoke('abort'); repaint(); } catch {} };
  const saveResult = async () => {
    try {
      const file = await studio.host.dialog.saveFile({ title: t('Save identification result'), defaultPath: 'auto-id-summary.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (file) await invoke('save-result', { file });
    } catch {}
  };
  studio.main.onMessage(message => { if (message?.type === 'state') { state = message.state; repaint(); } });
  studio.main.invoke('state').then(value => { state = value; repaint(); }).catch(() => {});

  studio.views.register('view', { title: t('System Identification'), icon: 'chart', location: 'editor', render(container) {
    disposed = false;
    container.classList.add('auto-id-view');
    const toolbar = h('div', { class: 'view-toolbar' }, icon('chart'), h('strong', null, t('System Identification')));
    const body = h('div', { class: 'aid-body' });
    container.append(toolbar, body);
    let resizeObserver = null;

    const drawChart = (canvas, signals) => {
      if (!canvas.isConnected || !signals?.time_s?.length) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const bounds = canvas.getBoundingClientRect(), scale = window.devicePixelRatio || 1;
      if (!bounds.width || !bounds.height) return;
      canvas.width = Math.round(bounds.width * scale); canvas.height = Math.round(bounds.height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const w = bounds.width, height = bounds.height, left = 55, right = 12, top = 14, bottom = 28;
      const times = signals.time_s, measured = signals.measured_speed_rad_s, model = signals.model_speed_rad_s || [];
      if (!Array.isArray(times) || !Array.isArray(measured) || !Array.isArray(model)) return;
      const get = key => getComputedStyle(canvas).getPropertyValue(key).trim();
      const finite = measured.concat(model).filter(Number.isFinite);
      if (!finite.length) return;
      let min = Infinity, max = -Infinity;
      for (const value of finite) { min = Math.min(min, value); max = Math.max(max, value); }
      const pad = Math.max((max - min) * .08, 1e-6); min -= pad; max += pad;
      const t0 = times[0], t1 = times.at(-1), span = Math.max(t1 - t0, 1e-9);
      ctx.clearRect(0, 0, w, height); ctx.font = '11px sans-serif'; ctx.fillStyle = get('--fg-3'); ctx.strokeStyle = get('--line'); ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = top + i * (height - top - bottom) / 4;
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke(); ctx.fillText((max - i * (max - min) / 4).toPrecision(3), 4, y + 4);
      }
      ctx.fillText(`${t0.toFixed(1)} s`, left, height - 7); ctx.fillText(`${t1.toFixed(1)} s`, Math.max(left, w - right - 45), height - 7);
      const gaps = [];
      for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) gaps.push(times[i] - times[i - 1]);
      gaps.sort((a, b) => a - b);
      const gapLimit = gaps.length ? gaps[Math.floor(gaps.length / 2)] * 3 : Infinity;
      for (const [series, color] of [[measured, get('--plot-1')], [model, get('--plot-2')]]) {
        ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.beginPath();
        const step = 1;
        let started = false;
        for (let i = 0; i < times.length; i += step) {
          if (!Number.isFinite(times[i]) || !Number.isFinite(series[i])) { started = false; continue; }
          const x = left + (times[i] - t0) / span * (w - left - right), y = top + (max - series[i]) / (max - min) * (height - top - bottom);
          if (started && i >= step && times[i] - times[i - step] <= gapLimit * step) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
        }
        ctx.stroke();
      }
    };
    const number = (value, suffix = '') => value == null || !Number.isFinite(value) ? t('Unavailable') : `${Number(value).toPrecision(5)}${suffix}`;
    const metric = (title, value) => h('div', { class: 'aid-metric' }, h('span', null, t(title)), h('strong', { class: 'mono' }, value));

    repaint = () => {
      if (disposed) return;
      resizeObserver?.disconnect(); resizeObserver = null;
      const active = busy();
      const port = h('input', { type: 'text', list: 'auto-id-ports', value: portValue, placeholder: t('No ports found; enter a port manually'), disabled: active, oninput: e => { portValue = e.target.value; } });
      const list = h('datalist', { id: 'auto-id-ports' }, ports.map(item => h('option', { value: item.path }, item.description || item.path)));
      const baud = h('input', { type: 'number', min: 1, value: baudValue, disabled: active, oninput: e => { baudValue = e.target.value; } });
      const torque = h('input', { type: 'text', value: torqueValue, placeholder: t('Signed, calibrated Kτ; required for J and B'), disabled: active, oninput: e => { torqueValue = e.target.value; } });
      const summary = state.result?.summary || state.result?.result;
      const signals = state.result?.signals;
      const raw = state.result?.rawSignals;
      const errorMessage = state.error?.includes('stop is unconfirmed')
        ? `${t('Stop is unconfirmed; check the device and use its emergency stop if needed.')} ${state.error}` : state.error;
      const status = h('div', { class: 'aid-status mono' }, t(labelForPhase(state.phase)), state.samples != null ? ` · ${t('Samples')}: ${state.samples}` : '',
        state.file ? h('div', null, `${t('Raw data')}: ${state.file}`) : null, errorMessage ? h('div', { class: 'err-text' }, errorMessage) : null,
        Number.isInteger(state.stats?.samples) && state.stats.samples !== state.samples ? h('div', { class: 'err-text' }, t('Firmware sample count differs from received samples.')) : null);
      const chart = h('canvas', { class: 'aid-chart', 'aria-label': `${t('Speed (rad/s)')} / ${t('Time (s)')}` });
      const positionChart = h('canvas', { class: 'aid-chart', 'aria-label': t('Yaw position (rad)') });
      const speedChart = h('canvas', { class: 'aid-chart', 'aria-label': t('Speed (rad/s)') });
      const currentChart = h('canvas', { class: 'aid-chart', 'aria-label': t('Current command') });
      const resultChildren = summary ? [
        h('div', { class: 'faint mono' }, 'Ω(s) / Icmd(s) = K / (Ts + 1) · e⁻ᵀᵈˢ'),
        h('div', { class: 'aid-metrics' },
          metric('Gain K', number(summary.K)), metric('Time constant T', number(summary.T_s, ' s')), metric('Delay Td', number(summary.Td_s, ' s')),
          metric('Fit', number(summary.fit_percent, ' %')), metric('RMSE', number(summary.rmse, ' rad/s')),
          metric('Inertia J', number(summary.J)), metric('Damping B', number(summary.B)),
          metric('Samples', number(summary.sample_count)), metric('Dropped samples', number(summary.dropped_samples)), metric('Saturation', number(summary.saturation_ratio_percent, ' %')),
          metric('Malformed rows', number(summary.malformed_rows)), metric('Sample gaps', number(summary.sample_gaps)),
          metric('Identification coverage', number(summary.identification_coverage_percent, ' %'))),
        ...(summary.quality_warnings?.length ? [h('div', { class: 'aid-warn' }, h('strong', null, t('Quality warnings')), ...summary.quality_warnings.map(warning => h('p', null, t(warning))))] : []),
        h('div', { class: 'aid-legend' }, h('span', { style: { color: 'var(--plot-1)' } }, `● ${t('Measured')}`), h('span', { style: { color: 'var(--plot-2)' } }, `● ${t('Modelled')}`), h('span', null, `${t('Speed (rad/s)')} · ${t('Time (s)')}`)),
        chart,
        ...(raw ? [h('h3', { style: { marginTop: '20px' } }, t('Raw signals')),
          h('div', { class: 'aid-legend' }, h('span', null, t('Yaw position (rad)')), h('span', { style: { color: 'var(--plot-1)' } }, `● ${t('Reference')}`), h('span', { style: { color: 'var(--plot-2)' } }, `● ${t('Feedback')}`)), positionChart,
          h('div', { class: 'aid-legend' }, t('Speed (rad/s)')), speedChart,
          h('div', { class: 'aid-legend' }, t('Current command')), currentChart] : []),
        h('div', { class: 'aid-actions' }, h('button', { class: 'btn small', disabled: active, onclick: saveResult }, icon('download'), t('Save result JSON'))),
      ] : [h('p', null, t('Run an experiment or analyze an existing capture.'))];
      body.replaceChildren(
        h('h2', null, t('Yaw gimbal · Auto-ID V1')), h('p', { class: 'faint aid-intro' }, t('Identify the first-order speed response from current command. Requires firmware implementing the Auto-ID V1 UART protocol.')),
        h('div', { class: 'aid-grid' },
          h('section', { class: 'aid-card' }, h('h3', null, t('Online experiment')),
            h('p', { class: 'aid-warn' }, t('This command moves the gimbal for about 40 seconds. Make sure the mechanism is clear and the correct Auto-ID V1 firmware is running.'), ' ', t('Abort sends a stop request to the firmware; it is not an emergency stop.'), ' ', t('Closing this view also requests an abort.')),
            h('div', { class: 'aid-fields' }, h('label', { class: 'field' }, h('span', null, t('Serial port')), h('div', { class: 'row' }, port, list, h('button', { class: 'btn small', title: t('Refresh ports'), disabled: active, onclick: refreshPorts }, icon('refresh')))),
              h('label', { class: 'field' }, h('span', null, t('Baud rate')), baud)),
            h('div', { class: 'aid-actions' }, h('button', { class: 'btn primary', disabled: active, onclick: start }, icon('play'), t('Start experiment')),
              h('button', { class: 'btn', disabled: !['starting', 'running'].includes(state.phase), onclick: abort }, icon('stop'), t('Abort experiment'))), status),
          h('section', { class: 'aid-card' }, h('h3', null, t('Offline analysis')), h('p', null, t('Offline files use the V1 defaults (40 s, 20% baseline); firmware drop counts are unavailable unless metadata is present.')),
            h('label', { class: 'field' }, h('span', null, t('Torque per command (optional)')), torque),
            h('div', { class: 'aid-actions' }, h('button', { class: 'btn', disabled: active, onclick: analyze }, icon('folderOpen'), t('Analyze existing V1 raw.csv'))))),
        h('section', { class: 'aid-card aid-result' }, h('h3', null, t('Results')), ...resultChildren));
      if (summary && signals) {
        const charts = [[chart, signals]];
        if (raw) charts.push(
          [positionChart, { time_s: raw.time_s, measured_speed_rad_s: raw.yaw_pos_ref_rad, model_speed_rad_s: raw.yaw_pos_fdb_rad }],
          [speedChart, { time_s: raw.time_s, measured_speed_rad_s: raw.yaw_speed_fdb_rad_s }],
          [currentChart, { time_s: raw.time_s, measured_speed_rad_s: raw.yaw_current_cmd }]);
        const draw = () => charts.forEach(([element, data]) => drawChart(element, data));
        requestAnimationFrame(draw);
        if (typeof ResizeObserver !== 'undefined') { resizeObserver = new ResizeObserver(draw); charts.forEach(([element]) => resizeObserver.observe(element)); }
      }
    };
    repaint(); refreshPorts();
    return { onShow: repaint, dispose: () => {
      if (['starting', 'running'].includes(state.phase)) studio.main.invoke('abort').catch(error => notify(error.message, 'error'));
      disposed = true; resizeObserver?.disconnect(); repaint = () => {};
    } };
  } });
  studio.commands.register('open', t('Open System Identification'), () => studio.views.open('view'));
  studio.ui.addToolbarButton({ title: t('System Identification'), icon: 'chart', run: () => studio.views.open('view') });
}
