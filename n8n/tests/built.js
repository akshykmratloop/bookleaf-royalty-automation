/**
 * The built workflows, and helpers that run their pieces the way n8n would, for the build tests.
 * Nothing here talks to n8n: Code nodes and expressions run in plain JS with n8n's globals faked.
 */
import { buildWorkflow, WORKFLOW_SOURCES } from '../build.mjs';

export const built = Object.fromEntries(await Promise.all(WORKFLOW_SOURCES.map(async (n) => [n, await buildWorkflow(n)])));

export const nodeOf = (wf, name) => built[wf].nodes.find((n) => n.name === name);
export const ofType = (wf, type) => built[wf].nodes.filter((n) => n.type === `n8n-nodes-base.${type}`);

/** @returns {string[]} the nodes wired to output `output` of `from` */
export const targets = (wf, from, output = 0) => (built[wf].connections[from]?.main[output] ?? []).map((c) => c.node);

/** `$('Node')` as n8n gives it to a Code node or an expression: that node's first item. */
export const outputsOf = (outputs) => (name) => ({ first: () => ({ json: outputs[name] }) });

/** Runs a built Code node the way n8n does: user code inside a function, n8n globals as parameters. */
export function runCode(node, globals) {
  const names = Object.keys(globals);
  // eslint-disable-next-line no-new-func
  return new Function(...names, node.parameters.jsCode)(...names.map((k) => globals[k]));
}

/** A fixed (non-expression) parameter as n8n reads it: a number stays a number, JSON text is parsed. */
function literalValue(parameter) {
  if (typeof parameter !== 'string') return parameter;
  try {
    return JSON.parse(parameter);
  } catch {
    return parameter;
  }
}

/**
 * Evaluates a node parameter for one item: a "={{ … }}" expression, or a fixed value.
 * @param {string} parameter @param {Record<string, unknown>} globals e.g. {$json, $}
 */
export function evaluate(parameter, globals) {
  if (typeof parameter !== 'string' || !parameter.startsWith('=')) return literalValue(parameter);
  const m = /^=\{\{ ([\s\S]*) \}\}$/.exec(parameter);
  if (!m) throw new Error(`not an n8n expression: ${parameter}`);
  if (m[1].includes('}}')) throw new Error(`n8n would end this expression at the first "}}": ${parameter}`);
  const names = Object.keys(globals);
  // eslint-disable-next-line no-new-func
  return new Function(...names, `return (${m[1]});`)(...names.map((k) => globals[k]));
}
