// IMU Attitude — renderer-only plugin.
// Streams roll/pitch/yaw variables, draws the attitude in 3D and tracks zero drift
// against a reference pose captured when streaming starts.
//
// Frames: the display frame is forward/left/up (FLU, right-handed). The user maps
// each sensor axis to one of those directions (default X forward, Y left, Z up);
// the sensor rotation R_s is conjugated into the display frame as M·R_s·Mᵀ.

const ZH = {
  'IMU Attitude': 'IMU 姿态', 'Open IMU attitude view': '打开 IMU 姿态视图',
  'Roll': '横滚', 'Pitch': '俯仰', 'Yaw': '偏航', 'Choose…': '选择…', 'Clear': '清除',
  'Unit': '单位', 'Rotation order': '旋转顺序', 'Re-zero': '重新记录零点',
  'Capture the current attitude as the reference pose': '把当前姿态记录为初始位姿',
  'Sensor axes': '传感器轴', 'Forward': '前', 'Back': '后', 'Left': '左', 'Right': '右', 'Up': '上', 'Down': '下',
  'Default (X forward, Y left, Z up)': '默认（前 X、左 Y、上 Z）',
  'Two sensor axes point the same way; using the default mapping.': '两个传感器轴方向重复，已使用默认映射。',
  'Left-handed mapping: check the sign of one axis.': '左手系映射：请检查某个轴的方向。',
  'Current': '当前', 'Reference': '初始', 'Δ': 'Δ', 'Drift': '漂移',
  'Total Δ': '总偏差', 'Since zero': '记录后',
  'Connect a target to stream attitude.': '连接目标后开始显示姿态。',
  'Choose the roll, pitch and yaw variables.': '请选择横滚、俯仰、偏航变量。',
  'Recording reference pose…': '正在记录初始位姿…',
  'Drag to orbit · wheel to zoom · double-click to reset view': '拖动旋转视角 · 滚轮缩放 · 双击复位视角',
  'Drift since zero': '记录零点后的漂移', 'reference': '初始位姿',
  'Degrees (°)': '角度 (°)', 'Radians (rad)': '弧度 (rad)',
  'Values stay within ±π while moving: they look like radians.': '数值变化明显但始终在 ±π 以内，看起来是弧度。', 'Use radians': '切换为弧度',
};

const ANGLES = ['roll', 'pitch', 'yaw'];
const LABELS = { roll: 'Roll', pitch: 'Pitch', yaw: 'Yaw' };
const DIRECTIONS = { '+F': [1, 0, 0], '-F': [-1, 0, 0], '+L': [0, 1, 0], '-L': [0, -1, 0], '+U': [0, 0, 1], '-U': [0, 0, -1] };
const DIRECTION_LABELS = { '+F': 'Forward', '-F': 'Back', '+L': 'Left', '-L': 'Right', '+U': 'Up', '-U': 'Down' };
const DEFAULT_AXES = ['+F', '+L', '+U'];
const ORDERS = { ZYX: 'Z-Y-X (yaw → pitch → roll)', XYZ: 'X-Y-Z (roll → pitch → yaw)', ZXY: 'Z-X-Y (yaw → roll → pitch)' };
const DEFAULTS = { roll: '', pitch: '', yaw: '', unit: 'deg', order: 'ZYX', axes: DEFAULT_AXES, rate: 100 };
const ZERO_WINDOW_MS = 500;   // the reference pose is a circular mean over this window
const HISTORY_STEP_MS = 100;
const HISTORY_LIMIT = 6000;   // 10 min at 10 Hz
const BOARD = { length: 1.3, width: 0.9, thickness: 0.1, radius: 0.22 }; // half extents (forward, left, up)
const GROUND = -0.95;
// Camera from behind-right and above, so the board's front and its heading marks on the dial stay in view.
const DEFAULT_VIEW = { az: Math.PI + 1.1, el: 0.5, zoom: 1 };   // height of the horizon dial below the board
const DIAL = 2.0;       // dial radius

/** Counter-clockwise (seen from above) rounded-rectangle outline of the board in the forward/left plane. */
function roundedRect(length, width, radius, segments = 6) {
  const points = [];
  [[1, 1, 0], [-1, 1, 1], [-1, -1, 2], [1, -1, 3]].forEach(([sf, sl, quadrant]) => {
    for (let i = 0; i <= segments; i++) {
      const a = (quadrant + i / segments) * Math.PI / 2;
      points.push([sf * (length - radius) + radius * Math.cos(a), sl * (width - radius) + radius * Math.sin(a)]);
    }
  });
  return points;
}
const OUTLINE = roundedRect(BOARD.length, BOARD.width, BOARD.radius);
const INSET = roundedRect(BOARD.length - 0.07, BOARD.width - 0.07, BOARD.radius - 0.05);
// Outward normal of each side facet (outline is counter-clockwise).
const OUTLINE_NORMALS = OUTLINE.map(([f0, l0], i) => { const [f1, l1] = OUTLINE[(i + 1) % OUTLINE.length]; const n = Math.hypot(f1 - f0, l1 - l0) || 1; return [(l1 - l0) / n, -(f1 - f0) / n]; });

