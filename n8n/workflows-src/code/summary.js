/**
 * Entry points for the royalty-summary workflow's Code nodes. Each takes plain data (the node body
 * passes $json and earlier nodes' output) and returns n8n items. All logic lives in n8n/src.
 */
import { afterAi, AI_ROUTES } from '../../src/pipeline/after-ai.js';
import { classifyInsert } from '../../src/pipeline/classify.js';
import { buildContext } from '../../src/pipeline/context.js';
import { errorBody, failure } from '../../src/pipeline/errors.js';
import { aiColumns, deliveryFor, draftUpdate, failedUpdate } from '../../src/pipeline/finalize.js';
import { nodeErrorSummary } from '../../src/pipeline/node-errors.js';
import { insertParams, prepareJob } from '../../src/pipeline/prepare.js';

const item = (json) => [{ json }];
const failItem = (job, f, extra) => item({ route: 0, update: failedUpdate(job, f, extra) });

const rejected = (f) => item({ route: 0, http_status: f.http_status, response: errorBody(f) });

/**
 * Check the settings (Load Settings) and the webhook body (the webhook already checked the key).
 * route 0 = reject (respond 4xx/500), 1 = insert the job.
 */
export function prepare({ body, settings, now }) {
  const r = prepareJob(body, settings, now);
  if (!r.ok) return rejected(r);
  return item({ route: 1, job: r.job, insert_params: insertParams(r.job) });
}

/** Insert result → webhook answer. route 0 = queued (continue), 1 = duplicate, 2 = rate limited. */
export const classify = ({ row, job }) => item(classifyInsert(row, job.settings));

/** Data + integrity + facts + prompt. route 0 = fail the job, 1 = call the AI. */
export function context({ job }) {
  const r = buildContext(job);
  return r.ok ? item({ route: 1, ctx: r.ctx }) : failItem(job, r);
}

export function aiFailed({ job, anthropicError, openaiError }) {
  const detail = `${nodeErrorSummary(anthropicError, 'anthropic')} | ${nodeErrorSummary(openaiError, 'openai')}`;
  return failItem(job, failure('AI_UNAVAILABLE', detail));
}

/**
 * Fact-check a draft. Attempt 1 routes: 0 send, 1 regenerate (Anthropic), 2 regenerate (OpenAI), 3 fail.
 * Attempt 2 routes: 0 send, 1 fail.
 */
export function checkDraft({ response, ctx, job, attempt, previous }) {
  const r = afterAi({ response, ctx, job, attempt, previous });
  const out = { outcome: r.outcome, ai: r.ai, issues: r.issues };
  if (r.route === AI_ROUTES.FAIL) {
    const update = failedUpdate(job, r.failure, aiColumns(r.ai));
    return item({ ...out, route: attempt === 1 ? AI_ROUTES.FAIL : 1, update });
  }
  if (r.route === AI_ROUTES.PASS) return item({ ...out, route: 0 });
  return item({ ...out, route: r.route, regenerate: r.regenerate });
}

export function regenerationFailed({ job, error, previous }) {
  return failItem(job, failure('AI_UNAVAILABLE', `Regeneration failed. ${nodeErrorSummary(error, previous?.provider ?? 'ai')}`), aiColumns(previous));
}

/**
 * route 0 = send: `deliver` holds the Deliver Email sub-workflow's inputs (it saves, sends and records);
 * 1 = delivery=draft: save the checked, rendered draft for an admin to approve; nothing is sent.
 */
export function render({ ctx, job, ai }) {
  if (job.delivery === 'draft') return item({ route: 1, update: draftUpdate({ ctx, job, ai }) });
  return item({ route: 0, deliver: deliveryFor({ ctx, job, ai }) });
}
