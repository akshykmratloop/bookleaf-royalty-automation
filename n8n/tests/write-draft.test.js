import { describe, expect, it } from 'vitest';
import { AI_OUTCOMES } from '../src/pipeline/after-ai.js';
import { buildContext } from '../src/pipeline/context.js';
import { TUNING } from '../src/pipeline/tuning.js';
import { WRITE_DRAFT } from '../workflows-src/write-draft.mjs';
import { anthropicOk, openaiOk, wrongSections } from './pipeline/ai-fixtures.js';
import { queuedJob } from './pipeline/job-fixture.js';
import { built, evaluate, nodeOf, ofType, runCode, targets } from './built.js';

/** "BookLeaf - Write Draft": Anthropic, OpenAI when it fails, then the fact check. Called for the draft and the rewrite. */
const WF = 'write-draft';
const job = queuedJob('AUTH002');
const ctx = buildContext(job).ctx;
const CALL = { job, ctx, request: ctx.requests, attempt: 1, previous: {} };
/** `$('Node')` with `first(branch)` per output, as n8n gives it. */
const nodes = (outputs) => (name) => ({ first: (branch = 0) => ({ json: (outputs[name] ?? [])[branch] }) });
const run = (name, $json, outputs = {}) => runCode(nodeOf(WF, name), { $json, $: nodes({ 'When Called': [CALL], ...outputs }) })[0].json;
/** The output a Switch sends this item to, decided the way n8n does: the first rule whose condition is true, else the fallback. */
function routeOf(name, $json, $runIndex) {
  const p = nodeOf(WF, name).parameters;
  const hit = p.rules.values.findIndex((r) => evaluate(r.conditions.conditions[0].leftValue, { $json, $runIndex }) === true);
  return hit >= 0 ? p.rules.values[hit].outputKey : p.options.renameFallbackOutput;
}
const full = (statusCode, body = {}, headers = {}) => ({ statusCode, body, headers });
const waitSeconds = (name, $json, $runIndex) => evaluate(nodeOf(WF, name).parameters.amount, { $json, $runIndex });

