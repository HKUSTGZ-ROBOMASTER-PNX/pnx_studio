'use strict';
// Do not restore a title bar entirely outside the currently connected displays.
function restoreWindowBounds(saved, displays) {
  const result = {
    width: Number.isFinite(saved?.width) && saved.width >= 960 ? Math.round(saved.width) : 1480,
    height: Number.isFinite(saved?.height) && saved.height >= 600 ? Math.round(saved.height) : 940,
  };
  if (!Number.isFinite(saved?.x) || !Number.isFinite(saved?.y)) return result;
  const x = Math.round(saved.x), y = Math.round(saved.y);
  const visible = displays.some(({ workArea: area }) => {
    if (!area) return false;
    const width = Math.min(x + result.width, area.x + area.width) - Math.max(x, area.x);
    const height = Math.min(y + 32, area.y + area.height) - Math.max(y, area.y);
    return width >= 100 && height >= 16;
  });
  if (visible) { result.x = x; result.y = y; }
  return result;
}
module.exports = { restoreWindowBounds };
