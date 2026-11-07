'use strict';
// GitHub releases are immutable inputs to this updater: the renderer never supplies URLs or paths.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const REPO = 'HKUSTGZ-ROBOMASTER-PNX/pnx_studio';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const MAX_PACKAGE = 1024 * 1024 * 1024;
const MAX_TEXT = 2 * 1024 * 1024;

function versionParts(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value || '');
  if (!match) throw new Error(`Invalid release version: ${value}`);
  const parts = match.slice(1).map(Number);
  if (parts.some(n => !Number.isSafeInteger(n))) throw new Error('Invalid release version');
  return parts;
}
function newer(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function assetPattern(platform, arch) {
  if (platform === 'win32' && arch === 'x64') return /^windows-x64-[A-Za-z0-9._-]+\.exe$/i;
  if (platform === 'linux' && arch === 'x64') return /^linux-x64-[A-Za-z0-9._-]+\.AppImage$/i;
  if (platform === 'darwin' && ['x64', 'arm64'].includes(arch)) return new RegExp(`^macos-${arch}-[A-Za-z0-9._-]+\\.dmg$`, 'i');
  throw new Error('No release package is available for this platform');
}
function assetUrl(tag, name) {
  return `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}
function selectRelease(release, platform, arch) {
  const version = release?.tag_name;
  versionParts(version);
  if (release.draft || release.prerelease || !Array.isArray(release.assets)) throw new Error('Invalid stable release');
  const pattern = assetPattern(platform, arch);
  const packages = release.assets.filter(a => pattern.test(a.name || ''));
  if (packages.length !== 1 || !release.assets.some(a => a.name === 'SHA256SUMS.txt')) throw new Error('Release package or checksums are missing or ambiguous');
  return { version, name: packages[0].name, url: assetUrl(version, packages[0].name), sumsUrl: assetUrl(version, 'SHA256SUMS.txt') };
}
async function response(url, fetcher, limit) {
  let result;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.username || target.password || target.port || !['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(target.hostname)) throw new Error('Untrusted update download host');
    result = await fetcher(target.href, { headers: { 'User-Agent': 'Embedded-Studio-Updater', Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(120000), redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(result.status)) break;
    const location = result.headers.get('location');
    if (!location || redirects === 5) throw new Error('Invalid update redirect');
    url = new URL(location, target).href;
  }
  if (!result.ok) throw new Error(`Update request failed (HTTP ${result.status})`);
  if (result.url && new URL(result.url).protocol !== 'https:') throw new Error('Update download must use HTTPS');
  const length = Number(result.headers.get('content-length'));
  if (length > limit) throw new Error('Update download is too large');
  return result;
}
async function textResponse(url, fetcher) {
  const result = await response(url, fetcher, MAX_TEXT);
  const reader = result.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_TEXT) throw new Error('Update metadata is too large');
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
function checksumFor(text, name) {
  const matches = text.split(/\r?\n/).map(line => /^([a-fA-F0-9]{64}) [ *](.+)$/.exec(line)).filter(m => m && m[2] === name);
  if (matches.length !== 1) throw new Error('Missing or ambiguous update checksum');
  return matches[0][1].toLowerCase();
}
function createUpdater({ version, platform = process.platform, arch = process.arch, userData, fetcher = fetch }) {
  let available = null;
  let downloaded = null;
  let busy = false;
  return {
    async check() {
      const release = JSON.parse(await textResponse(API, fetcher));
      const candidate = selectRelease(release, platform, arch);
      available = newer(candidate.version, version) ? candidate : null;
      downloaded = null;
      return { current: version, latest: candidate.version, available: !!available, package: candidate.name };
    },
    async download() {
      if (!available) throw new Error('Check for an available update first');
      if (busy) throw new Error('Update download already in progress');
      busy = true;
      downloaded = null;
      const candidate = available;
      const dir = path.join(userData, 'updates');
      const destination = path.join(dir, candidate.name);
      const temporary = `${destination}.${crypto.randomBytes(8).toString('hex')}.tmp`;
      try {
        const sum = checksumFor(await textResponse(candidate.sumsUrl, fetcher), candidate.name);
        const result = await response(candidate.url, fetcher, MAX_PACKAGE);
        fs.mkdirSync(dir, { recursive: true });
        const hash = crypto.createHash('sha256'); let size = 0;
        const meter = new Transform({ transform(chunk, _encoding, callback) {
          size += chunk.length;
          if (size > MAX_PACKAGE) return callback(new Error('Update download is too large'));
          hash.update(chunk); callback(null, chunk);
        } });
        await pipeline(Readable.fromWeb(result.body), meter, fs.createWriteStream(temporary, { flags: 'wx' }));
        if (hash.digest('hex') !== sum) throw new Error('Update checksum does not match');
        if (available !== candidate) throw new Error('Update changed while downloading; check again');
        fs.renameSync(temporary, destination);
        downloaded = { path: destination, checksum: sum };
        return { path: destination, version: candidate.version };
      } finally { busy = false; try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    },
    downloaded() { if (!downloaded || !fs.existsSync(downloaded.path)) throw new Error('Download the update first'); return downloaded.path; },
    async verified() {
      if (!downloaded) throw new Error('Download the update first');
      const selected = downloaded;
      const hash = crypto.createHash('sha256'); let size = 0;
      for await (const chunk of fs.createReadStream(selected.path)) {
        size += chunk.length;
        if (size > MAX_PACKAGE) throw new Error('Update download is too large');
        hash.update(chunk);
      }
      if (downloaded !== selected || hash.digest('hex') !== selected.checksum) throw new Error('Update checksum does not match');
      return selected.path;
    },
  };
}
module.exports = { createUpdater, versionParts, newer, selectRelease, checksumFor };