describe('Write Draft sub-workflow', () => {
  it('declares typed inputs: job, ctx, request, attempt, previous', () => {
    const [trigger] = ofType(WF, 'executeWorkflowTrigger');
    expect(built[WF].name).toBe('BookLeaf - Write Draft');
    expect(trigger.parameters.workflowInputs.values).toEqual(WRITE_DRAFT.inputs);
    expect(WRITE_DRAFT.inputs.map((i) => i.name)).toEqual(['job', 'ctx', 'request', 'attempt', 'previous']);
    expect(built[WF].settings).not.toHaveProperty('errorWorkflow');
  });
  it('has one copy of each AI node, of the answer reader and of the fact check', () => {
    expect(ofType(WF, 'httpRequest').map((n) => n.name)).toEqual(['Call Anthropic', 'Call OpenAI (fallback)']);
    expect(ofType(WF, 'code').map((n) => n.name)).toEqual(['Read Answer', 'Check Draft', 'AI Failed']);
  });
  it('Read Answer understands the providers; Check Draft only checks: neither carries the other\'s code', () => {
    const js = (name) => nodeOf(WF, name).parameters.jsCode;
    expect(js('Read Answer')).toMatch(/stop_reason/);
    expect(js('Read Answer')).not.toMatch(/function checkEmail/);
    expect(js('Check Draft')).toMatch(/function checkEmail/);
    expect(js('Check Draft')).not.toMatch(/stop_reason|output_text/);
    expect(targets(WF, 'Read Answer')).toEqual(['Check Draft']);
  });
  it('the HTTP nodes never retry on their own: they return the full answer, timeouts go to the error output', () => {
    for (const n of ofType(WF, 'httpRequest')) {
      expect(n, n.name).not.toHaveProperty('retryOnFail');
      expect(n, n.name).toMatchObject({ onError: 'continueErrorOutput' });
      expect(n.parameters.options, n.name).toEqual({
        timeout: "={{ $('When Called').first().json.job.settings.ai_timeout_ms }}",
        response: { response: { fullResponse: true, neverError: true } },
      });
    }
    expect(nodeOf(WF, 'Call Anthropic').parameters.jsonBody).toBe("={{ JSON.stringify($('When Called').first().json.request.anthropic) }}");
    expect(nodeOf(WF, 'Call OpenAI (fallback)').parameters.jsonBody).toBe("={{ JSON.stringify($('When Called').first().json.request.openai) }}");
  });
  it('both outputs of each HTTP node go to its answer Switch', () => {
    for (const [call, answer] of [['Call Anthropic', 'Anthropic Answer'], ['Call OpenAI (fallback)', 'OpenAI Answer']]) {
      expect([targets(WF, call, 0), targets(WF, call, 1)], call).toEqual([[answer], [answer]]);
    }
    expect([0, 1, 2].map((i) => targets(WF, 'Anthropic Answer', i))).toEqual([['Read Answer'], ['Wait (Anthropic)'], ['Call OpenAI (fallback)']]);
    expect([0, 1, 2].map((i) => targets(WF, 'OpenAI Answer', i))).toEqual([['Read Answer'], ['Wait (OpenAI)'], ['AI Failed']]);
    expect(targets(WF, 'Wait (Anthropic)')).toEqual(['Call Anthropic']);
    expect(targets(WF, 'Wait (OpenAI)')).toEqual(['Call OpenAI (fallback)']);
  });
  it.each(['Anthropic Answer', 'OpenAI Answer'])('%s retries only what can succeed later: 429, 5xx, a timeout', (name) => {
    expect(routeOf(name, full(200, anthropicOk()), 0)).toBe('Answer');
    for (const transient of [full(429), full(500), full(503), full(529), { error: { message: 'timeout of 45000ms exceeded' } }]) {
      expect(routeOf(name, transient, 0), JSON.stringify(transient)).toBe('Retry');
      expect(routeOf(name, transient, TUNING.aiRetries), 'no tries left').not.toBe('Retry');
    }
    for (const final of [full(400), full(401), full(403), full(404), full(422)]) expect(routeOf(name, final, 0), String(final.statusCode)).not.toMatch(/Answer|Retry/);
  });
  it('waits longer each time, honours Retry-After, and never waits more than the cap', () => {
    for (const name of ['Wait (Anthropic)', 'Wait (OpenAI)']) {
      expect(nodeOf(WF, name), name).toMatchObject({ typeVersion: 1.1, parameters: { resume: 'timeInterval', unit: 'seconds' } });
      expect(waitSeconds(name, full(500), 0)).toBe(TUNING.aiRetryBaseSeconds);
      expect(waitSeconds(name, full(500), 1)).toBe(Math.min(TUNING.aiRetryBaseSeconds * 2, TUNING.aiRetryMaxWaitSeconds));
      expect(waitSeconds(name, full(429, {}, { 'retry-after': '3' }), 0)).toBe(3);
      expect(waitSeconds(name, full(429, {}, { 'retry-after': '600' }), 0)).toBe(TUNING.aiRetryMaxWaitSeconds);
      expect(waitSeconds(name, { error: { message: 'timeout' } }, 0)).toBe(TUNING.aiRetryBaseSeconds);
    }
  });
  it('Read Answer then Check Draft fact-check whichever provider answered, for the draft and for the rewrite', () => {
    const pipeline = (call, answer) => {
      const read = runCode(nodeOf(WF, 'Read Answer'), { $json: answer, $: nodes({ 'When Called': [call] }) })[0].json;
      return runCode(nodeOf(WF, 'Check Draft'), { $json: read, $: nodes({ 'When Called': [call] }) })[0].json;
    };
    const first = pipeline(CALL, full(200, anthropicOk(wrongSections)));
    expect(first).toMatchObject({ outcome: AI_OUTCOMES.REWRITE, ok: false, rewrite: { anthropic: { messages: expect.any(Array) } } });
    const rewriteCall = { ...CALL, request: first.rewrite, attempt: 2, previous: first.ai };
    expect(pipeline(rewriteCall, full(200, openaiOk()))).toMatchObject({ outcome: AI_OUTCOMES.PASS, ok: true, ai: { provider: 'openai', attempts: 2 } });
    expect(pipeline(rewriteCall, full(200, { type: 'message', content: [], stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 1 } })))
      .toMatchObject({ outcome: AI_OUTCOMES.FAIL, update: { error_code: 'AI_UNAVAILABLE' } });
  });
  it('AI Failed names both providers\' last answers and returns the FAIL outcome the caller routes on', () => {
    const anthropic = full(404, { type: 'error', error: { type: 'not_found_error', message: 'model: bookleaf-drill-model-does-not-exist' } });
    const out = run('AI Failed', { error: { message: 'timeout of 45000ms exceeded' } }, { 'Anthropic Answer': [undefined, undefined, anthropic] });
    expect(out).toMatchObject({ outcome: AI_OUTCOMES.FAIL, ok: false, update: { job_id: job.job_id, status: 'FAILED', error_code: 'AI_UNAVAILABLE' } });
    expect(out.update.error).toContain('anthropic: 404 model: bookleaf-drill-model-does-not-exist | openai: timeout of 45000ms exceeded');
    const spent = { provider: 'anthropic', attempts: 1, input_tokens: 10, output_tokens: 5, cost_usd: 0.1 };
    const rewriteCall = { ...CALL, attempt: 2, previous: spent };
    const rewrite = runCode(nodeOf(WF, 'AI Failed'), {
      $json: full(503, { error: { message: 'down' } }), $: nodes({ 'When Called': [rewriteCall], 'Anthropic Answer': [undefined, undefined, full(500)] }),
    })[0].json;
    expect(rewrite.update.error).toContain('The rewrite failed. anthropic: 500 | openai: 503 down');
    expect(rewrite.update).toMatchObject({ ai_attempts: 1, provider: 'anthropic', cost_usd: 0.1 });
  });
});
