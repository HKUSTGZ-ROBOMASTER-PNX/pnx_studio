// Common format used by the Windows installer and the WSL installation script.
export const PLUGINS = [
  ['csv-recorder', 'CSV Recorder'],
  ['imu-attitude', 'IMU Attitude'],
  ['memory-image', 'Memory Image Viewer'],
  ['pnx-template', 'PnX Template Configuration'],
  ['system-identification', 'Gimbal System Identification'],
];
const ids = new Set(PLUGINS.map(([id]) => id));

export function parseSelection(value) {
  if (value === 'all') return new Set(ids);
  if (value === 'none' || value === '') return new Set();
  const selected = new Set(value.split(',').map(id => id.trim()).filter(Boolean));
  for (const id of selected) if (!ids.has(id)) throw new Error(`Unknown plugin: ${id}`);
  return selected;
}

export function readSelection(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([^=]+)=(.*)$/.exec(line.trim());
    if (match && ids.has(match[1])) values.set(match[1], match[2].trim());
  }
  if (values.size !== ids.size || [...values.values()].some(value => value !== '0' && value !== '1')) throw new Error('Invalid plugin selection');
  return new Set([...values].filter(([, value]) => value === '1').map(([id]) => id));
}

export function formatSelection(selected) {
  return `[plugins]\r\n${PLUGINS.map(([id]) => `${id}=${selected.has(id) ? 1 : 0}`).join('\r\n')}\r\n`;
}
