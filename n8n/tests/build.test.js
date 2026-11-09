import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildWorkflow, WORKFLOW_SOURCES } from '../build.mjs';
import { CREDENTIALS, placeholderId } from '../workflows-src/lib/credentials.mjs';
import { payloadFor } from '../../tests/fixtures/payloads.js';
import { ENV } from './pipeline/env.js';

const built = Object.fromEntries(await Promise.all(WORKFLOW_SOURCES.map(async (n) => [n, await buildWorkflow(n)])));
const nodeOf = (wf, name) => built[wf].nodes.find((n) => n.name === name);

/** Runs a built Code node the way n8n does: user code inside a function, n8n globals as parameters. */
function runCode(node, globals) {
  const names = Object.keys(globals);
  // eslint-disable-next-line no-new-func
  return new Function(...names, node.parameters.jsCode)(...names.map((k) => globals[k]));
}

describe('built workflows', () => {
  it('are committed and up to date', () => {
    for (const n of WORKFLOW_SOURCES) {
      const committed = readFileSync(new URL(`../workflows/${n}.json`, import.meta.url), 'utf8');
      expect(committed, n).toBe(`${JSON.stringify(built[n], null, 2)}\n`);
    }
  });
  it('contain no secrets and only placeholder credential ids', () => {
    const keyLike = /sk-ant-api\d\d-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{40,}/;
    expect(keyLike.test(JSON.stringify(built)), 'an API key is embedded in a workflow').toBe(false);
    for (const wf of Object.values(built)) {
      for (const n of wf.nodes.filter((x) => x.credentials)) {
        for (const ref of Object.values(n.credentials)) expect(Object.keys(CREDENTIALS).map(placeholderId)).toContain(ref.id);
      }
    }
  });
  it('Code nodes have no require/import at runtime', () => {
    for (const wf of Object.values(built)) {
      for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
        expect(n.parameters.jsCode, n.name).not.toMatch(/\brequire\(|^\s*import\s/m);
      }
    }
  });
  it('every connection points at a real node', () => {
    for (const wf of Object.values(built)) {
      const names = new Set(wf.nodes.map((n) => n.name));
      for (const [from, c] of Object.entries(wf.connections)) {
        expect(names.has(from)).toBe(true);
        c.main.flat().forEach((t) => expect(names.has(t.node), t.node).toBe(true));
      }
    }
  });
  it('royalty-summary names its error workflow', () => {
    expect(built['royalty-summary'].settings.errorWorkflow).toBe('__WORKFLOW_BookLeaf - Error Handler__');
  });
});

describe('bundled Code nodes run standalone', () => {
  it('Prepare Job accepts a valid payload and rejects a bad one', () => {
    const node = nodeOf('royalty-summary', 'Prepare Job');
    const ok = runCode(node, { $json: { body: payloadFor('AUTH002') }, $env: ENV });
    expect(ok[0].json).toMatchObject({ route: 1, job: { author_code: 'AUTH002' } });
    const bad = runCode(node, { $json: { body: { mode: 'x' } }, $env: ENV });
    expect(bad[0].json).toMatchObject({ route: 0, http_status: 400, response: { error: { code: 'VALIDATION' } } });
  });
  it('Parse Query validates job ids', () => {
    const out = runCode(nodeOf('job-status', 'Parse Query'), { $json: { query: { ids: 'nope' } } });
    expect(out[0].json).toMatchObject({ route: 0, http_status: 400 });
  });
});
