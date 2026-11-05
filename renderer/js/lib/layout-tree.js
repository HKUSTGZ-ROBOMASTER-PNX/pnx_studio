// Tiling layout as an immutable tree, for the plot board.
// node = { type: 'leaf', pane } | { type: 'split', dir: 'row'|'column', sizes: number[], children: node[] }

export const leaf = pane => ({ type: 'leaf', pane });
export const split = (dir, children) => ({ type: 'split', dir, sizes: children.map(() => 1 / children.length), children });

export function panesOf(node) { return node.type === 'leaf' ? [node.pane] : node.children.flatMap(panesOf); }

/** The tree without `pane`; a split left with one child collapses into it. */
export function removePane(node, pane) {
  if (node.type === 'leaf') return node.pane === pane ? null : node;
  const kept = node.children.map((child, i) => [removePane(child, pane), node.sizes[i]]).filter(([child]) => child);
  if (!kept.length) return null;
  if (kept.length === 1) return kept[0][0];
  const total = kept.reduce((sum, [, size]) => sum + size, 0);
  return { ...node, children: kept.map(([child]) => child), sizes: kept.map(([, size]) => size / total) };
}

/** Put `pane` beside `target` on the given side ('left'|'right'|'top'|'bottom'). */
export function insertPane(node, target, pane, side) {
  const dir = side === 'left' || side === 'right' ? 'row' : 'column';
  const before = side === 'left' || side === 'top';
  if (node.type === 'leaf') {
    if (node.pane !== target) return node;
    return split(dir, before ? [leaf(pane), node] : [node, leaf(pane)]);
  }
  // Beside a pane along its parent's direction: become a sibling sharing its space, not a nested split.
  const index = node.children.findIndex(child => child.type === 'leaf' && child.pane === target);
  if (index >= 0 && node.dir === dir) {
    const children = [...node.children], sizes = [...node.sizes];
    children.splice(before ? index : index + 1, 0, leaf(pane));
    sizes.splice(index, 1, sizes[index] / 2, sizes[index] / 2);
    return { ...node, children, sizes };
  }
  return { ...node, children: node.children.map(child => insertPane(child, target, pane, side)) };
}

export function swapPanes(node, a, b) {
  if (node.type === 'leaf') return node.pane === a ? leaf(b) : node.pane === b ? leaf(a) : node;
  return { ...node, children: node.children.map(child => swapPanes(child, a, b)) };
}

export function presetLayout(panes, preset) {
  if (panes.length === 1) return leaf(panes[0]);
  if (preset === 'stack') return split('column', panes.map(leaf));
  if (preset === 'side') return split('row', panes.map(leaf));
  const columns = Math.ceil(Math.sqrt(panes.length));
  const rows = [];
  for (let i = 0; i < panes.length; i += columns) rows.push(panes.slice(i, i + columns));
  return split('column', rows.map(row => (row.length === 1 ? leaf(row[0]) : split('row', row.map(leaf)))));
}

export const equalize = node => (node.type === 'leaf' ? node : { ...node, sizes: node.children.map(() => 1 / node.children.length), children: node.children.map(equalize) });
