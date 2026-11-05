// Minimal i18n: English source strings are keys; other languages map them.
// Missing entries fall back to English. `{name}` placeholders are interpolated.

const zh = {
  'Add': '添加', 'Add signal': '添加信号', 'Add to watch': '加入监视', 'Add variables from Symbols (eye icon) or with +.': '从“符号”中点击眼睛图标或用 + 添加变量。',
  'Address or symbol': '地址或符号', 'Attach, keep running': '附加，保持运行', 'Flash, reset, keep running': '烧录、复位并保持运行', 'Reset, run to main': '复位并运行到 main', 'Flash firmware before starting': '启动前烧录固件', 'Auto (single probe)': '自动（单个探针）', 'Auto refresh': '自动刷新',
  'Auto-scale Y': '自动缩放 Y 轴', 'Breakpoints': '断点', 'Browse…': '浏览…', 'Built-in Rust core (probe-rs)': '内置 Rust 内核（probe-rs）',
  'Call Stack': '调用栈', 'Call stack': '调用栈', 'Cancel': '取消', 'Choose SVD file': '选择 SVD 文件', 'Choose firmware': '选择固件',
  'Choose probe, chip and firmware': '选择探针、芯片与固件', 'Choose the target chip first': '请先选择目标芯片', 'Clear': '清空', 'Clear data': '清除数据',
  'Click the gutter of a source line to add a breakpoint.': '点击源码行号区域添加断点。', 'Click to show/hide': '点击显示/隐藏', 'Clock (kHz)': '时钟 (kHz)',
  'Close': '关闭', 'Connect': '连接', 'Connect to read core registers.': '连接后读取内核寄存器。', 'Connect to read memory.': '连接后读取内存。',
  'Connect to simulated target': '连接模拟目标', 'Connect to target': '连接目标', 'Connect to target…': '连接目标…', 'Connect under reset': '复位下连接',
  'Connected to simulated target': '已连接模拟目标', 'Connected to {chip}': '已连接 {chip}', 'Connecting…': '连接中…', 'Connection': '连接',
  'Connection failed': '连接失败', 'Connect…': '连接…', 'Console': '控制台', 'Continue': '继续', 'Copy as hex': '复制为十六进制',
  'Copy expression': '复制表达式', 'Could not read symbols': '无法读取符号', 'Dark': '深色', 'Data folder': '数据目录', 'Debug': '调试', 'Debug core': '调试内核',
  'Disconnect': '断开', 'Double-click to edit': '双击编辑', 'Double-click to toggle': '双击切换', 'Drag variables here from Symbols, or': '从「变量」面板拖入变量，或',
  'Drop plugin folders into the user plugin folder, then reload. See docs/PLUGINS.md for the API.': '将插件文件夹放入用户插件目录后重新加载。API 见 docs/PLUGINS.md。',
  'Enabled': '启用', 'Evaluate expression, e.g. motor.speed * 2   (↑ history)': '计算表达式，例如 motor.speed * 2   （↑ 历史）', 'Explorer': '资源管理器',
  'Export CSV': '导出 CSV', 'Export PNG': '导出 PNG', 'Filter peripherals / registers': '筛选外设 / 寄存器', 'Filter variables': '筛选变量', 'Firmware ELF': '固件 ELF',
  'Firmware project with sources and ELF': '包含源码与 ELF 的固件工程', 'Firmware set to {file}': '固件已设为 {file}', 'Firmware with DWARF debug info (.elf / .axf)': '含 DWARF 调试信息的固件（.elf / .axf）',
  'Flash complete': '烧录完成', 'Flash failed': '烧录失败', 'Flash firmware': '烧录固件', 'Flash firmware before running': '运行前烧录固件', 'Flash, reset, run to main': '烧录、复位并运行到 main',
  'Flashing {file}…': '正在烧录 {file}…', 'Follow system': '跟随系统', 'Halted': '已暂停', 'Hide inspector': '隐藏检查器', 'Hide panel': '隐藏面板', 'Keyboard': '快捷键',
  'Language': '语言', 'Launch': '启动', 'Launch needs a firmware ELF': '启动模式需要固件 ELF', 'Light': '浅色', 'Live': '实时', 'Load SVD…': '加载 SVD…',
  'Load symbols from ELF': '从 ELF 加载符号', 'Load the CMSIS-SVD file of your MCU to browse peripheral registers.': '加载 MCU 的 CMSIS-SVD 文件以浏览外设寄存器。',
  'Loaded {device}: {n} peripherals': '已加载 {device}：{n} 个外设', 'Loading {file}…': '正在加载 {file}…', 'Measured sample rate': '实测采样率', 'Memory': '内存',
  'Monitor': '监视', 'Monitor-only session: writes are disabled': '只读监视会话：已禁用写入', 'New plot': '新建曲线', 'No .elf/.axf files found in the workspace': '工作区中未找到 .elf/.axf 文件',
  'No folder opened.': '尚未打开文件夹。', 'No hardware needed — explore every view': '无需硬件，体验全部视图', 'No match': '无匹配', 'No plugins installed.': '未安装插件。',
  'No probe found': '未找到探针', 'No recent folders.': '没有最近的文件夹。', 'No symbols — choose an ELF or connect first': '暂无符号——请先选择 ELF 或连接目标',
  'No viewer for {name}': '无法预览 {name}', 'Not a number': '不是有效数字', 'Not connected': '未连接', 'Not connected.': '未连接。', 'Not found in current symbols': '当前符号中未找到',
  'Nothing to export yet': '暂无可导出的数据', 'Open Folder': '打开文件夹', 'Open a source file, a plot or the welcome page.': '打开源文件、曲线或欢迎页。', 'Open folder…': '打开文件夹…',
  'Open user plugin folder': '打开用户插件目录', 'Open view': '打开视图', 'PAUSED — drag to pan, double-click for live': '已暂停——拖动平移，双击恢复实时', 'Pause': '暂停',
  'Peripherals': '外设', 'Plot': '曲线', 'Plot in active chart': '添加到当前曲线', 'Plugins': '插件',
  'Poll every 500 ms; on some cores registers are only valid while halted': '每 500 ms 轮询；部分内核仅在暂停时寄存器有效', 'Probe': '探针', 'Protocol': '协议', 'Rate': '采样率',
  'Re-read expanded peripherals every 500 ms': '每 500 ms 重读已展开的外设', 'Read': '读取', 'Read expanded': '读取已展开项', 'Read-only, never halts': '只读，不暂停目标', 'Recent': '最近',
  'Recent builds in workspace': '工作区中的构建产物', 'Reconnect…': '重新连接…', 'Refresh': '刷新', 'Registers': '寄存器',
  'Registers, live plots and source-level stepping for Cortex-M targets over DAPLink / CMSIS-DAP and ST-Link.': '通过 DAPLink / CMSIS-DAP 与 ST-Link 对 Cortex-M 目标进行寄存器查看、实时曲线与源码级单步调试。',
  'Reload': '重新加载', 'Reload symbols from ELF': '从 ELF 重新加载符号', 'Reload to apply plugin changes.': '重新加载以应用插件更改。', 'Reload window': '重新加载窗口', 'Remove': '移除',
  'Remove all': '全部移除', 'Requested sample rate': '请求采样率', 'Rescan probes': '重新扫描探针', 'Reset target': '复位目标', 'Reveal in file manager': '在文件管理器中显示', 'Running': '运行中',
  'Rust core': 'Rust 内核', 'Rust core missing': '缺少 Rust 内核', 'Rust core not found — run `npm run build:native`.': '未找到 Rust 内核——请运行 `npm run build:native`。', 'Rust core ready': 'Rust 内核就绪',
  'SVD load failed': 'SVD 加载失败', 'Save': '保存', 'Saved {file}': '已保存 {file}', 'Scanning…': '扫描中…', 'Search variables…': '搜索变量…', 'Settings': '设置',
  'Show in memory view': '在内存视图中显示', 'Show welcome page': '显示欢迎页', 'Signal': '信号', 'Simulated': '模拟', 'Simulated target': '模拟目标', 'Simulated target, no hardware needed': '模拟目标，无需硬件',
  'Source not found locally: {path}': '本地未找到源文件：{path}', 'Start': '开始', 'Step into': '单步进入', 'Step out': '单步跳出', 'Step over': '单步跳过',
  'Stream variables at up to tens of kHz': '以最高数十 kHz 采样变量', 'Symbols': '符号', 'Symbols come from the firmware ELF (DWARF).': '符号来自固件 ELF（DWARF）。', 'Target chip': '目标芯片',
  'Target halted: {reason}': '目标已暂停：{reason}', 'Target is running.': '目标运行中。', 'Theme': '主题', 'This machine': '本机环境', 'This symbol has no fixed address': '该符号没有固定地址',
  'Time window': '时间窗口', 'Toggle bottom panel': '切换底部面板', 'Toggle inspector': '切换检查器', 'Toggle sidebar': '切换侧边栏', 'Toggle theme': '切换主题', 'Try the simulated target': '体验模拟目标',
  'Type a command…': '输入命令…', 'Unknown address or symbol: {text}': '未知地址或符号：{text}', 'Versions': '版本', 'Watch': '监视', 'Welcome': '欢迎', 'Window': '窗口',
  'built-in': '内置', 'debug core': '调试内核', 'monitor': '只读', 'not found': '未找到', 'offline': '离线', 'read-only': '只读', 'studio-adapter not found': '未找到 studio-adapter',
  'to connect': '连接', 'unresolved': '未解析', 'user': '用户', '{name} is read-only': '{name} 为只读', '{name} written': '已写入 {name}', '{n} dropped': '丢弃 {n}',
  '{n} globals · live target': '{n} 个全局变量 · 在线目标', '{n} globals · {file} (offline)': '{n} 个全局变量 · {file}（离线）', '{n} probe(s) found': '找到 {n} 个探针',
  'Connect / Continue': '连接 / 继续', 'Command palette': '命令面板',
  'Empty folder': '空文件夹', 'Select a file': '请选择一个文件', 'Up': '上一级', 'File name': '文件名', 'Save as': '另存为', 'Open file': '打开文件', 'Browsing files on {host}': '正在浏览 {host} 上的文件', 'Select folder': '选择此文件夹', 'Open': '打开',
  'Files': '文件', 'Variables': '变量', 'Plots': '曲线', 'Periph.': '外设', 'Add signal to plot': '添加信号到曲线',
  'Open plots': '已打开的曲线', 'Adding signals': '如何添加信号', 'No plots yet': '还没有曲线', '{n} signals': '{n} 个信号',
  'In Symbols, hover a variable and click the plot icon': '在「变量」面板中悬停变量，点击曲线图标',
  'Or drag a variable onto a plot': '或者把变量直接拖到曲线上',
  'Signals stream while the target runs; pause the plot to pan back in time': '目标运行时实时采样；暂停曲线后可拖动回看',
  'Pan, zoom, pause and the crosshair follow across plots': '各曲线的平移、缩放、暂停和十字光标同步',
  'Sync time axes': '同步时间轴',
  'Add plot': '添加曲线',
  'Layout': '布局',
  'Drag the grip onto another plot to rearrange': '拖动手柄到另一条曲线上可重新排布',
  'Drag onto another plot to rearrange': '拖到另一条曲线上重新排布',
  'Remove plot': '移除此曲线',
  'Grid': '网格',
  'Stack vertically': '纵向堆叠',
  'Side by side': '横向并排',
  'Equal sizes': '均分大小',
  '{n} plots': '{n} 个曲线',
  'Group': '分组',
  'Add variables here': '在此分组添加变量',
  'Rename': '重命名',
  'Resume all variables': '全部恢复采样',
  'Pause all variables': '全部暂停采样',
  'Delete group': '删除分组',
  'Clear group': '清空分组',
  'Double-click to rename': '双击重命名',
  'Click to make this the group new variables go to': '点击设为新变量的添加目标',
  'Expand': '展开',
  'Collapse': '折叠',
  '{live}/{total} sampled': '{live}/{total} 采样中',
  'paused · {total}': '已暂停 · {total}',
  'Pause sampling this group': '暂停采样此分组',
  'Resume sampling this group': '恢复采样此分组',
  'Group actions': '分组操作',
  'Pause sampling (keep in list)': '暂停采样（保留在列表中）',
  'Resume sampling': '恢复采样',
  'Add variables from Symbols (eye icon) or with +, or drag them here.': '从“符号”点击眼睛图标、用 + 添加，或直接拖到这里。',
  'Polling rate of sampled variables': '采样中变量的刷新率',
  'Group {n}': '分组 {n}',
  'Add to the highlighted group': '添加到高亮的分组',
  'New group': '新建分组',
  'Color theme': '颜色主题',
  'Export all plots as one CSV': '所有曲线导出为一个 CSV',
  'Export the board as one PNG': '整个画布导出为一张 PNG',
  'No signals — add one from Symbols': '暂无信号 —— 从「变量」中添加', 'Connect a target to stream signals': '连接目标后开始采样',
};

const dictionaries = { zh };
let active = 'en';

export function setLanguage(choice) {
  const resolved = choice === 'auto' || !choice ? (navigator.language || 'en') : choice;
  active = resolved.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function language() { return active === 'zh' ? 'zh-CN' : 'en'; }

export function t(text, params) {
  let out = dictionaries[active]?.[text] ?? text;
  if (params) for (const [key, value] of Object.entries(params)) out = out.replaceAll(`{${key}}`, String(value));
  return out;
}

/** Plugins may add translations for their own strings. */
export function addTranslations(lang, entries) {
  dictionaries[lang] = { ...(dictionaries[lang] || {}), ...entries };
}
