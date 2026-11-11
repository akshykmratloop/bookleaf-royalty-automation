/**
 * Entry points for the royalty-summary workflow's Code nodes. Each takes plain data (the node body
 * passes $json, $env and earlier nodes' output) and returns n8n items. All logic lives in n8n/src.
 */
import { authorQuery, booksQuery, royaltiesQuery } from '../../src/bubble-client.js';
import { afterAi, AI_ROUTES } from '../../src/pipeline/after-ai.js';
import { authFailure, isAuthorized } from '../../src/pipeline/auth.js';
import { callbackFor } from '../../src/pipeline/callback.js';
import { classifyInsert } from '../../src/pipeline/classify.js';
import { buildContext } from '../../src/pipeline/context.js';
import { errorBody, failure } from '../../src/pipeline/errors.js';
import { aiColumns, draftUpdate, failedUpdate, renderForSend, sentUpdate } from '../../src/pipeline/finalize.js';
import { nodeErrorSummary } from '../../src/pipeline/node-errors.js';
import { insertParams, prepareJob } from '../../src/pipeline/prepare.js';

const item = (json) => [{ json }];
const failItem = (job, f, extra) => item({ route: 0, update: failedUpdate(job, f, extra) });

const rejected = (f) => item({ route: 0, http_status: f.http_status, response: errorBody(f) });

/**
 * Check the key, then validate the webhook body. route 0 = reject (respond 4xx), 1 = insert the job.
 * `keyHashes` is written in at deploy time (SHA-256 of the current and next webhook keys).
 */
export function prepare({ body, headers, keyHashes, env, now }) {
  if (!isAuthorized(headers, keyHashes)) return rejected(authFailure());
  const r = prepareJob(body, env, now);
  if (!r.ok) return rejected(r);
  return item({ route: 1, job: r.job, insert_params: insertParams(r.job) });
}

/** Insert result → webhook answer. route 0 = queued (continue), 1 = duplicate, 2 = rate limited. */
export const classify = ({ row, job }) => item(classifyInsert(row, job.config));

/** Bubble Data API URLs for the author, books and royalty records (DATA_SOURCE=bubble). */
export function bubbleQueries({ job }) {
  const base = job.config.bubbleAppBase;
  return item({ author_url: authorQuery(base, job.author_id).url, books_url: booksQuery(base, job.author_id).url, royalties_url: royaltiesQuery(base, job.author_id).url });
}

/** Data + integrity + facts + prompt. route 0 = fail the job, 1 = call the AI. */
export function context({ job, bubble }) {
  const r = buildContext(job, bubble ?? null);
  return r.ok ? item({ route: 1, ctx: r.ctx }) : failItem(job, r);
}

export const dataFailed = ({ job, error }) => failItem(job, failure('DATA_UNAVAILABLE', nodeErrorSummary(error, 'bubble')));

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
 * route 0 = send (`drill` true = the email-down drill's unreachable SMTP server),
 * 1 = delivery=draft: save the checked, rendered draft for an admin to approve; nothing is sent.
 */
export function render({ ctx, job, ai }) {
  if (job.delivery === 'draft') return item({ route: 1, update: draftUpdate({ ctx, job, ai }) });
  const r = renderForSend({ ctx, job, ai });
  return item({ route: 0, drill: job.drills.email_down, email: r.email, update: r.update });
}

export const markSent = ({ job, rendered }) => item({ update: sentUpdate(job, rendered.update) });

export function emailFailed({ job, rendered, error }) {
  const { sent_to: _notSent, ...kept } = rendered.update;
  return failItem(job, failure('EMAIL_FAILED', nodeErrorSummary(error, 'smtp')), kept);
}

/** After the final update. route 1 = push the result to Bubble (CALLBACK_MODE=push). */
export function afterUpdate({ row, job }) {
  const cb = job.config.callbackMode === 'push' ? callbackFor(row, job.config) : null;
  return item(cb ? { route: 1, callback: cb, job_id: row.job_id } : { route: 0, job_id: row.job_id });
}

export function callbackResult({ jobId, error }) {
  return item({ params: JSON.stringify({ job_id: jobId, callback_status: error ? 'FAILED' : 'DONE' }), error: error ? nodeErrorSummary(error, 'bubble') : null });
}
