import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildWorkflow, WORKFLOW_SOURCES } from '../build.mjs';
import { CREDENTIALS, placeholderId } from '../workflows-src/lib/credentials.mjs';
import { KEY_HASHES_PLACEHOLDER } from '../workflows-src/lib/nodes.mjs';
import { KEY_HEADER } from '../src/pipeline/auth.js';
import { sha256Hex } from '../src/pipeline/sha256.js';
import { payloadFor } from '../../tests/fixtures/payloads.js';
import { ENV } from './pipeline/env.js';

const built = Object.fromEntries(await Promise.all(WORKFLOW_SOURCES.map(async (n) => [n, await buildWorkflow(n)])));
const nodeOf = (wf, name) => built[wf].nodes.find((n) => n.name === name);

/** Test-only key; deploy.mjs writes the hash of the real key(s) in place of the placeholder. */
const TEST_KEY = 'build-test-key-cccccccccccccccccccccccc';
const AUTH = { [KEY_HEADER]: TEST_KEY };

/** Runs a built Code node the way n8n does: user code inside a function, n8n globals as parameters. */
function runCode(node, globals) {
  const names = Object.keys(globals);
  const code = node.parameters.jsCode.split(KEY_HASHES_PLACEHOLDER).join(sha256Hex(TEST_KEY));
  // eslint-disable-next-line no-new-func
  return new Function(...names, code)(...names.map((k) => globals[k]));
}
const webhooksOf = (wf) => built[wf].nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');

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
  it('royalty-summary and approve-draft name the error workflow', () => {
    expect(built['royalty-summary'].settings.errorWorkflow).toBe('__WORKFLOW_BookLeaf - Error Handler__');
    expect(built['approve-draft'].settings.errorWorkflow).toBe('__WORKFLOW_BookLeaf - Error Handler__');
  });
  it('webhooks check the key in the workflow (current + next key), from a deploy-time hash list', () => {
    const paths = ['royalty-summary', 'job-status', 'approve-draft'].flatMap((wf) => webhooksOf(wf).map((n) => n.parameters.path));
    expect(paths).toEqual(['royalty-summary', 'royalty-summary/jobs', 'royalty-summary/approve']);
    for (const wf of ['royalty-summary', 'job-status', 'approve-draft']) {
      for (const n of webhooksOf(wf)) expect(n.parameters.authentication, wf).toBe('none');
      expect(JSON.stringify(built[wf]), wf).toContain(KEY_HASHES_PLACEHOLDER);
    }
  });
});

describe('bundled Code nodes run standalone', () => {
  it('Prepare Job accepts a valid payload and rejects a bad one or a bad key', () => {
    const node = nodeOf('royalty-summary', 'Prepare Job');
    const ok = runCode(node, { $json: { body: payloadFor('AUTH002', { delivery: 'draft' }), headers: AUTH }, $env: ENV });
    expect(ok[0].json).toMatchObject({ route: 1, job: { author_code: 'AUTH002', delivery: 'draft' } });
    const bad = runCode(node, { $json: { body: { mode: 'x' }, headers: AUTH }, $env: ENV });
    expect(bad[0].json).toMatchObject({ route: 0, http_status: 400, response: { error: { code: 'VALIDATION' } } });
    const noKey = runCode(node, { $json: { body: payloadFor('AUTH002'), headers: { [KEY_HEADER]: 'wrong' } }, $env: ENV });
    expect(noKey[0].json).toMatchObject({ route: 0, http_status: 403, response: { error: { code: 'FORBIDDEN' } } });
  });
  it('Parse Query validates job ids and the key', () => {
    const out = runCode(nodeOf('job-status', 'Parse Query'), { $json: { query: { ids: 'nope' }, headers: AUTH } });
    expect(out[0].json).toMatchObject({ route: 0, http_status: 400 });
    const noKey = runCode(nodeOf('job-status', 'Parse Query'), { $json: { query: { ids: 'nope' }, headers: {} } });
    expect(noKey[0].json).toMatchObject({ route: 0, http_status: 403 });
  });
  it('Parse Request (approve) validates the body and the key', () => {
    const node = nodeOf('approve-draft', 'Parse Request');
    const body = { job_id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', action: 'discard' };
    expect(runCode(node, { $json: { body, headers: AUTH }, $env: ENV })[0].json).toMatchObject({ route: 1, job_id: body.job_id });
    expect(runCode(node, { $json: { body: { action: 'x' }, headers: AUTH }, $env: ENV })[0].json).toMatchObject({ route: 0, http_status: 400 });
    expect(runCode(node, { $json: { body, headers: {} }, $env: ENV })[0].json).toMatchObject({ route: 0, http_status: 403 });
  });
});
