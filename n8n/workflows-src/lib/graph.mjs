/**
 * Builds n8n `connections` from edges and lays nodes out left to right by graph depth.
 * Edge: [from, to] or [from, to, outputIndex].
 */
export function connectionsFrom(edges) {
  const out = {};
  for (const [from, to, output = 0] of edges) {
    const main = (out[from] ??= { main: [] }).main;
    while (main.length <= output) main.push([]);
    main[output].push({ node: to, type: 'main', index: 0 });
  }
  return out;
}

function depths(nodes, edges) {
  const depth = new Map(nodes.map((n) => [n.name, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const [from, to] of edges) {
      const d = depth.get(from) + 1;
      if (d > depth.get(to) && d < nodes.length) { depth.set(to, d); changed = true; }
    }
    if (!changed) break;
  }
  return depth;
}

/** @returns {Object[]} nodes with `position` (notes keep theirs) */
export function layout(nodes, edges) {
  const depth = depths(nodes, edges);
  const rowAt = new Map();
  return nodes.map((n) => {
    if (n.position) return n;
    const d = depth.get(n.name);
    const row = rowAt.get(d) ?? 0;
    rowAt.set(d, row + 1);
    return { ...n, position: [d * 260, row * 180] };
  });
}

/** Fails the build when an edge names a node that does not exist. */
export function assertEdges(nodes, edges) {
  const names = new Set(nodes.map((n) => n.name));
  const bad = edges.flatMap(([f, t]) => [f, t]).filter((n) => !names.has(n));
  if (bad.length) throw new Error(`Unknown node(s) in connections: ${[...new Set(bad)].join(', ')}`);
}
