import { canonicalJson } from './canonical.js';
import { readConfig, resolveReferenceDate } from './config.js';
import { effectiveDrills } from './drills.js';
import { failure } from './errors.js';
import { idempotencyKey, uuidV4 } from './ids.js';
import { recipientFor } from './recipient.js';
import { validateRequest } from './request.js';

/**
 * @typedef {Object} Job
 * @property {string} job_id @property {string} idem_key @property {string} author_id
 * @property {string|null} author_code @property {string|null} log_id @property {string|null} batch_id
 * @property {'single'|'bulk'} mode @property {string} requested_by @property {string} reference_date
 * @property {string} recipient @property {number} attempt
 * @property {{ai_down:boolean, email_down:boolean, data_down:boolean}} drills
 * @property {import('../types.js').AuthorBundle|null} bundle
 * @property {import('./config.js').Config} config
 */

/** Fields that decide what the email says and where it goes. */
const fingerprintOf = (req, referenceDate, recipient) => canonicalJson({
  author_id: req.author_id, reference_date: referenceDate, recipient, attempt: req.attempt, drills: req.drills, bundle: req.bundle,
});

/**
 * First step of the royalty-summary webhook: settings, validation, drills, recipient, ids.
 * @param {unknown} body webhook body @param {Record<string,string|undefined>} env @param {number} nowMs
 * @param {() => number[]} [random] for tests
 * @returns {{ok:true, job:Job}|import('./errors.js').Failure}
 */
export function prepareJob(body, env, nowMs, random) {
  const cfg = readConfig(env);
  if (!cfg.ok) return cfg;
  const { config } = cfg;
  const req = validateRequest(body, { dataSource: config.dataSource });
  if (!req.ok) return failure('VALIDATION', `${req.errors.length} field(s) need attention.`, req.errors);
  const r = req.value;
  const drills = effectiveDrills(r.drills, config);
  if (!drills.ok) return drills;
  const to = recipientFor(r, config, r.bundle?.author.email ?? null);
  if (!to.ok) return to;
  const referenceDate = r.reference_date ?? resolveReferenceDate(config.referenceDateDefault, nowMs);
  const job = {
    job_id: uuidV4(random),
    idem_key: idempotencyKey(r.author_id, fingerprintOf(r, referenceDate, to.recipient), nowMs),
    author_id: r.author_id, author_code: r.bundle?.author.code ?? null, log_id: r.log_id, batch_id: r.batch_id,
    mode: r.mode, requested_by: r.requested_by, reference_date: referenceDate, recipient: to.recipient,
    attempt: r.attempt, drills: drills.drills, bundle: r.bundle, config,
  };
  return { ok: true, job };
}

/** @param {Job} job @returns {string} the single JSON parameter of the insert query */
export function insertParams(job) {
  return JSON.stringify({
    job_id: job.job_id, idem_key: job.idem_key, log_id: job.log_id, batch_id: job.batch_id, author_id: job.author_id,
    author_code: job.author_code, mode: job.mode, requested_by: job.requested_by,
    max_sends: job.config.maxSendsPerHour, callback_status: job.config.callbackMode === 'push' ? 'PENDING' : 'NOT_NEEDED',
  });
}
