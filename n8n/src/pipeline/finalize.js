import { renderEmail } from '../render-email.js';
import { signatureFor } from '../signature.js';
import { formatIssues, toEditText } from './edit.js';
import { MAX_ERROR_LENGTH } from './errors.js';

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
 * @returns {{email:{from:string, to:string, subject:string, html:string, text:string}, update:JobUpdate}}
 */
export function renderForSend({ ctx, job, ai }) {
  const r = renderFor({ ctx, job, ai });
  const email = { from: senderFor(job.settings), to: job.recipient, subject: r.subject, html: r.html, text: r.text };
  const update = {
    job_id: job.job_id, author_code: ctx.bundle.author.code, subject: r.subject, html: r.html, text_body: r.text,
    sent_to: job.recipient, ...aiColumns(ai),
  };
  return { email, update };
}

/** @param {import('./settings.js').Settings} settings @returns {string} the From line: sender_name <email_from> */
export const senderFor = (settings) => `${settings.sender_name} <${settings.email_from}>`;

/** @param {import('./settings.js').Settings} settings @returns {{name:string, supportEmail:string}} header and footer */
export const brandOf = (settings) => ({ name: settings.brand_name, supportEmail: settings.support_email });

/** The email as the author would get it: AI prose, figures from facts, signature from the job's tone and sign-off. */
function renderFor({ ctx, job, ai }) {
  const signature = signatureFor(job.tone, job.sign_off, job.settings.sender_name);
  return renderEmail({ sections: ai.sections, facts: ctx.facts, bundle: ctx.bundle, brand: brandOf(job.settings), signature });
}

/**
 * delivery=draft: everything an admin needs to review, edit and approve later; nothing is sent.
 * @param {{ctx:import('./context.js').Context, job:import('./prepare.js').Job, ai:Object}} input
 * @returns {JobUpdate}
 */
export function draftUpdate({ ctx, job, ai }) {
  const r = renderFor({ ctx, job, ai });
  return {
    job_id: job.job_id, status: 'DRAFTED', stage: 'drafted', author_code: ctx.bundle.author.code,
    subject: r.subject, html: r.html, text_body: r.text, ...aiColumns(ai),
    sections: ai.sections, facts: ctx.facts, titles: ctx.titles, edit_text: toEditText(ai.sections, ctx.facts),
    issues: formatIssues(ai.warnings) || null,
  };
}

/** @param {JobUpdate} update from renderForSend @returns {JobUpdate} */
export const sentUpdate = (update) => ({ ...update, status: 'SENT' });

/**
 * @param {import('./prepare.js').Job} job @param {import('./errors.js').Failure} f
 * @param {Object} [extra] e.g. aiColumns(ai) or the rendered subject/html, kept for the log
 * @returns {JobUpdate}
 */
export function failedUpdate(job, f, extra = {}) {
  return {
    ...extra, job_id: job.job_id, status: 'FAILED', error_code: f.code,
    error: String(f.message).slice(0, MAX_ERROR_LENGTH),
  };
}
