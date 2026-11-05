// Render the app icon (assets/icon.png + assets/icon.ico) from renderer/js/lib/brand.js.
// Usage: electron scripts/make-icons.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
// ICO entries stop at 256; macOS packaging needs a PNG of at least 512 px.
const SIZES = [16, 24, 32, 48, 64, 128, 256, 1024];

function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e); header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map(p => p.data)]);
}

app.whenReady().then(async () => {
  const { brandSvg } = await import(pathToFileURL(path.join(ROOT, 'renderer', 'js', 'lib', 'brand.js')).href);
  const svg = brandSvg();
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.svg'), svg);
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const pngs = [];
  for (const size of SIZES) {
    const url = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image(); img.src = ${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)};
      await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = ${size};
      c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size});
      return c.toDataURL('image/png');
    })()`);
    pngs.push({ size, data: Buffer.from(url.split(',')[1], 'base64') });
  }
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.png'), pngs.at(-1).data);
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.ico'), ico(pngs.filter(png => png.size <= 256)));
  console.log('wrote assets/icon.svg, icon.png and icon.ico');
  app.quit();
});
