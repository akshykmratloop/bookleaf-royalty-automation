import { resolveReferenceDate } from '../dates.js';
import { effectiveDrills } from './drills.js';
import { errorBody, failure } from './errors.js';
import { recipientFor } from './recipient.js';
import { validateRequest } from './request.js';

/**
 * A validated request, ready for enqueue_royalty_job. It has no id yet: the function makes the job id
 * and the fingerprint (a SHA-256 of `fingerprint_of`), so neither is computed in a Code node.
 * @typedef {Object} Job
 * @property {string} [job_id] set once Enqueue Job has made it (Build Context adds it)
 * @property {string} author_id
 * @property {string} author_code @property {string|null} log_id @property {string|null} batch_id
 * @property {'single'|'bulk'} mode @property {string} requested_by @property {string} reference_date
 * @property {string} recipient @property {number} attempt
 * @property {{ai_down:boolean, email_down:boolean, data_down:boolean, primary_down:boolean, crash:boolean}} drills
 * @property {'send'|'draft'} delivery @property {'warm'|'formal'|'concise'} tone
 * @property {'short'|'standard'|'detailed'} length @property {string} note @property {string} sign_off
 * @property {import('../types.js').AuthorBundle} bundle
 * @property {import('./settings.js').Settings} settings the validated server settings this job runs with
 */

/** @param {Object} r @returns {import('./style.js').Style} */
const styleOf = (r) => ({ delivery: r.delivery, tone: r.tone, length: r.length, note: r.note, sign_off: r.sign_off });

/**
 * Everything that decides what the email says and where it goes. enqueue_royalty_job hashes it and
 * treats the same author and hash within duplicate_window_minutes as a double click.
 * @param {Job} job
 */
const fingerprintOf = (job) => ({
  author_id: job.author_id, reference_date: job.reference_date, recipient: job.recipient, attempt: job.attempt, drills: job.drills,
  bundle: job.bundle, ...styleOf(job),
});

/**
 * Validate Body: the request, drills and recipient, against settings Check Settings already validated.
 * @param {unknown} body webhook body @param {import('./settings.js').Settings} settings @param {number} nowMs
 * @returns {{ok:true, job:Job}|import('./errors.js').Failure}
 */
export function prepareJob(body, settings, nowMs) {
  const req = validateRequest(body);
  if (!req.ok) return failure('VALIDATION', `${req.errors.length} field(s) need attention.`, req.errors);
  const r = req.value;
  const drills = effectiveDrills(r.drills, settings);
  if (!drills.ok) return drills;
  const to = recipientFor(r, settings, r.bundle.author.email);
  if (!to.ok) return to;
  const job = {
    author_id: r.author_id, author_code: r.bundle.author.code, log_id: r.log_id, batch_id: r.batch_id,
    mode: r.mode, requested_by: r.requested_by, reference_date: r.reference_date ?? resolveReferenceDate(settings.reference_date_default, nowMs),
    recipient: to.recipient, attempt: r.attempt, drills: drills.drills, ...styleOf(r), bundle: r.bundle, settings,
  };
  return { ok: true, job };
}

/**
 * The one JSON parameter of enqueue_royalty_job (Enqueue Job). The function refuses a job without the
 * id of the n8n execution that runs it, so this refuses one first.
 * @param {Job} job @param {string} executionId `$execution.id` @returns {string}
 */
export function enqueueParams(job, executionId) {
  if (typeof executionId !== 'string' || executionId === '') throw new TypeError('enqueueParams: executionId is required');
  return JSON.stringify({
    execution_id: executionId, fingerprint_of: fingerprintOf(job), log_id: job.log_id, batch_id: job.batch_id,
    author_id: job.author_id, author_code: job.author_code, mode: job.mode, requested_by: job.requested_by,
    recipient: job.recipient, drills: job.drills, ...styleOf(job),
  });
}

/** @param {import('./settings.js').Settings} settings @returns {Object} the 429 body, answered when the enqueue says rate_limited */
export const rateLimitedResponse = (settings) => errorBody(failure('RATE_LIMITED', `The limit is ${settings.max_sends_per_hour} per hour; try again later.`));
