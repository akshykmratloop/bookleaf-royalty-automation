/**
 * Builds n8n `connections` from edges and lays nodes out left to right by graph depth.
 * Edge: [from, to] or [from, to, output]: an output index, or its name (resolveEdges).
 */

/** An IF's outputs, and the error output of a node set to "continue (using error output)". */
const IF_OUTPUTS = Object.freeze({ true: 0, false: 1 });
const ERROR_OUTPUT = 1;

/** @returns {number} the index of `from`'s output named `output` */
function outputIndex(from, output) {
  if (typeof output === 'number') return output;
  if (from.type === 'n8n-nodes-base.if' && output in IF_OUTPUTS) return IF_OUTPUTS[output];
  if (output === 'error' && from.onError === 'continueErrorOutput') return ERROR_OUTPUT;
  const rules = from.parameters?.mode === 'rules' ? from.parameters.rules.values : [];
  const i = rules.findIndex((r) => r.outputKey === output);
  if (i < 0) throw new Error(`Node "${from.name}" has no output named "${output}"`);
  return i;
}

/**
 * Edges with every output as an index. Names: 'true'/'false' (IF), 'error' (error output), or a
 * Switch's output name, so the source reads like the canvas.
 * @param {Object[]} nodes @param {[string, string, (number|string)?][]} edges @returns {[string, string, number][]}
 */
export function resolveEdges(nodes, edges) {
  const byName = new Map(nodes.map((n) => [n.name, n]));
  return edges.map(([from, to, output = 0]) => [from, to, outputIndex(byName.get(from), output)]);
}

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

/**
 * Positions by depth (x) and row (y). Nodes in `mainRow` (the happy path) share row 0; the others stack
 * below them, rows 1, 2, ... at each depth. Without a main row, the first node at each depth takes row 0.
 * @param {Object[]} nodes @param {[string, string, number][]} edges @param {string[]} [mainRow]
 * @returns {Object[]} nodes with `position` (notes keep theirs)
 */
export function layout(nodes, edges, mainRow = []) {
  const depth = depths(nodes, edges);
  const main = new Set(mainRow);
  const rowAt = new Map();
  return nodes.map((n) => {
    if (n.position) return n;
    const d = depth.get(n.name);
    if (main.has(n.name)) return { ...n, position: [d * 260, 0] };
    const row = rowAt.get(d) ?? (main.size ? 1 : 0);
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
