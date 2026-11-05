// Launch the app with an isolated profile, run a scenario in the window, save a screenshot.
// Usage: node scripts/smoke.mjs <scenario.js|-> <out.png> [--lang zh]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [scenario, out, ...rest] = process.argv.slice(2);
if (!out) { console.error('usage: node scripts/smoke.mjs <scenario.js|-> <out.png> [--lang zh]'); process.exit(2); }
const electron = createRequire(import.meta.url)('electron');
const profile = mkdtempSync(path.join(os.tmpdir(), 'studio-smoke-'));
const env = { ...process.env, STUDIO_USER_DATA: profile, STUDIO_SCREENSHOT: path.resolve(out), STUDIO_SCREENSHOT_DELAY: '800' };
if (scenario && scenario !== '-') env.STUDIO_SMOKE_SCRIPT = path.resolve(scenario);
const lang = rest.includes('--lang') ? rest[rest.indexOf('--lang') + 1] : null;
if (lang) {
  const preload = path.join(profile, 'lang.js');
  writeFileSync(preload, `localStorage.setItem('studio.language', ${JSON.stringify(lang)}); location.reload(); 'reloading'`);
}
const result = spawnSync(electron, ['.', ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [])], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, stdio: 'inherit', timeout: 90000 });
process.exit(result.status ?? 1);
