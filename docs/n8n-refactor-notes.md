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

## Step 3c — the prompt reads the KB policy from kb.js

- **Changed:** `n8n/src/kb.js` is the one place the policy figures are written (threshold ₹ amount,
  payout window, overdue window, escalation time, 80/20 split) as numbers plus `KB_TEXT` (each figure
  as emails write it). The system prompt, the situation texts (`prompt.js`), the status texts
  (`badge.js`), the next-payout fact note (`facts.js`) and the payout calendar (`dates.js`, whose
  `PAYOUT_WINDOW_DAYS` moved to `kb.js`) read them from there. KB policy stays versioned code, not a
  setting (lead's decision): changing a figure changes the prompt, so it needs a new `PROMPT_VERSION`.
- **Verified:** the system prompt, the KB facts and the prompts and facts of all 10 sample authors are
  byte-identical before and after, so `PROMPT_VERSION` stays `royalty-summary.v2` (prompt caching
  unaffected). New test: every KB display is in the system prompt and none of the five modules above
  repeats one.
- **Sizes:** unchanged node counts (69); Code 214.0 KB (+0.8 KB: `formatInr` now comes along).

## Step 3d — workflows read bookleaf_settings instead of $env

- **Changed:** `readSettings()` in `settings.js` checks the "Load Settings" row (`LOAD_SETTINGS`:
  `SELECT jsonb_object_agg(key, value) AS settings FROM bookleaf_settings`): every known key present
  and valid, unknown keys ignored (a newer migration never breaks older workflows), problems named
  without values → 500 `INTERNAL`. royalty-summary and approve-draft gained a **Load Settings**
  Postgres node right after the webhook; job-status loads none. The job carries `settings` instead of
  `config`; every reader moved: drills (`allow_drills`), recipient (`default_demo_inbox`), reference
  date, idempotency bucket (`duplicate_window_minutes`, until step 6 replaces idem_key), insert cap and
  429 text (`max_sends_per_hour`), AI bodies (`ai_primary`, `ai_fallback`), AI node timeouts (expression
  on `ai_timeout_ms`), cost (`model_prices`; the `PRICES` constants are gone), From line
  (`sender_name <email_from>`, now always set, so the deploy-time `__SMTP_FROM__` fallback is gone),
  default signature (`sender_name`), header/footer (`brand_name`, `support_email`), `DRAFT_EXPIRED`
  text (`draft_ttl_hours`). The SQL reads `bookleaf_setting()` itself for the draft freshness
  (Load Draft, Claim Draft) and the sweeper threshold and message (`stuck_job_minutes`).
  `pipeline/config.js` is deleted (`isEmail` → `validate-fields.js`, `resolveReferenceDate` →
  `dates.js`). New `workflows-src/lib/tuning.mjs`: AI retries 2 × 2 s, Send Email 2 tries (step 5
  makes it 1), sweeper every minute (lead's decision). The error handler's `$env.N8N_INTERNAL_URL`
  became the constant `http://127.0.0.1:5678/api/v1` (both compose files run n8n on 5678; the node
  goes away in step 8). Build test: no workflow contains `$env`.
- **Tests:** the `SETTINGS` fixture (`tests/pipeline/settings-fixture.js`: seeded defaults + test
  per-environment values) replaces the `ENV` fixture; `readSettings` and every reader above are
  tested with non-default values; the "defaults reproduce today's constants" pins are deleted (their
  readers moved). npm test 424.
- **Live checks (local):** contracts 35/35; a test row stuck for 11 minutes was failed by the sweeper
  within ~45 s with "did not finish within 10 minutes" (row deleted); `allow_drills=false` made the
  very next drill request a 400 `DISABLED`, then it was set back to true.
- **Sizes:** 69 → **71** working nodes (+2 Load Settings). Code 19 nodes, 214.0 → **224.8 KB**: the
  schema's checks and descriptions are bundled into Prepare Job (30.1 KB) and Parse Request.
- **Deviations:** the sweeper saves only failed executions (`saveDataSuccessExecution: 'none'`), since
  at one run a minute successful sweeps would bury everything else in the executions list (build.mjs
  now merges a workflow's own `settings`). `sender_name` must not contain `" , ; : < > @ \` or control
  characters (it is a From display name; a comma would split the address list); check only, the seed
  is unchanged. The provider modules keep their `DEFAULT_MODEL`/`DEFAULT_MAX_TOKENS`/`DEFAULT_EFFORT`
  as library defaults; the workflows always pass the settings.
- **Release engineer:** write the production per-environment settings (step 3b) **before** deploying
  this, or every request answers 500 (`email_from must be an email address`). `alert_email` is read
  only from step 8. The previous tag reads `$env`: keep `n8n/app_env` and the env flag until the
  rollback window has passed.

## Step 3e — $env blocked in both compose files

- **Changed:** `N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"` is gone from `docker/docker-compose.local.yml`
  and the repo copy of the production compose (`infra/terraform/files/docker-compose.yml`), so n8n's
  default applies and a Code node that reads `$env` fails ("access to env vars denied"). The local
  compose no longer sets the old workflow variables (`ALLOW_DRILLS`, `EMAIL_PROVIDER`, …,
  `N8N_INTERNAL_URL`), and `docker/bootstrap.mjs` no longer writes `DEFAULT_DEMO_INBOX`/`EMAIL_FROM`
  into the compose env (it writes those as settings instead). The production compose keeps
  `env_file: app.env` (SSM `n8n/app_env`) only for a rollback; comments in `ssm.tf`, `variables.tf`
  and `infra/README.md` now say so (no Terraform resource changed). New `tests/infra/compose.test.js`:
  neither compose file names the flag; the local one passes no workflow variables.
- **Local n8n restarted** (only that container, from this worktree's compose):
  `N8N_VERSION=$(cat docker/N8N_VERSION) docker compose -f docker/docker-compose.local.yml
  --project-directory <main checkout>/docker -p bookleaf-n8n-local up -d --no-deps n8n`. The project
  directory must be the main checkout's `docker/`, where the data lives (`.data/n8n`, `.data/postgres`);
  from the worktree, `./.data` would point at an empty folder. Same mount and image after the restart,
  the flag is unset, all five workflows active. A throwaway workflow whose Code node reads `$env.TZ`
  got "access to env vars denied" (then deleted). Contracts 35/35 on the blocked n8n.
- **Note:** the local `.secrets/n8n-local.compose.env` still holds `DEFAULT_DEMO_INBOX` and
  `EMAIL_FROM` from an older bootstrap; n8n cannot read them any more, and the next bootstrap run
  rewrites the file without them (the file is shared with the main checkout, so it was left alone).
- **Release engineer (production):** deploy the settings-reading workflows first, then remove the flag
  on the box (the compose file in this commit) and restart `n8n-stack`. Rollback to the `$env`
  workflows needs the line `N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"` back in the n8n `environment:`
  block and `app.env` (still rendered from SSM).
- **Sizes:** unchanged (71 working nodes; 19 Code nodes, 224.8 KB).

## Step 4 — n8n Header Auth on the three webhooks

- **Changed:** the webhooks (royalty-summary, job-status, approve-draft) use `authentication:
  'headerAuth'` with the new credential **BookLeaf Webhook Key** (`httpHeaderAuth`: header
  `X-BookLeaf-Key`, value `BOOKLEAF_WEBHOOK_KEY` from `.secrets/webhook.env`,
  `allowedHttpRequestDomains: 'none'` so no HTTP Request node can send it). `deploy.mjs` creates or
  updates it like the other credentials. n8n answers a missing or wrong key with 403 and the plain
  text `Authorization data is wrong!` (header `WWW-Authenticate: Basic realm="Webhook"`) before the
  workflow starts. Removed: the key check in Prepare Job / Parse Request / Parse Query (they no
  longer get headers), `src/pipeline/auth.js` and its test, the `__WEBHOOK_KEY_HASHES__`
  placeholder (nodes.mjs, deploy.mjs) and the `FORBIDDEN` error code (no workflow can answer it now).
  `sha256.js` stays (ids.js and build.mjs use it). `webhookKeys()` became `webhookKey()`: one key,
  32–256 printable characters without spaces; a leftover `BOOKLEAF_WEBHOOK_KEY_NEXT` stops the deploy.
- **Bubble-visible change:** only the 403 body (n8n's text instead of `{error:{code:'FORBIDDEN'}}`),
  which Bubble sees only when its key is wrong. Same paths, header name and key. Rotation now has a
  short gap (one key): new key in `.secrets/webhook.env`, deploy, then update Bubble (PAYLOAD.md).
- **Tests:** build test (Header Auth + the credential on all three webhooks; no Code node mentions
  the key, `keyHashes` or `FORBIDDEN`; the Code nodes run without headers); new
  `n8n/tests/secrets.test.js` (key file generated once, `_NEXT` refused, weak/spaced keys refused
  with messages that name the variable, never the value; the credential data). Contract 01: no key
  and a wrong key → all three endpoints 403 with n8n's text, and no execution contains the
  request's marker (executions newer than the newest before the probe, read through the n8n API
  2 s later); a control with the right key finds its execution, so the check is not vacuous.
- **Live checks (local):** contracts 36/36. Rotation: switching the credential to a temporary key
  made the old key 403 and the new one 200 at once (no republish); a redeploy restored the real key.
  The key appears 0 times in the n8n container log (default log level).
- **Sizes:** 71 working nodes (unchanged); Code 19 nodes, 224.8 → **214.0 KB** (Prepare Job 28.9 KB).
- **Deviations:** "no new execution" is checked with a per-request marker instead of "the newest
  execution id did not change", because the sweeper (failed runs) or a still-finishing job may add
  executions meanwhile. The public API leaves out running executions; the control shows a run is
  saved well within the 2 s wait. The contract suite now needs `N8N_API_KEY` in its env file (the
  deploy env files have it). The key strength check is new (the existing local key passes).
- **Known (unchanged by this step):** the request headers, key included, are kept in the saved
  execution data of the three webhook workflows (as before), visible to n8n users.
- **Release engineer:** no box change. Deploy from a machine whose `.secrets/webhook.env` holds the
  key Bubble uses (the one production was deployed with); the deploy creates the credential.
  `deploy.mjs` never deletes credentials: the stale "BookLeaf Webhook Key (X-BookLeaf-Key)" (from
  commit 023b5b2) and "BookLeaf Bubble API (bearer)" (step 3a) stay on an instance until deleted by
  hand in n8n, after the rollback window. Rollback: the previous tag's workflows check the key in a
  Code node again (same `webhook.env`).

## Step 5 — Deliver Email sub-workflow

- **Changed:** new workflow **BookLeaf - Deliver Email** (`workflows-src/deliver-email.mjs`), the one
  place an email is sent: **When Called** (Execute Workflow Trigger 1.1; inputs `job_id` string, `email`
  object {from, to, subject, html, text}, `drill` boolean, `record` object) → **Mark Sending**
  (`UPDATE_JOB`, alwaysOutputData: the caller's `record` columns, then job id, stage `sending` and the
  email, so a record can never change those) → **Still Running?** (IF 2.2, `job_id` not empty; false =
  the job already ended, e.g. the sweeper failed it, and nothing is sent) → **Real SMTP?** (IF 2.2,
  `drill` is false: true = **Send Email** on the main row, false = **Send Email (drill: SMTP down)**
  below; each tries once: `retryOnFail: false`, error output) →
  **Mark Sent** (`MARK_SENT`: SENT, stage sent, `sent_to`, completed) / **Mark Failed**
  (`MARK_EMAIL_FAILED`: FAILED, `EMAIL_FAILED`, "<standard message> smtp: <server message>" on one line,
  at most 300 characters after the standard message). Both end queries only touch a QUEUED/PROCESSING
  job. No error workflow on it: a failure fails the caller's node and the caller's error workflow
  handles it (with the caller's execution id). Callers: royalty-summary (`Draft?` send → **Deliver
  Email**; removed Stage: Sending, Email Drill?, both Send Email nodes, Mark Sent, Email Failed) and
  approve-draft (Respond Sending → **Deliver Email**; removed Email Drill?, both Send Email nodes, Mark
  Sent, Email Failed, Update Job). The call is Execute Workflow 1.2 (database source, run once, waits),
  built by `executeWorkflow()` from the sub-workflow's exported `DELIVER_EMAIL` {name, inputs}, so the
  mapping and the trigger come from one list. `WORKFLOW_SOURCES` (deploy order) is now error-handler,
  deliver-email, royalty-summary, job-status, sweeper, approve-draft. Pipeline: `deliveryFor()`
  (finalize.js) gives a send job's inputs (record = author code + AI columns); `decideApproval` puts
  `deliver` (record `{}`) on the claim route. Deleted `renderForSend`, `sentUpdate`,
  `approvedSentUpdate`, `approvedFailedUpdate` and the Code entries `markSent`, `emailFailed`,
  `approvedSent`, `approvedFailed`; `TUNING` lost the email tries. New builders in `lib/nodes.mjs`:
  `ifTrue` (+ `IS_FALSE`, `NOT_EMPTY`), `subWorkflowTrigger`, `executeWorkflow`, `withNote`
  (notesInFlow), `stableUuid` (build.mjs node ids now use it, same ids), `workflowPlaceholder`;
  `note()` takes an optional position and width.
- **Behaviour changes (Bubble sees only the first):** the `EMAIL_FAILED` text now carries the SMTP
  server's message; before, it always said `smtp: unknown error` (Send Email's error output gives
  `error` as a string, which `nodeErrorSummary` did not read). Send Email tries once (it was 2 tries,
  2 s apart). A job that has already ended is never emailed (Stage: Sending used to let the send go
  ahead). The email and the AI columns are on the job before the send, so a crash after it leaves them.
- **Tests:** `n8n/tests/deliver-email.test.js` (sub-workflow inputs, deploy order, wiring, the three
  queries' parameters evaluated like n8n, IF 2.2 shape, node notes of at most 28 characters in every
  workflow, the happy path on one row; no Send Email outside it and none retries), `n8n/tests/deliver-callers.test.js` (each caller maps exactly the trigger's names and types;
  the mapping expressions evaluated on the real Render Email / Decide Code nodes give values of those
  types), SQL pins, `tests/db/deliver.test.js` (10, real Postgres: Mark Sending on a running and an
  ended job, Mark Sent, Mark Failed text: one line, `unknown error`, 300-character cap, never on an
  ended job). Contract 02 asserts the email-down drill's error ends with `smtp: …ECONNREFUSED`. Shared
  build-test helpers moved to `n8n/tests/built.js`. npm test 444, test:db 28.
- **Live checks (local):** deploy created and published Deliver Email before its callers (local id
  `wzHQZwU5rqqe6pDK`); contracts 36/36; 7 sub-executions for the run's 6 sends and the email-down drill,
  all successful. The drill's error went from `smtp: unknown error` (baseline run) to `smtp: connect
  ECONNREFUSED 127.0.0.1:9`. Guard: a throwaway caller (deleted afterwards, with its test row) called
  Deliver Email with drill=true for a job the sweeper had failed: it stopped at Still Running? (false
  branch), no send node ran, the row was unchanged, and the caller's execution ended successfully (no
  error workflow). With trigger 1.1 the IF's false item comes back to the caller's node on a second
  output that node does not have, so that node shows no output item; harmless, as nothing follows it.
  Canvas (local n8n editor, screenshot): the happy path When Called → Mark Sent reads left to right on
  one row; the drill send and Mark Failed sit below; every node note shows whole. One crossing stays
  (both sends feed both end nodes). After the canvas changes: redeployed, contracts 36/36 again.
- **Sizes:** 71 → **69** working nodes (royalty-summary 35 → 30, approve-draft 21 → 16, deliver-email 8);
  Code 19 → **15** nodes, 214.0 → **204.6 KB** (budget lowered 250 → 215 KB); Switch 15 → 13; IF 0 → 2.
- **Deviations:** `record` holds only the extra columns: the email travels once, in `email`, and Mark
  Sending builds the row with `Object.assign`. Send Email has `retryOnFail: false` and no `maxTries`
  (the design says maxTries 1; n8n reads maxTries only when retries are on, and the editor's field starts
  at 2). Mark Failed builds the error text in SQL (no Code node in the sub-workflow), shaped like
  `nodeErrorSummary`'s, without its API-key redaction (an SMTP error never carries one). The false
  branch of Still Running? is left unconnected. The drill question is asked as **Real SMTP?** (`drill` is
  false) rather than "Email Drill?", so IF 2.2's top output (true) is the main row and the edges do not
  cross; n8n tests `!drill`, so a missing flag would use the real server (both callers always pass a
  boolean). Node notes stay within 28 characters: the canvas shows one line of about 30. The About note
  sits above the row at a fixed position; the callers' sticky notes keep their size and place (step 9
  sizes notes from bounding boxes). Node versions as designed (Execute Workflow 1.2, trigger 1.1, IF 2.2).
- **Next builder:** steps 6/7 rewire around the **Deliver Email** nodes (royalty-summary takes
  `$json.deliver` from Render Email through `Draft?`; approve-draft takes `$('Decide').first().json.deliver`).
  The sub-workflow never writes `execution_id`: step 8's Fail Job matches the caller's execution id
  (the error workflow gets the caller's), and Mark Sending's stage `sending` is the marker for
  `EMAIL_UNCERTAIN`. Mark Sent never overwrites an ended job: if the sweeper fails a job while its
  email is in flight (only possible with a send slower than `stuck_job_minutes`), the job stays failed
  although the email went out; step 8's `EMAIL_UNCERTAIN` is the honest label for that case.
- **Release engineer:** no migration, no new credential. The deploy creates "BookLeaf - Deliver Email"
  and publishes it before the callers (an unpublished sub-workflow fails every send with "Workflow is
  not active"). A rollback to the previous tag leaves it published but unused; archive it by hand if
  wanted. Its executions are saved separately; each caller's Deliver Email node links to its run.
