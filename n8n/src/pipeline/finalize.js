import { renderEmail } from '../render-email.js';
import { MAX_ERROR_LENGTH } from './errors.js';

export const SENDER_NAME = 'BookLeaf Author Relations';

/**
 * @typedef {Object} JobUpdate fields for sql.UPDATE_JOB (absent fields keep their value)
 * @property {string} job_id @property {'SENT'|'FAILED'} [status] @property {string} [error_code] @property {string} [error]
 */

/** AI bookkeeping columns shared by the SENT and FAILED rows. */
export function aiColumns(ai) {
  if (!ai) return {};
  return {
    ai_attempts: ai.attempts, provider: ai.provider, model: ai.model, input_tokens: ai.input_tokens,
    output_tokens: ai.output_tokens, cost_usd: ai.cost_usd, figures_verified: ai.verified_figures,
  };
}

/**
 * Renders the email (prose from AI, every figure from data) and the row written once it is sent.
 * @param {{ctx:import('./context.js').Context, job:import('./prepare.js').Job, ai:Object}} input
 * `from` is null when EMAIL_FROM is unset: the Send Email node then uses the SMTP account address.
 * @returns {{email:{from:string|null, to:string, subject:string, html:string, text:string}, update:JobUpdate}}
 */
export function renderForSend({ ctx, job, ai }) {
  const r = renderEmail({ sections: ai.sections, facts: ctx.facts, bundle: ctx.bundle, brand: job.config.brand });
  const from = job.config.emailFrom ? `${SENDER_NAME} <${job.config.emailFrom}>` : null;
  const email = { from, to: job.recipient, subject: r.subject, html: r.html, text: r.text };
  const update = {
    job_id: job.job_id, author_code: ctx.bundle.author.code, subject: r.subject, html: r.html, text_body: r.text,
    sent_to: job.recipient, ...aiColumns(ai),
  };
  return { email, update };
}

const callbackStatus = (job) => (job.config.callbackMode === 'push' ? 'PENDING' : 'NOT_NEEDED');

/** @param {import('./prepare.js').Job} job @param {JobUpdate} update from renderForSend @returns {JobUpdate} */
export const sentUpdate = (job, update) => ({ ...update, status: 'SENT', callback_status: callbackStatus(job) });

/**
 * @param {import('./prepare.js').Job} job @param {import('./errors.js').Failure} f
 * @param {Object} [extra] e.g. aiColumns(ai) or the rendered subject/html, kept for the log
 * @returns {JobUpdate}
 */
export function failedUpdate(job, f, extra = {}) {
  return {
    ...extra, job_id: job.job_id, status: 'FAILED', error_code: f.code,
    error: String(f.message).slice(0, MAX_ERROR_LENGTH), callback_status: callbackStatus(job),
  };
}
