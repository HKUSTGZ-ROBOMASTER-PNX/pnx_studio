const translations = {
  'Embedded Environment Setup': '嵌入式环境配置', 'Open Embedded Environment Setup': '打开嵌入式环境配置',
  'Platform': '平台', 'Installation directory': '安装目录', 'Choose folder': '选择文件夹',
  'Scan only': '仅扫描', 'Scan and configure': '扫描并配置', 'Waiting for response': '等待回答',
  'Answer': '回答', 'Send': '发送', 'Yes': '是', 'No': '否', 'Running': '正在运行',
  'Finished': '进程已结束', 'Idle': '就绪', 'Output': '输出',
  'Scanning can take a long time. Progress and discovered tools appear below.': '全盘扫描可能耗时较长，下方显示扫描进度和发现的工具。',
  'The installer asks before modifying files, PATH, or existing installations. Review each question and the final output.': '安装程序会在修改文件、PATH 或现有安装前逐项询问。请检查每个问题及最终输出。',
  'On Linux and macOS, sudo cannot prompt for a password here; privileged operations require existing sudo authorization or a terminal.': 'Linux 和 macOS 下此界面不能输入 sudo 密码；提权操作需要已有 sudo 授权或在终端中运行。',
  'Exit code': '退出代码', 'No response yet': '尚无输出', 'New terminals may be needed to use updated PATH.': '更新 PATH 后可能需要重新打开终端。'
};
Object.assign(translations, {
  'Components': '安装组件', 'Skip': '不处理', 'Use existing or install': '使用已有版本或安装',
  'Reinstall / move': '重装到目标位置', 'Install': '开始安装', 'Quit': '退出',
  'Choose what to do for each tool. Reinstall may remove old copies after the replacement is verified; the script asks before removal.': '为每个工具选择处理方式。重装会在新版本验证后尝试清理旧副本，删除前会询问。',
  'CubeMX uses its own installation wizard and does not support automatic replacement here.': 'CubeMX 使用自己的安装向导，此处不支持自动覆盖已安装版本。',
  'On Linux and macOS, Git, Ninja and OpenOCD use the system or Homebrew package location.': '在 Linux 和 macOS 上，Git、Ninja 和 OpenOCD 使用系统或 Homebrew 的安装位置。',
  'Scanning': '正在扫描', 'Scan completed': '扫描完成', 'Finishing': '正在处理',
  'Scanned directories': '已扫描目录', 'Candidates found': '发现的工具', 'Access denied': '无权访问',
  'Scan errors': '扫描错误', 'Current directory': '当前目录', 'Elapsed': '已用时间', 'seconds': '秒',
  'Tool paths found (not version-checked)': '发现的工具路径（尚未检查版本）',
  'Installation results': '组件处理结果',
  'Direct install': '直接安装所选组件', 'Select for direct installation': '选择直接安装的组件',
  'Direct installation checks only PATH and the chosen installation directory; other locations are not scanned.': '直接安装只检查 PATH 和选定安装目录，不扫描其他位置。',
  'Check the components to install directly. Unchecked components are not processed.': '勾选要直接安装的组件，未勾选的组件不会处理。',
  'Select at least one component for direct installation.': '请勾选至少一个要直接安装的组件。',
  'Preparing selected components': '正在处理所选组件',
});
const tools = ['cmake', 'git', 'arm-none-eabi-gcc', 'openocd', 'STM32CubeMX', 'ninja'];
export function activate(studio) {
  studio.i18n.addTranslations('zh', translations);
  const t = s => studio.i18n.t(s), { h, notify } = studio.ui;
  let state = { phase: 'idle', log: [] }, info = null, directory = '', answer = '', repaint = () => {};
  const components = Object.fromEntries(tools.map(name => [name, 'reuse']));
  const directSelection = new Set();
  const invoke = async (name, args) => { try { return await studio.main.invoke(name, args); } catch (e) { notify(e.message, 'error'); throw e; } };
  studio.main.onMessage(message => { if (message?.type === 'state') { state = message.state; repaint(); } });
  Promise.all([studio.main.invoke('platform'), studio.main.invoke('state')]).then(([p, s]) => { info = p; directory ||= p.defaultDir; state = s; repaint(); }).catch(e => notify(e.message, 'error'));
  studio.views.register('view', { title: t('Embedded Environment Setup'), icon: 'settings', location: 'editor', render(container) {
    const style = h('style', null, '.setup-body{padding:20px;overflow:auto;flex:1;min-height:0}.setup-body .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.setup-body input{min-width:240px;flex:1}.setup-card{padding:14px;border:1px solid var(--line);border-radius:6px;margin:12px 0}.setup-body progress{width:100%}');
    const body = h('div', { class: 'setup-body' }); container.append(style, body);
    const submit = async value => { answer = ''; try { state = await invoke('respond', { value }); repaint(); } catch {} };
    const run = async mode => {
      if (mode === 'direct' && !directSelection.size) { notify(t('Select at least one component for direct installation.'), 'error'); return; }
      const choices = mode === 'direct' ? Object.fromEntries(tools.map(name => [name, directSelection.has(name) ? (components[name] === 'reinstall' ? 'reinstall' : 'reuse') : 'skip'])) : { ...components };
      try { state = await invoke('start', { mode, directory, components: choices }); repaint(); } catch {}
    };
    repaint = () => {
      const busy = state.phase === 'running';
      const progress = state.progress;
      const stage = progress?.stage === 'direct' ? 'Preparing selected components' : progress?.stage === 'scanning' ? 'Scanning' : progress?.stage === 'scanned' ? 'Scan completed' : 'Finishing';
      const statusPanel = h('div', { class: 'setup-card', role: 'status', 'aria-live': 'polite' },
        h('strong', null, t(busy && progress ? stage : busy ? 'Running' : state.phase === 'finished' ? 'Finished' : 'Idle')),
        state.phase === 'finished' ? ` · ${t('Exit code')}: ${state.code ?? state.signal ?? '—'}` : '',
        busy ? h('progress', { 'aria-label': t(progress ? stage : 'Running') }) : null,
        progress ? h('div', null,
          state.mode !== 'direct' ? h('p', null, `${t('Scanned directories')}: ${progress.directories || 0} · ${t('Candidates found')}: ${progress.found || 0} · ${t('Access denied')}: ${progress.denied || 0} · ${t('Scan errors')}: ${progress.errors || 0} · ${t('Elapsed')}: ${progress.seconds || 0} ${t('seconds')}`) : null,
          progress.current ? h('p', { class: 'faint' }, `${t('Current directory')}: ${progress.current}`) : null,
          progress.issues?.length ? h('div', { class: 'err-text' }, ...progress.issues.map(issue => h('p', null, issue))) : null,
          progress.candidates?.length ? h('details', null, h('summary', null, t('Tool paths found (not version-checked)')), ...progress.candidates.map(item => h('div', { class: 'mono' }, item))) : null,
          Object.keys(progress.results || {}).length ? h('div', null, h('strong', null, t('Installation results')), ...Object.entries(progress.results).map(([name, result]) => h('div', null, `${name}: ${result}`))) : null) : null,
        state.prompt ? h('div', null, h('h3', null, t('Waiting for response')), h('p', null, state.prompt), h('div', { class: 'row' }, h('input', { type: 'text', value: answer, placeholder: t('Answer'), oninput: e => { answer = e.target.value; }, onkeydown: e => { if (e.key === 'Enter') submit(answer); } }), h('button', { class: 'btn', onclick: () => submit(answer) }, t('Send')), ...(/\[y=/.test(state.prompt) ? [h('button', { class: 'btn', onclick: () => submit('y') }, t('Yes')), h('button', { class: 'btn', onclick: () => submit('n') }, t('No'))] : []), ...(/\bI\s|I =/.test(state.prompt) ? [h('button', { class: 'btn primary', onclick: () => submit('I') }, t('Install')), h('button', { class: 'btn', onclick: () => submit('Q') }, t('Quit'))] : []))) : null);
      body.replaceChildren(...[h('h2', null, t('Embedded Environment Setup')),
        h('p', null, `${t('Platform')}: ${info ? `${info.platform} / ${info.arch}` : '…'}`),
        h('p', { class: 'faint' }, t('Scanning can take a long time. Progress and discovered tools appear below.')),
        h('p', { class: 'faint' }, t('The installer asks before modifying files, PATH, or existing installations. Review each question and the final output.')),
        info && info.platform !== 'win32' ? h('p', { class: 'faint' }, t('On Linux and macOS, sudo cannot prompt for a password here; privileged operations require existing sudo authorization or a terminal.')) : null,
        statusPanel,
        h('label', { class: 'field' }, h('span', null, t('Installation directory')), h('div', { class: 'row' }, h('input', { type: 'text', value: directory, disabled: busy, oninput: e => { directory = e.target.value; } }), h('button', { class: 'btn', disabled: busy, onclick: async () => { const p = await studio.host.dialog.openFolder(t('Choose folder')); if (p) { directory = p; repaint(); } } }, t('Choose folder')))),
        h('div', { class: 'setup-card' }, h('h3', null, t('Components')),
          h('p', { class: 'faint' }, t('Choose what to do for each tool. Reinstall may remove old copies after the replacement is verified; the script asks before removal.')),
          h('p', { class: 'faint' }, t('Direct installation checks only PATH and the chosen installation directory; other locations are not scanned.')),
          h('p', null, t('Check the components to install directly. Unchecked components are not processed.')),
          ...tools.map(name => h('label', { class: 'row', style: { margin: '8px 0' } }, h('span', { style: { minWidth: '180px' } }, name),
            h('input', { type: 'checkbox', style: { minWidth: '0', flex: 'none' }, checked: directSelection.has(name), disabled: busy, title: `${t('Select for direct installation')}: ${name}`, onchange: e => { if (e.target.checked) directSelection.add(name); else directSelection.delete(name); } }),
            h('select', { value: components[name], disabled: busy, onchange: e => { components[name] = e.target.value; } },
              h('option', { value: 'reuse', selected: components[name] === 'reuse' }, t('Use existing or install')),
              h('option', { value: 'skip', selected: components[name] === 'skip' }, t('Skip')),
              name !== 'STM32CubeMX' ? h('option', { value: 'reinstall', selected: components[name] === 'reinstall' }, t('Reinstall / move')) : null))),
          h('p', { class: 'faint' }, t('CubeMX uses its own installation wizard and does not support automatic replacement here.')),
          info && info.platform !== 'win32' ? h('p', { class: 'faint' }, t('On Linux and macOS, Git, Ninja and OpenOCD use the system or Homebrew package location.')) : null),
        h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', disabled: busy || !info, onclick: () => run('direct') }, t('Direct install')), h('button', { class: 'btn', disabled: busy || !info, onclick: () => run('scan') }, t('Scan only')), h('button', { class: 'btn', disabled: busy || !info, onclick: () => run('install') }, t('Scan and configure'))),
        h('p', { class: 'faint' }, t('New terminals may be needed to use updated PATH.'))].filter(Boolean));
    };
    repaint(); return { onShow: repaint, dispose: () => { repaint = () => {}; } };
  } });
  studio.commands.register('open', t('Open Embedded Environment Setup'), () => studio.views.open('view'));
}
