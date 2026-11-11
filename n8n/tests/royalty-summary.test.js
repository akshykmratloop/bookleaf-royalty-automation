import { describe, expect, it } from 'vitest';
import { AI_OUTCOMES } from '../src/pipeline/after-ai.js';
import { buildContext } from '../src/pipeline/context.js';
import { rateLimitedResponse } from '../src/pipeline/prepare.js';
import { ENQUEUE_JOB, UPDATE_JOB } from '../src/pipeline/sql.js';
import { WRITE_DRAFT } from '../workflows-src/write-draft.mjs';
import { payloadFor } from './pipeline/fixtures.js';
import { JOB_ID, queuedJob } from './pipeline/job-fixture.js';
import { SETTINGS } from './pipeline/settings-fixture.js';
import { built, evaluate, nodeOf, runCode, targets } from './built.js';

/** "BookLeaf - Royalty Summary": intake, ledger, data, AI writer, fact check, render and deliver, record. */
const WF = 'royalty-summary';
const ID = JOB_ID;
const working = built[WF].nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
const typeCounts = () => working.reduce((acc, n) => ({ ...acc, [n.type.replace('n8n-nodes-base.', '')]: (acc[n.type.replace('n8n-nodes-base.', '')] ?? 0) + 1 }), {});
const job = queuedJob('AUTH002');
const ctx = buildContext(job).ctx;
/**
 * `$` as n8n gives it to a Code node: `first()` of a node's output, `all(1)` of its error output and
 * `isExecuted`. @param {Record<string, Object>} outputs @param {Record<string, Object>} [errors]
 */
const nodes = (outputs, errors = {}) => (name) => ({
  isExecuted: name in outputs || name in errors,
  first: () => ({ json: outputs[name] }),
  all: (branch = 0) => (branch === 1 ? (name in errors ? [{ json: errors[name] }] : []) : [{ json: outputs[name] }]),
});
const run = (name, $json, outputs, errors) => runCode(nodeOf(WF, name), { $json, $: nodes(outputs, errors), $execution: { id: '4711' } })[0].json;
const ruleOutputs = (name) => nodeOf(WF, name).parameters.rules.values.map((r) => [r.outputKey, r.conditions.conditions[0].rightValue]);
/** A sub-workflow call's inputs, evaluated like n8n for these node outputs. */
const callInputs = (name, outputs, $json = {}) => Object.fromEntries(Object.entries(nodeOf(WF, name).parameters.workflowInputs.value)
  .map(([k, expr]) => [k, evaluate(expr, { $json, $: nodes(outputs) })]));

describe('royalty-summary shape', () => {
  it('has 27 working nodes: 4 Code, 5 IF, 2 Switch, 5 Postgres, 6 Respond, 3 sub-workflow calls, Stop and the webhook', () => {
    expect(working).toHaveLength(27);
    expect(typeCounts()).toEqual({
      webhook: 1, postgres: 5, code: 4, if: 5, switch: 2, respondToWebhook: 6, executeWorkflow: 3, stopAndError: 1,
    });
  });
  it('every Switch is in Rules mode with named outputs (filter version 2); none picks an output by number', () => {
    for (const n of working.filter((x) => x.type === 'n8n-nodes-base.switch')) {
      expect(n, n.name).toMatchObject({ typeVersion: 3.2, parameters: { mode: 'rules' } });
      for (const rule of n.parameters.rules.values) {
        expect(rule, n.name).toMatchObject({ renameOutput: true, outputKey: expect.stringMatching(/^[A-Z][a-z ]+$/) });
        expect(rule.conditions.options, n.name).toEqual({ caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 });
        expect(rule.conditions.conditions[0].operator, n.name).toEqual({ type: 'string', operation: 'equals' });
      }
      expect(n.parameters.options, `${n.name}: an unexpected value goes to a named fallback output`).toEqual({
        fallbackOutput: 'extra', renameFallbackOutput: 'Unexpected',
      });
    }
  });
  it('every IF is 2.2 and asks the happy-path question, so true is the main row', () => {
    const ifs = working.filter((x) => x.type === 'n8n-nodes-base.if');
    expect(ifs.map((n) => [n.name, n.parameters.conditions.conditions[0].leftValue])).toEqual([
      ['Settings OK?', '={{ $json.ok }}'], ['Request Valid?', '={{ $json.ok }}'], ['Context OK?', '={{ $json.ok }}'], ['Rewrite OK?', '={{ $json.ok }}'], ['Send Now?', '={{ $json.send }}'],
    ]);
    for (const n of ifs) expect(n.parameters.conditions.conditions[0].operator, n.name).toEqual({ type: 'boolean', operation: 'true', singleValue: true });
  });
});

