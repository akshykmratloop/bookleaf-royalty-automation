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

## Step 6 — royalty-summary: enqueue function, named outputs, one AI Failed, Record Result

- **Changed:** royalty-summary is the design's 27 nodes. Intake: **Prepare Job** (now also passes
  `$execution.id`, builds the enqueue parameter and precomputes the 429 body) → **Request Valid?** (IF 2.2)
  → **Enqueue Job** (`SELECT outcome, job_id, status, error_code FROM enqueue_royalty_job($1::jsonb)`) →
  **Outcome** (Switch 3.2 Rules mode, outputs *Queued* / *Duplicate* / *Rate limited*) → **Respond 202** /
  **Respond Duplicate** / **Respond 429** (bodies as before: `{job_id, status, duplicate}`, `+error_code` on a
  duplicate of a failed job, the `RATE_LIMITED` error body). AI: **Call Anthropic** -error→ **Call OpenAI
  (fallback)** -error→ **AI Failed**; **Check Draft** → **Draft OK?** (*Pass* / *Rewrite* / *Fail*) →
  **Stage: Rewriting** → **Rewrite (Anthropic)** -error→ **Rewrite (OpenAI fallback)** -error→ **AI Failed**
  → **Check Rewrite** → **Rewrite OK?** → **Render Email** → **Send Now?** → **Deliver Email**. **Record
  Result** (`UPDATE_JOB`) is the one sink for drafts and every failure. Removed: Insert Job, Classify,
  Respond Accepted, Queued?, Stage: Writing, Stage: Checking, Rewrite With?, Regenerate ×2, Regeneration
  Failed, Retry OK?, Update Job; `INSERT_JOB`, `classify.js`, `idempotencyKey`, `insertParams`, `AI_ROUTES`.
- **Pipeline:** the job carries `fingerprint` (SHA-256 hex of the canonical fingerprint JSON) instead of
  `idem_key`; `enqueueParams(job, executionId)` is the function's parameter (refuses an empty execution id);
  `rateLimitedResponse(settings)`. `afterAi` returns `outcome` (`AI_OUTCOMES` PASS / REWRITE / FAIL) and, for
  a rewrite, `rewrite: {anthropic, openai}` (both bodies from `providerRequests`, so drills still apply).
  `aiUnavailable({rewriting, anthropicError, openaiError})` names both providers' errors and says when it
  was the rewrite. Code entries return booleans for the IFs (`ok`, `send`). `MARK_PROCESSING` sets stage
  `writing`. The error handler takes the job id from Prepare Job (or Claim Draft), never from Enqueue Job:
  for a duplicate that is the earlier request's job, which must not be failed.
- **Builders:** `switchRules(name, left, [{output, equals}])` (Rules mode, `renameOutput`/`outputKey`, filter
  options version 2), `IS_TRUE`; `ifTrue` and `switchRules` share one `filter()` (deliver-email's JSON is
  unchanged). Edges may name outputs (`'true'`/`'false'`, `'error'`, a Switch output name); `resolveEdges`
  turns them into indexes and fails the build on an unknown name. A workflow may list its happy path as
  `mainRow`: those nodes share row 0, every other node stacks below (rows 1, 2, … per column).
- **Tests (written first):** `n8n/tests/royalty-summary.test.js` (node and type counts, Rules-mode Switches
  with named outputs, IF 2.2 questions, wiring of both AI fallbacks, the Respond bodies evaluated like
  n8n, Prepare Job / Check Draft / Check Rewrite / AI Failed run as built, Record Result's five feeds, the
  happy path on row 0), unit tests for fingerprint, `enqueueParams`, `rateLimitedResponse`, outcomes,
  rewrite bodies (drills kept) and `aiUnavailable`; `tests/db/enqueue.test.js` runs `ENQUEUE_JOB` with
  Prepare Job's real parameter (queued, then duplicate). New contract `05-concurrent-enqueue`: 3 identical
  requests at once → exactly one 202, two 200 duplicates of that job (data_down drill: no AI, no email).
