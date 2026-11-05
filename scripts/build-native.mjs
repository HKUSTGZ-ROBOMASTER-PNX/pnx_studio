// Build the Rust core and stage it under bin/<platform>-<arch>/ for Electron packaging.
// Usage: node scripts/build-native.mjs [--target <rust-triple>] [--debug]
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : null;
const profile = args.includes('--debug') ? 'debug' : 'release';

// Map a Rust target triple to the Node platform/arch naming used at runtime.
function nodeTriple(rustTarget) {
  if (!rustTarget) return `${process.platform}-${process.arch}`;
  const platform = rustTarget.includes('windows') ? 'win32' : rustTarget.includes('apple') ? 'darwin' : 'linux';
  const arch = rustTarget.startsWith('aarch64') ? 'arm64' : rustTarget.startsWith('x86_64') ? 'x64' : rustTarget.split('-')[0];
  return `${platform}-${arch}`;
}

const cargoArgs = ['build', '--locked', '--manifest-path', path.join(root, 'native', 'Cargo.toml'), '-p', 'studio-adapter'];
if (profile === 'release') cargoArgs.push('--release');
if (target) cargoArgs.push('--target', target);
execFileSync('cargo', cargoArgs, { stdio: 'inherit' });

const triple = nodeTriple(target);
const exe = triple.startsWith('win32') ? 'studio-adapter.exe' : 'studio-adapter';
const built = path.join(root, 'native', 'target', ...(target ? [target] : []), profile, exe);
const staged = path.join(root, 'bin', triple, exe);
mkdirSync(path.dirname(staged), { recursive: true });
copyFileSync(built, staged);
if (!triple.startsWith('win32')) chmodSync(staged, 0o755);
console.log(`staged ${path.relative(root, staged)}`);
