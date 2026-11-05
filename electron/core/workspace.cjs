'use strict';
// File-system helpers for the workspace explorer and source view.
const fs = require('node:fs');
const path = require('node:path');

const MAX_TEXT = 8 * 1024 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg', '.vscode', '.idea', '__pycache__', '.cache']);

function readText(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`Not a file: ${file}`);
  if (stat.size > MAX_TEXT) throw new Error(`File too large to open (${(stat.size / 1048576).toFixed(1)} MB)`);
  return { path: path.resolve(file), text: fs.readFileSync(file, 'utf8'), mtimeMs: stat.mtimeMs };
}

function writeText(file, text) {
  if (typeof text !== 'string') throw new Error('text must be a string');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}

function writeBinary(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(data));
  return true;
}

function listDir(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith('.') || entry.name === '.github')
    .map(entry => ({ name: entry.name, path: path.join(dir, entry.name), dir: entry.isDirectory() }))
    .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Starting points for a path picker: home, drive letters on Windows, / elsewhere. */
function roots() {
  const os = require('node:os');
  const list = [{ name: '~', path: os.homedir() }];
  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const drive = `${letter}:\\`;
      if (fs.existsSync(drive)) list.push({ name: `${letter}:`, path: drive });
    }
  } else {
    list.push({ name: '/', path: '/' });
    if (fs.existsSync('/mnt/c')) list.push({ name: 'C: (Windows)', path: '/mnt/c' });
  }
  return list;
}

/** Breadth-first search for build artifacts, newest first. */
function findFiles(root, pattern, { maxDepth = 6, limit = 200 } = {}) {
  if (!root || !fs.existsSync(root)) return [];
  const found = [];
  let frontier = [[root, 0]];
  while (frontier.length && found.length < limit) {
    const next = [];
    for (const [dir, depth] of frontier) {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (depth < maxDepth && !SKIP_DIRS.has(entry.name)) next.push([full, depth + 1]); }
        else if (pattern.test(entry.name)) {
          try { found.push({ path: full, mtimeMs: fs.statSync(full).mtimeMs }); } catch { /* raced deletion */ }
        }
      }
    }
    frontier = next;
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).map(item => item.path);
}

module.exports = { readText, writeText, writeBinary, listDir, findFiles, roots };