// Colors as [r, g, b] so faces can be lit; theme tokens are hex.
const parseColor = text => { const match = /^#([0-9a-f]{6})$/i.exec(text.trim()); if (!match) return [128, 128, 128]; const n = parseInt(match[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const mixColor = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const shadeColor = (c, k) => c.map(v => Math.min(255, v * k));
const css = (c, alpha = 1) => `rgba(${c.map(Math.round).join(', ')}, ${alpha})`;

/** Convex hull of 2D points (monotone chain). */
function hull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => { const out = []; for (const p of list) { while (out.length >= 2 && turn(out.at(-2), out.at(-1), p) <= 0) out.pop(); out.push(p); } out.pop(); return out; };
  return [...half(sorted), ...half([...sorted].reverse())];
}

// ---------------------------------------------------------------- 3×3 math (row-major arrays)
const mul = (a, b) => { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; };
const transpose = m => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const det = m => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
const rotX = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotY = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ = a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const wrap = (value, period) => value - period * Math.round(value / period);

/** Sensor-frame rotation from [roll, pitch, yaw] in radians; `order` lists intrinsic axes, outermost first. */
export function eulerToMatrix([roll, pitch, yaw], order = 'ZYX') {
  const parts = { X: rotX(roll), Y: rotY(pitch), Z: rotZ(yaw) };
  return [...order].map(axis => parts[axis]).reduce(mul);
}

/** Columns are the display-frame (FLU) directions of the sensor X/Y/Z axes; null if two coincide. */
export function axisMatrix(axes) {
  const [x, y, z] = axes.map(key => DIRECTIONS[key]);
  if (!x || !y || !z) return null;
  const m = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  return Math.abs(det(m)) < 0.5 ? null : m;
}

/** Rotation angle of a rotation matrix, radians. */
const rotationAngle = m => Math.acos(Math.max(-1, Math.min(1, (m[0] + m[4] + m[8] - 1) / 2)));

