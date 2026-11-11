import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WORKFLOW_SOURCES } from '../build.mjs';
import { CREDENTIALS, credentialRef, placeholderId } from '../workflows-src/lib/credentials.mjs';
import { LOAD_SETTINGS } from '../src/pipeline/sql.js';
import { TUNING } from '../src/pipeline/tuning.js';
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
  it('the two AI calls live only in Write Draft, and no HTTP node anywhere retries on its own', () => {
    const http = WORKFLOW_SOURCES.flatMap((wf) => ofType(wf, 'httpRequest').map((n) => `${wf}/${n.name}`));
    expect(http).toEqual(['write-draft/Call Anthropic', 'write-draft/Call OpenAI (fallback)']);
    for (const wf of WORKFLOW_SOURCES) for (const n of ofType(wf, 'httpRequest')) expect(n.retryOnFail, n.name).toBeUndefined();
    expect(TUNING.aiRetries).toBeGreaterThanOrEqual(1);
  });
  it('Send Email takes the From line from the settings; no deploy-time sender placeholder is left', () => {
    const sends = WORKFLOW_SOURCES.flatMap((wf) => ofType(wf, 'emailSend')).filter((n) => n.name !== 'Send Alert');
    expect(sends.length).toBeGreaterThan(0);
    expect(nodeOf('error-handler', 'Send Alert').parameters.fromEmail).toBe('={{ $json.alert_from }}');
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
  it('job-status (polled every few seconds) saves only failed runs, so its successful polls and their headers are not kept', () => {
    expect(built['job-status'].settings).toMatchObject({ saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all' });
  });
  it('job-status is Parse Query → Query Valid? (IF 2.2) → Select Jobs → Respond Jobs, or Respond Rejected: one Code node per poll', () => {
    const wf = built['job-status'];
    const next = (from, i = 0) => (wf.connections[from]?.main[i] ?? []).map((c) => c.node);
    expect(nodeOf('job-status', 'Query Valid?')).toMatchObject({ type: 'n8n-nodes-base.if', typeVersion: 2.2 });
    expect([next('Parse Query'), next('Query Valid?', 0), next('Query Valid?', 1), next('Select Jobs')])
      .toEqual([['Query Valid?'], ['Select Jobs'], ['Respond Rejected'], ['Respond Jobs']]);
    expect(ofType('job-status', 'code').map((n) => n.name)).toEqual(['Parse Query']);
    const respondJobs = nodeOf('job-status', 'Respond Jobs').parameters;
    expect([respondJobs.options.responseCode, respondJobs.responseBody]).toEqual(['={{ 200 }}', '={{ $json.response }}']);
  });
  it('no Switch picks its output by a computed number: every Switch is in Rules mode with named outputs', () => {
    const switches = WORKFLOW_SOURCES.flatMap((wf) => ofType(wf, 'switch'));
    expect(switches.length).toBeGreaterThan(0);
    for (const n of switches) expect(n.parameters.mode, n.name).toBe('rules');
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
  it('Build Context throws on the crash drill, so the execution fails and the error workflow runs', () => {
    const job = runCode(nodeOf('royalty-summary', 'Validate Body'), {
      $json: { settings: SETTINGS }, $: outputsOf({ 'Royalty Summary Webhook': { body: payloadFor('AUTH002', { drills: { crash: true } }) } }),
      $execution: { id: '81' },
    })[0].json.job;
    const run = () => runCode(nodeOf('royalty-summary', 'Build Context'), {
      $: outputsOf({ 'Validate Body': { job }, 'Enqueue Job': { job_id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' } }),
    });
    expect(run).toThrow('Failure drill: the workflow crashed on purpose.');
  });
  // The webhook has already checked the key (Header Auth): the Code nodes get no headers at all.
  it('Validate Body takes the request from the webhook, the checked settings from Check Settings and the execution id from n8n', () => {
    const node = nodeOf('royalty-summary', 'Validate Body');
    const run = (body, settings = SETTINGS) => runCode(node, {
      $json: { settings }, $: outputsOf({ 'Royalty Summary Webhook': { body } }), $execution: { id: '81' },
    })[0].json;
    const ok = run(payloadFor('AUTH002', { delivery: 'draft' }));
    expect(ok).toMatchObject({ ok: true, job: { author_code: 'AUTH002', delivery: 'draft', settings: SETTINGS } });
    expect(JSON.parse(ok.enqueue).execution_id).toBe('81');
    expect(run({ mode: 'x' })).toMatchObject({ ok: false, http_status: 400, response: { error: { code: 'VALIDATION' } } });
  });
  it('Check Settings (both workflows) answers 500 INTERNAL for unusable settings and passes good ones on', () => {
    for (const wf of ['royalty-summary', 'approve-draft']) {
      const run = (settings) => runCode(nodeOf(wf, 'Check Settings'), { $json: { settings } })[0].json;
      expect(run(SETTINGS), wf).toEqual({ ok: true, settings: SETTINGS });
      expect(run({ ...SETTINGS, email_from: '' }), wf).toMatchObject({ ok: false, http_status: 500, response: { error: { code: 'INTERNAL' } } });
    }
  });
  it('Parse Query validates the job ids', () => {
    const run = (query) => runCode(nodeOf('job-status', 'Parse Query'), { $json: { query } })[0].json;
    expect(run({ ids: 'nope' })).toMatchObject({ ok: false, http_status: 400 });
    expect(run({ ids: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', include: 'html' })).toMatchObject({ ok: true, include_html: true });
  });
  it('Parse Request (approve) validates the body and passes the checked settings on', () => {
    const node = nodeOf('approve-draft', 'Parse Request');
    const run = (body, settings = SETTINGS) => runCode(node, {
      $json: { settings }, $: outputsOf({ 'Approve Webhook': { body } }),
    })[0].json;
    const body = { job_id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', action: 'discard' };
    expect(run(body)).toMatchObject({ ok: true, job_id: body.job_id, settings: SETTINGS });
    expect(run({ action: 'x' })).toMatchObject({ ok: false, http_status: 400 });
  });
});

describe('expressions', () => {
  /** Every string parameter, with its path, in every built workflow. */
  function* stringsOf(value, path) {
    if (typeof value === 'string') yield [path, value];
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* stringsOf(v, `${path}.${k}`);
  }
  it('no "={{ … }}" parameter holds "}}" before its end (n8n would close the expression there)', () => {
    const bad = [];
    for (const [wf, w] of Object.entries(built)) {
      for (const n of w.nodes) {
        for (const [path, s] of stringsOf(n.parameters, `${wf}/${n.name}`)) {
          if (!s.startsWith('={{') || path.endsWith('.jsCode')) continue;
          if (s.indexOf('}}') !== s.length - 2) bad.push(path);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('run time limit', () => {
  it('Royalty Summary and Write Draft end themselves after TUNING.runTimeoutSeconds (n8n executionTimeout)', () => {
    for (const wf of ['royalty-summary', 'write-draft']) expect(built[wf].settings.executionTimeout, wf).toBe(TUNING.runTimeoutSeconds);
    expect(TUNING.runTimeoutSeconds).toBe(600);
  });
});
