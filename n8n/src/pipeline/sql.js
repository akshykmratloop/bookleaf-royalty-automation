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
 * Deliver Email, before the send: the email and the caller's AI usage, at stage sending. Its column
 * list is the whole of what it can write, so a caller's record can never set the status, an error,
 * the recipient or the stage. Returns no row once the job has ended: then nothing is sent.
 */
export const MARK_SENDING = `UPDATE royalty_jobs AS j SET stage = 'sending', stage_at = now(),
  subject = p.subject, html = p.html, text_body = p.text_body,
  author_code = COALESCE(p.author_code, j.author_code), figures_verified = COALESCE(p.figures_verified, j.figures_verified),
  ai_attempts = COALESCE(p.ai_attempts, j.ai_attempts), provider = COALESCE(p.provider, j.provider), model = COALESCE(p.model, j.model),
  input_tokens = COALESCE(p.input_tokens, j.input_tokens), output_tokens = COALESCE(p.output_tokens, j.output_tokens),
  cost_usd = COALESCE(p.cost_usd, j.cost_usd), updated_at = now()
FROM jsonb_to_record(${P}) AS p(job_id uuid, subject text, html text, text_body text, author_code text, figures_verified int,
  ai_attempts int, provider text, model text, input_tokens int, output_tokens int, cost_usd numeric)
WHERE j.job_id = p.job_id AND j.status IN ('QUEUED', 'PROCESSING')
RETURNING j.job_id::text AS job_id, j.status, j.stage, j.error_code`;

/**
 * Deliver Email, after the SMTP server took the email ({job_id, sent_to}). The email itself was saved
 * by Mark Sending before the send.
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

/** A timestamp as the ISO string JavaScript's toISOString() gives (UTC, milliseconds); null stays null. */
const iso = (column) => `to_char(r.${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ${column}`;

/**
 * job-status's whole answer as one row, `response` = {jobs, missing}: the jobs in the order asked, the ids
 * not found in `missing`, html and text_body only with include_html.
 */
export const SELECT_JOBS = `WITH asked AS (
  SELECT id, ord FROM jsonb_array_elements_text(${P}->'ids') WITH ORDINALITY AS a(id, ord)
), found AS (
  SELECT a.ord, to_jsonb(j) AS job FROM asked a CROSS JOIN LATERAL (
    SELECT r.job_id::text AS job_id, r.log_id, r.batch_id, r.author_id, r.author_code, r.mode, r.status, r.error_code, r.error,
      r.subject, r.sent_to, r.figures_verified, r.ai_attempts, r.provider, r.model, r.input_tokens, r.output_tokens,
      r.cost_usd::float8 AS cost_usd, r.requested_by, ${iso('created_at')}, ${iso('updated_at')}, ${iso('completed_at')},
      r.callback_status, r.stage, ${iso('stage_at')}, r.delivery, r.tone, r.length, r.issues, r.edit_text, ${iso('drafted_at')},
      r.html, r.text_body
    FROM royalty_jobs r WHERE r.job_id = a.id::uuid) j
)
SELECT jsonb_build_object(
  'jobs', coalesce((SELECT jsonb_agg(CASE WHEN (${P}->>'include_html')::boolean THEN job ELSE job - 'html' - 'text_body' END ORDER BY ord)
    FROM found), '[]'::jsonb),
  'missing', coalesce((SELECT jsonb_agg(a.id ORDER BY a.ord) FROM asked a WHERE a.ord NOT IN (SELECT ord FROM found)), '[]'::jsonb)
) AS response`;
