// Tiny DOM toolkit: hyperscript, icons, formatting.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'html') el.innerHTML = value;
      else if (key in el && typeof value !== 'string') el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : String(child));
  }
}

const PATHS = {
  play: '<path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M5 3.5v9M11 3.5v9" stroke-width="2.2"/>',
  stepOver: '<path d="M2.5 9a5.5 5.5 0 0 1 10.6-2"/><path d="M13.5 3.5v3.5H10"/><circle cx="8" cy="12.5" r="1.4" fill="currentColor" stroke="none"/>',
  stepInto: '<path d="M8 2v7"/><path d="M5 6.5 8 9.5l3-3"/><circle cx="8" cy="13" r="1.4" fill="currentColor" stroke="none"/>',
  stepOut: '<path d="M8 10V3"/><path d="M5 5.5 8 2.5l3 3"/><circle cx="8" cy="13" r="1.4" fill="currentColor" stroke="none"/>',
  restart: '<path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.8"/><path d="M2.5 2.5v3.5H6"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor" stroke="none"/>',
  plug: '<path d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3"/>',
  unplug: '<path d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3M2 2l12 12"/>',
  flash: '<path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z"/>',
  files: '<path d="M9.5 1.8H5A1.5 1.5 0 0 0 3.5 3.3v9.4A1.5 1.5 0 0 0 5 14.2h6.5a1.5 1.5 0 0 0 1.5-1.5V5.3z"/><path d="M9.5 1.8v3.5H13M6 8.5h4M6 11h2.5"/>',
  folder: '<path d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3A1 1 0 0 0 2 4.5z"/>',
  folderOpen: '<path d="M2 12V4.5a1 1 0 0 1 1-1h3.5L8 5h4.5a1 1 0 0 1 1 1v1"/><path d="M2 12l1.8-4.5h11L13 12z"/>',
  file: '<path d="M4 2h5l3 3v9H4z"/>',
  symbol: '<path d="M5.5 2.5H4.6A1.6 1.6 0 0 0 3 4.1v2.2L1.8 8 3 9.7v2.2a1.6 1.6 0 0 0 1.6 1.6h.9M10.5 2.5h.9A1.6 1.6 0 0 1 13 4.1v2.2L14.2 8 13 9.7v2.2a1.6 1.6 0 0 1-1.6 1.6h-.9"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/>',
  chip: '<rect x="3.8" y="3.8" width="8.4" height="8.4" rx="1.8"/><rect x="6.4" y="6.4" width="3.2" height="3.2" rx="0.6"/><path d="M6.2 1.5v2.3M9.8 1.5v2.3M6.2 12.2v2.3M9.8 12.2v2.3M1.5 6.2h2.3M1.5 9.8h2.3M12.2 6.2h2.3M12.2 9.8h2.3"/>',
  plugin: '<path d="M6.3 2.6a1.6 1.6 0 0 1 3.2 0v.9h2.4c.6 0 1.1.5 1.1 1.1v2.4h.9a1.6 1.6 0 0 1 0 3.2h-.9v2.4c0 .6-.5 1.1-1.1 1.1H9.5v-.9a1.6 1.6 0 0 0-3.2 0v.9H4c-.6 0-1.1-.5-1.1-1.1v-2.4h.9a1.6 1.6 0 0 0 0-3.2h-.9V4.6c0-.6.5-1.1 1.1-1.1h2.3z"/>',
  waves: '<path d="M2 2.5v11h12"/><path d="M4.3 9.6c.9-3.3 1.7-5.1 2.7-5.1 1.5 0 1.7 6 3.2 6 .9 0 1.4-1.3 2.3-3.4"/>',
  chartAdd: '<path d="M2 2.5v11h6.5"/><path d="M4.3 9.2c.9-2.9 1.7-4.7 2.7-4.7 1 0 1.4 2.3 2 3.8"/><path d="M12 9.5v5M9.5 12h5"/>',
  chart: '<path d="M2 13.5h12"/><path d="M3 10.5l3-4 3 2.5 4.5-6"/>',
  console: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4.5 6l2 2-2 2M8 10.5h3.5"/>',
  memory: '<rect x="2" y="4" width="12" height="8" rx="1"/><path d="M5 4v8M8 4v8M11 4v8"/>',
  register: '<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M2 10h12M6 2.5v11"/>',
  stack: '<path d="M8 2 2 5l6 3 6-3zM2 8l6 3 6-3M2 11l6 3 6-3"/>',
  grip: '<circle cx="6" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="6" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="6" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="12" r="1" fill="currentColor" stroke="none"/>',
  layout: '<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M8 2.5v11M8 8h6"/>',
  cube: '<path d="M8 1.8 13.5 4.9v6.2L8 14.2 2.5 11.1V4.9z"/><path d="M2.5 4.9 8 8l5.5-3.1M8 8v6.2"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  minus: '<path d="M3 8h10"/>',
  refresh: '<path d="M13.2 8A5.2 5.2 0 1 1 11.6 4.2"/><path d="M13.5 2.5V6H10"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>',
  settings: '<path d="M6.54 3.22L6.97 1.48L9.03 1.48L9.46 3.22L10.35 3.59L11.88 2.66L13.34 4.12L12.41 5.65L12.78 6.54L14.52 6.97L14.52 9.03L12.78 9.46L12.41 10.35L13.34 11.88L11.88 13.34L10.35 12.41L9.46 12.78L9.03 14.52L6.97 14.52L6.54 12.78L5.65 12.41L4.12 13.34L2.66 11.88L3.59 10.35L3.22 9.46L1.48 9.03L1.48 6.97L3.22 6.54L3.59 5.65L2.66 4.12L4.12 2.66L5.65 3.59Z"/><circle cx="8" cy="8" r="2.1"/>',
  sun: '<circle cx="8" cy="8" r="3"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1"/>',
  moon: '<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"/>',
  chevronRight: '<path d="M6 3.5 10.5 8 6 12.5"/>',
  chevronDown: '<path d="M3.5 6 8 10.5 12.5 6"/>',
  dot: '<circle cx="8" cy="8" r="4" fill="currentColor" stroke="none"/>',
  sidebar: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M6 2.5v11"/>',
  panel: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M1.5 10h13"/>',
  inspector: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M10 2.5v11"/>',
  download: '<path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11"/>',
  record: '<circle cx="8" cy="8" r="4.5" fill="currentColor" stroke="none"/>',
  image: '<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="M2 12l4-4 3 3 2-2 3 3"/>',
  info: '<circle cx="8" cy="8" r="6.5"/><path d="M8 7.2V11M8 5v.1"/>',
  warn: '<path d="M8 2 1.5 13.5h13z"/><path d="M8 6.5V9.5M8 11.5v.1"/>',
  check: '<path d="M3 8.5 6.5 12 13 4.5"/>',
  edit: '<path d="M10.5 2.5l3 3L6 13H3v-3z"/>',
  zoomFit: '<path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5"/>',
  link: '<path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"/>',
  pin: '<path d="M9.5 2 14 6.5l-2 .5-2.5 2.5L9 13l-6-6 3.5-.5L9 4z"/><path d="M5.5 10.5 2 14"/>',
};

