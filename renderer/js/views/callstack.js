// Call stack and breakpoint list.
import { h, icon, iconButton, basename } from '../lib/dom.js';
import { bus } from '../lib/emitter.js';
import { session } from '../session.js';
import { breakpoints } from '../breakpoints.js';
import { t } from '../i18n.js';

export function createCallStack() {
  const frames = h('div', { class: 'list' });
  const bps = h('div', { class: 'list' });

  const renderFrames = list => {
    if (!session.halted || !list?.length) { frames.replaceChildren(h('div', { class: 'tree-msg muted' }, session.connected ? t('Target is running.') : t('Not connected.'))); return; }
    frames.replaceChildren(...list.map((frame, index) => h('div', {
      class: `list-row${index === 0 ? ' current' : ''}`,
      onclick: () => frame.source?.path && bus.emit('source:open', { path: frame.source.path, line: frame.line }),
    }, icon(index === 0 ? 'play' : 'dot'), h('span', { class: 'grow mono' }, frame.name), h('span', { class: 'faint mono' }, frame.instructionPointerReference || ''))));
  };

  const renderBreakpoints = () => {
    const list = breakpoints.list();
    if (!list.length) { bps.replaceChildren(h('div', { class: 'tree-msg muted' }, t('Click the gutter of a source line to add a breakpoint.'))); return; }
    bps.replaceChildren(...list.map(bp => h('div', { class: 'list-row', title: bp.message || bp.file, onclick: () => bus.emit('source:open', { path: bp.file, line: bp.line }) },
      h('span', { class: `bp-dot${bp.verified === false ? ' unverified' : ''}` }),
      h('span', { class: 'grow' }, `${basename(bp.file)}:${bp.line}`),
      bp.verified === false ? h('span', { class: 'faint' }, t('unresolved')) : null,
      iconButton('close', t('Remove'), event => { event.stopPropagation(); breakpoints.toggle(bp.file, bp.line); }, { class: 'small' }))));
  };

  session.on('stack', renderFrames);
  session.on('status', () => { if (!session.halted) renderFrames([]); });
  breakpoints.on('changed', renderBreakpoints);
  renderFrames([]);
  renderBreakpoints();
  return {
    el: h('div', { class: 'inspector-view' },
      h('div', { class: 'section-title' }, t('Call stack')), frames,
      h('div', { class: 'section-title row' }, h('span', { class: 'grow' }, t('Breakpoints')), iconButton('close', t('Remove all'), () => breakpoints.clearAll(), { class: 'small' })), bps),
  };
}
