# n8n clean-up — running log (branch `refactor/n8n-clean`)

One entry per step: what changed, node counts and Code sizes, deviations from the design and why,
and what the next builder or the release engineer must know. Newest step last.

**Starting point (main @ f57df75):** 80 working nodes (royalty-summary 45, approve-draft 20,
job-status 7, error-handler 6, sweeper 2); 23 Code nodes, 415.1 KB of generated Code; 17 Switch nodes.

**Worktree set-up (local only, never committed):** `.secrets`, `node_modules` and `.env` are symlinks
to the main checkout. `.env` was added in step 1: `n8n/deploy.mjs` reads the SMTP account from
`<repo>/.env`, so a worktree without it cannot deploy. All three paths are git-ignored.

---

## Step 1 — tree-shaking

- **Changed:** `"sideEffects": false` in the root `package.json`, so esbuild leaves out every module
  a Code node never calls. New `n8n/tests/code-size.test.js`: all Code nodes together ≤ 250 KB,
  no single Code node > 40 KB (it failed before the fix: 415.1 KB, Build Context 42.5 KB).
- **Sizes:** 23 Code nodes, **415.1 → 233.9 KB**. Largest: Check Draft 34.7, Build Context 33.5,
  Decide 31.3, Prepare Job 25.7. Thin nodes now carry only their own code (Mark Sent 14.1 → 0.8 KB).
  Node counts unchanged (80).
- **Deviations:** none.
- **Next builder:** lower `TOTAL_BUDGET_KB` as Code nodes are removed (the design projects ~185 KB).
  `n8n/src` must stay free of import-time side effects (top-level code = imports, exports and
  declarations only): with this flag, anything a module does on import is silently dropped from
  the bundles. Only `n8n/build.mjs` bundles with esbuild, so the flag affects nothing else.

## Step 2 — migration 03: settings table, execution id, fingerprint, race-free enqueue

- **Changed:** `n8n/src/pipeline/settings.js` is the one settings schema (16 keys, each with
  default, description and check; `settingProblem(key, value)`). `email_from`,
  `default_demo_inbox`, `allow_drills`, `alert_email` are per-environment; `email_from` has no valid
  default on purpose. `infra/db/migrations/03-settings-enqueue.sql`, mirrored in
  `infra/db/init/01-bookleaf.sql`: table `bookleaf_settings` (key, jsonb value, description,
  updated_at) seeded `ON CONFLICT DO NOTHING`; `bookleaf_setting(k)` (raises on a missing key);
  `royalty_jobs.execution_id` and `fingerprint` with three indexes; `idem_key` nullable (still
  unique); `enqueue_royalty_job(jsonb)`. `node n8n/tools/settings-seed.mjs` writes the seed into
  both files from the schema. gpt-4.1-mini price verified on OpenAI's pricing page (values unchanged).
