// Synchronize the application package and npm lockfile with a release tag.
// Usage: node scripts/set-release-version.mjs vMAJOR.MINOR.PATCH
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG_PATTERN = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

export function setReleaseVersion(root, tag) {
  if (typeof tag !== 'string' || tag.trim() !== tag || !TAG_PATTERN.test(tag)) {
    throw new Error('Expected a release tag in the form vMAJOR.MINOR.PATCH');
  }
  const version = tag.slice(1);
  if (version.length > 256 || version.split('.').some(part => !Number.isSafeInteger(Number(part)))) {
    throw new Error('Expected a release tag in the form vMAJOR.MINOR.PATCH with safe integer components');
  }
  const packagePath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  // Read and validate both files before writing either one.
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg) || typeof pkg.name !== 'string') {
    throw new Error('package.json must contain a package name');
  }
  if (!lock || typeof lock !== 'object' || Array.isArray(lock) || !lock.packages?.[''] ||
      typeof lock.packages[''] !== 'object' || Array.isArray(lock.packages[''])) {
    throw new Error('package-lock.json must contain the root package entry');
  }
  if (lock.name !== pkg.name || lock.packages[''].name !== pkg.name) {
    throw new Error('Package and lockfile root names do not match');
  }
  pkg.version = version;
  lock.version = version;
  lock.packages[''].version = version;
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/set-release-version.mjs vMAJOR.MINOR.PATCH');
    const root = fileURLToPath(new URL('..', import.meta.url));
    console.log(`Release package version: ${setReleaseVersion(root, process.argv[2])}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
