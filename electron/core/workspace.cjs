'use strict';
// File-system helpers for the workspace explorer and source view.
const fs = require('node:fs');
const path = require('node:path');

const MAX_TEXT = 8 * 1024 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg', '.vscode', '.idea', '__pycache__', '.cache']);
const CONFIG_FILE = '.embedded-studio.json';

function readConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const config = JSON.parse(text);
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`Invalid workspace configuration: ${file}`);
  if (typeof config.connection?.elf === 'string' && config.connection.elf && !path.isAbsolute(config.connection.elf)) {
    config.connection.elf = path.resolve(root, config.connection.elf);
  }
  return config;
}

function writeConfig(root, config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid workspace configuration');
  const file = path.join(root, CONFIG_FILE);
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  let saved = config;
  const elf = config.connection?.elf;
  if (typeof elf === 'string' && path.isAbsolute(elf)) {
    const relative = path.relative(root, elf);
    if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
      saved = { ...config, connection: { ...config.connection, elf: relative.split(path.sep).join('/') } };
    }
  }
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(saved, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return true;
}

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

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
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

// .out is also used by other tools; only report files with an ELF signature.
function findElfs(root) {
  return findFiles(root, /\.(elf|axf|out)$/i).filter(file => {
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const header = Buffer.alloc(4);
      return fs.readSync(fd, header, 0, 4, 0) === 4 && header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    } catch { return false; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  });
}

module.exports = { readText, writeText, writeBinary, listDir, findFiles, findElfs, roots, isFile, readConfig, writeConfig };
