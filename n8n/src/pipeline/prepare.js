import { resolveReferenceDate } from '../dates.js';
import { canonicalJson } from './canonical.js';
import { effectiveDrills } from './drills.js';
import { errorBody, failure } from './errors.js';
import { uuidV4 } from './ids.js';
import { recipientFor } from './recipient.js';
import { validateRequest } from './request.js';
import { readSettings } from './settings.js';
import { sha256Hex } from './sha256.js';

/**
 * @typedef {Object} Job
 * @property {string} job_id @property {string} fingerprint SHA-256 hex of everything that shapes the email
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

/**
 * Fields that decide what the email says and where it goes. enqueue_royalty_job treats the same author
 * and fingerprint within duplicate_window_minutes as a double click.
 */
const fingerprintOf = (req, referenceDate, recipient) => sha256Hex(canonicalJson({
  author_id: req.author_id, reference_date: referenceDate, recipient, attempt: req.attempt, drills: req.drills, bundle: req.bundle,
  ...styleOf(req),
}));

/** @param {import('./request.js').EnqueueRequest} r @returns {import('./style.js').Style} */
const styleOf = (r) => ({ delivery: r.delivery, tone: r.tone, length: r.length, note: r.note, sign_off: r.sign_off });

/**
 * First step of the royalty-summary webhook: settings, validation, drills, recipient, ids.
 * @param {unknown} body webhook body @param {unknown} stored the Load Settings row's `settings` @param {number} nowMs
 * @param {() => number[]} [random] for tests
 * @returns {{ok:true, job:Job}|import('./errors.js').Failure}
 */
export function prepareJob(body, stored, nowMs, random) {
  const read = readSettings(stored);
  if (!read.ok) return read;
  const { settings } = read;
  const req = validateRequest(body);
  if (!req.ok) return failure('VALIDATION', `${req.errors.length} field(s) need attention.`, req.errors);
  const r = req.value;
  const drills = effectiveDrills(r.drills, settings);
  if (!drills.ok) return drills;
  const to = recipientFor(r, settings, r.bundle.author.email);
  if (!to.ok) return to;
  const referenceDate = r.reference_date ?? resolveReferenceDate(settings.reference_date_default, nowMs);
  const job = {
    job_id: uuidV4(random),
    fingerprint: fingerprintOf(r, referenceDate, to.recipient),
    author_id: r.author_id, author_code: r.bundle.author.code, log_id: r.log_id, batch_id: r.batch_id,
    mode: r.mode, requested_by: r.requested_by, reference_date: referenceDate, recipient: to.recipient,
    attempt: r.attempt, drills: drills.drills, ...styleOf(r), bundle: r.bundle, settings,
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
    job_id: job.job_id, execution_id: executionId, fingerprint: job.fingerprint, log_id: job.log_id, batch_id: job.batch_id,
    author_id: job.author_id, author_code: job.author_code, mode: job.mode, requested_by: job.requested_by,
    recipient: job.recipient, drills: job.drills, ...styleOf(job),
  });
}

/** @param {import('./settings.js').Settings} settings @returns {Object} the 429 body, answered when the enqueue says rate_limited */
export const rateLimitedResponse = (settings) => errorBody(failure('RATE_LIMITED', `The limit is ${settings.max_sends_per_hour} per hour; try again later.`));
