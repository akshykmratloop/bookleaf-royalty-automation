-- 02: drafts, live stages and per-request writing options on the job ledger.
-- Additive and idempotent: safe to run more than once, on a fresh or a populated database.
-- No column is dropped or retyped; only the status CHECK is replaced to allow two new values.
--   docker exec -i <postgres container> psql -U n8n -d bookleaf -v ON_ERROR_STOP=1 < infra/db/migrations/02-drafts-stages.sql
BEGIN;

ALTER TABLE royalty_jobs
  ADD COLUMN IF NOT EXISTS stage       text,         -- queued, reading_data, writing, checking, rewriting, sending, sent, drafted, failed, discarded
  ADD COLUMN IF NOT EXISTS stage_at    timestamptz,  -- when the stage last changed
  ADD COLUMN IF NOT EXISTS delivery    text,         -- send | draft
  ADD COLUMN IF NOT EXISTS tone        text,         -- warm | formal | concise
  ADD COLUMN IF NOT EXISTS length      text,         -- short | standard | detailed
  ADD COLUMN IF NOT EXISTS note        text,         -- admin style note (0-300 chars)
  ADD COLUMN IF NOT EXISTS sign_off    text,         -- signature name ('' = brand default)
  ADD COLUMN IF NOT EXISTS recipient   text,         -- the demo inbox chosen at enqueue (sent_to is set only once sent)
  ADD COLUMN IF NOT EXISTS drills      jsonb,        -- drills requested with the job (email_down is honoured on approval)
  ADD COLUMN IF NOT EXISTS sections    jsonb,        -- AI sections of a draft
  ADD COLUMN IF NOT EXISTS facts       jsonb,        -- verified facts the draft was checked against
  ADD COLUMN IF NOT EXISTS titles      jsonb,        -- book titles (exempt from figure scanning)
  ADD COLUMN IF NOT EXISTS edit_text   text,         -- the draft prose as editable plain text
  ADD COLUMN IF NOT EXISTS issues      text,         -- checker warnings, one per line
  ADD COLUMN IF NOT EXISTS drafted_at  timestamptz;  -- when the draft was saved (approval window: 24 hours)

ALTER TABLE royalty_jobs DROP CONSTRAINT IF EXISTS royalty_jobs_status_check;
ALTER TABLE royalty_jobs ADD CONSTRAINT royalty_jobs_status_check
  CHECK (status IN ('QUEUED', 'PROCESSING', 'SENT', 'FAILED', 'DRAFTED', 'DISCARDED'));

-- Finished jobs from before this migration get their final stage (only empty stages are filled).
UPDATE royalty_jobs SET stage = lower(status) WHERE stage IS NULL AND status IN ('SENT', 'FAILED');

COMMIT;
