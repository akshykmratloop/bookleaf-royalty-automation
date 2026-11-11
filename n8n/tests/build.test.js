import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildWorkflow, WORKFLOW_SOURCES } from '../build.mjs';
import { CREDENTIALS, placeholderId } from '../workflows-src/lib/credentials.mjs';
import { KEY_HASHES_PLACEHOLDER } from '../workflows-src/lib/nodes.mjs';
import { KEY_HEADER } from '../src/pipeline/auth.js';
import { sha256Hex } from '../src/pipeline/sha256.js';
import { LOAD_SETTINGS } from '../src/pipeline/sql.js';
import { TUNING } from '../workflows-src/lib/tuning.mjs';
import { payloadFor } from '../../tests/fixtures/payloads.js';
import { SETTINGS } from './pipeline/settings-fixture.js';

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
const ofType = (wf, type) => built[wf].nodes.filter((n) => n.type === `n8n-nodes-base.${type}`);
/** `$('Node')` as n8n gives it to a Code node: that node's first item. */
const outputsOf = (outputs) => (name) => ({ first: () => ({ json: outputs[name] }) });

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
  it('royalty-summary reads the author data from the request only: no Bubble Data API, no push callback', () => {
    const names = built['royalty-summary'].nodes.map((n) => n.name);
    expect(names.filter((n) => /Bubble|Callback|Data Source|After Update/.test(n))).toEqual([]);
    expect(Object.keys(CREDENTIALS)).not.toContain('bubble');
    expect(built['royalty-summary'].connections['Mark Processing'].main[0].map((c) => c.node)).toEqual(['Build Context']);
  });
  it('no workflow reads $env: the server settings come from bookleaf_settings', () => {
    for (const [name, wf] of Object.entries(built)) expect(JSON.stringify(wf), name).not.toMatch(/\$env\b/);
  });
  it('royalty-summary and approve-draft load the settings right after the webhook; job-status loads none', () => {
    for (const [wf, hook] of [['royalty-summary', 'Royalty Summary Webhook'], ['approve-draft', 'Approve Webhook']]) {
      expect(built[wf].connections[hook].main[0].map((c) => c.node), wf).toEqual(['Load Settings']);
      expect(nodeOf(wf, 'Load Settings').parameters.query, wf).toBe(LOAD_SETTINGS);
    }
    expect(JSON.stringify(built['job-status'])).not.toContain('bookleaf_settings');
  });
  it('the four AI calls time out after ai_timeout_ms and retry as tuned at build time', () => {
    const ai = ofType('royalty-summary', 'httpRequest');
    expect(ai.map((n) => n.name)).toEqual(['Call Anthropic', 'Call OpenAI (fallback)', 'Regenerate (Anthropic)', 'Regenerate (OpenAI)']);
    for (const n of ai) {
      expect(n.parameters.options.timeout, n.name).toBe("={{ $('Prepare Job').first().json.job.settings.ai_timeout_ms }}");
      expect(n, n.name).toMatchObject({ retryOnFail: true, maxTries: TUNING.aiRetries + 1, waitBetweenTries: TUNING.aiRetryWaitMs });
    }
  });
  it('Send Email takes the From line from the settings; no deploy-time sender placeholder is left', () => {
    for (const wf of ['royalty-summary', 'approve-draft']) {
      for (const n of ofType(wf, 'emailSend')) expect(n.parameters.fromEmail, n.name).toMatch(/^=\{\{ [^|]+\.email\.from \}\}$/);
    }
    expect(JSON.stringify(built)).not.toContain('__SMTP_FROM__');
  });
  it('the sweeper runs every minute and saves only failed runs', () => {
    const [trigger] = ofType('sweeper', 'scheduleTrigger');
    expect(TUNING.sweepEveryMinutes).toBe(1);
    expect(trigger.parameters.rule.interval).toEqual([{ field: 'minutes', minutesInterval: TUNING.sweepEveryMinutes }]);
    expect(built.sweeper.settings).toMatchObject({ saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all' });
    expect(built['royalty-summary'].settings.saveDataSuccessExecution).toBe('all');
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
  it('Prepare Job takes the request from the webhook and the settings from Load Settings', () => {
    const node = nodeOf('royalty-summary', 'Prepare Job');
    const run = (body, headers = AUTH, settings = SETTINGS) => runCode(node, {
      $json: { settings }, $: outputsOf({ 'Royalty Summary Webhook': { body, headers } }),
    })[0].json;
    expect(run(payloadFor('AUTH002', { delivery: 'draft' }))).toMatchObject({ route: 1, job: { author_code: 'AUTH002', delivery: 'draft', settings: SETTINGS } });
    expect(run({ mode: 'x' })).toMatchObject({ route: 0, http_status: 400, response: { error: { code: 'VALIDATION' } } });
    expect(run(payloadFor('AUTH002'), { [KEY_HEADER]: 'wrong' })).toMatchObject({ route: 0, http_status: 403, response: { error: { code: 'FORBIDDEN' } } });
    expect(run(payloadFor('AUTH002'), AUTH, { ...SETTINGS, email_from: '' })).toMatchObject({ route: 0, http_status: 500, response: { error: { code: 'INTERNAL' } } });
  });
  it('Parse Query validates job ids and the key', () => {
    const out = runCode(nodeOf('job-status', 'Parse Query'), { $json: { query: { ids: 'nope' }, headers: AUTH } });
    expect(out[0].json).toMatchObject({ route: 0, http_status: 400 });
    const noKey = runCode(nodeOf('job-status', 'Parse Query'), { $json: { query: { ids: 'nope' }, headers: {} } });
    expect(noKey[0].json).toMatchObject({ route: 0, http_status: 403 });
  });
  it('Parse Request (approve) validates the settings, the key and the body', () => {
    const node = nodeOf('approve-draft', 'Parse Request');
    const run = (body, headers = AUTH, settings = SETTINGS) => runCode(node, {
      $json: { settings }, $: outputsOf({ 'Approve Webhook': { body, headers } }),
    })[0].json;
    const body = { job_id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', action: 'discard' };
    expect(run(body)).toMatchObject({ route: 1, job_id: body.job_id, settings: SETTINGS });
    expect(run({ action: 'x' })).toMatchObject({ route: 0, http_status: 400 });
    expect(run(body, {})).toMatchObject({ route: 0, http_status: 403 });
    expect(run(body, AUTH, { ...SETTINGS, draft_ttl_hours: 0 })).toMatchObject({ route: 0, http_status: 500 });
  });
});
