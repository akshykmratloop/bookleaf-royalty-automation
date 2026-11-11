/**
 * Every query takes ONE parameter: a JSON object ($1::jsonb). n8n's Postgres node binds a single
 * expression as a single value, so text with commas (HTML, error messages) never splits.
 */
const P = '$1::jsonb';

export const INSERT_JOB = `WITH p AS (SELECT ${P} AS v),
recent AS (
  SELECT count(*)::int AS n FROM royalty_jobs
  WHERE created_at > now() - interval '1 hour' AND status NOT IN ('FAILED', 'DISCARDED')
),
up AS (
  INSERT INTO royalty_jobs (job_id, idem_key, log_id, batch_id, author_id, author_code, mode, status, requested_by, callback_status,
    stage, stage_at, delivery, tone, length, note, sign_off, recipient, drills)
  SELECT (v->>'job_id')::uuid, v->>'idem_key', v->>'log_id', v->>'batch_id', v->>'author_id', v->>'author_code',
         v->>'mode', 'QUEUED', v->>'requested_by', v->>'callback_status',
         'queued', now(), v->>'delivery', v->>'tone', v->>'length', v->>'note', v->>'sign_off', v->>'recipient', v->'drills'
  FROM p
  WHERE (SELECT n FROM recent) < (v->>'max_sends')::int
     OR EXISTS (SELECT 1 FROM royalty_jobs r WHERE r.idem_key = v->>'idem_key')
  ON CONFLICT (idem_key) DO UPDATE SET idem_key = EXCLUDED.idem_key
  RETURNING job_id, status, error_code, (xmax = 0) AS inserted
)
SELECT job_id::text AS job_id, status, error_code, inserted, (SELECT n FROM recent) AS recent_sends FROM up
UNION ALL
SELECT NULL, NULL, NULL, false, (SELECT n FROM recent) WHERE NOT EXISTS (SELECT 1 FROM up)`;

export const MARK_PROCESSING = `UPDATE royalty_jobs SET status = 'PROCESSING', stage = 'reading_data', stage_at = now(), updated_at = now()
WHERE job_id = (${P}->>'job_id')::uuid AND status = 'QUEUED'
RETURNING job_id::text AS job_id, status`;

/** Live progress (writing, checking, rewriting, sending). Never moves a finished job. */
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
  callback_status = COALESCE(p.callback_status, j.callback_status),
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
  cost_usd numeric, callback_status text, sections jsonb, facts jsonb, titles jsonb, edit_text text, issues text)
WHERE j.job_id = p.job_id AND j.status IN ('QUEUED', 'PROCESSING')
RETURNING j.job_id::text AS job_id, j.log_id, j.batch_id, j.author_id, j.status, j.stage, j.error_code, j.error, j.subject, j.html,
  j.figures_verified, j.model, j.cost_usd::float8 AS cost_usd, j.completed_at, j.callback_status`;

export const UPDATE_CALLBACK = `UPDATE royalty_jobs SET callback_status = ${P}->>'callback_status', updated_at = now()
WHERE job_id = (${P}->>'job_id')::uuid
RETURNING job_id::text AS job_id, callback_status`;

export const SELECT_JOBS = `SELECT job_id::text AS job_id, log_id, batch_id, author_id, author_code, mode, status, error_code, error,
  subject, sent_to, figures_verified, ai_attempts, provider, model, input_tokens, output_tokens, cost_usd::float8 AS cost_usd,
  requested_by, created_at, updated_at, completed_at, callback_status,
  stage, stage_at, delivery, tone, length, issues, edit_text, drafted_at,
  CASE WHEN (${P}->>'include_html')::boolean THEN html END AS html,
  CASE WHEN (${P}->>'include_html')::boolean THEN text_body END AS text_body
FROM royalty_jobs
WHERE job_id = ANY (ARRAY(SELECT jsonb_array_elements_text(${P}->'ids'))::uuid[])`;

/**
 * A job still QUEUED/PROCESSING 10 minutes after it started becomes FAILED (TIMEOUT). An approved
 * draft starts when it is claimed (stage_at), not when the draft was made. DRAFTED and DISCARDED
 * jobs are never touched.
 */
export const SWEEP_STUCK = `UPDATE royalty_jobs
SET status = 'FAILED', stage = 'failed', stage_at = now(), error_code = 'TIMEOUT',
    error = 'The job did not finish within 10 minutes, so it was stopped. Send it again if needed.',
    completed_at = now(), updated_at = now()
WHERE status IN ('QUEUED', 'PROCESSING')
  AND (CASE WHEN drafted_at IS NULL THEN created_at ELSE stage_at END) < now() - interval '10 minutes'
RETURNING job_id::text AS job_id, log_id, author_id`;
