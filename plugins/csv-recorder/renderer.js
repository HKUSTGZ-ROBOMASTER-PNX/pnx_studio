// CSV Recorder — renderer half: a toolbar toggle and a panel to choose what to record.
// With variables selected, only those become columns and the recorder keeps them
// sampled itself (no plot needed). With none selected, every sampled channel is recorded.
const VAR_MIME = 'application/x-studio-var';
const RATES = [100, 500, 1000, 2000, 5000, 10000];

const ZH = {
  'Recorder': '录制', 'Toggle CSV recording': '开始/停止 CSV 录制',
  'Record to CSV': '录制为 CSV', 'Stop recording': '停止录制', 'Start recording': '开始录制',
  'Record samples to…': '录制到…',
  'Add variable': '添加变量', 'Clear list': '清空列表', 'Remove': '移除', 'Rate': '采样率',
  'Recorded variables': '录制的变量',
  'No variables selected: every channel being sampled (plots, other plugins) is recorded. Add variables or drag them here from Symbols / Watch to record just those.':
    '未选择变量：录制所有正在采样的通道（曲线、其它插件）。添加变量或从「变量」/「监视」拖到这里，只录制这些变量。',
  'Not recording.': '未在录制。', 'recording': '录制中', 'stopped': '已停止', '{rows} rows · {columns} columns': '{rows} 行 · {columns} 列',
  'Connect a target before recording selected variables.': '录制所选变量前请先连接目标。',
  'Not in current symbols: {names}': '当前符号中找不到：{names}',
  'Recording armed — samples are written once a target streams plotted channels.': '录制已就绪 —— 目标开始采样后写入数据。',
  'Drop to record this variable': '松开以录制此变量',
};

export function activate(studio) {
  const { h, icon, iconButton, notify, pickVariable } = studio.ui;
  const { t, addTranslations } = studio.i18n;
  addTranslations('zh', ZH);

  let state = { recording: false };
  const config = { keys: [], rate: 1000, ...studio.storage.get('config', {}) };
  const persist = () => studio.storage.set('config', config);

  const start = async () => {
    let columns = null;
    if (config.keys.length) {
      if (!studio.session.connected) { notify(t('Connect a target before recording selected variables.'), 'warn'); return; }
      const resolved = config.keys.map(key => ({ key, variable: studio.session.variable(key) }));
      const missing = resolved.filter(entry => !entry.variable?.id).map(entry => entry.key);
      if (missing.length) { notify(t('Not in current symbols: {names}', { names: missing.join(', ') }), 'warn'); return; }
      columns = resolved.map(({ key, variable }) => ({ id: variable.id, label: key }));
    }
    const file = await studio.host.dialog.saveFile({ title: t('Record samples to…'), defaultPath: 'recording.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!file) return;
    state = await studio.main.invoke('start', { file, columns });
    if (columns) studio.session.subscribe(columns.map(column => column.id), config.rate);
    else if (!studio.session.connected) notify(t('Recording armed — samples are written once a target streams plotted channels.'), 'info');
  };
  const stop = async () => {
    state = await studio.main.invoke('stop');
    studio.session.unsubscribe();
  };
  const toggle = async () => {
    try { await (state.recording ? stop() : start()); render(); }
    catch (error) { notify(error.message, 'error'); }
  };

  const button = studio.ui.addToolbarButton({ title: t('Record to CSV'), icon: 'record', run: toggle });

  // ------------------------------------------------ panel
  const add = item => {
    const key = item.expression || item.id;
    if (!key || config.keys.includes(key)) return;
    config.keys.push(key);
    persist(); render();
  };
  const list = h('div', { class: 'recorder-list' });
  const status = h('div', { class: 'mono faint', style: { userSelect: 'text', whiteSpace: 'pre-wrap', fontSize: '12px' } });
  const startButton = h('button', { class: 'btn small primary', onclick: toggle });
  const rateSelect = h('select', { title: t('Rate'), onchange: event => { config.rate = Number(event.target.value); persist(); if (state.recording && config.keys.length) studio.session.subscribe(state.columns, config.rate); } },
    RATES.map(value => h('option', { value, selected: value === config.rate }, value >= 1000 ? `${value / 1000} kHz` : `${value} Hz`)));
  const panel = h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '0', flex: '1' } },
    h('div', { class: 'view-toolbar' },
      startButton,
      h('button', { class: 'btn small', onclick: event => pickVariable(event.currentTarget, add) }, icon('plus'), t('Add variable')),
      h('span', { class: 'faint' }, t('Rate')), rateSelect,
      h('span', { class: 'grow' }),
      iconButton('close', t('Clear list'), () => { config.keys = []; persist(); render(); }, { class: 'small' })),
    h('div', { style: { padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'auto', flex: '1' } }, status, list));
  panel.addEventListener('dragover', event => { if (event.dataTransfer.types.includes(VAR_MIME)) { event.preventDefault(); panel.style.boxShadow = 'inset 0 0 0 2px var(--accent)'; } });
  panel.addEventListener('dragleave', event => { if (!panel.contains(event.relatedTarget)) panel.style.boxShadow = ''; });
  panel.addEventListener('drop', event => {
    panel.style.boxShadow = '';
    const data = event.dataTransfer.getData(VAR_MIME);
    if (data) { event.preventDefault(); add(JSON.parse(data)); }
  });

  const render = () => {
    button.classList.toggle('active', !!state.recording);
    button.style.color = state.recording ? 'var(--err)' : '';
    startButton.replaceChildren(icon(state.recording ? 'stop' : 'record'), state.recording ? t('Stop recording') : t('Start recording'));
    startButton.className = state.recording ? 'btn small' : 'btn small primary';
    status.textContent = state.file
      ? `${state.recording ? `● ${t('recording')}` : `■ ${t('stopped')}`}  ${t('{rows} rows · {columns} columns', { rows: state.rows ?? 0, columns: state.columns?.length ?? 0 })}\n${state.file}`
      : t('Not recording.');
    list.replaceChildren(config.keys.length
      ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
        h('div', { class: 'faint', style: { width: '100%', fontSize: '11px' } }, `${t('Recorded variables')} (${config.keys.length})`),
        ...config.keys.map(key => h('span', { class: 'chip mono', style: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 4px 2px 8px', borderRadius: '6px', border: '1px solid var(--line-strong)', background: 'var(--bg-2)', fontSize: '12px', opacity: studio.session.connected && !studio.session.variable(key) ? 0.5 : 1 } },
          key, state.recording ? null : iconButton('close', t('Remove'), () => { config.keys = config.keys.filter(entry => entry !== key); persist(); render(); }, { class: 'small' }))))
      : h('div', { class: 'faint', style: { fontSize: '12px', lineHeight: '1.5' } }, t('No variables selected: every channel being sampled (plots, other plugins) is recorded. Add variables or drag them here from Symbols / Watch to record just those.')));
  };

  studio.main.onMessage(message => { if (message.type === 'state') { state = message.state; render(); } });
  studio.main.invoke('state').then(value => { state = value; render(); }).catch(() => {});
  studio.session.on('catalog', render);
  studio.views.register('status', { title: t('Recorder'), icon: 'record', location: 'panel', render: container => { container.append(panel); render(); } });
  studio.commands.register('toggle', t('Toggle CSV recording'), toggle);
}
