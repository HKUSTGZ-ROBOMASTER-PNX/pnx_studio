# Embedded Studio 插件 API（apiVersion 1）

插件让 Embedded Studio 在不修改核心的前提下扩展：新的可视化（图像、FFT、状态机……）、数据导出、协议解码（RTT、日志格式）、工程适配，以及替换调试内核。

## 目录与清单

```
my-plugin/
  plugin.json
  main.cjs        # 可选：主进程（Node.js, CommonJS）
  renderer.js     # 可选：窗口（ES module）
```

```json
{
  "id": "acme.rtt-terminal",
  "name": "RTT Terminal",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "…",
  "main": "main.cjs",
  "renderer": "renderer.js",
  "contributes": {
    "views":    [{ "id": "terminal", "title": "RTT", "location": "panel" }],
    "commands": [{ "id": "acme.rtt-terminal:clear", "title": "Clear RTT" }],
    "adapters": [{ "id": "openocd", "label": "OpenOCD bridge", "executable": { "win32-x64": "bin/bridge.exe", "default": "bin/bridge" } }]
  }
}
```

- `id`：小写字母、数字、`.`、`_`、`-`，≤ 64 字符，全局唯一。
- `apiVersion` 必须等于宿主版本（当前为 1），不匹配的插件不会加载并在插件侧栏显示原因。
- `main` / `renderer` 必须位于插件目录内。
- 加载位置：应用内置 `plugins/`，以及用户目录 `<userData>/plugins/`（同 id 时用户插件优先）。启用/停用后点击“重新加载”生效。

## 渲染进程 API

```js
export function activate(studio) { … }
```

| 成员 | 说明 |
| --- | --- |
| `studio.views.register(id, { title, icon?, location?, render(container) })` | `location`：`editor`（默认，按需打开）、`panel`、`inspector`、`sidebar`。`render` 可返回 `{ dispose, onShow, onHide }`。 |
| `studio.views.open(id)` | 打开/聚焦视图。 |
| `studio.commands.register(id, title, run)` / `execute(id, args)` | 命令出现在命令面板中；`execute` 找不到时会转发给主进程插件命令。 |
| `studio.session.status / connected / halted / catalog` | 当前会话状态与 ELF 变量目录。 |
| `studio.session.request(command, args)` | 发送任意 DAP 或 `studio/*` 请求（见下表）。 |
| `studio.session.debug('continue'｜'pause'｜'next'｜'stepIn'｜'stepOut'｜'restart')` | 调试控制。 |
| `studio.session.readMemory(addr, len)` → `Uint8Array`；`writeMemory(addr, bytes)` | 内存访问。 |
| `studio.session.readValues(ids)` → `Map<id, number>` | 一次性读取变量。 |
| `studio.session.subscribe(ids, rate)` / `unsubscribe()` | 请求流式采样；会与曲线等其它消费者合并。 |
| `studio.session.on(event, fn)` | `status`、`connected`、`stopped`、`continued`、`samples`、`catalog`、`coreState`、`frame`、`log`。返回取消函数。 |
| `studio.ui.h / icon / iconButton / notify / modal / menu / pickVariable / hex / formatValue / parseNumber` | 与内置视图相同的 UI 工具，插件外观自动跟随主题。 |
| `studio.ui.addToolbarButton({ title, icon, run })` | 在顶部工具栏添加按钮。 |
| `studio.main.invoke(command, args)` / `studio.main.onMessage(fn)` | 与本插件主进程部分通信。 |
| `studio.storage.get(key, fallback)` / `set(key, value)` | 按插件隔离的持久化存储。 |
| `studio.workspace.root` / `studio.workspace.on('opened', fn)` | 当前工作区。 |
| `studio.host.dialog / studio.host.fs` | 打开/保存对话框、文本与二进制文件读写。 |
| `studio.i18n.t(text, params)` / `language()` / `addTranslations(lang, entries)` | 界面语言；插件用英文原文作键注册自己的译文（如 `addTranslations('zh', {...})`）。 |

`samples` 事件的批次格式：

```js
{ channelIds: ['mock.sine', …], sampleCount, startTimestampNs, samplePeriodNs, droppedFrames,
  values: Float64Array /* 按样本交错: s0c0, s0c1, …, s1c0 … */ }
```

## 主进程 API

```js
exports.activate = context => { … };
exports.deactivate = async () => { … };
```

| 成员 | 说明 |
| --- | --- |
| `context.commands.register(id, handler)` | 注册 `<pluginId>:<id>` 命令，可被渲染进程 `studio.main.invoke` 调用。 |
| `context.core.request(command, args)` | 直接向当前 Rust 会话发送请求。 |
| `context.core.on('samples'｜'dap'｜'connected'｜'disconnected', fn)` | 原始采样批次在主进程即可拿到，适合记录、转发（如 UDP/WebSocket）、在线分析。 |
| `context.postMessage(payload)` | 推送给本插件渲染部分。 |
| `context.storagePath` | 插件专属数据目录。 |
| `context.log(text, level)` | 输出到控制台面板。 |
| `context.subscriptions` | 放入清理函数，停用时调用。 |

## 内核请求（`studio/*`）

| 请求 | 参数 → 返回 |
| --- | --- |
| `studio/getState` | → `SessionState`（目标状态、实际采样率、丢帧数…） |
| `studio/getCatalog` | → `{ variables: VariableDescriptor[] }` |
| `studio/coreRegisters` | → `{ registers: [{ name, value }] }` |
| `studio/readRegisters` | `{ registers: [{ id, address, sizeBits }] }` → `{ values: [{ id, address, value }] }` |
| `studio/readValues` | `{ ids }` → `{ values: [{ id, value }] }` |
| `studio/writeValue` | `{ id, value }`，写入后回读校验 |
| `studio/setSubscriptions` | `{ ids, requestedSamplesPerSecond }` |
| `studio/flash` | `{ path, verify, resetAfter }` |
| `studio/loadSvd` | `{ path }` → SVD 树 |
| `studio/benchmark` | `{ seconds }` → 采样统计 |

标准 DAP 请求：`continue`、`pause`、`next`、`stepIn`、`stepOut`、`restart`、`stackTrace`、`setBreakpoints`、`setInstructionBreakpoints`、`evaluate`、`readMemory`、`writeMemory`、`variables` 等。

## 提供调试内核

`contributes.adapters` 声明的可执行文件会出现在连接对话框的“调试内核”下拉框中。它需要：

1. 在 stdio 上实现 DAP（`Content-Length` 帧）；
2. `attach`/`launch` 成功后发出 `studio.dataChannelReady` 事件 `{ port, token, protocolVersion: 1 }`，并在该本地 TCP 端口按 `CKIT` 格式（见 `native/crates/studio-adapter/src/protocol.rs`）推送采样；
3. 实现上表中界面用到的 `studio/*` 请求。

最简单的方式是基于本仓库的 Rust crate：实现 `studio_probe::Backend` trait（连接、暂停、单步、断点、读写内存、采样），复用 `studio-adapter` 的协议层即可接入新的探针或仿真器。

## 安全模型

插件以应用相同的权限运行（与 VS Code 扩展一致），没有进程隔离。只安装来源可信的插件。
