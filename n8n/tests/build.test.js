import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WORKFLOW_SOURCES } from '../build.mjs';
import { CREDENTIALS, credentialRef, placeholderId } from '../workflows-src/lib/credentials.mjs';
import { LOAD_SETTINGS } from '../src/pipeline/sql.js';
import { TUNING } from '../workflows-src/lib/tuning.mjs';
import { payloadFor } from '../../tests/fixtures/payloads.js';
import { SETTINGS } from './pipeline/settings-fixture.js';
import { built, nodeOf, ofType, outputsOf, runCode } from './built.js';

const webhooksOf = (wf) => ofType(wf, 'webhook');

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
    const sends = WORKFLOW_SOURCES.flatMap((wf) => ofType(wf, 'emailSend'));
    expect(sends.length).toBeGreaterThan(0);
    for (const n of sends) expect(n.parameters.fromEmail, n.name).toMatch(/^=\{\{ [^|]+\.email\.from \}\}$/);
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
  it('the three webhooks check X-BookLeaf-Key with n8n Header Auth (credential "BookLeaf Webhook Key")', () => {
    const hooks = ['royalty-summary', 'job-status', 'approve-draft'].flatMap(webhooksOf);
    expect(hooks.map((n) => n.parameters.path)).toEqual(['royalty-summary', 'royalty-summary/jobs', 'royalty-summary/approve']);
    expect(CREDENTIALS.webhookKey).toEqual({ type: 'httpHeaderAuth', name: 'BookLeaf Webhook Key' });
    for (const n of hooks) {
      expect(n.parameters.authentication, n.name).toBe('headerAuth');
      expect(n.credentials, n.name).toEqual(credentialRef('webhookKey'));
    }
  });
  it('no Code node checks the key any more, and no key hash is written into a workflow', () => {
    expect(JSON.stringify(built)).not.toContain('__WEBHOOK_KEY_HASHES__');
    for (const wf of Object.values(built)) {
      for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
        expect(n.parameters.jsCode, n.name).not.toMatch(/x-bookleaf-key|keyHashes|FORBIDDEN/i);
      }
    }
  });
});

describe('bundled Code nodes run standalone', () => {
  // The webhook has already checked the key (Header Auth): the Code nodes get no headers at all.
  it('Prepare Job takes the request from the webhook and the settings from Load Settings', () => {
    const node = nodeOf('royalty-summary', 'Prepare Job');
    const run = (body, settings = SETTINGS) => runCode(node, {
      $json: { settings }, $: outputsOf({ 'Royalty Summary Webhook': { body } }),
    })[0].json;
    expect(run(payloadFor('AUTH002', { delivery: 'draft' }))).toMatchObject({ route: 1, job: { author_code: 'AUTH002', delivery: 'draft', settings: SETTINGS } });
    expect(run({ mode: 'x' })).toMatchObject({ route: 0, http_status: 400, response: { error: { code: 'VALIDATION' } } });
    expect(run(payloadFor('AUTH002'), { ...SETTINGS, email_from: '' })).toMatchObject({ route: 0, http_status: 500, response: { error: { code: 'INTERNAL' } } });
  });
  it('Parse Query validates the job ids', () => {
    const run = (query) => runCode(nodeOf('job-status', 'Parse Query'), { $json: { query } })[0].json;
    expect(run({ ids: 'nope' })).toMatchObject({ route: 0, http_status: 400 });
    expect(run({ ids: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', include: 'html' })).toMatchObject({ route: 1, include_html: true });
  });
  it('Parse Request (approve) validates the settings and the body', () => {
    const node = nodeOf('approve-draft', 'Parse Request');
    const run = (body, settings = SETTINGS) => runCode(node, {
      $json: { settings }, $: outputsOf({ 'Approve Webhook': { body } }),
    })[0].json;
    const body = { job_id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', action: 'discard' };
    expect(run(body)).toMatchObject({ route: 1, job_id: body.job_id, settings: SETTINGS });
    expect(run({ action: 'x' })).toMatchObject({ route: 0, http_status: 400 });
    expect(run(body, { ...SETTINGS, draft_ttl_hours: 0 })).toMatchObject({ route: 0, http_status: 500 });
  });
});
