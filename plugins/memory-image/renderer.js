// Memory Image Viewer — example renderer-only plugin.
// Reads `width * height * bpp` bytes from target memory and draws them on a canvas.

const FORMATS = {
  gray8: { label: 'GRAY8', bytes: 1, decode: (b, i) => [b[i], b[i], b[i]] },
  rgb565: { label: 'RGB565 (LE)', bytes: 2, decode: (b, i) => { const v = b[i] | (b[i + 1] << 8); return [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31]; } },
  rgb565be: { label: 'RGB565 (BE)', bytes: 2, decode: (b, i) => { const v = (b[i] << 8) | b[i + 1]; return [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31]; } },
  rgb888: { label: 'RGB888', bytes: 3, decode: (b, i) => [b[i], b[i + 1], b[i + 2]] },
  rgba8888: { label: 'RGBA8888', bytes: 4, decode: (b, i) => [b[i], b[i + 1], b[i + 2]] },
  mono1: { label: '1-bit (MSB first)', bytes: 1 / 8, decode: null },
  f32: { label: 'float32 heat map', bytes: 4, decode: null },
};

function heat(t) {
  // Perceptual-ish dark-blue → teal → yellow ramp.
  const stops = [[13, 8, 135], [84, 2, 163], [139, 10, 165], [185, 50, 137], [219, 92, 104], [244, 136, 73], [254, 188, 43], [240, 249, 33]];
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x), f = x - i;
  return stops[i].map((c, k) => c + (stops[i + 1][k] - c) * f);
}

export function activate(studio) {
  const { h, icon, iconButton, notify, parseNumber, hex } = studio.ui;

  studio.views.register('viewer', {
    title: 'Memory Image',
    icon: 'image',
    location: 'editor',
    render(container) {
      const saved = studio.storage.get('config', { address: '0x20010000', width: 64, height: 48, format: 'rgb565', scale: 4, fps: 5 });
      const address = h('input', { type: 'text', class: 'mono', value: saved.address, style: { width: '150px' }, title: 'Address or symbol name' });
      const width = h('input', { type: 'number', value: saved.width, min: 1, max: 2048, style: { width: '70px' } });
      const height = h('input', { type: 'number', value: saved.height, min: 1, max: 2048, style: { width: '70px' } });
      const format = h('select', null, Object.entries(FORMATS).map(([key, value]) => h('option', { value: key, selected: key === saved.format }, value.label)));
      const scale = h('select', null, [1, 2, 3, 4, 6, 8].map(value => h('option', { value, selected: value === saved.scale }, `${value}×`)));
      const fps = h('select', null, [0, 1, 2, 5, 10, 20].map(value => h('option', { value, selected: value === saved.fps }, value ? `${value} fps` : 'manual')));
      const live = h('input', { type: 'checkbox' });
      const canvas = h('canvas', { style: { imageRendering: 'pixelated', border: '1px solid var(--line-strong)', background: 'var(--bg-0)' } });
      const info = h('div', { class: 'faint mono', style: { padding: '6px 12px' } });
      let timer = null, busy = false;

      const resolveAddress = () => {
        const n = parseNumber(address.value);
        if (n !== null) return n;
        const variable = studio.session.variable(address.value.trim());
        if (variable?.address != null) return variable.address;
        throw new Error(`Unknown address or symbol: ${address.value}`);
      };

      const draw = async () => {
        if (busy) return;
        if (!studio.session.connected) { info.textContent = 'Connect to a target (the simulated target has a 64×48 RGB565 buffer at 0x20010000).'; return; }
        busy = true;
        try {
          const w = Math.max(1, Number(width.value)), hgt = Math.max(1, Number(height.value));
          const spec = FORMATS[format.value];
          const length = Math.ceil(w * hgt * spec.bytes);
          if (length > 4 * 1024 * 1024) throw new Error('Frame larger than 4 MiB');
          const base = resolveAddress();
          const started = performance.now();
          const bytes = await studio.session.readMemory(base, length);
          const image = new ImageData(w, hgt);
          const px = image.data;
          if (format.value === 'mono1') {
            for (let p = 0; p < w * hgt; p++) { const on = (bytes[p >> 3] >> (7 - (p & 7))) & 1; px.set(on ? [230, 230, 230, 255] : [20, 20, 20, 255], p * 4); }
          } else if (format.value === 'f32') {
            const floats = new Float32Array(bytes.buffer, bytes.byteOffset, w * hgt);
            let lo = Infinity, hi = -Infinity;
            for (const v of floats) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
            const span = hi - lo || 1;
            floats.forEach((v, p) => { const [r, g, b] = heat((v - lo) / span); px.set([r, g, b, 255], p * 4); });
            info.dataset.range = `min ${lo.toPrecision(4)} · max ${hi.toPrecision(4)}`;
          } else {
            for (let p = 0; p < w * hgt; p++) { const [r, g, b] = spec.decode(bytes, p * spec.bytes); px[p * 4] = r; px[p * 4 + 1] = g; px[p * 4 + 2] = b; px[p * 4 + 3] = 255; }
          }
          canvas.width = w; canvas.height = hgt;
          canvas.style.width = `${w * Number(scale.value)}px`;
          canvas.style.height = `${hgt * Number(scale.value)}px`;
          canvas.getContext('2d').putImageData(image, 0, 0);
          info.textContent = `${hex(base)} · ${w}×${hgt} ${spec.label} · ${length} bytes in ${(performance.now() - started).toFixed(0)} ms ${info.dataset.range && format.value === 'f32' ? `· ${info.dataset.range}` : ''}`;
        } catch (error) { info.textContent = error.message; }
        finally { busy = false; }
      };

      const schedule = () => {
        clearInterval(timer);
        const rate = Number(fps.value);
        if (live.checked && rate) timer = setInterval(draw, 1000 / rate);
      };
      const persist = () => studio.storage.set('config', { address: address.value, width: Number(width.value), height: Number(height.value), format: format.value, scale: Number(scale.value), fps: Number(fps.value) });
      for (const input of [address, width, height, format, scale, fps]) input.addEventListener('change', () => { persist(); schedule(); draw(); });
      live.addEventListener('change', schedule);

      const save = async () => {
        const file = await studio.host.dialog.saveFile({ title: 'Save frame', defaultPath: 'frame.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
        if (!file) return;
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        await studio.host.fs.writeBinary(file, new Uint8Array(await blob.arrayBuffer()));
        notify(`Saved ${file}`, 'ok');
      };

      container.append(
        h('div', { class: 'view-toolbar' }, address, width, h('span', { class: 'faint' }, '×'), height, format, scale,
          h('button', { class: 'btn small primary', onclick: draw }, icon('refresh'), 'Read'),
          h('label', { class: 'row' }, live, 'Live'), fps, h('span', { class: 'grow' }), iconButton('download', 'Save PNG', save)),
        h('div', { style: { flex: '1', overflow: 'auto', padding: '16px', display: 'grid', placeItems: 'start' } }, canvas),
        info);
      const offs = [studio.session.on('stopped', draw), studio.session.on('connected', draw)];
      draw();
      return { dispose: () => { clearInterval(timer); offs.forEach(off => off()); }, onHide: () => clearInterval(timer), onShow: schedule };
    },
  });

  studio.commands.register('open', 'Open Memory Image viewer', () => studio.views.open('viewer'));
}