- **Live checks (local):** contracts 37/37; new jobs carry their execution id and a 64-hex fingerprint and
  no `idem_key`; with `max_sends_per_hour` set to 1 for one request the webhook answered 429 with "The
  limit is 1 per hour" (then set back to 60); a repeat of a failed request answered 200 `duplicate: true,
  error_code: DATA_UNAVAILABLE`.
- **Sizes:** royalty-summary 30 → **27** working nodes (Code 8 → 6, IF 0 → 4, Switch 7 → 2, Postgres 7 → 5); all workflows
  69 → **66**, Switch 13 → 8. Code 15 → **13** nodes, 204.6 → **201.6 KB** (budget 215 → 205 KB). Largest: Check Rewrite
  34.0, Check Draft 33.9, Prepare Job 28.9, Build Context 26.3 KB.
- **Deviations:** the design's "Save as Draft?" is asked as **Send Now?** (true = send), so the IF's top
  output is the happy path, as in Deliver Email. Stage `reading_data` and `checking` are no longer written
  (each takes milliseconds; the lead allowed skipping short stages): a new job goes queued → writing →
  (rewriting) → sending/drafted. The rewrite now always tries Anthropic first, then OpenAI (it used to
  stay with the provider of the first draft); with `primary_down` the Anthropic body still names the
  drill model, so OpenAI rewrites. The rewrite branch and the rewrite-phase AI Failed are covered by unit
  tests on the built nodes only: no drill forces a fact-check failure, and none happened live.
- **Release engineer:** needs migration 03 (the function) on the target before this deploy; no new
  credential, no new setting. Bubble sees the same paths, bodies and status codes; the duplicate window
  now slides (10 minutes back from each click instead of fixed 10-minute buckets).

## Step 7 — approve-draft: Decide works out every answer, named outputs, claim records the execution

- **Changed:** approve-draft is the design's 16 nodes: Approve Webhook → Load Settings → Parse Request →
  **Request Valid?** (IF 2.2) → Respond Rejected / Load Draft → **Decide** → **Action** (Switch 3.2 Rules mode:
  *Answer* / *Discard* / *Send*). Answer → **Respond Answer**. Discard → **Discard Draft** → **Respond
  Discard** (`$json.job_id ? response : fallback`). Send → **Claim Draft** → **Claimed?** (IF 2.2, `job_id`
  not empty) → **Respond Sending** → Deliver Email, or **Respond Already Sent**. Removed the Code nodes
  Discard Result and Claim Result (and `claimOutcome`, `discardOutcome`, `APPROVE_ROUTES`) and the shared
  Respond Result. `decideApproval` returns `action` (`APPROVE_ACTIONS`), `response`, and for discard/send a
  `fallback` (NOT_A_DRAFT / ALREADY_SENT, the answer when the update takes no row), so no Code runs after
  the database. `CLAIM_DRAFT` sets `execution_id` to the approving execution (`$execution.id`, passed by
  Decide in `params`): the job now belongs to the run that sends it, for step 8's error handler.
- **Tests (written first):** `n8n/tests/approve-draft.test.js` (counts and types, Action's named outputs,
  both IFs, wiring, the five Respond bodies evaluated like n8n, the send path on row 0, node notes);
  `tests/db/approve.test.js` (5, real Postgres: claim records the execution id, a second click claims nothing
  and keeps the first id, an expired draft is never claimed, discard works on an expired draft and returns
  nothing once the job is no longer a draft); unit tests for the new Decide shape.
- **Live checks (local):** contracts 37/37 (04: check, EDIT_BLOCKED, send + ALREADY_SENT on the second click,
  discard, NOT_FOUND, 400/403). The approved job's `execution_id` was the approve-draft execution, whose
  path was Approve Webhook → … → Claim Draft → Claimed? → Respond Sending → Deliver Email. Canvas
  screenshots of both workflows in the local editor (scratchpad, not committed): the happy path on one
  row, the other branches below.
- **Sizes:** approve-draft 16 → **16** working nodes (Code 4 → 2, Switch 3 → 1, IF 0 → 2, Respond 3 → 5); all
  workflows **66**, Switch **6**, IF **8**. Code 13 → **11** nodes, 201.6 → **198.0 KB** (budget 205 → 200 KB).
- **Deviations:** Claim Draft and Discard Draft keep `RETURNING` + `alwaysOutputData` (an empty item when no
  row was taken) instead of returning a `claimed`/`discarded` flag: the same pattern as Deliver Email's Still
  Running?, and Claim Draft's `job_id` is what today's error handler reads. Every approve answer is a
  literal HTTP 200 (Decide no longer carries `http_status`).
- **Release engineer:** no migration, credential or setting. Bubble sees the same answers.

## Step 8 — error handler by execution id, EMAIL_UNCERTAIN, alert, crash drill

- **Changed:** "BookLeaf - Error Handler" is **Error Trigger → Fail Job → Alert Set? → Send Alert** (4 working
  nodes, was 6: Has Execution?, Fetch Execution, Find Job, Job Found?, Mark Job Failed are gone). **Fail Job** runs
  `FAIL_JOB` (new `n8n/src/pipeline/sql-failures.js`) with `{execution_id, node, message}` from the Error Trigger:
  it fails the job whose `execution_id` is the failed run's, only while QUEUED/PROCESSING, as `EMAIL_UNCERTAIN`
  when the job was at stage `sending` and `INTERNAL` otherwise (`<standard message> Node "<node>": <message>`, one
  line, at most 1000 characters). It always returns exactly one row: `job_id`/`error_code` (null when no running
  job belonged to the run) plus `alert_to` (`alert_email`) and `alert_from` (`sender_name <email_from>`).
  **Alert Set?** (IF 2.2, `alert_to` not empty) → **Send Alert** (plain text, SMTP credential, one try): workflow,
  execution link, node, error, which job became FAILED with which code (or that none did), and for
  `EMAIL_UNCERTAIN` "check the inbox before sending it again". No n8n API call, no key, no `$env`.
- **Removed:** the credential key `n8nApi` ("BookLeaf n8n API (X-N8N-API-KEY)") from `CREDENTIALS`,
  `credentialData` and `deploy.mjs`; `n8n/src/pipeline/error-handler.js` (`jobIdFromExecution`,
  `internalFailureUpdate`, `JOB_ID_NODES`); the Code entry `failedJob`; the `SELF_API` constant.
- **New:** error code `EMAIL_UNCERTAIN` (HTTP 502, `retryable: false`: the email may have arrived). The `crash`
  drill (`drills.crash`, honoured only with `allow_drills`): Build Context throws `CrashDrillError` ("Failure
  drill: the workflow crashed on purpose."), so the run fails like a bug would. `DRILLS` is exported from
  `request.js`; the `allow_drills` description now lists `crash` (seed regenerated into 01 and 03 by
  `settings-seed.mjs`; 03 is not yet in production, and a stored row keeps its description: harmless). Builders:
  `sendAlert` (plain text, no error output) next to `sendEmail`, both on one `emailNode` (Deliver Email's JSON is
  unchanged).
- **Tests (written first, RED for the expected reasons):** `n8n/tests/error-handler.test.js` (9: nodes and wiring,
  no API key or `/api/v1` anywhere, Fail Job's parameter on a run failure and on a trigger failure, Alert Set?,
  Send Alert's fields evaluated like n8n for INTERNAL, EMAIL_UNCERTAIN and no job), `n8n/tests/pipeline/sql-failures.test.js`
  (4 pins), crash-drill tests (prepare, buildContext, the built Build Context node), `credentialData` without
  `n8nApi`, the drills listed in the `allow_drills` description. Real Postgres: `tests/db/failures.test.js` (5:
  INTERNAL with node text, EMAIL_UNCERTAIN at stage sending, an ended job and another execution's job untouched,
  a duplicate's execution owns no job, defaults and the 1000-character cap, empty `alert_email`). New contract
  `tests/contract/06-error-handler.test.js`: the crash drill → job FAILED `INTERNAL` naming Build Context, and the
  error handler's run (found through the n8n API by the job id) succeeded with Error Trigger → Fail Job → Alert Set?
  → Send Alert. It failed first with `unknown drill(s): crash` (old deploy), then passed after the deploy.
- **Live checks (local):** contracts 39/39 (06 adds 2); one alert email per run reaches the demo inbox
  (`alert_email` = demo inbox locally).
- **Sizes:** error-handler 6 → **4** working nodes; all workflows 66 → **64**. Code 11 → **10** nodes, 198.0 →
  **196.3 KB** (Find Job gone; Build Context +0.5 KB for the drill). Switch 6 → **4** (one expression-mode Switch left, in job-status: step 9).
- **Deviations:** Send Alert has no "continue on error" (the design said continue): a failed alert fails the error
  handler's run, which then shows red in the executions list instead of passing silently; the job was already
  failed before, so nothing depends on the alert. The alert text is built by n8n expressions in Send Alert from the
  Error Trigger (no Code node); Fail Job gives the From line and recipient from the settings. `EMAIL_UNCERTAIN` is
  not exercised live (no drill stops a run at stage `sending`); the real-Postgres test covers it.
- **Release engineer:** no migration needed beyond 03 (the regenerated 03 seed differs only in the `allow_drills`
  description). The error handler reads `alert_email`, `sender_name` and `email_from` (step 3b settings) and uses
  the SMTP credential. After the rollout, delete the credential **BookLeaf n8n API (X-N8N-API-KEY)** on each
  instance by hand, and the n8n API key it held if nothing else uses it (deploy and the contract suite still use
  the key in the env file). Rollback to the previous tag recreates and needs that credential.

## Step 9a — job-status keeps no successful run; the sweeper labels EMAIL_UNCERTAIN

- **Changed:** job-status is Job Status Webhook → Parse Query → **Query Valid?** (IF 2.2 on `ok`; was the
  expression-mode Switch `Valid?`) → Select Jobs → Shape Jobs → Respond Jobs, or Respond Rejected; its settings
  add `saveDataSuccessExecution: 'none'` (failed runs are still saved). `parseQuery` returns `ok` instead of
  `route`. The `route()` builder is deleted: every Switch left is in Rules mode with named outputs (build test).
  `SWEEP_STUCK` moved to `sql-failures.js` next to `FAIL_JOB`: a job stuck at stage `sending` becomes
  `EMAIL_UNCERTAIN` ("… It was still sending 10 minutes after it started, so it was stopped."), any other
  `TIMEOUT` (text unchanged); it now also returns `error_code`. The sweeper still runs every minute
  (`TUNING.sweepEveryMinutes`, threshold from `stuck_job_minutes`) and saves only failed runs.
- **X-BookLeaf-Key in saved executions:** n8n 2.45.4 has execution-data redaction (workflow setting
  `redactionPolicy`, `modules/redaction`), but it is licensed (`isDataRedactionLicensed`): on a Community instance
  the setting is deleted when the workflow is created or updated, and redaction only masks data when it is viewed.
  So the header cannot be kept out of saved executions here. What was done instead: job-status (the endpoint Bubble
  calls every few seconds) no longer saves successful runs; royalty-summary and approve-draft still keep the
  header in their saved runs, which only n8n users can open and which n8n prunes after 336 hours. Documented in
  `n8n/PAYLOAD.md`.
- **Tests (written first):** build tests for job-status (settings, the IF and its wiring; no expression-mode
  Switch anywhere), Parse Query's `ok`; SWEEP_STUCK pins moved to `sql-failures.test.js` plus the
  EMAIL_UNCERTAIN case; real Postgres (`tests/db/failures.test.js`, +3): TIMEOUT text, EMAIL_UNCERTAIN text, younger
  job / draft / approved draft counted from its claim. Contract 01: a new test asserts a job-status probe leaves no
  saved execution (it failed on the old deploy, execution 2795 was found); the right-key control now probes
  approve-draft, which still saves its runs.
- **Live checks (local):** contracts 40/40. A test row at stage `sending`, created 11 minutes ago, was failed by
  the sweeper within ~15 s as `EMAIL_UNCERTAIN` with the new text (row deleted afterwards).
- **Sizes:** working nodes unchanged (64; job-status 7). Switch 4 → **3** (all Rules mode), IF 9 → **10**. Code 10
  nodes, 196.3 KB.
- **Release engineer:** no migration, credential or setting. Bubble sees the same job-status answers; jobs that a
  sweep catches mid-send now read `EMAIL_UNCERTAIN` instead of `TIMEOUT`.

## Step 9b — explicit grid, section sticky notes sized from their nodes

- **Changed:** new `n8n/workflows-src/lib/canvas.mjs` replaces the depth layout in `graph.mjs` (deleted:
  `depths`, `layout`, `mainRow`) and the `note()` builder. Each workflow source now gives `grid` (node →
  `[column, row]`, 260 × 200 px cells), `sections` (`{title, text, nodes}`) and `about` (markdown).
  `placeOnGrid` fails the build for a node without a cell, two nodes in one cell or a cell naming no node.
  `sectionNotes` draws one sticky note per section around its nodes' bounding box (60 px beside, 80 px under each
  node for its name and note, a header sized to its text at the note's width by `noteHeight`) and fails the build
  for an unknown node, a node in two sections, two overlapping sections or a title equal to a node name. The
  About note sits 40 px above the highest section, from the left edge, at most 1200 px wide. build.mjs puts the
  notes first, then the nodes.
- **Sections:** royalty-summary Intake / Ledger / Data & facts / AI writer / Fact check / Render & deliver / Record
  (the lead's list); approve-draft Intake / Load & decide / Send / Discard or check; deliver-email Save / Send once
  / Record; job-status Intake / Answer; error-handler Fail the job / Alert; sweeper Sweep. job-status and the
  sweeper got About notes. An empty column separates neighbouring sections; a section under another starts two
  rows lower (approve-draft's Discard or check, royalty-summary's Record).
- **approve-draft's Action** outputs are now in the order Send / Discard / Answer, so the top output feeds the
  main row (the send path) and no edge crosses it. Behaviour is unchanged (Rules mode matches by value).
- **Node notes added:** Select Jobs "html only with include=html", Sweep Stuck Jobs "TIMEOUT or EMAIL_UNCERTAIN".
  deliver-email's edges now name their outputs (`'true'`, `'false'`, `'error'`); its JSON connections are unchanged.
- **Tests (written first):** `n8n/tests/canvas.test.js` (unit: grid, section boxes and every build error,
  `noteHeight`; every workflow: each node on its own cell, inside exactly one section note, no two notes
  overlapping, About above all sections; royalty-summary's section titles left to right; job-status,
  error-handler and sweeper read left to right on row 0). approve-draft tests updated for the Action order.
- **Live checks (local):** contracts 40/40 after the deploy. Canvas screenshots in the n8n editor (ego-browser
  TaskSpace 7, closed afterwards; files in the scratchpad, not committed): royalty-summary reads left to right on
  row 0 with seven titled sections and the failure branches below; approve-draft's send path on row 0 with
  Discard or check below Send; note titles and text readable when zoomed in.
- **Sizes:** unchanged (64 working nodes, 10 Code nodes, 196.3 KB); 6 + 14 sticky notes (About + sections).
- **Deviations:** the About note is capped at 1200 px instead of spanning the whole canvas (a 5,900 px line is not
  readable). Long edges remain where several branches meet one node (the Record section, AI Failed).

## Step 10 — import-ready export, docs, size budget

- **Changed:** new `n8n/tools/export.mjs` (`node n8n/tools/export.mjs --env .secrets/n8n-local.env`) reads the six
  BookLeaf workflows from an n8n's public API and writes `n8n/export/<source>.json`: `id`, `name`, `active: false`,
  `nodes` (every credential `id` set to `null`, name and type kept), `connections`, `settings`, `pinData: {}`;
  no version, owner, tags or static data. It stops when a workflow is missing or two share a name. Workflow ids
  are kept, so the `errorWorkflow` settings and the Deliver Email calls point at workflows in the export. The
  committed export was produced from the LOCAL deployment.
- **Found and fixed:** n8n gives every Send Email node a `webhookId` and invents a new one whenever a save lacks
  it, so each deploy changed the three email nodes. `emailNode` now sets a fixed one (`stableUuid('emailSend/<name>')`):
  the deployed workflows equal the build again.
- **Tests:** `n8n/tests/export.test.js` (written first; failed with ENOENT, then on the email nodes' `webhookId`):
  `exportable()` keeps only the importable fields and nulls credential ids without touching its input; the export
  holds exactly the six workflows and matches the committed build (credential placeholders → `null`, workflow
  placeholders → the exported ids), so a forgotten re-export fails `npm test`; cross-workflow references resolve
  inside the export; a secret scan (no credential id, API-key or private-key shapes, no `password`/`token`/
  `secret`/`apiKey` fields, no email address, no pinned or static data, and none of the values in the local
  `.secrets/webhook.env`, `.secrets/n8n-local.env` and `.env`, checked without printing them).
- **Import checked:** `n8n import:workflow --separate --input=/import` in a throwaway `n8nio/n8n:2.45.4`
  container (no network, its own database, deleted afterwards) imported all 6 with their ids, inactive. Credential
  linking was read in n8n's source, not exercised (the throwaway had no credentials): `replaceInvalidCredentials`
  (`dist/workflow-helpers.js`, called by `commands/import/workflow.js`) gives a node whose credential id is `null`
  the one credential of that name and type in the project; with none or several it stays unlinked.
- **Docs:** `docs/integration.md` rewritten for the current design (pull only; contract with author/books and 403;
  lifecycle with drafts; enqueue function; Deliver Email; the six workflows; the export and how to import it;
  push left as the paid-plan upgrade path in PAYLOAD.md). `docs/error-handling.md` rewritten: every failure with
  its real code and behaviour (retries 2 × 2 s, one rewrite, one SMTP try, error workflow by execution id,
  `EMAIL_UNCERTAIN`, sweeper every minute), the five drills, the test suites. No `{{TODO}}`/`{{VERIFY}}` left in
  either. README's doc index line updated. PAYLOAD.md was brought up to date in steps 8 and 9a.
- **Size budget:** `code-size.test.js` total 200 → **198 KB** (measured 196.3 KB), per node 40 → **36 KB** (largest
  34.2 KB, Check Rewrite).
- **Gates (final tree):** npm test 522/522 (39 files), `build.mjs --check` clean, test:db 42/42, contracts 40/40
  on the local n8n.

## Summary of the clean-up (main @ f57df75 → this branch)

| Workflow | Working nodes before → after | Code nodes | Code KB |
|---|---|---|---|
| Royalty Summary | 45 → 27 | → 6 | 145.7 |
| Approve Draft | 20 → 16 | → 2 | 45.4 |
| Deliver Email | new → 8 | 0 | 0 |
| Job Status | 7 → 7 | 2 | 5.2 |
| Error Handler | 6 → 4 | 1 → 0 | 0 |
| Stuck Job Sweeper | 2 → 2 | 0 | 0 |
| **All** | **80 → 64** | **23 → 10** | **415.1 → 196.3** |

Switch 17 → 3 (all Rules mode with named outputs), IF 0 → 10. Largest Code nodes: Check Rewrite 34.2, Check Draft
34.1, Decide 31.9, Prepare Job 29.1, Build Context 26.8 KB.

**Release engineer, in order (production; done by the lead):** migration 03 (`scripts/ops/migrate-prod.sh`,
backs up first) → production settings SQL (step 3b) → `n8n/deploy.mjs` with the current `BOOKLEAF_WEBHOOK_KEY`
(creates "BookLeaf Webhook Key", publishes Error Handler and Deliver Email first) → contracts against production →
remove `N8N_BLOCK_ENV_ACCESS_IN_NODE` from the box's compose and restart (step 3e) → contracts again and a Bubble
smoke test → after the rollback window, delete the credentials "BookLeaf n8n API (X-N8N-API-KEY)", "BookLeaf
Bubble API (bearer)" and "BookLeaf Webhook Key (X-BookLeaf-Key)" by hand. `n8n/export/` holds local workflow ids:
a deploy to another instance should use `deploy.mjs`, an import there keeps those ids.

---

# Inspection 2 fixes (score 7.8) — one entry per commit

## Fix 1 — the database makes the job id and the fingerprint; Prepare Job split in two (HIGH: Code-node size)

- **Changed:** `enqueue_royalty_job` (migration 03, mirrored in 01) now makes the job id (`gen_random_uuid()`) and the
  fingerprint: SHA-256 hex of the `fingerprint_of` object as `jsonb::text`, which Postgres prints canonically (keys
  sorted, fixed spacing), so key order never matters. Input: `fingerprint_of` (required JSON object) replaces
  `job_id` and `fingerprint`. Deleted: `n8n/src/pipeline/sha256.js` (hand-written SHA-256), `canonical.js`,
  `uuidV4` in `ids.js` (only the UUID regex is left) and their test. `stableUuid` in the build uses `node:crypto`.
- **Prepare Job → Check Settings + Settings OK? + Validate Body** in Royalty Summary; Approve Draft gets the same
  Check Settings + Settings OK? before Parse Request. Bad settings (500) and a bad body (400) are now two visible
  branches into Respond Rejected. Build Context takes the job id from Enqueue Job and passes `job` on; every later
  node reads the job from Build Context.
- **Tests (written first, RED):** prepare (no id/fingerprint on the job, `fingerprint_of` fields), ledger pins
  (id and hash made in SQL after the lock), workflow wiring of both workflows, Check Settings in both workflows,
  Build Context with the Enqueue Job id; real Postgres: a made v4 id, the stored fingerprint equals Postgres's
  SHA-256 of the data, the same data in another key order is a duplicate, `fingerprint_of` must be an object.
  `queuedJob()` fixture (`n8n/tests/pipeline/job-fixture.js`) replaces `fixedRandom`.
- **Gates:** npm test 516/516, build --check clean, test:db 43/43, contracts 40/40 on the local n8n (03 re-applied
  to the local `bookleaf` database first: re-runnable, only the function changed).
- **Sizes:** working nodes 64 → 68 (royalty-summary 29, approve-draft 18). Code 10 → 12 nodes, 196.3 → 197.8 KB:
  Validate Body 17.9 KB (Prepare Job was 29.1), Check Settings 10.0 KB ×2. Further cuts follow in later fixes.
- **Release engineer:** 03 is not in production yet, so it was edited in place (its function is `CREATE OR
  REPLACE`; re-running it on a database that already has 03 updates the function only). Workflows and 03 must go
  out together: the new workflows send `fingerprint_of`, which the old function refuses, and vice versa.

## Fix 2 — one Write Draft sub-workflow; AI retries only what can pass; named fallback outputs (MEDIUM ×2, LOW)

- **Changed:** new sub-workflow **BookLeaf - Write Draft** (`n8n/workflows-src/write-draft.mjs`, 9 nodes): When
  Called (job, ctx, request, attempt, previous) → Call Anthropic → Anthropic Answer (Switch: Answer / Retry /
  Fallback) → Wait (Anthropic) loops back, Fallback → Call OpenAI (fallback) → OpenAI Answer (Answer / Retry /
  Give up) → Wait (OpenAI) loops back, Give up → AI Failed; both Answers → Check Draft. Royalty Summary calls it as
  **Write Draft** (attempt 1, the context's requests) and **Rewrite Draft** (attempt 2, the checker's requests, the
  first draft's usage). Gone from Royalty Summary: the four HTTP nodes, Check Draft, Check Rewrite (byte-identical
  copies), AI Failed and its `$('Stage: Rewriting').isExecuted` lookup.
- **Retries:** the HTTP nodes no longer use n8n's retry. They return the full answer whatever the status
  (`fullResponse` + `neverError`); a request with no answer (timeout, refused) goes to the error output. Both go
  to the answer Switch: 2xx → Answer; 429, 5xx or no answer, with tries left → Retry (Wait: Retry-After when sent,
  else 2 s doubling, at most 10 s); anything else (400/401/404: a bad key, the drills' missing model) → straight
  to the fallback. `TUNING` moved to `n8n/src/pipeline/tuning.js` (fix 5 reads it in `readSettings`):
  `aiRetries` 2 → **1**, `aiRetryBaseSeconds` 2, `aiRetryMaxWaitSeconds` 10.
- **Named fallback outputs (LOW):** every Switch now has `fallbackOutput: 'extra'` with a name. Outcome →
  `Unexpected` → **Respond 500** (INTERNAL); Draft OK? → `Unexpected` → **Stop: Unexpected** (Stop and Error: the
  error workflow fails the job); approve-draft's Action → `Unexpected` → **Respond 500**.
- **Builders:** `switchRules(name, left, cases, fallback)` and `switchWhen(name, cases, fallback)` share one
  `switchNode`; `http()` always returns the full answer and never retries; new `wait()` (fixed `webhookId`) and
  `stopAndError()`; `executeWorkflow()` takes one expression per input; graph.mjs resolves a fallback output by name.
  `nodeErrorSummary` reads a full answer (`404 model: x`).
- **Tests (written first):** `n8n/tests/write-draft.test.js` (inputs, one copy of each node, no node-level retry,
  wiring of both outputs, each Switch's routing for 200/429/5xx/529/timeout/4xx and with no tries left, the wait
  for each case, Check Draft for draft and rewrite, AI Failed for both); royalty-summary and approve-draft wiring
  and fallback outputs; no HTTP node outside Write Draft; `nodeErrorSummary` of a full answer (RED first).
- **Live checks (local):** contracts 40/40. In Write Draft's executions the `ai_down` drill now ends in 1.5 s
  (Anthropic 404 → OpenAI 404 → AI Failed, no waits; before: 3 tries × 2 s per provider) and `primary_down` goes
  Anthropic → OpenAI → Check Draft. The Retry/Wait path is covered by unit tests only (no drill makes a provider
  answer 5xx); n8n sleeps inside the execution for a time-interval Wait under 65 s (`MAX_IN_PROCESS_WAIT_MS`,
  `base-execute-context.js putExecutionToWait`), so no resume webhook or saved waiting execution is involved.
- **Sizes:** working nodes 68 → 75 (royalty-summary 26, approve-draft 19, write-draft 9). Code 12 → 11 nodes,
  197.8 → **164.2 KB** (the second 34 KB fact-check copy is gone).
- **Deviations:** the design's AI retries (2 × 2 s on any error) became 1 retry on transient errors only, because
  the fallback provider is the real second chance and fix 5 checks the worst-case AI time against
  `stuck_job_minutes`. Each Write Draft call is its own execution (saved like any other).
- **Release engineer:** a new workflow, **BookLeaf - Write Draft**; deploy.mjs publishes it before Royalty Summary
  (it uses the existing Anthropic and OpenAI credentials). No migration or setting.

## Fix 3 — a database failure before the answer gives Bubble a shaped 503 (MEDIUM)

- **Changed:** new error code `DB_UNAVAILABLE` (HTTP 503, `retryable: true`). Every Postgres node that runs before
  a webhook has answered sends its errors to a **Respond 503** node: royalty-summary Load Settings and Enqueue Job;
  approve-draft Load Settings, Load Draft, Discard Draft and Claim Draft; job-status Select Jobs. Nodes after the
  answer keep failing the run, so the error workflow handles them. `pg()` takes `{ alwaysOutputData, errorOutput }`.
- **Found and fixed while testing it live:** a Respond node whose body was `={{ <JSON> }}` broke in n8n ("invalid
  syntax"): a JSON object ends in `}}`, which closes the n8n expression early. The unit helper `evaluate()` had
  accepted it. Fixed bodies (Respond 503, both Respond 500 of fix 2) now use the new `respondFixed()` (literal JSON,
  numeric status, no expression); `evaluate()` now refuses an expression holding `}}` before its end, and a build
  test scans every parameter of every workflow for it.
- **Builders:** email and sub-workflow builders moved to `n8n/workflows-src/lib/flow-nodes.mjs` (nodes.mjs was
  near the 200-line limit).
- **Tests (written first):** `n8n/tests/database-down.test.js` (wiring of each node, the 503 body, nodes after the
  answer have no error output), the expression scan, updated node counts. New contract
  `tests/contract/07-database-down.test.js`: holds the enqueue advisory lock for 8 s, so Enqueue Job fails after its
  5 s `lock_timeout`; the webhook answers 503 DB_UNAVAILABLE. It runs only against a localhost n8n (it needs the
  local Postgres container and must never hold up production's database).
- **Live checks (local):** before the fix the same request got n8n's `500 {"message":"Error in workflow"}`; after
  it, `503 DB_UNAVAILABLE` in 5.2 s. Contracts 41/41.
- **Sizes:** working nodes 75 → 78 (royalty-summary 27, approve-draft 20, job-status 8). Code unchanged in count
  (11), 165.4 KB (the error catalog grew by one entry in every bundle that carries it).
- **Deviations:** none from the inspector's fix. The 503 run counts as a success in n8n (it answered), so no alert
  is sent for it; with the database down, the sweeper's runs fail every minute and alert (fix 6).
- **Release engineer:** none (no migration, credential or setting). Bubble's API Connector already treats a non-2xx
  answer as an error; the body has the documented `{error:{code,message,retryable}}` shape.

## Fix 4 — database writes that are safe to repeat retry (MEDIUM)

- **Changed:** `pg()` takes `retry: true`: `retryOnFail`, `TUNING.dbRetries + 1` = **3** tries, `TUNING.dbRetryWaitMs` =
  **1 s** apart. Retried: the reads (both Load Settings, Load Draft, Select Jobs) and every write guarded by the
  job's status, where a second run changes nothing more: Mark Processing, Stage: Rewriting, Record Result, Mark
  Sending, Mark Sent, Mark Failed, and the error handler's Fail Job. Deliberately run once: Enqueue Job (a retried
  insert would answer as a duplicate of itself and the job would never be processed), Claim Draft and Discard Draft
  (a retry would find the draft gone and answer ALREADY_SENT / NOT_A_DRAFT), and the sweep (it runs every minute).
  So one dropped connection after a successful Send Email no longer turns a sent email into `EMAIL_UNCERTAIN`.
- **Tests (written first, RED):** `n8n/tests/database-retries.test.js` classifies every Postgres node of every
  workflow as retried or not, so a new node must be decided on.
- **Gates:** npm test 540/540, build --check clean, contracts 41/41.
- **Local environment:** the contract suite had been run five times inside one hour and hit `max_sends_per_hour`
  (60): `max_sends_per_hour` is now **300 on the local database only** (one UPDATE of `bookleaf_settings`), so
  repeated local runs pass. Production keeps its own value.
- **Sizes:** unchanged (78 working nodes, 11 Code nodes, 165.4 KB).

## Fix 5 — the AI worst case is checked against stuck_job_minutes; n8n ends a run itself (MEDIUM)

- **Changed:** new `n8n/src/pipeline/settings-timing.js`: `worstCaseAiMs(settings)` = 4 AI calls (draft and rewrite
  × two providers) × ((`aiRetries` + 1) × `ai_timeout_ms` + `aiRetries` × the 10 s wait cap) = **400 s** with the
  defaults. `readSettings` now refuses settings (500 INTERNAL, "Server settings do not fit together: …") unless that
  worst case plus a 60 s margin fits within both `stuck_job_minutes` and the run timeout. New `TUNING.runTimeoutSeconds`
  = **600**, set as n8n's `executionTimeout` on Royalty Summary and Write Draft, so n8n stops a run that is still
  going (and stops paying for AI calls). With the defaults the largest `ai_timeout_ms` that fits is 62 500 ms; the
  two setting descriptions say so (seed regenerated into 01 and 03; stored rows keep their old description text).
- **What a timed-out run does (read in n8n 2.45.4's source, not exercised live: it needs a 10-minute run):**
  `workflow-runner.js` stops the execution at `executionTimeout`; the stop is recorded as the run's error, so
  `execute-error-workflow.js` starts the Error Handler, which fails the job (`INTERNAL`, or `EMAIL_UNCERTAIN` at stage
  `sending`). The sweeper remains the safety net.
- **Tests (written first, RED):** `n8n/tests/pipeline/settings-timing.test.js` (the formula, the defaults fit, a
  120 s AI timeout refused with stuck 10 and with stuck 60 because of the run timeout, stuck 5 refused); build test
  for `executionTimeout` on both workflows.
- **Gates:** npm test 546/546, build --check clean, contracts 41/41. One run of the suite before that had one
  failure: the `primary_down` job's OpenAI draft wrote a bare "2025" twice and the fact checker failed it
  (`AI_FACT_CHECK_FAILED`), an AI-output flake unrelated to this change; the rerun passed.
- **Deviations:** none from the inspector's fix; the run timeout is build-time (n8n workflow settings cannot be
  expressions), so raising `ai_timeout_ms` past 62.5 s needs `stuck_job_minutes` and `TUNING.runTimeoutSeconds` raised
  together (rebuild and redeploy).
- **Release engineer:** production's stored `ai_timeout_ms` and `stuck_job_minutes` must fit (the defaults do). If
  production holds other values, check them first: a misfit makes every request answer 500 until fixed.

## Fix 6 — the alert reaches someone when the database is down; the sweeper and job-status have an error workflow (MEDIUM)

- **Changed:** error-handler is Error Trigger → Fail Job (3 tries, error output) → **Alert Address** (new Code node,
  2.6 KB) → Alert Set? → Send Alert; Fail Job's error output also goes to Alert Address. Alert Address
  (`n8n/src/pipeline/alert-cache.js`) keeps `alert_to`/`alert_from` of every answered Fail Job in the workflow's
  static data (`$getWorkflowStaticData('global')`, which n8n saves after each non-manual run); when Fail Job could not
  reach the database it alerts that last known address, with a line saying the database was down, at most once every
  `TUNING.dbDownAlertEveryMinutes` = **15** minutes. Job Status and the Stuck Job Sweeper now name the Error Handler as
  their error workflow (the two sub-workflows still have none, by design).
- **Deviation from the immutability rule:** `alertAddress` changes the static-data object in place; that is n8n's
  API for it (a new object would not be saved). Documented on the function.
- **Tests (written first, RED):** error-handler wiring, Fail Job's error output and retry, Alert Address remembering,
  using and throttling the address, no address before any was seen, the alert text for a database outage, the error
  workflow of every top-level workflow; contract 06 expects Alert Address in the path with the remembered address.
- **Live checks (local):** after a crash-drill run the Error Handler's static data held `alert_to`/`alert_from`
  (read through the n8n API, values not printed) and survived the next deploy. Outage: `royalty_jobs` renamed for
  85 s on the local `bookleaf` database: the sweeper's run failed (`relation "royalty_jobs" does not exist`), the
  Error Handler ran (Fail Job 3 tries, 6.0 s) and Alert Address sent the alert to the remembered address. That run
  showed n8n's real error-item shape (`{message, error:{…}}`, the message beside the error object), so the message
  read "unknown database error"; fixed and pinned with that shape in the unit test. Table renamed back (455 rows).
  Contracts 41/41.
- **Sizes:** working nodes 78 → 79 (error-handler 5). Code 11 → 12 nodes, 172.7 KB (Check Settings also grew by the
  timing check of fix 5).
- **Release engineer:** after the first successful Error Handler run on an instance the address is remembered; until
  then a database outage alerts nobody. Static data survives a redeploy through the public API (seen locally).

## Fix 7a — Code nodes carry only what they run (HIGH, part 2 of 4)

- **Changed:** the settings checks moved to `n8n/src/pipeline/settings-checks.js` (`SETTING_CHECKS`, `settingProblem`,
  `readSettings`); `settings.js` keeps the defaults and descriptions (the seed tool and tests use them) and takes each
  `check` from `SETTING_CHECKS`. Check Settings no longer carries 16 descriptions: 11.0 → **9.0 KB** (×2). esbuild now
  treats `Object.freeze(...)` as pure, so a frozen constant a node never reads is dropped (AI Failed 9.9 → **5.6 KB**:
  no provider parser left in it); a test keeps `n8n/src` free of bare-statement `Object.freeze(x)` calls, which a pure
  marking would drop.
- **Tests (written first, RED):** `SETTING_CHECKS` keys and identity with the schema's checks; Check Settings has no
  description text and is under 10 KB; AI Failed has no provider parser; the bare-freeze scan; total budget 198 →
  165 KB, per node 36 → 35 KB.
- **Gates:** npm test 555/555, build --check clean, test:db 43/43, contracts 41/41.
- **Sizes:** 12 Code nodes, 172.7 → **160.6 KB**.

## Fix 7b — Read Answer apart from Check Draft; Check Edit apart from Decide (HIGH, part 3 of 4)

- **Changed:** `afterAi` is now two steps, each its own Code node in Write Draft: **Read Answer** (`readAnswer`: which
  provider answered, its sections, usage and cost; needs no context; 7.5 KB) and **Check Draft** (`checkAnswer`: the
  fact check and the pass / rewrite / fail decision; 34.3 → 28.0 KB). `afterAi` stays as their composition for the
  tests and the callers that hold a whole answer. In Approve Draft, **Check Edit** (`editCheck`: the same fact checker
  over the edited text, only for a fresh draft that is checked or sent; 20.7 KB) now runs before **Decide** (31.8 →
  13.4 KB), which only renders and works out the answers. The approve pipeline test used `fixedRandom`, removed in
  fix 1 (the import came back `undefined`); it now uses `queuedJob`.
- **Tests (written first, RED):** `readAnswer` + `checkAnswer` equal `afterAi` for a pass, a rewrite and an unreadable
  answer; Read Answer carries no checker and Check Draft no provider parser; `editCheck` runs only when needed;
  wiring and node counts; per-node budget 35 → **29 KB**.
- **Gates:** npm test 559/559, build --check clean, contracts 41/41.
- **Sizes:** working nodes 79 → 81 (write-draft 10, approve-draft 21); Code 12 → 14 nodes, 164.2 KB. Largest now:
  Check Draft 28.0, Build Context 27.0, Check Edit 20.7, Validate Body 18.1 KB (was 34.9 / 35.0 / 32.7 / 29.8).

## Fix 7c — job-status answers from one SQL query (HIGH, part 4 of 4; LOW "two Code nodes per poll")

- **Changed:** `SELECT_JOBS` returns one row, `response = {jobs, missing}`: the ids come from `$1->'ids'` WITH
  ORDINALITY, so the jobs keep the order asked and an unknown id lands in `missing`; timestamps are written as
  JavaScript's `toISOString()` writes them (UTC, milliseconds; null stays null); `cost_usd` is a number; html and
  text_body are left out unless `include_html`. **Shape Jobs** (Code) is gone, with `shapeJobs` and `respondJobs`:
  job-status is Job Status Webhook → Parse Query → Query Valid? → Select Jobs → Respond Jobs (`200`, `$json.response`),
  or Respond Rejected / Respond 503. Select Jobs no longer needs `alwaysOutputData` (it always returns one row). A poll
  now runs one Code node (Parse Query). Every job-status field and the answer shape are unchanged for Bubble (the
  JSON key order inside a job is Postgres's, which JSON readers ignore).
- **Tests (written first, RED):** `tests/db/status.test.js` runs the query on real Postgres: order, `missing`, the
  exact field list, ISO timestamps (`2026-11-12T09:00:02.250Z`), numbers, nulls, html only on request, empty lists;
  build test: one Code node, Respond Jobs answers `$json.response` with 200. The `shapeJobs` unit tests are removed
  with the function.
- **Gates:** npm test 557/557, build --check clean, test:db 47/47, contracts 41/41 (job-status contracts unchanged).
- **Sizes:** working nodes 81 → **80** (job-status 7); Code 14 → **13** nodes, 164.2 → **162.7 KB**; total budget
  165 → 163 KB.

## Fix 8 — CI (MEDIUM "no CI")

- **Changed:** `.github/workflows/ci.yml` runs on every push to `main` and `refactor/**` and on pull requests:
  `npm ci` → `npm test` → `node n8n/build.mjs --check` → `npm run test:db` against a `postgres:16-alpine` service
  (the image the local stack runs). Read-only token, 15-minute limit, one run per branch at a time. The real-Postgres
  tests no longer need the local container: `tests/db/pg-command.js` runs psql and pg_dump through `docker exec`
  by default, or directly when `BOOKLEAF_PG_DIRECT=1` (CI sets it with `PGHOST`/`PGPORT`; any other value is refused).
- **Not in CI, on purpose:** the contract suite. It needs a live n8n with the workflows deployed, the webhook key, AI
  keys and SMTP, and it spends real AI calls; CI would need those secrets in GitHub. It stays a local gate, run
  before every commit on this branch (41/41 at each commit above).
- **Tests (written first, RED):** `tests/infra/ci.test.js`: the workflow exists, its steps run in order, Postgres 16
  matches the local stack, read-only, no contract step and no secrets; `pgCommand` picks docker or direct and
  refuses an unknown value.
- **Gates:** npm test 564/564, build --check clean, test:db 47/47, contracts 41/41.
- **First run on GitHub:** green in 1 m 11 s (unit 43 files, ledger SQL 7 files on Postgres 16.15). It warned that
  `actions/checkout@v4` and `actions/setup-node@v4` run on the deprecated Node 20, so both moved to `@v5`.

## Fix 9 — a failed job that reached the AI counts toward the hourly cap (LOW)

- **Changed:** `enqueue_royalty_job` counts every job of the last hour except discarded ones and failures with
  `ai_attempts = 0` (bad data, a database or setting failure before any AI answer). A job that failed after the AI
  answered (fact check failed, email failed, a rewrite that failed) spent money and may have sent mail, so retrying it
  can no longer get round `max_sends_per_hour`. Discarded drafts still do not count: discarding is the admin's own
  choice, and the slot is theirs to reuse. Both `03-settings-enqueue.sql` (not yet in production) and the fresh
  install changed; the setting description, the seed and `n8n/PAYLOAD.md` say the same.
- **Tests (written first, RED):** a failed job with `ai_attempts = 2` takes a slot; a failure with 0 and a discarded
  draft with 1 do not; the schema pin.
- **Local:** migration 03 re-applied to the local `bookleaf` database (re-runnable; the stored setting rows are kept,
  so the local description row still has the old text). 104 jobs counted in the last hour against the local 300.
- **Gates:** npm test 564/564, build --check clean, test:db 48/48, contracts 41/41.

## Fix 10 — Mark Sending writes only the email and the AI usage (LOW "Deliver Email trusts the caller's record")

- **Changed:** Mark Sending uses its own query, `MARK_SENDING`, instead of the general `UPDATE_JOB`. Its column list
  (`jsonb_to_record … AS p(job_id, subject, html, text_body, author_code, figures_verified, ai_attempts, provider,
  model, input_tokens, output_tokens, cost_usd)`) is all it can write, and it sets stage `sending` itself. A caller's
  `record` naming `status`, `error_code`, `error`, `sent_to`, `stage` or `edit_text` now changes nothing. Same
  guard as before: no row once the job has ended, so nothing is sent.
- **Tests (written first, RED):** real Postgres: a forged record leaves status PROCESSING, no error, no recipient;
  the SQL pin (nothing but the email and usage columns before `WHERE`); Mark Sending's node uses `MARK_SENDING`.
- **Gates:** npm test 565/565, build --check clean, test:db 49/49, contracts 41/41 (send, draft-approve and
  email-failed contracts unchanged).

## Fix 11 — coloured sticky notes (LOW)

- **Changed:** `lib/canvas.mjs` gives every note a colour from n8n's palette (`STICKY_COLORS`, read from the n8n
  2.45 editor's styles: 3 red, 5 blue, 6 purple, 7 neutral). The About note is blue; a section is neutral unless its
  `tone` is `ai` (purple: the AI writer in Royalty Summary and Write Draft, where the money is spent) or `failure`
  (red: both Error Handler sections). An unknown tone fails the build. Only the sticky notes changed; no working node
  moved.
- **Tests (written first, RED):** the palette, tone → colour, the unknown-tone error; every note in every built
  workflow has a palette colour and About is blue; the AI and error-handler sections. The export test confirms n8n
  kept the colours after the deploy.
- **Gates:** npm test 574/574, build --check clean, test:db 49/49, contracts 41/41.

## Fix 12 — EMAIL_UNCERTAIN exercised end to end (LOW)

- **Added:** `tests/contract/08-stuck-jobs.test.js` (local stack only, like contract 07). It writes two PROCESSING
  jobs, last moved 30 minutes ago, straight into the local `bookleaf` database: one at stage `sending`, one at
  `writing`. The live Stuck Job Sweeper fails them on its next run and job-status shows what Bubble would see:
  `EMAIL_UNCERTAIN` ("… may or may not have arrived … It was still sending 10 minutes after it started …") and
  `TIMEOUT`. It passed on the first run (13 s): this covers behaviour that was already right but only unit- and
  SQL-tested. The jobs are FAILED with no AI attempt, so they do not take hourly-cap slots.
- **Gates:** npm test 574/574, build --check clean, contracts **42/42**.

## Not fixed on purpose (inspection 2)

- **Per-node Code budget is 29 KB, not the suggested ~20 KB.** Three nodes are over 20 KB: Check Draft 28.0 KB
  (Write Draft), Build Context 27.0 KB (Royalty Summary) and Check Edit 20.7 KB (Approve Draft). Each is one piece of
  domain logic with nothing left to move out: Check Draft and Check Edit are the fact checker (every figure in the
  email matched to the data, words to numbers, Indian grouping, dates), and Build Context holds the system prompt and
  the facts it is built from. Splitting the checker over two Code nodes would pass half-checked state between them and
  make a failure harder to read. Minifying was also rejected: whitespace and names are only about 20% of the size,
  and a minified node cannot be read in the n8n editor, which is where an operator looks when a job fails. The budget
  test keeps the numbers from growing (total 163 KB, per node 29 KB).
- **Approve Draft's claim sets stage `sending` before Deliver Email's Mark Sending does.** The stage names are part
  of the Bubble contract (queued … discarded) and there is no "approved" stage to use instead. The claim runs
  directly before the Deliver Email call, so the window is milliseconds. If the run dies in that window, the sweeper
  labels the job `EMAIL_UNCERTAIN` ("check the inbox"), which is the safe answer: it never claims an email was sent.
- **Some values are still written in code:** `MAX_IDS` = 50 (job-status), the one-hour window of
  `max_sends_per_hour`, and the brand colours of the email. The first two are part of the API Bubble calls (the
  limit is documented in `n8n/PAYLOAD.md`; "per hour" is in the setting's name), so making them settings would let an
  environment silently break the contract. The colours are the email's design, changed with the template and its
  tests, not per environment.

## Summary of inspection 2 (commits c321bf6 to 25e56e1)

- **HIGH (Code-node size):** fixes 1, 7a, 7b, 7c. The id and fingerprint moved into Postgres; Prepare Job, After AI and
  Decide were split; the settings descriptions and unread constants left the bundles; Shape Jobs became SQL. Code:
  10 nodes / 196.3 KB at the start of inspection 2 → **13 nodes / 162.7 KB**, largest 34.9 → **28.0 KB**; a poll of
  job-status runs one Code node.
- **MEDIUM:** one Write Draft sub-workflow (fix 2), a shaped 503 (fix 3), database retries (fix 4), the AI worst case
  checked against `stuck_job_minutes` plus a 600 s `executionTimeout` (fix 5), an alert that works with the database
  down and error workflows on the sweeper and job-status (fix 6), AI retries only for 429 / 5xx / timeouts (fix 2),
  CI on GitHub Actions (fix 8, green on its first run).
- **LOW:** named fallback outputs on every Switch (fix 2), one Code node per poll (fix 7c), failed jobs that reached
  the AI count toward the cap (fix 9), Mark Sending writes only the email and usage (fix 10), coloured sticky notes
  (fix 11), EMAIL_UNCERTAIN exercised end to end (fix 12). Not fixed, with reasons above: the claim stage and the
  hardcoded values.
- **Workflows:** 80 working nodes: royalty-summary 27 (4 Code), approve-draft 21 (4), write-draft 10 (3),
  deliver-email 8 (0), job-status 7 (1), error-handler 5 (1), sweeper 2 (0).
- **Bubble contract:** unchanged. Same webhook paths, `X-BookLeaf-Key`, 202 / 200 duplicate / 429 bodies, job-status
  fields, approve answers and stage names. New, additive: a 503 `DB_UNAVAILABLE` body when the database is down.
- **Gates at the end:** npm test 574/574, build --check clean, test:db 49/49, contracts 42/42 on the local n8n,
  GitHub Actions green.
- **Release engineer:** migration 03 (edited in place; not yet in production) and the workflows go out together.
  After the first Error Handler run on an instance the alert address is remembered for database outages. The local
  `max_sends_per_hour` is 300 (local database only).

---

# Security review fixes — one entry per commit

## Security fix 1 — emails go only to a configured demo inbox (HIGH: the caller chose the recipient)

- **Changed:** new per-environment setting `allowed_demo_inboxes` (a list of up to 20 email addresses, default `[]`,
  checked like the other settings). `recipientFor` (`n8n/src/pipeline/recipient.js`) now uses the request's
  `demo_inbox` only when it equals, ignoring case and spaces, `default_demo_inbox` or an entry of
  `allowed_demo_inboxes`, and then sends to the configured spelling. Any other address is refused with the new
  error code `RECIPIENT_NOT_ALLOWED` (422, `retryable: false`); the message names the two settings and no address.
  It is never redirected to the default inbox. No `demo_inbox` → `default_demo_inbox`; none at all → `NO_RECIPIENT`
  as before. The author-address guard still runs after the allow check, so an author address is refused even if it
  is configured. Approve keeps using the recipient stored on the job.
- **Settings tool:** `n8n/tools/settings-sql.mjs` accepts `ALLOWED_DEMO_INBOXES` as a comma-separated list (entries
  trimmed, empty entries dropped, an empty value = no entries); a bad entry names the variable, never the value.
  Seed regenerated into 03 and 01 by `settings-seed.mjs`; the 03 header lists the new per-environment key.
- **Docs:** `n8n/PAYLOAD.md` (the `demo_inbox` rule, the 422 answer, the error code, the settings table),
  `docs/integration.md` (contract summary), `docs/error-handling.md` (failure table).
- **Tests (written first, RED for the expected reasons):** recipient rules (allowed default and list, case and
  spaces, refusal for three setting shapes with no address in the message, `NO_RECIPIENT`, the author guard on an
  allowed address), `prepareJob` refuses with no job, the schema and check (`must be a list of email addresses`,
  at most 20), `settings-sql` list parsing and refusal; real Postgres: the list written by the tool is a JSON array
  that `bookleaf_setting()` reads, and a fresh install seeds `[]`. New contract `tests/contract/09-recipient.test.js`:
  an outside `demo_inbox` → 422 `RECIPIENT_NOT_ALLOWED` without the address in the message, and (local stack) no
  job row with the request's log id. It was not run against the old deploy on purpose: the old workflow would have
  emailed the outside address.
- **Local:** backup (`pg_dump` to the scratchpad), then 03 re-applied to the local `bookleaf` database: the seed added
  `allowed_demo_inboxes = []` and changed no other row. The contract suite sends to the local `default_demo_inbox`, so
  no allowed list is needed locally. Deployed with `node n8n/deploy.mjs --env .secrets/n8n-local.env`, exported with
  `node n8n/tools/export.mjs --env .secrets/n8n-local.env`.
- **Gates:** npm test 585/585, build --check clean, test:db 50/50, contracts 43/43.
- **Sizes:** working nodes unchanged (80). Code 13 nodes, 162.7 → **165.1 KB**: the new error code is in the shared
  error catalog that most Code nodes carry, and Check Settings carries the list check (9.0 → 9.5 KB ×2). Total budget
  raised 163 → **166 KB** (+3 KB); per node unchanged (29 KB).
- **Release engineer:** `readSettings` needs every key, so 03 (which seeds `allowed_demo_inboxes = []`) must be applied
  before these workflows, as already planned. Write `DEFAULT_DEMO_INBOX` with the address Bubble's Settings
  "Demo inbox" holds in production. If Bubble may send any other inbox, list it in `ALLOWED_DEMO_INBOXES`
  (comma-separated) in the same env file for `settings-sql.mjs`; otherwise leave it out (empty list). A Bubble send to
  an inbox on neither gets 422 `RECIPIENT_NOT_ALLOWED`.
- **Deviation:** the refusal is synchronous (422, no job), the same path as `NO_RECIPIENT`, not a job that ends FAILED:
  the recipient is decided in Validate Body before a job exists, so refusing there means no job row, no AI call and no
  email at all.
