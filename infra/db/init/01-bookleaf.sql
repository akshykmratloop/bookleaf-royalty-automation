-- Runs once, on the first start of the Postgres container (docker-entrypoint-initdb.d).
-- n8n keeps its own tables in the `n8n` database; our job ledger lives in `bookleaf`.
CREATE DATABASE bookleaf;

\connect bookleaf

-- One row per royalty-summary request. The durable record of every send.
CREATE TABLE IF NOT EXISTS royalty_jobs (
  job_id            uuid PRIMARY KEY,
  -- author + data fingerprint + 10-minute window: a double click maps to the same row.
  idem_key          text NOT NULL UNIQUE,
  log_id            text,                 -- Bubble NotificationLog unique id
  batch_id          text,
  author_id         text NOT NULL,        -- Bubble Author unique id
  author_code       text,
  mode              text NOT NULL CHECK (mode IN ('single', 'bulk')),
  status            text NOT NULL CHECK (status IN ('QUEUED', 'PROCESSING', 'SENT', 'FAILED')),
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
  callback_status   text CHECK (callback_status IN ('NOT_NEEDED', 'PENDING', 'DONE', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS royalty_jobs_status_idx ON royalty_jobs (status, updated_at);
CREATE INDEX IF NOT EXISTS royalty_jobs_log_idx ON royalty_jobs (log_id);
