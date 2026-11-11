import { describe, expect, it } from 'vitest';
import { buildWorkflow, WORKFLOW_SOURCES } from '../build.mjs';

/**
 * Size budget for the generated Code nodes. esbuild drops a module whose exports a node never uses
 * only when the package declares it free of import-time side effects ("sideEffects": false in the
 * root package.json); without that, every Code node carries ~12 KB of library code it never calls.
 * Lower these numbers as the refactor removes code; raising one needs a reason in the commit.
 */
const TOTAL_BUDGET_KB = 198;
const NODE_BUDGET_KB = 36;

const workflows = await Promise.all(WORKFLOW_SOURCES.map(buildWorkflow));
const codeNodes = workflows.flatMap((wf) => wf.nodes
  .filter((n) => n.type === 'n8n-nodes-base.code')
  .map((n) => ({ where: `${wf.name} / ${n.name}`, kb: n.parameters.jsCode.length / 1024 })));

describe('Code node size budget', () => {
  it(`all Code nodes together stay within ${TOTAL_BUDGET_KB} KB`, () => {
    const total = codeNodes.reduce((sum, n) => sum + n.kb, 0);
    expect(total, `${codeNodes.length} Code nodes`).toBeLessThanOrEqual(TOTAL_BUDGET_KB);
  });
  it(`no Code node is over ${NODE_BUDGET_KB} KB`, () => {
    const over = codeNodes.filter((n) => n.kb > NODE_BUDGET_KB).map((n) => `${n.where}: ${n.kb.toFixed(1)} KB`);
    expect(over).toEqual([]);
  });
});
