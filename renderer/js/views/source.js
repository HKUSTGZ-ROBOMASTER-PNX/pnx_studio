// Read-only, virtualized source view with breakpoint gutter, PC marker and hover evaluation.
import { h, icon, iconButton, basename, debounce } from '../lib/dom.js';
import { bus } from '../lib/emitter.js';
import { workspace } from '../workspace.js';
import { workbench, notify, showTooltip, hideTooltip } from '../shell.js';
import { session } from '../session.js';
import { breakpoints } from '../breakpoints.js';
import { t } from '../i18n.js';
import { highlightLine, escapeHtml } from '../lib/highlight.js';

const host = window.host;
const LINE_HEIGHT = 20;
const OVERSCAN = 30;

const normalize = file => String(file).replaceAll('\\', '/').replace(/^([a-z]):/i, (_, d) => `${d.toLowerCase()}:`);
const resolved = new Map();

/** Map a DWARF source path (possibly from another machine) to a local file. */
async function resolveSourcePath(file) {
  if (resolved.has(file)) return resolved.get(file);
  let result = null;
  try { await host.fs.readText(file); result = file; } catch {
    // Windows app + firmware built in WSL: DWARF holds /home/... while the
    // workspace is \\wsl.localhost\<distro>\...; map through that prefix.
    const wsl = workspace.root && /^(\/\/wsl(?:\.localhost|\$)\/[^/]+)\//i.exec(normalize(workspace.root));
    const posix = normalize(file);
    if (wsl && posix.startsWith('/')) {
      try { const mapped = `${wsl[1]}${posix}`; await host.fs.readText(mapped); result = mapped; } catch { /* fall through */ }
    }
    if (!result && workspace.root) {
      const name = basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = await findByName(name);
      const wanted = normalize(file).split('/').reverse();
      let best = -1;
      for (const candidate of matches) {
        const parts = normalize(candidate).split('/').reverse();
        let score = 0;
        while (score < parts.length && score < wanted.length && parts[score] === wanted[score]) score++;
        if (score > best) { best = score; result = candidate; }
      }
    }
  }
  resolved.set(file, result);
  return result;
}

async function findByName(escapedName) {
  // Breadth-first file search via the explorer listing API (bounded depth).
  const pattern = new RegExp(`^${escapedName}$`, 'i');
  const found = [];
  let frontier = [workspace.root];
  for (let depth = 0; depth < 7 && frontier.length && found.length < 20; depth++) {
    const next = [];
    for (const dir of frontier) {
      let entries = [];
      try { entries = await host.fs.listDir(dir); } catch { continue; }
      for (const entry of entries) {
        if (entry.dir) { if (!/^(node_modules|\.git|build|out)$/i.test(entry.name) || depth === 0) next.push(entry.path); }
        else if (pattern.test(entry.name)) found.push(entry.path);
      }
    }
    frontier = next.slice(0, 400);
  }
  return found;
}

class SourceView {
  constructor(file) {
    this.file = file;
    this.lines = [];
    this.html = [];
    this.pcLine = null;
    this.scroller = h('div', { class: 'code-scroll', onscroll: () => this.paint() });
    this.sizer = h('div', { class: 'code-sizer' });
    this.layer = h('div', { class: 'code-layer mono' });
    this.sizer.append(this.layer);
    this.scroller.append(this.sizer);
    this.crumb = h('div', { class: 'code-crumb' }, icon('file'), h('span', { class: 'path' }, file), h('span', { class: 'grow' }),
      iconButton('folder', t('Reveal in file manager'), () => host.shell.showItem(this.file), { class: 'small' }));
    this.el = h('div', { class: 'source-view' }, this.crumb, this.scroller);
    this.layer.addEventListener('mousedown', event => {
      const gutter = event.target.closest('.gutter');
      if (gutter) breakpoints.toggle(this.file, Number(gutter.dataset.line));
    });
    this.layer.addEventListener('mousemove', debounce(event => this.hover(event), 250));
    this.layer.addEventListener('mouseleave', () => hideTooltip());
    this.offs = [
      breakpoints.on('changed', file => { if (file === this.file) this.paint(true); }),
      session.on('frame', frame => this.onFrame(frame)),
      session.on('status', () => { if (!session.halted) this.setPc(null); }),
    ];
    this.load();
  }

