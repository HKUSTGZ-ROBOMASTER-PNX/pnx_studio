// Output console with an expression prompt (DAP `evaluate`).
import { h, iconButton } from '../lib/dom.js';
import { session } from '../session.js';
import { workbench } from '../shell.js';
import { t } from '../i18n.js';

const MAX_LINES = 2000;

export function createConsole() {
  const out = h('div', { class: 'console-out mono' });
  const input = h('input', { type: 'text', class: 'mono grow', placeholder: t('Evaluate expression, e.g. motor.speed * 2   (↑ history)'), spellcheck: false });
  const history = [];
  let cursor = 0;
  let errors = 0;

  const write = (level, text, time = Date.now()) => {
    const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 8;
    const stamp = new Date(time).toTimeString().slice(0, 8);
    for (const line of String(text).split('\n')) out.append(h('div', { class: `log ${level}` }, h('span', { class: 'time' }, stamp), line));
    while (out.childElementCount > MAX_LINES) out.firstChild.remove();
    if (stick) out.scrollTop = out.scrollHeight;
    if (level === 'error' && workbench.panel.active !== 'console') workbench.panel.setBadge('console', String(++errors));
  };

  input.addEventListener('keydown', async event => {
    if (event.key === 'ArrowUp' && history.length) { cursor = Math.max(0, cursor - 1); input.value = history[cursor]; event.preventDefault(); }
    if (event.key === 'ArrowDown' && history.length) { cursor = Math.min(history.length, cursor + 1); input.value = history[cursor] || ''; event.preventDefault(); }
    if (event.key !== 'Enter' || !input.value.trim()) return;
    const expression = input.value.trim();
    history.push(expression); cursor = history.length; input.value = '';
    write('input', `› ${expression}`);
    if (!session.connected) { write('warn', t('Not connected.')); return; }
    try {
      const result = await session.request('evaluate', { expression, context: 'repl' });
      write('result', `${result.result}${result.type ? `   (${result.type})` : ''}`);
    } catch (error) { write('error', error.message); }
  });

  session.on('log', entry => write(entry.level || 'info', entry.text, entry.time));
  session.on('status', status => write('meta', `— ${status} —`));
  session.on('stopped', body => write('meta', `${t('Halted')}${body?.reason ? `: ${body.reason}` : ''}`));
  workbench.panel.on('activate', id => { if (id === 'console') { errors = 0; workbench.panel.setBadge('console', ''); } });

  return {
    el: h('div', { class: 'console' }, out, h('div', { class: 'console-input row' }, h('span', { class: 'prompt mono' }, '›'), input,
      iconButton('close', t('Clear'), () => out.replaceChildren(), { class: 'small' }))),
    write,
  };
}