describe('intake and ledger', () => {
  it('Check Settings checks the Load Settings row on its own: bad settings get 500 before the body is read', () => {
    expect(targets(WF, 'Load Settings')).toEqual(['Check Settings']);
    expect(targets(WF, 'Check Settings')).toEqual(['Settings OK?']);
    expect([targets(WF, 'Settings OK?', 0), targets(WF, 'Settings OK?', 1)]).toEqual([['Validate Body'], ['Respond Rejected']]);
    expect(run('Check Settings', { settings: SETTINGS }, {})).toEqual({ ok: true, settings: SETTINGS });
    const bad = run('Check Settings', { settings: { ...SETTINGS, max_sends_per_hour: 'lots', email_from: '' } }, {});
    expect(bad).toMatchObject({ ok: false, http_status: 500, response: { error: { code: 'INTERNAL' } } });
    expect(bad.response.error.message).toContain('max_sends_per_hour must be a whole number');
    expect(bad.response.error.message).toContain('email_from must be an email address');
    expect(run('Check Settings', { settings: null }, {})).toMatchObject({ ok: false, http_status: 500 });
  });
  it('Validate Body checks the request and builds the enqueue parameter (no id, no hash: the database makes both) and the 429 answer', () => {
    const out = run('Validate Body', { ok: true, settings: SETTINGS }, { 'Royalty Summary Webhook': { body: payloadFor('AUTH002') } });
    expect(out).toMatchObject({ ok: true, job: { author_code: 'AUTH002' }, rate_limited: rateLimitedResponse(SETTINGS) });
    expect(out.job).not.toHaveProperty('job_id');
    expect(JSON.parse(out.enqueue)).toMatchObject({ execution_id: '4711', fingerprint_of: { author_id: 'bubble_auth002' } });
    expect(run('Validate Body', { ok: true, settings: SETTINGS }, { 'Royalty Summary Webhook': { body: { mode: 'x' } } }))
      .toMatchObject({ ok: false, http_status: 400, response: { error: { code: 'VALIDATION' } } });
  });
  it('a valid request goes to Enqueue Job (enqueue_royalty_job); a bad one is answered by Respond Rejected', () => {
    expect(targets(WF, 'Validate Body')).toEqual(['Request Valid?']);
    expect(targets(WF, 'Request Valid?', 0)).toEqual(['Enqueue Job']);
    expect(targets(WF, 'Request Valid?', 1)).toEqual(['Respond Rejected']);
    expect(nodeOf(WF, 'Enqueue Job').parameters).toMatchObject({ query: ENQUEUE_JOB, options: { queryReplacement: '={{ $json.enqueue }}' } });
  });
  it('Outcome names its outputs after the enqueue outcome: Queued, Duplicate, Rate limited', () => {
    expect(nodeOf(WF, 'Outcome').parameters.rules.values[0].conditions.conditions[0].leftValue).toBe('={{ $json.outcome }}');
    expect(ruleOutputs('Outcome')).toEqual([['Queued', 'queued'], ['Duplicate', 'duplicate'], ['Rate limited', 'rate_limited']]);
    expect([0, 1, 2, 3].map((i) => targets(WF, 'Outcome', i))).toEqual([['Respond 202'], ['Respond Duplicate'], ['Respond 429'], ['Respond 500']]);
    expect(targets(WF, 'Respond 202')).toEqual(['Mark Processing']);
    for (const r of ['Respond Duplicate', 'Respond 429', 'Respond Rejected', 'Respond 500']) expect(targets(WF, r), r).toEqual([]);
  });
  it('answers Bubble exactly as before: 202 {job_id, status, duplicate}, 200 duplicate (+error_code), 429 RATE_LIMITED', () => {
    const answer = (name, $json) => {
      const p = nodeOf(WF, name).parameters;
      const g = { $json, $: nodes({ 'Validate Body': { rate_limited: rateLimitedResponse(SETTINGS) } }) };
      return { status: evaluate(p.options.responseCode, g), body: evaluate(p.responseBody, g) };
    };
    const queued = { outcome: 'queued', job_id: ID, status: 'QUEUED', error_code: null };
    expect(answer('Respond 202', queued)).toEqual({ status: 202, body: { job_id: ID, status: 'QUEUED', duplicate: false } });
    expect(answer('Respond Duplicate', { ...queued, outcome: 'duplicate', status: 'SENT' }))
      .toEqual({ status: 200, body: { job_id: ID, status: 'SENT', duplicate: true } });
    expect(answer('Respond Duplicate', { ...queued, outcome: 'duplicate', status: 'FAILED', error_code: 'AI_UNAVAILABLE' }))
      .toEqual({ status: 200, body: { job_id: ID, status: 'FAILED', duplicate: true, error_code: 'AI_UNAVAILABLE' } });
    expect(answer('Respond 429', { outcome: 'rate_limited', job_id: null }))
      .toEqual({ status: 429, body: rateLimitedResponse(SETTINGS) });
    expect(answer('Respond 500', { outcome: 'something else' })).toEqual({
      status: 500, body: { error: { code: 'INTERNAL', message: expect.stringContaining('unexpected answer'), retryable: true } },
    });
  });
});

describe('the job after the ledger', () => {
  it('Build Context runs the job under the id Enqueue Job made, and passes the job on', () => {
    const validated = { ...job };
    delete validated.job_id;
    const out = run('Build Context', {}, { 'Validate Body': { job: validated }, 'Enqueue Job': { job_id: ID } });
    expect(out).toMatchObject({ ok: true, job: { job_id: ID, author_code: 'AUTH002' }, ctx: { titles: expect.any(Array) } });
  });
});

