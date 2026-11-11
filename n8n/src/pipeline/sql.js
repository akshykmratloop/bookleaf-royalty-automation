import { ERROR_CODES } from './errors.js';
import { MAX_SUMMARY_LENGTH } from './node-errors.js';

/**
 * Every query takes ONE parameter: a JSON object ($1::jsonb). n8n's Postgres node binds a single
 * expression as a single value, so text with commas (HTML, error messages) never splits.
 */
const P = '$1::jsonb';
/** @param {string} text @returns {string} a SQL string literal */
const literal = (text) => `'${text.replaceAll("'", "''")}'`;
/** Only a job that is still running may end here: a finished one (SENT, FAILED, DRAFTED, DISCARDED) keeps its verdict. */
const RUNNING_JOB = `WHERE job_id = (${P}->>'job_id')::uuid AND status IN ('QUEUED', 'PROCESSING')`;

/** The "Load Settings" nodes: every bookleaf_settings row as one JSON object (checked by settings.readSettings). */
export const LOAD_SETTINGS = 'SELECT jsonb_object_agg(key, value) AS settings FROM bookleaf_settings';

/**
 * Enqueue Job: one call of enqueue_royalty_job (migration 03). Under one advisory lock it answers, in
 * order, `duplicate` (the same author and fingerprint within duplicate_window_minutes: the earlier job),
 * `rate_limited` (max_sends_per_hour reached) or `queued` (the new job, QUEUED at stage queued, with
 * this execution's id). Two simultaneous clicks can never both insert.
 */
export const ENQUEUE_JOB = `SELECT outcome, job_id, status, error_code FROM enqueue_royalty_job(${P})`;

/** Right after the 202: the job runs. Reading the data takes milliseconds, so the first stage shown is writing. */
export const MARK_PROCESSING = `UPDATE royalty_jobs SET status = 'PROCESSING', stage = 'writing', stage_at = now(), updated_at = now()
WHERE job_id = (${P}->>'job_id')::uuid AND status = 'QUEUED'
RETURNING job_id::text AS job_id, status`;

/** Live progress (Stage: Rewriting). Never moves a finished job. */
export const SET_STAGE = `UPDATE royalty_jobs SET stage = ${P}->>'stage', stage_at = now(), updated_at = now()
WHERE job_id = (${P}->>'job_id')::uuid AND status IN ('QUEUED', 'PROCESSING')
RETURNING job_id::text AS job_id, stage`;

/**
 * Terminal (or partial) update. Absent fields keep their value; a finished job (SENT, FAILED,
 * DRAFTED, DISCARDED) is never overwritten. The final stage follows the status unless given.
 */
export const UPDATE_JOB = `UPDATE royalty_jobs AS j SET
  status = COALESCE(p.status, j.status),
  stage = COALESCE(p.stage, CASE p.status WHEN 'SENT' THEN 'sent' WHEN 'FAILED' THEN 'failed' WHEN 'DRAFTED' THEN 'drafted' END, j.stage),
  stage_at = CASE WHEN p.stage IS NOT NULL OR p.status IS NOT NULL THEN now() ELSE j.stage_at END,
  error_code = COALESCE(p.error_code, j.error_code),
  error = COALESCE(p.error, j.error),
  author_code = COALESCE(p.author_code, j.author_code),
  subject = COALESCE(p.subject, j.subject),
  html = COALESCE(p.html, j.html),
  text_body = COALESCE(p.text_body, j.text_body),
  sent_to = COALESCE(p.sent_to, j.sent_to),
  figures_verified = COALESCE(p.figures_verified, j.figures_verified),
  ai_attempts = COALESCE(p.ai_attempts, j.ai_attempts),
  provider = COALESCE(p.provider, j.provider),
  model = COALESCE(p.model, j.model),
  input_tokens = COALESCE(p.input_tokens, j.input_tokens),
  output_tokens = COALESCE(p.output_tokens, j.output_tokens),
  cost_usd = COALESCE(p.cost_usd, j.cost_usd),
  sections = COALESCE(p.sections, j.sections),
  facts = COALESCE(p.facts, j.facts),
  titles = COALESCE(p.titles, j.titles),
  edit_text = COALESCE(p.edit_text, j.edit_text),
  issues = COALESCE(p.issues, j.issues),
  drafted_at = CASE WHEN p.status = 'DRAFTED' THEN now() ELSE j.drafted_at END,
  completed_at = CASE WHEN p.status IN ('SENT', 'FAILED') THEN now() ELSE j.completed_at END,
  updated_at = now()
FROM jsonb_to_record(${P}) AS p(
  job_id uuid, status text, stage text, error_code text, error text, author_code text, subject text, html text, text_body text,
  sent_to text, figures_verified int, ai_attempts int, provider text, model text, input_tokens int, output_tokens int,
  cost_usd numeric, sections jsonb, facts jsonb, titles jsonb, edit_text text, issues text)
WHERE j.job_id = p.job_id AND j.status IN ('QUEUED', 'PROCESSING')
RETURNING j.job_id::text AS job_id, j.status, j.stage, j.error_code`;

/**
 * Deliver Email, after the SMTP server took the email ({job_id, sent_to}). The email itself was saved
 * by Mark Sending (UPDATE_JOB at stage sending) before the send.
 */
export const MARK_SENT = `UPDATE royalty_jobs SET status = 'SENT', stage = 'sent', stage_at = now(), sent_to = ${P}->>'sent_to',
  completed_at = now(), updated_at = now()
${RUNNING_JOB}
RETURNING job_id::text AS job_id, status, stage`;

/**
 * Deliver Email, when the SMTP server refused the email or could not be reached ({job_id, error}:
 * the Send Email node's message). The error reads like nodeErrorSummary's: the standard message, then
 * "smtp: " and the server's own text on one line, at most MAX_SUMMARY_LENGTH characters. The saved
 * email stays for the log; sent_to stays empty.
 */
export const MARK_EMAIL_FAILED = `UPDATE royalty_jobs SET status = 'FAILED', stage = 'failed', stage_at = now(), error_code = 'EMAIL_FAILED',
  error = ${literal(`${ERROR_CODES.EMAIL_FAILED.message} `)} || left('smtp: ' ||
    coalesce(nullif(btrim(regexp_replace(${P}->>'error', '\\s+', ' ', 'g')), ''), 'unknown error'), ${MAX_SUMMARY_LENGTH}),
  completed_at = now(), updated_at = now()
${RUNNING_JOB}
RETURNING job_id::text AS job_id, status, stage, error_code`;

export const SELECT_JOBS = `SELECT job_id::text AS job_id, log_id, batch_id, author_id, author_code, mode, status, error_code, error,
  subject, sent_to, figures_verified, ai_attempts, provider, model, input_tokens, output_tokens, cost_usd::float8 AS cost_usd,
  requested_by, created_at, updated_at, completed_at, callback_status,
  stage, stage_at, delivery, tone, length, issues, edit_text, drafted_at,
  CASE WHEN (${P}->>'include_html')::boolean THEN html END AS html,
  CASE WHEN (${P}->>'include_html')::boolean THEN text_body END AS text_body
FROM royalty_jobs
WHERE job_id = ANY (ARRAY(SELECT jsonb_array_elements_text(${P}->'ids'))::uuid[])`;