export function icon(name, extraClass = '') {
  const span = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  span.setAttribute('viewBox', '0 0 16 16');
  span.setAttribute('class', `icon ${extraClass}`.trim());
  span.innerHTML = PATHS[name] || PATHS.dot;
  return span;
}

export function iconButton(name, title, onClick, extra = {}) {
  return h('button', { class: `icon-btn ${extra.class || ''}`, title, 'aria-label': title, onclick: onClick, disabled: extra.disabled }, icon(name));
}

export function hex(value, digits = 8) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value)));
  return `0x${(n < 0n ? n + (1n << BigInt(digits * 4)) : n).toString(16).toUpperCase().padStart(digits, '0')}`;
}

export function parseNumber(text) {
  const value = String(text).trim().replaceAll('_', '');
  const hexMatch = /^(-?)0x([0-9a-f]+)$/i.exec(value);
  if (hexMatch) return (hexMatch[1] ? -1 : 1) * Number.parseInt(hexMatch[2], 16);
  if (/^0b[01]+$/i.test(value)) return Number.parseInt(value.slice(2), 2);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function formatValue(value, digits = 6) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e7)) return value.toExponential(3);
  return Number(value.toPrecision(digits)).toString();
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

export function basename(file) { return String(file).split(/[\\/]/).pop(); }

export function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