export function activate(studio) {
  const { h, icon, iconButton, pickVariable } = studio.ui;
  const { t, addTranslations } = studio.i18n;
  addTranslations('zh', ZH);

  studio.views.register('view', {
    title: t('IMU Attitude'),
    icon: 'cube',
    location: 'editor',
    render(container) {
      const config = { ...DEFAULTS, ...studio.storage.get('config', {}) };
      const persist = () => studio.storage.set('config', config);

      // ------------------------------------------------ state
      let latest = null;      // [roll, pitch, yaw] in the configured unit
      let zero = null;        // { angles, matrix, at }
      let collecting = null;  // { until, sums: [[sin, cos] ×3] , n }
      let deltas = null;      // unwrapped Δ per axis, degrees
      let history = [];       // { t (ms since zero), d: [Δroll, Δpitch, Δyaw] }
      let lastHistoryAt = -Infinity;
      let range = { min: Infinity, max: -Infinity }; // raw values seen this session, to spot radians shown as degrees
      let dirty = true;
      let frame = 0;
      const view = { ...DEFAULT_VIEW };

      const toRad = () => (config.unit === 'deg' ? Math.PI / 180 : 1);
      const toDeg = () => (config.unit === 'deg' ? 1 : 180 / Math.PI);
      const mapping = () => axisMatrix(config.axes) || axisMatrix(DEFAULT_AXES);
      const channel = key => (config[key] ? studio.session.variable(config[key])?.id ?? null : null);

      const restartZero = () => { zero = null; collecting = null; deltas = null; history = []; lastHistoryAt = -Infinity; dirty = true; };

      const accept = angles => {
        if (angles.some(value => !Number.isFinite(value))) return;
        latest = angles;
        for (const value of angles) { range.min = Math.min(range.min, value); range.max = Math.max(range.max, value); }
        const now = performance.now();
        if (!zero) {
          collecting ??= { until: now + ZERO_WINDOW_MS, sums: ANGLES.map(() => [0, 0]), n: 0 };
          angles.forEach((value, i) => { collecting.sums[i][0] += Math.sin(value * toRad()); collecting.sums[i][1] += Math.cos(value * toRad()); });
          collecting.n++;
          if (now >= collecting.until) {
            const reference = collecting.sums.map(([s, c]) => Math.atan2(s, c) / toRad());
            zero = { angles: reference, matrix: eulerToMatrix(reference.map(v => v * toRad()), config.order), at: now };
            deltas = [0, 0, 0];
            collecting = null;
          }
        } else {
          // Unwrap so a yaw drifting past ±180° keeps accumulating instead of jumping.
          deltas = deltas.map((previous, i) => previous + wrap((angles[i] - zero.angles[i]) * toDeg() - previous, 360));
          if (now - lastHistoryAt >= HISTORY_STEP_MS) {
            lastHistoryAt = now;
            history.push({ t: now - zero.at, d: [...deltas] });
            if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT * 0.9);
          }
        }
        dirty = true;
      };

      // ------------------------------------------------ data
      let ids = [];
      const resubscribe = () => {
        ids = ANGLES.map(channel);
        const live = ids.filter(Boolean);
        if (live.length) studio.session.subscribe(live, Number(config.rate) || 100);
        else studio.session.unsubscribe();
        dirty = true;
      };
      const readOnce = async () => {
        if (!studio.session.connected || !ids.some(Boolean)) return;
        try {
          const values = await studio.session.readValues(ids.filter(Boolean));
          accept(ids.map(id => (id ? values.get(id) : 0)));
        } catch { /* target busy; streaming resumes */ }
      };
      const onSamples = batch => {
        const columns = ids.map(id => (id ? batch.channelIds.indexOf(id) : -1));
        if (!columns.some(index => index >= 0)) return;
        const width = batch.channelIds.length;
        for (let s = 0; s < batch.sampleCount; s++) {
          accept(ids.map((id, k) => (!id ? 0 : columns[k] < 0 ? NaN : batch.values[s * width + columns[k]])));
        }
      };

      /** Pre-fill unset variables from catalog names ending in roll/pitch/yaw. */
      const guessVariables = () => {
        if (ANGLES.some(key => config[key])) return false;
        const found = {};
        const walk = items => { for (const item of items || []) {
          if (item.children?.length) { walk(item.children); continue; }
          const name = (item.name || '').toLowerCase();
          for (const key of ANGLES) if (!found[key] && (name === key || name.endsWith(`_${key}`) || name.endsWith(`.${key}`))) found[key] = item.expression || item.id;
        } };
        walk(studio.session.catalog);
        if (!ANGLES.every(key => found[key])) return false;
        Object.assign(config, found);
        persist();
        return true;
      };

      // ------------------------------------------------ toolbar
      const pickers = {};
      const renderPickers = () => {
        for (const key of ANGLES) {
          const { button, clear } = pickers[key];
          button.replaceChildren(config[key] || t('Choose…'));
          button.classList.toggle('faint', !config[key]);
          clear.hidden = !config[key];
        }
      };
      const setVariable = (key, value) => { config[key] = value; range = { min: Infinity, max: -Infinity }; persist(); renderPickers(); resubscribe(); restartZero(); readOnce(); };
      for (const key of ANGLES) {
        const button = h('button', { class: 'btn small mono', title: t(LABELS[key]), onclick: event => pickVariable(event.currentTarget, item => setVariable(key, item.expression || item.id)) });
        const clear = iconButton('close', t('Clear'), () => setVariable(key, ''), { class: 'small' });
        pickers[key] = { button, clear };
      }
      const setUnit = unit => { config.unit = unit; unitSelect.value = unit; persist(); restartZero(); };
      const unitSelect = h('select', { title: t('Unit'), onchange: event => setUnit(event.target.value) },
        [['deg', t('Degrees (°)')], ['rad', t('Radians (rad)')]].map(([value, label]) => h('option', { value, selected: config.unit === value }, label)));
      const orderSelect = h('select', { title: t('Rotation order'), onchange: event => { config.order = event.target.value; persist(); restartZero(); } },
        Object.entries(ORDERS).map(([value, label]) => h('option', { value, selected: config.order === value }, label)));
      const rateSelect = h('select', { onchange: event => { config.rate = Number(event.target.value); persist(); resubscribe(); } },
        [50, 100, 200, 500].map(value => h('option', { value, selected: Number(config.rate) === value }, `${value} Hz`)));

      const axisStatus = h('span', { class: 'faint' });
      const axisSelects = [0, 1, 2].map(index => h('select', { onchange: event => { config.axes = config.axes.map((value, i) => (i === index ? event.target.value : value)); persist(); renderAxes(); restartZero(); } },
        Object.keys(DIRECTIONS).map(value => h('option', { value }, t(DIRECTION_LABELS[value])))));
      const renderAxes = () => {
        axisSelects.forEach((select, i) => { select.value = config.axes[i]; });
        const m = axisMatrix(config.axes);
        axisStatus.textContent = !m ? t('Two sensor axes point the same way; using the default mapping.') : det(m) < 0 ? t('Left-handed mapping: check the sign of one axis.') : '';
        axisStatus.style.color = m && det(m) > 0 ? '' : 'var(--warn)';
        dirty = true;
      };

      // ------------------------------------------------ readouts
      const cell = () => h('span', { class: 'mono', style: { textAlign: 'right' } });
      const rows = ANGLES.map(key => ({ key, current: cell(), reference: cell(), delta: cell(), rate: cell() }));
      const totalCell = h('span', { class: 'mono' });
      const elapsedCell = h('span', { class: 'mono' });
      const message = h('div', { class: 'faint', style: { padding: '6px 0' } });
      const radiansHint = h('div', { class: 'row', hidden: true, style: { gap: '8px', padding: '6px 8px', borderRadius: '6px', background: 'color-mix(in srgb, var(--warn) 14%, transparent)', color: 'var(--warn)' } },
        h('span', { class: 'grow' }, t('Values stay within ±π while moving: they look like radians.')),
        h('button', { class: 'btn small', onclick: () => setUnit('rad') }, t('Use radians')));
      const readouts = h('div', { style: { display: 'grid', gridTemplateColumns: 'auto repeat(4, minmax(0, 1fr))', gap: '4px 10px', alignItems: 'baseline' } },
        h('span'), ...[t('Current'), t('Reference'), t('Δ'), `${t('Drift')} °/min`].map(text => h('span', { class: 'faint', style: { textAlign: 'right', fontSize: '11px' } }, text)),
        ...rows.flatMap(row => [h('b', { style: { color: `var(--plot-${ANGLES.indexOf(row.key) + 1})` } }, t(LABELS[row.key])), row.current, row.reference, row.delta, row.rate]));

      const stage = h('canvas', { style: { width: '100%', height: '100%', display: 'block', cursor: 'grab', touchAction: 'none' } });
      const chart = h('canvas', { style: { width: '100%', height: '150px', display: 'block' } });

      container.append(
        h('div', { class: 'view-toolbar', style: { flexWrap: 'wrap' } },
          ...ANGLES.flatMap(key => [h('span', { class: 'faint' }, t(LABELS[key])), pickers[key].button, pickers[key].clear]),
          unitSelect, orderSelect, rateSelect, h('span', { class: 'grow' }),
          h('button', { class: 'btn small primary', title: t('Capture the current attitude as the reference pose'), onclick: () => { restartZero(); readOnce(); } }, icon('refresh'), t('Re-zero'))),
        h('div', { class: 'view-toolbar', style: { flexWrap: 'wrap' } },
          h('span', { class: 'faint' }, t('Sensor axes')),
          ...['X', 'Y', 'Z'].flatMap((axis, i) => [h('b', { class: 'mono', style: { color: `var(--${['err', 'ok', 'info'][i]})` } }, `${axis} →`), axisSelects[i]]),
          h('button', { class: 'btn small ghost', onclick: () => { config.axes = [...DEFAULT_AXES]; persist(); renderAxes(); restartZero(); } }, t('Default (X forward, Y left, Z up)')),
          axisStatus),
        h('div', { style: { flex: '1', minHeight: '0', display: 'flex', flexWrap: 'wrap' } },
          h('div', { style: { flex: '1 1 360px', minHeight: '280px', position: 'relative' } }, stage,
            h('div', { class: 'faint', style: { position: 'absolute', right: '10px', top: '8px', fontSize: '11px', pointerEvents: 'none' } }, t('Drag to orbit · wheel to zoom · double-click to reset view'))),
          h('div', { style: { flex: '0 1 340px', minWidth: '280px', padding: '10px 14px', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '8px' } },
            message, radiansHint, readouts,
            h('div', { class: 'row', style: { gap: '14px' } }, h('span', null, h('span', { class: 'faint' }, `${t('Total Δ')} `), totalCell), h('span', null, h('span', { class: 'faint' }, `${t('Since zero')} `), elapsedCell)),
            h('div', { class: 'faint', style: { fontSize: '11px', marginTop: '6px' } }, t('Drift since zero')),
            chart)));

      // ------------------------------------------------ camera interaction
      let drag = null;
      stage.addEventListener('pointerdown', event => { drag = { x: event.clientX, y: event.clientY, az: view.az, el: view.el }; stage.setPointerCapture(event.pointerId); stage.style.cursor = 'grabbing'; });
      stage.addEventListener('pointermove', event => {
        if (!drag) return;
        view.az = drag.az - (event.clientX - drag.x) * 0.01;
        view.el = Math.max(-1.45, Math.min(1.45, drag.el + (event.clientY - drag.y) * 0.01));
        dirty = true;
      });
      stage.addEventListener('pointerup', () => { drag = null; stage.style.cursor = 'grab'; });
      stage.addEventListener('wheel', event => { event.preventDefault(); view.zoom = Math.max(0.4, Math.min(3, view.zoom * Math.exp(-event.deltaY * 0.001))); dirty = true; }, { passive: false });
      stage.addEventListener('dblclick', () => { Object.assign(view, DEFAULT_VIEW); dirty = true; });

      // ------------------------------------------------ drawing
      const fit = canvas => {
        const ratio = window.devicePixelRatio || 1;
        const { width, height } = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.round(width * ratio)), hgt = Math.max(1, Math.round(height * ratio));
        if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        return { ctx, width, height };
      };
      const palette = () => {
        const style = getComputedStyle(container);
        const get = name => style.getPropertyValue(name).trim();
        const color = name => parseColor(get(name));
        const bg0 = color('--bg-0'), fg0 = color('--fg-0'), accent = color('--accent');
        const dark = bg0[0] + bg0[1] + bg0[2] < 384;
        return {
          dark, bg0, bg1: color('--bg-1'), fg0, fg2: color('--fg-2'), accent, warn: color('--warn'),
          x: color('--err'), y: color('--ok'), z: color('--info'),
          top: dark ? mixColor(color('--bg-3'), accent, 0.22) : mixColor([255, 255, 255], accent, 0.28),
          side: dark ? color('--bg-4') : mixColor(color('--bg-4'), fg0, 0.15),
          chip: dark ? [24, 27, 33] : [52, 58, 68],
          // Chart colors stay CSS strings.
          faint: get('--fg-3'), line: get('--line'), strong: get('--line-strong'), plots: [get('--plot-1'), get('--plot-2'), get('--plot-3')],
          font: get('--font-mono') || 'monospace', monoFont: get('--font-mono') || 'monospace', uiFont: get('--font-ui') || 'sans-serif',
        };
      };

      const drawStage = colors => {
        const { ctx, width, height } = fit(stage);
        const background = ctx.createRadialGradient(width / 2, height * 0.45, 0, width / 2, height * 0.45, Math.max(width, height) * 0.75);
        background.addColorStop(0, css(colors.bg1)); background.addColorStop(1, css(colors.bg0));
        ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);

        const d = [Math.cos(view.el) * Math.cos(view.az), Math.cos(view.el) * Math.sin(view.az), Math.sin(view.el)];
        const right = normalize(cross(d.map(x => -x), [0, 0, 1]));
        const up = cross(right, d.map(x => -x));
        const distance = 8;
        // Fit the dial (with labels) horizontally and dial + Z axis vertically.
        const scale = Math.min(width / 5.4, height / 4.3) * view.zoom;
        const project = p => { const f = distance / (distance - dot(p, d)); return [width / 2 + dot(p, right) * f * scale, height / 2 - dot(p, up) * f * scale]; };
        const path = points => { ctx.beginPath(); points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); };
        const ring = (radius, steps = 96) => Array.from({ length: steps }, (_, i) => project([radius * Math.cos(i / steps * Math.PI * 2), radius * Math.sin(i / steps * Math.PI * 2), GROUND]));

        // Horizon dial: rings, compass ticks and labels in the display frame.
        path(ring(DIAL)); ctx.closePath(); ctx.fillStyle = css(colors.fg0, colors.dark ? 0.025 : 0.035); ctx.fill();
        ctx.lineWidth = 1;
        for (const radius of [DIAL / 3, (DIAL * 2) / 3, DIAL]) { path(ring(radius)); ctx.closePath(); ctx.strokeStyle = css(colors.fg0, radius === DIAL ? 0.16 : 0.07); ctx.stroke(); }
        for (let deg = 0; deg < 360; deg += 15) {
          const a = deg * Math.PI / 180, inner = DIAL - (deg % 90 ? 0.08 : 0.2);
          path([project([inner * Math.cos(a), inner * Math.sin(a), GROUND]), project([DIAL * Math.cos(a), DIAL * Math.sin(a), GROUND])]);
          ctx.strokeStyle = css(colors.fg0, deg % 90 ? 0.18 : 0.4); ctx.stroke();
        }
        ctx.font = `600 11px ${colors.uiFont}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        [['Forward', 0], ['Left', 90], ['Back', 180], ['Right', 270]].forEach(([label, deg]) => {
          const a = deg * Math.PI / 180;
          const [x, y] = project([(DIAL + 0.28) * Math.cos(a), (DIAL + 0.28) * Math.sin(a), GROUND]);
          ctx.fillStyle = css(deg ? colors.fg2 : colors.accent); ctx.fillText(t(label), x, y);
        });
        ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';

        const m = mapping();
        const toDisplay = sensor => mul(mul(m, sensor), transpose(m));
        const heading = rotation => { const nose = apply(rotation, [1, 0, 0]); return Math.hypot(nose[0], nose[1]) < 0.2 ? null : Math.atan2(nose[1], nose[0]); };
        const reference = zero ? toDisplay(zero.matrix) : null;
        const rotation = latest ? toDisplay(eulerToMatrix(latest.map(v => v * toRad()), config.order)) : null;

        // Heading marks on the dial; the arc between them is the yaw drift.
        const mark = (angle, color, width) => {
          path([project([(DIAL - 0.4) * Math.cos(angle), (DIAL - 0.4) * Math.sin(angle), GROUND]), project([(DIAL + 0.1) * Math.cos(angle), (DIAL + 0.06) * Math.sin(angle), GROUND])]);
          ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt';
        };
        const referenceHeading = reference && heading(reference);
        const currentHeading = rotation && heading(rotation);
        if (referenceHeading != null && currentHeading != null) {
          const sweep = wrap(currentHeading - referenceHeading, Math.PI * 2);
          const steps = Math.max(2, Math.ceil(Math.abs(sweep) / 0.05));
          const arc = radius => Array.from({ length: steps + 1 }, (_, i) => { const a = referenceHeading + sweep * i / steps; return project([radius * Math.cos(a), radius * Math.sin(a), GROUND]); });
          path([...arc(DIAL), ...arc(DIAL - 0.36).reverse()]); ctx.closePath();
          ctx.fillStyle = css(colors.warn, 0.45); ctx.fill();
        }
        if (referenceHeading != null) mark(referenceHeading, css(colors.fg2), 2.5);
        if (currentHeading != null) mark(currentHeading, css(colors.accent), 4);

        // Reference pose: dashed footprint and nose line.
        if (reference) {
          const outline = OUTLINE.map(([f, l]) => project(apply(reference, [f, l, BOARD.thickness])));
          path(outline); ctx.closePath();
          ctx.fillStyle = css(colors.fg0, 0.035); ctx.fill();
          ctx.setLineDash([5, 5]); ctx.strokeStyle = css(colors.fg2, 0.8); ctx.lineWidth = 1.2; ctx.stroke();
          const tail = project(apply(reference, [BOARD.length, 0, BOARD.thickness]));
          const nose = project(apply(reference, [BOARD.length + 0.55, 0, BOARD.thickness]));
          path([tail, nose]); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = css(colors.fg2); ctx.font = `11px ${colors.uiFont}`; ctx.fillText(t('reference'), nose[0] + 5, nose[1] + 4);
        }
        if (!rotation) return;

        // Soft shadow straight down onto the dial.
        const footprint = hull([1, -1].flatMap(side => OUTLINE.map(([f, l]) => { const p = apply(rotation, [f, l, side * BOARD.thickness]); return project([p[0], p[1], GROUND]); })));
        ctx.save(); ctx.filter = 'blur(10px)'; path(footprint); ctx.closePath(); ctx.fillStyle = `rgba(0, 0, 0, ${colors.dark ? 0.55 : 0.22})`; ctx.fill(); ctx.restore();

        // Sensor axes: the part pointing away from the camera is drawn before the board.
        const origin = project([0, 0, 0]);
        const axes = ['X', 'Y', 'Z'].map((label, k) => {
          const direction = apply(rotation, [m[k], m[3 + k], m[6 + k]]);
          return { label, direction, color: colors[label.toLowerCase()], behind: dot(direction, d) < 0 };
        });
        const drawAxis = ({ label, direction, color }) => {
          const tip = project(direction.map(v => v * 1.75));
          const angle = Math.atan2(tip[1] - origin[1], tip[0] - origin[0]);
          const base = [tip[0] - 11 * Math.cos(angle), tip[1] - 11 * Math.sin(angle)];
          ctx.strokeStyle = css(color); ctx.fillStyle = css(color); ctx.lineWidth = 2.5; ctx.lineCap = 'round';
          path([origin, base]); ctx.stroke(); ctx.lineCap = 'butt';
          path([tip, [base[0] + 5 * Math.sin(angle), base[1] - 5 * Math.cos(angle)], [base[0] - 5 * Math.sin(angle), base[1] + 5 * Math.cos(angle)]]); ctx.closePath(); ctx.fill();
          const at = [tip[0] + 12 * Math.cos(angle), tip[1] + 12 * Math.sin(angle)];
          ctx.beginPath(); ctx.arc(at[0], at[1], 8, 0, Math.PI * 2); ctx.fillStyle = css(color, 0.18); ctx.fill();
          ctx.fillStyle = css(color); ctx.font = `700 11px ${colors.monoFont}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(label, at[0], at[1] + 0.5); ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
        };
        axes.filter(axis => axis.behind).forEach(drawAxis);

        // Board: a rounded slab, back faces culled (it is convex, so no sorting is needed).
        const light = normalize([-0.35, 0.45, 1]);
        const lit = (color, normal) => shadeColor(color, 0.5 + 0.55 * Math.max(0, dot(normal, light)));
        const top = OUTLINE.map(([f, l]) => apply(rotation, [f, l, BOARD.thickness]));
        const bottom = OUTLINE.map(([f, l]) => apply(rotation, [f, l, -BOARD.thickness]));
        const topNormal = apply(rotation, [0, 0, 1]);
        if (dot(topNormal, d) < 0) { path(bottom.map(project)); ctx.closePath(); ctx.fillStyle = css(lit(colors.side, topNormal.map(v => -v))); ctx.fill(); }
        OUTLINE.forEach(([f, l], i) => {
          const j = (i + 1) % OUTLINE.length;
          const [nf, nl] = OUTLINE_NORMALS[i];
          const normal = apply(rotation, [nf, nl, 0]);
          if (dot(normal, d) <= 0) return;
          path([top[i], top[j], bottom[j], bottom[i]].map(project)); ctx.closePath();
          const base = nf > 0.7 ? mixColor(colors.side, colors.accent, 0.55) : colors.side;
          ctx.fillStyle = css(lit(base, normal)); ctx.fill();
          ctx.strokeStyle = css(lit(base, normal)); ctx.lineWidth = 0.6; ctx.stroke(); // hide seams between facets
        });
        if (dot(topNormal, d) > 0) {
          const onTop = (f, l) => project(apply(rotation, [f, l, BOARD.thickness + 0.002]));
          path(top.map(project)); ctx.closePath();
          ctx.fillStyle = css(lit(colors.top, topNormal)); ctx.fill();
          ctx.strokeStyle = css(mixColor(colors.top, colors.fg0, 0.25)); ctx.lineWidth = 1.2; ctx.stroke();
          path(INSET.map(([f, l]) => onTop(f, l))); ctx.closePath(); ctx.strokeStyle = css(colors.fg0, 0.1); ctx.lineWidth = 1; ctx.stroke();
          // IMU chip with pins.
          const [cf, cl, cs] = [-0.2, 0, 0.26];
          ctx.strokeStyle = css(colors.fg0, 0.35); ctx.lineWidth = 1;
          for (let i = -2; i <= 2; i++) for (const [f0, l0, f1, l1] of [[cf + cs, cl + i * 0.09, cf + cs + 0.07, cl + i * 0.09], [cf - cs, cl + i * 0.09, cf - cs - 0.07, cl + i * 0.09], [cf + i * 0.09, cl + cs, cf + i * 0.09, cl + cs + 0.07], [cf + i * 0.09, cl - cs, cf + i * 0.09, cl - cs - 0.07]]) {
            path([onTop(f0, l0), onTop(f1, l1)]); ctx.stroke();
          }
          path([[cf + cs, cl + cs], [cf - cs, cl + cs], [cf - cs, cl - cs], [cf + cs, cl - cs]].map(([f, l]) => onTop(f, l))); ctx.closePath();
          ctx.fillStyle = css(lit(colors.chip, topNormal)); ctx.fill();
          ctx.beginPath(); const dotAt = onTop(cf + cs - 0.08, cl + cs - 0.08); ctx.arc(dotAt[0], dotAt[1], 2, 0, Math.PI * 2); ctx.fillStyle = css(colors.fg0, 0.5); ctx.fill();
          // Chevron pointing forward.
          path([[BOARD.length - 0.12, 0], [BOARD.length - 0.42, 0.26], [BOARD.length - 0.34, 0], [BOARD.length - 0.42, -0.26]].map(([f, l]) => onTop(f, l))); ctx.closePath();
          ctx.fillStyle = css(colors.accent); ctx.fill();
        }
        axes.filter(axis => !axis.behind).forEach(drawAxis);

        // Display-frame gizmo.
        const gizmo = [30, height - 30];
        [['+F', 'Forward'], ['+L', 'Left'], ['+U', 'Up']].forEach(([key, label]) => {
          const v = DIRECTIONS[key];
          const end = [gizmo[0] + dot(v, right) * 20, gizmo[1] - dot(v, up) * 20];
          ctx.strokeStyle = css(colors.fg2); ctx.lineWidth = 1.5; path([gizmo, end]); ctx.stroke();
          ctx.fillStyle = css(colors.fg2); ctx.font = `11px ${colors.uiFont}`; ctx.fillText(t(label), end[0] + 3, end[1] - 2);
        });
      };

      const drawChart = colors => {
        const { ctx, width, height } = fit(chart);
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = colors.line; ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
        if (history.length < 2) return;
        const span = Math.max(1000, history.at(-1).t);
        const limit = Math.max(0.5, ...history.flatMap(point => point.d.map(Math.abs))) * 1.1;
        const x = time => 4 + (time / span) * (width - 8);
        const y = value => height / 2 - (value / limit) * (height / 2 - 6);
        ctx.strokeStyle = colors.strong; ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(width, y(0)); ctx.stroke();
        [0, 1, 2].forEach(k => {
          ctx.strokeStyle = colors.plots[k]; ctx.lineWidth = 1.5; ctx.beginPath();
          history.forEach((point, i) => (i ? ctx.lineTo(x(point.t), y(point.d[k])) : ctx.moveTo(x(point.t), y(point.d[k]))));
          ctx.stroke();
        });
        ctx.fillStyle = colors.faint; ctx.font = `10px ${colors.font}`;
        ctx.fillText(`±${limit.toPrecision(2)}°`, 6, 12);
        const label = `${(span / 1000).toFixed(0)} s`;
        ctx.fillText(label, width - 6 - ctx.measureText(label).width, height - 6);
      };

      /** Least-squares slope of Δ over time, °/min; robust against motion that oscillates around the drift. */
      const driftRate = k => {
        if (history.length < 10 || history.at(-1).t - history[0].t < 2000) return null;
        let st = 0, sd = 0, stt = 0, std = 0;
        for (const { t: time, d } of history) { st += time; sd += d[k]; stt += time * time; std += time * d[k]; }
        const n = history.length;
        const denominator = n * stt - st * st;
        return denominator ? ((n * std - st * sd) / denominator) * 60000 : null;
      };

      const fmt = (value, digits = 2) => (value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits));
      const renderReadouts = () => {
        const configured = ANGLES.some(key => config[key]);
        message.textContent = !studio.session.connected ? t('Connect a target to stream attitude.') : !configured ? t('Choose the roll, pitch and yaw variables.') : !zero ? t('Recording reference pose…') : '';
        message.hidden = !message.textContent;
        radiansHint.hidden = !(config.unit === 'deg' && range.max - range.min >= 1.5 && Math.max(Math.abs(range.min), Math.abs(range.max)) <= 3.25);
        const digits = config.unit === 'deg' ? 2 : 4;
        rows.forEach((row, k) => {
          row.current.textContent = latest ? fmt(latest[k], digits) : '—';
          row.reference.textContent = zero ? fmt(zero.angles[k], digits) : '—';
          row.delta.textContent = deltas ? `${fmt(deltas[k])}°` : '—';
          row.rate.textContent = fmt(driftRate(k), 3);
        });
        const relative = zero && latest ? mul(transpose(zero.matrix), eulerToMatrix(latest.map(v => v * toRad()), config.order)) : null;
        totalCell.textContent = relative ? `${fmt(rotationAngle(relative) * 180 / Math.PI)}°` : '—';
        const elapsed = zero ? (performance.now() - zero.at) / 1000 : null;
        elapsedCell.textContent = elapsed == null ? '—' : elapsed < 120 ? `${elapsed.toFixed(0)} s` : `${(elapsed / 60).toFixed(1)} min`;
      };

      let lastReadout = 0;
      const tick = now => {
        frame = requestAnimationFrame(tick);
        if (!dirty && now - lastReadout < 1000) return;
        dirty = false;
        const colors = palette();
        drawStage(colors);
        drawChart(colors);
        if (now - lastReadout > 100) { lastReadout = now; renderReadouts(); }
      };

      // ------------------------------------------------ lifecycle
      const onConnected = () => { guessVariables(); renderPickers(); resubscribe(); restartZero(); readOnce(); };
      const offs = [
        studio.session.on('samples', onSamples),
        studio.session.on('connected', onConnected),
        studio.session.on('catalog', () => { if (guessVariables()) { renderPickers(); resubscribe(); restartZero(); } else resubscribe(); }),
        studio.session.on('stopped', readOnce),
        studio.session.on('status', status => { if (status === 'disconnected') { latest = null; range = { min: Infinity, max: -Infinity }; restartZero(); } }),
      ];
      renderPickers();
      renderAxes();
      if (studio.session.connected) onConnected();
      frame = requestAnimationFrame(tick);
      return {
        dispose: () => { cancelAnimationFrame(frame); offs.forEach(off => off()); studio.session.unsubscribe(); },
        onHide: () => cancelAnimationFrame(frame),
        onShow: () => { cancelAnimationFrame(frame); dirty = true; frame = requestAnimationFrame(tick); },
      };
    },
  });

  studio.commands.register('open', t('Open IMU attitude view'), () => studio.views.open('view'));
  studio.ui.addToolbarButton({ title: t('IMU Attitude'), icon: 'cube', run: () => studio.views.open('view') });
}