- **`enqueue_royalty_job` contract (step 6 wires it):** `SELECT * FROM enqueue_royalty_job($1::jsonb)`.
  Input: `job_id`, `execution_id` (required: `$execution.id`), `fingerprint` (required: 64
  lowercase hex = SHA-256 of the canonical fingerprint JSON; today's idem_key keeps only 40 chars),
  `author_id`, `author_code`, `log_id`, `batch_id`, `mode`, `requested_by`, `delivery`, `tone`,
  `length`, `note`, `sign_off`, `recipient`, `drills`. Output, one row: `outcome`
  (`queued` | `duplicate` | `rate_limited`), `job_id`, `status`, `error_code`, `recent_sends`.
  Under one transaction-scoped advisory lock: duplicate (same author + fingerprint within
  `duplicate_window_minutes`, any status) before the cap (`max_sends_per_hour` jobs in the last
  hour, FAILED/DISCARDED not counted), else insert QUEUED/queued. Writes `callback_status`
  NOT_NEEDED, never `idem_key`. Waits at most 5 s for the lock (`lock_timeout`).
- **Tests:** unit pins in `n8n/tests/pipeline/settings.test.js` and `n8n/tests/ledger-schema.test.js`
  (seed = schema, 01 mirrors 03, lock/window/cap/VOLATILE, additive only). New real-Postgres suite
  `npm run test:db` (15 tests, ~20 s, throwaway databases in the local container, never `bookleaf`):
  fresh install, 02/03 re-run with no schema change, seed values, `bookleaf_setting`, `idem_key`,
  enqueue semantics, 6 simultaneous identical requests → 1 job, 6 simultaneous different requests
  with one slot left → 1 job, lock never released → fails after 5 s. Removing the lock or using
  `>` for the cap makes it fail.
- **Applied locally:** backup, then 03 twice on the local `bookleaf` (73 jobs kept; the re-run
  changed nothing). Its `pg_dump --schema-only` equals a fresh install from 01 (pg_dump 16.15 adds
  random `\restrict` lines: strip them before diffing). Contracts 35/35 on it with the old workflows.
- **Sizes:** unchanged (80 nodes, 23 Code nodes, 233.9 KB).
- **Deviations:** settings.js holds literal defaults, and tests pin each to the constant it replaces
  (brand, sign-off, AI models/effort/tokens, prices, 60/hour, reference date, 10-minute window,
  45 s AI timeout, 24 h drafts, 10-minute sweeper): delete a pin when its reader moves to the table.
  Additions: an index on `created_at` (the hourly count runs under the lock on every enqueue), the
  5 s `lock_timeout`, required `execution_id`/`fingerprint`, and the `test:db` suite (not in the
  gate list; run it whenever ledger SQL changes).
- **Next builder / release engineer:** nothing reads the settings or calls the function yet; the
  live workflows still insert with `idem_key` (compatible). The local per-environment settings still
  hold the seed placeholders: write them (the settings SQL tool of step 3) before any workflow reads
  them. Production: `scripts/ops/migrate-prod.sh infra/db/migrations/03-settings-enqueue.sql`.
  `docs/integration.md` (Idempotency, The job ledger) and `docs/error-handling.md` (Duplicate row)
  still describe `idem_key`: update them in step 6. After the production rollout 03 is frozen: new
  keys need a new migration (and the seed test must then cover every seeding file). A new EC2 box
  gets 01 inside its gzipped user data: now 9.8 KB of the 16 KB limit.

## Step 3a — drop the Bubble Data API and push-callback paths

- **Why now:** `DATA_SOURCE`, `CALLBACK_MODE` and `BUBBLE_APP_BASE` were read from `$env` and have no
  row in the settings table (the lead dropped push), so once step 3 removes `$env` both paths are
  unreachable. They are removed first, on their own, to keep the settings commit readable.
- **Changed:** royalty-summary loses 11 nodes (Data Source, Bubble Queries, Bubble Author/Books/
  Royalties, Bubble Data Failed, After Update, Push Callback?, Notify Bubble, Callback Result, Update
  Callback): Mark Processing now feeds Build Context, and Update Job is the end of every branch.
  Deleted `n8n/src/bubble-client.js`, `n8n/src/pipeline/callback.js`, `UPDATE_CALLBACK`, the `bubble`
  credential and their tests. The request always carries `author` and `books`. New jobs are written
  `callback_status = 'NOT_NEEDED'` by the insert itself and no update touches the column (it stays in
  job-status for Bubble). `UPDATE_JOB` returns only `job_id, status, stage, error_code`, so saved
  executions no longer carry the HTML twice. `n8n/PAYLOAD.md`: the push section is now the paid-plan
  upgrade path.
- **Sizes:** 80 → **69** working nodes (royalty-summary 45 → 34); Code 23 → 19 nodes,
  233.9 → 213.2 KB; Switch 17 → 15.
- **Deviation:** the design drops push without naming a step; it is done here because step 3 removes
  its configuration.
- **Next builder / release engineer:** the credential `BookLeaf Bubble API (bearer)` is no longer
  deployed; delete it on each instance after the rollout (it is still on the local one). The narrative
  docs (`README.md` diagram, `docs/integration.md`, `docs/error-handling.md`, `docs/decisions.md`,
  `docs/learning-log.md`) still describe push mode: step 10.

## Step 3b — per-environment settings tool

- **Changed:** `n8n/tools/settings-sql.mjs` prints idempotent SQL that writes an environment's own
  settings (the schema's `perEnvironment` keys) for piping straight into psql:
  `node n8n/tools/settings-sql.mjs --env <file> [--env <file> ...] | <psql -d bookleaf>`. Env names
  are the keys upper-cased: `EMAIL_FROM` (falls back to `SMTP_USER_EMAIL`, the address deploy used
  to fill in), `DEFAULT_DEMO_INBOX`, `ALLOW_DRILLS` (`true`/`false`), `ALERT_EMAIL`; `--env -` reads
  stdin; a later file wins; unnamed settings keep their stored value; a value is checked by the
  schema and an error names the variable, never the value. Each upsert changes a row (and its
  `updated_at`) only when the value differs. `docker/bootstrap.mjs` now writes the local values after
  the stack is up (SMTP account sends, demo inbox receives and gets the alerts, drills on).
  `env-file.mjs` gained `parseEnvText` (stdin input).
- **Tests:** `n8n/tests/settings-sql.test.js` (10), `tests/db/settings-sql.test.js` (3: typed values
  readable by `bookleaf_setting()`, a re-run changes nothing, only named settings change).
- **Applied locally** (values never printed): `{ echo ALLOW_DRILLS=true; sed -n
  's/^DEFAULT_DEMO_INBOX=/ALERT_EMAIL=/p' .secrets/n8n-local.compose.env; } | node
  n8n/tools/settings-sql.mjs --env .env --env .secrets/n8n-local.compose.env --env - | docker exec -i
  bookleaf-n8n-local-postgres-1 psql -X -q -U n8n -d bookleaf -v ON_ERROR_STOP=1`. All four set;
  `alert_email` = `default_demo_inbox`; the sender equals the SMTP account. Contracts 35/35 on the
  old workflows (they do not read the table yet).
- **Release engineer (production):** before deploying the settings-reading workflows, build an env
  file outside the repo with `DEFAULT_DEMO_INBOX` and `ALLOW_DRILLS` from the SSM parameter
  `n8n/app_env` (`ALLOW_DRILLS=true` for this demo), `EMAIL_FROM` = the SMTP account address
  (`SMTP_USER_EMAIL` in `.env`) and `ALERT_EMAIL` = the demo inbox; then
  `node n8n/tools/settings-sql.mjs --env <that file> > /tmp/bookleaf-settings.sql &&
  scripts/ops/migrate-prod.sh /tmp/bookleaf-settings.sql` (backs up first) and delete the temp
  files. Also compare `MAX_SENDS_PER_HOUR`, `REFERENCE_DATE_DEFAULT`, `AI_PRIMARY_MODEL`,
  `AI_FALLBACK_MODEL`, `AI_EFFORT` and `BRAND_SUPPORT_EMAIL` in `n8n/app_env` with the seeded
  defaults (60, 2025-12-31, claude-sonnet-5-5, gpt-4.1-mini, medium, empty) and UPDATE any that differ.
