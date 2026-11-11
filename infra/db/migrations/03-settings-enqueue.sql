-- 03: server settings in the database, execution tracking, and a race-free enqueue for the job ledger.
-- Additive and re-runnable on a fresh or a populated database. The workflows from before this
-- migration keep working unchanged (idem_key stays, still unique, now nullable). Mirrored in
-- infra/db/init/01-bookleaf.sql; checked by n8n/tests/ledger-schema.test.js and npm run test:db.
--   local:      docker exec -i bookleaf-n8n-local-postgres-1 psql -U n8n -d bookleaf -v ON_ERROR_STOP=1 < infra/db/migrations/03-settings-enqueue.sql
--   production: scripts/ops/migrate-prod.sh infra/db/migrations/03-settings-enqueue.sql (backs the database up first)
-- The per-environment settings (email_from, default_demo_inbox, allow_drills, alert_email) are seeded
-- empty or off here; each environment writes its own values afterwards.
-- Undo, only while no workflow reads them: drop the functions enqueue_royalty_job(jsonb) and
-- bookleaf_setting(text), then the table bookleaf_settings. Keep the two new columns: they hold data.
BEGIN;

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
  ('ai_timeout_ms', '45000', 'Time limit for one AI request, in milliseconds. All AI calls of a run at worst (draft and rewrite, two providers, two tries each) plus 60 s must end within stuck_job_minutes and the 600 s run timeout; 62500 is the most that fits.'),
  ('model_prices', '{"claude-sonnet-5-5":{"inputPerMTok":2,"outputPerMTok":10,"cacheWriteMultiplier":1.25,"cacheReadMultiplier":0.1},"gpt-4.1-mini":{"inputPerMTok":0.4,"outputPerMTok":1.6,"cacheWriteMultiplier":1,"cacheReadMultiplier":0.25}}', 'USD per million tokens by model, for cost_usd; cache multipliers apply to the input price, and a model with no entry records no cost. claude-sonnet-5-5: Anthropic list price (claude-api model table, 2026-10-06); gpt-4.1-mini: OpenAI standard tier (developers.openai.com/api/docs/pricing, checked 2026-11-11).'),
  ('max_sends_per_hour', '60', 'Jobs accepted per rolling hour (failed and discarded jobs do not count); beyond it the webhook answers 429.'),
  ('duplicate_window_minutes', '10', 'A request identical to one accepted within this many minutes gets that job back (duplicate) instead of a new one.'),
  ('draft_ttl_hours', '24', 'Hours a draft can still be approved and sent; after that, approval answers DRAFT_EXPIRED.'),
  ('stuck_job_minutes', '10', 'A job still running after this many minutes is stopped by the sweeper and marked failed. Must leave room for the AI worst case (see ai_timeout_ms).'),
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

ALTER TABLE royalty_jobs
  ADD COLUMN IF NOT EXISTS execution_id text,  -- n8n execution running the job: the enqueue, or the approval once claimed
  ADD COLUMN IF NOT EXISTS fingerprint  text;  -- SHA-256 hex of everything that shapes the email (duplicate window)
-- New jobs are de-duplicated by enqueue_royalty_job; idem_key stays unique for the old workflows' rows.
ALTER TABLE royalty_jobs ALTER COLUMN idem_key DROP NOT NULL;

CREATE INDEX IF NOT EXISTS royalty_jobs_execution_idx ON royalty_jobs (execution_id) WHERE execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS royalty_jobs_fingerprint_idx ON royalty_jobs (author_id, fingerprint, created_at);
CREATE INDEX IF NOT EXISTS royalty_jobs_created_idx ON royalty_jobs (created_at);

-- Accepts one royalty-summary request. Every call holds the same transaction-scoped advisory lock
-- (released at commit), so calls run one at a time and each sees the jobs the earlier ones wrote:
-- two simultaneous clicks can never both insert, and the hourly cap is exact. In order it answers
--   duplicate     the newest job of the same author and fingerprint created within
--                 duplicate_window_minutes (a sliding window; any status)
--   rate_limited  max_sends_per_hour jobs were created in the last hour (FAILED and DISCARDED not counted)
--   queued        the new job, inserted QUEUED at stage queued
-- It makes the job id (gen_random_uuid) and the fingerprint: SHA-256 hex of `fingerprint_of` as jsonb
-- text, which is canonical (keys sorted, whitespace fixed), so the order Bubble sends fields in never matters.
-- VOLATILE on purpose: each statement takes a fresh snapshot after the lock is granted.
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

COMMIT;