  async load() {
    try {
      const { text } = await host.fs.readText(this.file);
      this.lines = text.replace(/\r\n?/g, '\n').split('\n');
      let inComment = false;
      this.html = this.lines.map(line => { const result = highlightLine(line, inComment); inComment = result.inComment; return result.html; });
      this.sizer.style.height = `${this.lines.length * LINE_HEIGHT + 40}px`;
      this.gutterWidth = `${String(this.lines.length).length + 3}ch`;
      this.layer.style.setProperty('--gutter', this.gutterWidth);
      this.paint(true);
      if (session.frame) this.onFrame(session.frame);
      if (this.pendingReveal) { this.reveal(this.pendingReveal); this.pendingReveal = null; }
    } catch (error) {
      this.layer.replaceChildren(h('div', { class: 'tree-msg err-text' }, error.message));
    }
  }

  paint(force = false) {
    if (!this.lines.length) return;
    const top = this.scroller.scrollTop, height = this.scroller.clientHeight || 800;
    const first = Math.max(0, Math.floor(top / LINE_HEIGHT) - OVERSCAN);
    const last = Math.min(this.lines.length, Math.ceil((top + height) / LINE_HEIGHT) + OVERSCAN);
    if (!force && first === this.first && last === this.last) return;
    this.first = first; this.last = last;
    const bps = breakpoints.lines(this.file);
    let html = '';
    for (let i = first; i < last; i++) {
      const number = i + 1;
      const bp = bps.get(number);
      const bpClass = bp ? (bp.verified === false ? ' bp unverified' : ' bp') : '';
      const pc = number === this.pcLine ? ' pc' : '';
      html += `<div class="code-line${pc}" style="top:${i * LINE_HEIGHT}px"><span class="gutter${bpClass}" data-line="${number}" title="${bp?.message ? escapeHtml(bp.message) : ''}">${number}</span><span class="text">${this.html[i]}</span></div>`;
    }
    this.layer.innerHTML = html;
  }

  reveal(line) {
    if (!this.lines.length) { this.pendingReveal = line; return; }
    const target = (line - 1) * LINE_HEIGHT;
    const view = this.scroller.clientHeight;
    if (target < this.scroller.scrollTop + 40 || target > this.scroller.scrollTop + view - 60) this.scroller.scrollTop = Math.max(0, target - view / 3);
    this.paint(true);
  }

  setPc(line) {
    if (this.pcLine === line) return;
    this.pcLine = line;
    this.paint(true);
  }

  onFrame(frame) {
    const path = frame?.source?.path;
    if (!path) { this.setPc(null); return; }
    const same = normalize(path) === normalize(this.file) || resolved.get(path) === this.file;
    this.setPc(same ? frame.line : null);
    if (same) this.reveal(frame.line);
  }

  async hover(event) {
    if (!session.halted) return;
    const token = event.target.closest('.id');
    if (!token) { hideTooltip(); return; }
    const line = event.target.closest('.code-line');
    let expression = token.textContent;
    // Include member access chains such as `cfg.motor.kp`.
    let previous = token.previousSibling;
    while (previous && previous.textContent === '.' && previous.previousSibling?.classList?.contains('id')) {
      expression = `${previous.previousSibling.textContent}.${expression}`;
      previous = previous.previousSibling.previousSibling;
    }
    if (!line) return;
    try {
      const result = await session.request('evaluate', { expression, context: 'hover' }, 4000);
      showTooltip(event.clientX, event.clientY, `${expression} = ${result.result}${result.type ? `  (${result.type})` : ''}`);
    } catch { hideTooltip(); }
  }

  onShow() { requestAnimationFrame(() => this.paint(true)); }
  dispose() { this.offs.forEach(off => off()); hideTooltip(); }
}

export async function openSource(file, line) {
  const id = `src:${file}`;
  const view = workbench.editor.open({ id, title: basename(file), tooltip: file, icon: 'file', create: () => new SourceView(file) });
  if (line) view.reveal(line);
  return view;
}

export function initSourceRouting() {
  bus.on('source:open', ({ path, line }) => openSource(path, line));
  session.on('frame', async frame => {
    const path = frame?.source?.path;
    if (!path) return;
    const local = await resolveSourcePath(path);
    if (!local) { session.emit('log', { level: 'warn', text: t('Source not found locally: {path}', { path }), time: Date.now() }); return; }
    resolved.set(path, local);
    const view = await openSource(local, frame.line);
    view.onFrame({ ...frame, source: { path: local } });
  });
  session.on('stopped', body => {
    if (body?.reason && !['step', 'entry', 'pause'].includes(body.reason)) notify(t('Target halted: {reason}', { reason: body.reason }), 'warn', 2500);
  });
}
