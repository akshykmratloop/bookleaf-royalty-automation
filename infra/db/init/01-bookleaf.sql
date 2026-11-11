-- Runs once, on the first start of the Postgres container (docker-entrypoint-initdb.d).
-- n8n keeps its own tables in the `n8n` database; our job ledger and settings live in `bookleaf`.
-- This is the whole current schema, migrations 02 and 03 included: an existing database is upgraded
-- with infra/db/migrations/*.sql instead (n8n/tests/ledger-schema.test.js keeps the two in step).
CREATE DATABASE bookleaf;

\connect bookleaf

-- One row per royalty-summary request. The durable record of every send.
CREATE TABLE IF NOT EXISTS royalty_jobs (
  job_id            uuid PRIMARY KEY,
  -- Old de-duplication key (author + data fingerprint + 10-minute bucket), written only by the
  -- workflows from before migration 03; new jobs are de-duplicated by enqueue_royalty_job.
  idem_key          text UNIQUE,
  log_id            text,                 -- Bubble NotificationLog unique id
  batch_id          text,
  author_id         text NOT NULL,        -- Bubble Author unique id
  author_code       text,
  mode              text NOT NULL CHECK (mode IN ('single', 'bulk')),
  status            text NOT NULL CONSTRAINT royalty_jobs_status_check
                      CHECK (status IN ('QUEUED', 'PROCESSING', 'SENT', 'FAILED', 'DRAFTED', 'DISCARDED')),
  error_code        text,
  error             text,
  subject           text,
  html              text,
  text_body         text,
  sent_to           text,
  figures_verified  integer,
  ai_attempts       integer NOT NULL DEFAULT 0,
  provider          text,
  model             text,
  input_tokens      integer,
  output_tokens     integer,
  cost_usd          numeric(10, 6),
  requested_by      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  callback_status   text CHECK (callback_status IN ('NOT_NEEDED', 'PENDING', 'DONE', 'FAILED')),
  -- Live progress and drafts (same columns as infra/db/migrations/02-drafts-stages.sql).
  stage             text,                 -- queued, reading_data, writing, checking, rewriting, sending, sent, drafted, failed, discarded
  stage_at          timestamptz,
  delivery          text,                 -- send | draft
  tone              text,                 -- warm | formal | concise
  length            text,                 -- short | standard | detailed
  note              text,                 -- admin style note
  sign_off          text,                 -- signature name ('' = brand default)
  recipient         text,                 -- demo inbox chosen at enqueue
  drills            jsonb,
  sections          jsonb,                -- AI sections of a draft
  facts             jsonb,                -- verified facts the draft was checked against
  titles            jsonb,
  edit_text         text,                 -- draft prose as editable plain text
  issues            text,                 -- checker warnings, one per line
  drafted_at        timestamptz,
  -- Execution tracking and the duplicate window (same columns as infra/db/migrations/03-settings-enqueue.sql).
  execution_id      text,                 -- n8n execution running the job: the enqueue, or the approval once claimed
  fingerprint       text                  -- SHA-256 hex of everything that shapes the email (duplicate window)
);

CREATE INDEX IF NOT EXISTS royalty_jobs_status_idx ON royalty_jobs (status, updated_at);
CREATE INDEX IF NOT EXISTS royalty_jobs_log_idx ON royalty_jobs (log_id);
CREATE INDEX IF NOT EXISTS royalty_jobs_execution_idx ON royalty_jobs (execution_id) WHERE execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS royalty_jobs_fingerprint_idx ON royalty_jobs (author_id, fingerprint, created_at);
CREATE INDEX IF NOT EXISTS royalty_jobs_created_idx ON royalty_jobs (created_at);

-- One row per server setting, value as JSON. Keys, defaults and checks: n8n/src/pipeline/settings.js.
CREATE TABLE IF NOT EXISTS bookleaf_settings (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  value        jsonb NOT NULL,
  description  text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- BEGIN settings seed: generated from n8n/src/pipeline/settings.js by n8n/tools/settings-seed.mjs; do not edit by hand.
INSERT INTO bookleaf_settings (key, value, description) VALUES
  ('brand_name', '"BookLeaf Publishing"', 'Publisher name shown in the email header, subject line and footer.'),
  ('sender_name', '"BookLeaf Author Relations"', 'Name in the From line of every email and in the default signature.'),
  ('email_from', '""', 'Sender address. Required: set it for each environment to an address the SMTP account may send from.'),
  ('support_email', '""', 'Support address printed in the email footer; empty leaves the line out.'),
  ('default_demo_inbox', '""', 'Inbox for requests that name no demo_inbox; empty makes such requests fail with NO_RECIPIENT. Never an author address.'),
  ('allow_drills', 'false', 'true lets a request force failure drills (ai_down, email_down, data_down, primary_down, crash); keep false where real authors are emailed.'),
  ('reference_date_default', '"2025-12-31"', 'Date the royalty status is worked out against when a request gives none: YYYY-MM-DD, or "today" (IST).'),
  ('ai_primary', '{"model":"claude-sonnet-5-5","effort":"medium","max_tokens":8000}', 'Primary AI writer (Anthropic Messages API): model, effort (low, medium or high) and output token limit.'),
  ('ai_fallback', '{"model":"gpt-4.1-mini","max_tokens":4000}', 'Fallback AI writer (OpenAI Responses API), used when the primary fails: model and output token limit.'),
  ('ai_timeout_ms', '45000', 'Time limit for one AI request, in milliseconds.'),
  ('model_prices', '{"claude-sonnet-5-5":{"inputPerMTok":2,"outputPerMTok":10,"cacheWriteMultiplier":1.25,"cacheReadMultiplier":0.1},"gpt-4.1-mini":{"inputPerMTok":0.4,"outputPerMTok":1.6,"cacheWriteMultiplier":1,"cacheReadMultiplier":0.25}}', 'USD per million tokens by model, for cost_usd; cache multipliers apply to the input price, and a model with no entry records no cost. claude-sonnet-5-5: Anthropic list price (claude-api model table, 2026-10-06); gpt-4.1-mini: OpenAI standard tier (developers.openai.com/api/docs/pricing, checked 2026-11-11).'),
  ('max_sends_per_hour', '60', 'Jobs accepted per rolling hour (failed and discarded jobs do not count); beyond it the webhook answers 429.'),
  ('duplicate_window_minutes', '10', 'A request identical to one accepted within this many minutes gets that job back (duplicate) instead of a new one.'),
  ('draft_ttl_hours', '24', 'Hours a draft can still be approved and sent; after that, approval answers DRAFT_EXPIRED.'),
  ('stuck_job_minutes', '10', 'A job still running after this many minutes is stopped by the sweeper and marked failed.'),
  ('alert_email', '""', 'Address told about unexpected workflow errors; empty sends no alert.')
ON CONFLICT (key) DO NOTHING;
-- END settings seed

-- A setting's value. A missing key is an error, never a silent NULL.
CREATE OR REPLACE FUNCTION bookleaf_setting(setting_key text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  stored jsonb;
BEGIN
  SELECT s.value INTO stored FROM bookleaf_settings s WHERE s.key = setting_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bookleaf setting "%" is missing', setting_key USING ERRCODE = 'no_data_found';
  END IF;
  RETURN stored;
END $$;

-- Accepts one royalty-summary request, race-free (see infra/db/migrations/03-settings-enqueue.sql):
-- duplicate within duplicate_window_minutes, rate_limited at max_sends_per_hour, else queued.
CREATE OR REPLACE FUNCTION enqueue_royalty_job(job jsonb)
RETURNS TABLE (outcome text, job_id text, status text, error_code text, recent_sends integer)
LANGUAGE plpgsql VOLATILE
SET lock_timeout = '5s'
AS $$
DECLARE
  window_minutes integer := bookleaf_setting('duplicate_window_minutes')::integer;
  max_sends integer := bookleaf_setting('max_sends_per_hour')::integer;
  earlier_job uuid;
  earlier_status text;
  earlier_error text;
  sends integer;
  job_fingerprint text := encode(sha256(convert_to((job->'fingerprint_of')::text, 'UTF8')), 'hex');
  new_job uuid := gen_random_uuid();
BEGIN
  IF jsonb_typeof(job->'fingerprint_of') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'enqueue_royalty_job: fingerprint_of must be a JSON object' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF coalesce(job->>'execution_id', '') = '' THEN
    RAISE EXCEPTION 'enqueue_royalty_job: execution_id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('bookleaf.enqueue_royalty_job', 0));

  SELECT r.job_id, r.status, r.error_code INTO earlier_job, earlier_status, earlier_error
  FROM royalty_jobs r
  WHERE r.author_id = job->>'author_id' AND r.fingerprint = job_fingerprint
    AND r.created_at > now() - make_interval(mins => window_minutes)
  ORDER BY r.created_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT 'duplicate'::text, earlier_job::text, earlier_status, earlier_error, NULL::integer;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO sends
  FROM royalty_jobs r
  WHERE r.created_at > now() - interval '1 hour' AND r.status NOT IN ('FAILED', 'DISCARDED');
  IF sends >= max_sends THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::text, NULL::text, NULL::text, sends;
    RETURN;
  END IF;

  INSERT INTO royalty_jobs (job_id, fingerprint, execution_id, log_id, batch_id, author_id, author_code, mode, status,
    requested_by, callback_status, stage, stage_at, delivery, tone, length, note, sign_off, recipient, drills)
  VALUES (new_job, job_fingerprint, job->>'execution_id', job->>'log_id', job->>'batch_id',
    job->>'author_id', job->>'author_code', job->>'mode', 'QUEUED', job->>'requested_by', 'NOT_NEEDED', 'queued', now(),
    job->>'delivery', job->>'tone', job->>'length', job->>'note', job->>'sign_off', job->>'recipient', job->'drills');
  RETURN QUERY SELECT 'queued'::text, new_job::text, 'QUEUED'::text, NULL::text, sends + 1;
END $$;
