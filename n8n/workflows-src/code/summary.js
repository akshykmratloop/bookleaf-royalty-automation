/**
 * Entry points for the royalty-summary workflow's Code nodes. Each takes plain data (the node body
 * passes $json and earlier nodes' output) and returns n8n items. All logic lives in n8n/src.
 * The IF nodes after them read a boolean (`ok`, `send`); "Draft OK?" reads `outcome`.
 */
import { afterAi, AI_OUTCOMES, aiUnavailable } from '../../src/pipeline/after-ai.js';
import { buildContext } from '../../src/pipeline/context.js';
import { errorBody } from '../../src/pipeline/errors.js';
import { aiColumns, deliveryFor, draftUpdate, failedUpdate } from '../../src/pipeline/finalize.js';
import { enqueueParams, prepareJob, rateLimitedResponse } from '../../src/pipeline/prepare.js';

const item = (json) => [{ json }];

/**
 * Validate Body: the webhook body (the webhook already checked the key) against the settings Check
 * Settings passed on. ok: `enqueue` is Enqueue Job's parameter and `rate_limited` the 429 body; not
 * ok: the 4xx answer.
 */
export function prepare({ body, settings, now, executionId }) {
  const r = prepareJob(body, settings, now);
  if (!r.ok) return item({ ok: false, http_status: r.http_status, response: errorBody(r) });
  return item({ ok: true, job: r.job, enqueue: enqueueParams(r.job, executionId), rate_limited: rateLimitedResponse(r.job.settings) });
}

/**
 * Data + integrity + facts + prompt, for the job under the id Enqueue Job made (`jobId`). `job` is passed
 * on for every later node. ok: call the AI; not ok: `update` fails the job.
 */
export function context({ validated, jobId }) {
  const job = { ...validated, job_id: jobId };
  const r = buildContext(job);
  return r.ok ? item({ ok: true, job, ctx: r.ctx }) : item({ ok: false, job, update: failedUpdate(job, r) });
}

/**
 * Neither provider answered, for the first draft or for the rewrite (`previous`: the first draft's AI
 * usage, recorded with the failure).
 */
export function aiFailed({ job, rewriting, anthropicError, openaiError, previous }) {
  return item({ update: failedUpdate(job, aiUnavailable({ rewriting, anthropicError, openaiError }), aiColumns(previous)) });
}

/**
 * Fact-check a draft (attempt 1: Check Draft) or its rewrite (attempt 2: Check Rewrite). outcome PASS
 * (ok), REWRITE (`rewrite` holds both providers' bodies) or FAIL (`update` fails the job).
 */
export function checkDraft({ response, ctx, job, attempt, previous }) {
  const r = afterAi({ response, ctx, job, attempt, previous });
  const out = { outcome: r.outcome, ok: r.outcome === AI_OUTCOMES.PASS, ai: r.ai, issues: r.issues };
  if (r.outcome === AI_OUTCOMES.FAIL) return item({ ...out, update: failedUpdate(job, r.failure, aiColumns(r.ai)) });
  if (r.outcome === AI_OUTCOMES.REWRITE) return item({ ...out, rewrite: r.rewrite });
  return item(out);
}

/**
 * send: `deliver` holds the Deliver Email sub-workflow's inputs (it saves, sends and records);
 * not send (delivery=draft): `update` saves the checked, rendered draft for an admin to approve.
 */
export function render({ ctx, job, ai }) {
  if (job.delivery === 'draft') return item({ send: false, update: draftUpdate({ ctx, job, ai }) });
  return item({ send: true, deliver: deliveryFor({ ctx, job, ai }) });
}
