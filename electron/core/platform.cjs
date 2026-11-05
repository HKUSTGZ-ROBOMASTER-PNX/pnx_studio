'use strict';
// Host platform detection and Rust adapter binary resolution.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXE = process.platform === 'win32' ? '.exe' : '';
const ADAPTER = `studio-adapter${EXE}`;

function isWsl() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME) return true;
  try { return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')); } catch { return false; }
}

function hostKind() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return isWsl() ? 'wsl' : 'linux';
}

/**
 * Candidate adapter locations, most specific first:
 *  1. STUDIO_ADAPTER env override
 *  2. packaged:   <resources>/bin/<platform>-<arch>/studio-adapter
 *  3. packaged:   <resources>/bin/studio-adapter
 *  4. dev build:  <repo>/bin/…, <repo>/native/target/{release,debug}/studio-adapter
 */
function adapterCandidates(appRoot, resourcesPath) {
  const triple = `${process.platform}-${process.arch}`;
  const list = [process.env.STUDIO_ADAPTER];
  if (resourcesPath) list.push(path.join(resourcesPath, 'bin', triple, ADAPTER), path.join(resourcesPath, 'bin', ADAPTER));
  list.push(
    path.join(appRoot, 'bin', triple, ADAPTER),
    path.join(appRoot, 'bin', ADAPTER),
    path.join(appRoot, 'native', 'target', 'release', ADAPTER),
    path.join(appRoot, 'native', 'target', 'debug', ADAPTER),
  );
  return list.filter(Boolean);
}

function resolveAdapter(appRoot, resourcesPath) {
  return adapterCandidates(appRoot, resourcesPath).find(candidate => fs.existsSync(candidate)) || null;
}

/** Setup hints shown in the welcome page so probe access problems are diagnosable per OS. */
function probeAccessHints(kind = hostKind()) {
  switch (kind) {
    case 'wsl':
      return [
        'WSL has no direct USB access. In an elevated Windows terminal run `usbipd list`, then `usbipd bind --busid <id>` once and `usbipd attach --wsl --busid <id>` after each replug.',
        'Inside WSL install the udev rules (see Linux) so the attached probe is accessible without root.',
        'Alternatively run the Windows build of Embedded Studio and open the project through \\\\wsl$\\.',
      ];
    case 'linux':
      return [
        'Install the udev rules: `sudo install -m 644 70-embedded-studio-probes.rules /etc/udev/rules.d/ && sudo udevadm control --reload-rules && sudo udevadm trigger`, then replug the probe.',
      ];
    case 'macos':
      return ['ST-Link and CMSIS-DAP probes work without drivers. If a probe is missing, check System Information → USB.'];
    case 'windows':
      return [
        'CMSIS-DAP v2 (WinUSB) and DAPLink work without drivers. ST-Link needs the ST-Link USB driver (STSW-LINK009).',
        'Close other debuggers (STM32CubeIDE, Keil, OpenOCD) that may hold the probe.',
      ];
    default:
      return [];
  }
}

function describeHost() {
  const kind = hostKind();
  return {
    kind,
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    hostname: os.hostname(),
    hints: probeAccessHints(kind),
  };
}

module.exports = { ADAPTER, isWsl, hostKind, adapterCandidates, resolveAdapter, probeAccessHints, describeHost };
