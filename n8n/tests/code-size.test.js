import { describe, expect, it } from 'vitest';
import { buildWorkflow, WORKFLOW_SOURCES } from '../build.mjs';

/**
 * Size budget for the generated Code nodes. esbuild drops a module whose exports a node never uses
 * only when the package declares it free of import-time side effects ("sideEffects": false in the
 * root package.json); without that, every Code node carries ~12 KB of library code it never calls.
 * Lower these numbers as the refactor removes code; raising one needs a reason in the commit.
 */
const TOTAL_BUDGET_KB = 166;
const NODE_BUDGET_KB = 29;

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

describe('Code nodes carry only what they run', () => {
  it('Check Settings bundles the checks, not the defaults and descriptions (those are for the seed tool)', () => {
    const node = workflows.find((wf) => wf.name === 'BookLeaf - Royalty Summary').nodes.find((n) => n.name === 'Check Settings');
    expect(node.parameters.jsCode).not.toContain('Publisher name shown in the email header');
    expect(node.parameters.jsCode.length / 1024).toBeLessThan(10);
  });
  it('AI Failed bundles no provider parser (frozen constants it never reads are dropped)', () => {
    const node = workflows.find((wf) => wf.name === 'BookLeaf - Write Draft').nodes.find((n) => n.name === 'AI Failed');
    expect(node.parameters.jsCode).not.toMatch(/content_filter|output_text/);
  });
});

describe('pure Object.freeze', () => {
  it('n8n/src never calls Object.freeze as a bare statement (build.mjs marks it pure, which would drop one)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
    const src = fileURLToPath(new URL('../src', import.meta.url));
    const bare = files(src).filter((f) => /^\s*Object\.freeze\(/m.test(readFileSync(f, 'utf8')));
    expect(bare).toEqual([]);
  });
});