describe('AI writer, fact check and rewrite (the Write Draft sub-workflow, called twice)', () => {
  it('Write Draft writes and checks the first draft: the context\'s requests, attempt 1, no earlier usage', () => {
    expect(targets(WF, 'Mark Processing')).toEqual(['Build Context']);
    expect(targets(WF, 'Context OK?', 0)).toEqual(['Write Draft']);
    expect(nodeOf(WF, 'Write Draft').parameters.workflowId.cachedResultName).toBe(WRITE_DRAFT.name);
    expect(callInputs('Write Draft', { 'Build Context': { job, ctx } })).toEqual({ job, ctx, request: ctx.requests, attempt: 1, previous: {} });
    expect(targets(WF, 'Write Draft')).toEqual(['Draft OK?']);
  });
  it('Draft OK? names its outputs Pass, Rewrite and Fail after the fact check; anything else stops the run', () => {
    expect(ruleOutputs('Draft OK?')).toEqual([['Pass', AI_OUTCOMES.PASS], ['Rewrite', AI_OUTCOMES.REWRITE], ['Fail', AI_OUTCOMES.FAIL]]);
    expect([0, 1, 2, 3].map((i) => targets(WF, 'Draft OK?', i))).toEqual([['Render Email'], ['Stage: Rewriting'], ['Record Result'], ['Stop: Unexpected']]);
    expect(nodeOf(WF, 'Stop: Unexpected')).toMatchObject({ parameters: { errorType: 'errorMessage', errorMessage: expect.stringContaining('unexpected') } });
  });
  it('Rewrite Draft runs the same sub-workflow with the checker\'s rewrite requests, attempt 2 and the first draft\'s usage', () => {
    expect(targets(WF, 'Stage: Rewriting')).toEqual(['Rewrite Draft']);
    const first = { outcome: AI_OUTCOMES.REWRITE, rewrite: { anthropic: { a: 1 }, openai: { o: 1 } }, ai: { provider: 'anthropic', attempts: 1 } };
    expect(callInputs('Rewrite Draft', { 'Build Context': { job, ctx }, 'Write Draft': first }))
      .toEqual({ job, ctx, request: first.rewrite, attempt: 2, previous: first.ai });
    expect([targets(WF, 'Rewrite OK?', 0), targets(WF, 'Rewrite OK?', 1)]).toEqual([['Render Email'], ['Record Result']]);
  });
  it('no AI node, fact check or provider fallback is left in this workflow: they live once in Write Draft', () => {
    expect(working.filter((n) => /Anthropic|OpenAI|Check Draft|Check Rewrite|AI Failed/.test(n.name))).toEqual([]);
    expect(JSON.stringify(built[WF])).not.toContain('isExecuted');
  });
});

describe('render, deliver and record', () => {
  it('Send Now? sends through Deliver Email; drafts and every failure end in Record Result', () => {
    expect([targets(WF, 'Send Now?', 0), targets(WF, 'Send Now?', 1)]).toEqual([['Deliver Email'], ['Record Result']]);
    const feeds = Object.entries(built[WF].connections)
      .flatMap(([from, c]) => c.main.flatMap((t, i) => t.filter((x) => x.node === 'Record Result').map(() => `${from}#${i}`)));
    expect(feeds.sort()).toEqual(['Context OK?#1', 'Draft OK?#2', 'Rewrite OK?#1', 'Send Now?#1']);
    expect(nodeOf(WF, 'Record Result').parameters).toMatchObject({ query: UPDATE_JOB, options: { queryReplacement: '={{ JSON.stringify($json.update) }}' } });
    expect(targets(WF, 'Record Result')).toEqual([]);
  });
  it('reads left to right: the happy path on one row, every other branch below it', () => {
    const y = (name) => nodeOf(WF, name).position[1];
    const happy = ['Royalty Summary Webhook', 'Load Settings', 'Check Settings', 'Settings OK?', 'Validate Body', 'Request Valid?', 'Enqueue Job', 'Outcome', 'Respond 202',
      'Mark Processing', 'Build Context', 'Context OK?', 'Write Draft', 'Draft OK?', 'Render Email', 'Send Now?', 'Deliver Email'];
    expect(happy.map(y)).toEqual(happy.map(() => 0));
    const x = happy.map((name) => nodeOf(WF, name).position[0]);
    expect(x).toEqual([...x].sort((a, b) => a - b));
    for (const n of working.filter((w) => !happy.includes(w.name))) expect(y(n.name), n.name).toBeGreaterThan(0);
    const about = nodeOf(WF, 'About');
    expect(about.position[1] + about.parameters.height, 'the About note ends above the nodes').toBeLessThan(0);
  });
  it('explains the non-obvious nodes with a note on the canvas', () => {
    for (const name of ['Enqueue Job', 'Write Draft', 'Rewrite Draft', 'Stop: Unexpected', 'Send Now?', 'Record Result', 'Deliver Email']) {
      expect(nodeOf(WF, name), name).toMatchObject({ notesInFlow: true, notes: expect.stringMatching(/\w/) });
    }
  });
});
