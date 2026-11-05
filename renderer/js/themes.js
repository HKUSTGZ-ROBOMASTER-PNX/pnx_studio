// Color themes. Each id matches a [data-theme] block in css/theme.css; `kind` drives
// [data-kind] (shared light-mode rules) and `pair` is what the toolbar sun/moon toggles to.
// `preview` = [frame, surface, pane, accent, keyword, string] for the theme picker.
import { bus } from './lib/emitter.js';

export const THEMES = [
  { id: 'dark', label: 'Embedded Dark', kind: 'dark', pair: 'light', preview: ['#090b10', '#12151c', '#161a22', '#2fd4bd', '#c49bff', '#9fd88a'] },
  { id: 'light', label: 'Embedded Light', kind: 'light', pair: 'dark', preview: ['#e4e8ee', '#ffffff', '#fbfcfd', '#0c9e8b', '#8338c9', '#2f8519'] },
  { id: 'vscode-dark', label: 'VS Code Dark Modern', kind: 'dark', pair: 'vscode-light', preview: ['#111111', '#1f1f1f', '#181818', '#0078d4', '#569cd6', '#ce9178'] },
  { id: 'vscode-light', label: 'VS Code Light Modern', kind: 'light', pair: 'vscode-dark', preview: ['#e8e8e8', '#ffffff', '#f8f8f8', '#005fb8', '#0000ff', '#a31515'] },
  { id: 'github-dark', label: 'GitHub Dark', kind: 'dark', pair: 'github-light', preview: ['#010409', '#0d1117', '#161b22', '#2f81f7', '#ff7b72', '#a5d6ff'] },
  { id: 'github-dimmed', label: 'GitHub Dark Dimmed', kind: 'dark', pair: 'github-light', preview: ['#1c2128', '#22272e', '#2d333b', '#539bf5', '#f47067', '#96d0ff'] },
  { id: 'github-light', label: 'GitHub Light', kind: 'light', pair: 'github-dark', preview: ['#eaeef2', '#ffffff', '#f6f8fa', '#0969da', '#cf222e', '#0a3069'] },
];

const KEY = 'studio.theme';
const byId = id => THEMES.find(theme => theme.id === id);

export function currentTheme() { return byId(document.documentElement.dataset.theme) || THEMES[0]; }

export function applyTheme(id) {
  const theme = byId(id) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.dataset.kind = theme.kind;
  try { localStorage.setItem(KEY, theme.id); } catch { /* ignore */ }
  bus.emit('theme', theme);
  return theme;
}

/** Light ↔ dark within the same family (GitHub Dark ↔ GitHub Light, …). */
export function toggleTheme() { return applyTheme(currentTheme().pair); }

export function restoreTheme() {
  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch { /* ignore */ }
  return applyTheme(byId(stored) ? stored : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
}
