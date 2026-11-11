# Error handling

**Principle: never silent.** Every request ends as Sent or Failed (or a draft waiting for an admin),
with a reason a person can read. Nothing is left spinning, nothing is swallowed, and a wrong email
is never preferred over a failed one.

Every failure is detected at its own boundary, sets the job to FAILED with an `error_code` and a
readable `error`, and is kept in the job ledger. Bubble shows it on the next poll. The codes are
listed in [`n8n/PAYLOAD.md`](../n8n/PAYLOAD.md#error-codes-error_code).

## Failure table

| Failure | How it is detected | Answer or job result |
|---|---|---|
| Missing or wrong key | n8n Header Auth on the webhook | 403 `Authorization data is wrong!` (plain text); no execution, no job |
| Invalid payload (bad id, bad date, too long) | Field-by-field validation in Validate Body | 400 `VALIDATION` with the list of fields; no job |
| No safe recipient | Neither `demo_inbox` nor the `default_demo_inbox` setting | 422 `NO_RECIPIENT`; no job |
| Missing or invalid server setting | Check Settings, against the settings schema, before the body is read | 500 `INTERNAL` naming the setting (never its value); no job |
| Database down before the webhook answered (settings, enqueue, job status, a draft's load, claim or discard) | The Postgres node's error output | 503 `DB_UNAVAILABLE` (`retryable: true`), the standard error body; nothing changed. The run itself succeeds, so no alert: the sweeper's failing runs alert while the database stays down. |
| Duplicate request | `enqueue_royalty_job` (one advisory lock; same author + fingerprint within `duplicate_window_minutes`) | 200 with the first job's id and `duplicate: true` |
| Too many sends | `enqueue_royalty_job`: `max_sends_per_hour` jobs in the last hour | 429 `RATE_LIMITED`, naming the limit |
| Figures do not add up (earned is not copies x rate, paid + pending is not earned) | Integrity check before any AI call | FAILED `INTEGRITY`, naming the book and rule; no AI call |
| Author data withheld | The `data_down` drill | FAILED `DATA_UNAVAILABLE` |
| AI down, timeout (`ai_timeout_ms`, 45 s) or API error | The provider's status, read by the answer Switch in Write Draft | Only a 429, a 5xx or no answer (timeout) is tried once more, after 2 s (or the provider's Retry-After, at most 10 s); a 4xx (bad key, unknown model) goes straight to the OpenAI fallback, which works the same way; if both fail, FAILED `AI_UNAVAILABLE` naming both providers' last answers |
| AI refusal, truncated, empty or malformed answer | Stop reason, parser and shape check | One more try (Rewrite Draft: the same sub-workflow, Anthropic then OpenAI); unusable twice: FAILED `AI_UNAVAILABLE` |
| Fact-check failure (wrong figure, banned phrase, placeholder) | Checker on the finished text | One rewrite with the checker's notes (Anthropic, then OpenAI). If still blocked: FAILED `AI_FACT_CHECK_FAILED`. Nothing is sent. |
| SMTP refused or unreachable | Send Email's error output | FAILED `EMAIL_FAILED`, ending with the server's own message. Tried once, never retried. The email stays on the job. |
| Unexpected error in a run (a bug, a database or SMTP outage) | n8n runs the Error Handler workflow | The job owned by that execution becomes FAILED `INTERNAL` (naming the node and message), or `EMAIL_UNCERTAIN` if it stopped while sending. `alert_email` gets an email. |
| Job stuck (n8n restarted mid-run) | The sweeper, every minute, reads the ledger | After `stuck_job_minutes` (10): FAILED `TIMEOUT`, or `EMAIL_UNCERTAIN` if it was at stage `sending` |
| n8n unreachable from Bubble | API Connector error or timeout | Bubble marks the log Failed; an unanswered request fails after 12 minutes on Bubble's side. n8n never saw it. |
| Webhook slow (more than about 50 s) | Not applicable: the webhook replies 202 at once | Normal "Queued", then "Sent" |

## Detail on the important paths

**Fact-check failure.** This is the safety net. The checker can block, the AI gets one more try with
the exact list of problems, and if it still fails the email is not sent. The author never sees a
number that was not in the data.

**Email sent at most once.** Deliver Email saves the finished email on the job (stage `sending`)
before the send, sends once, and records SENT or EMAIL_FAILED. It never sends for a job that has
already ended (for example one the sweeper failed). If a run stops between the send and the record,
nobody can tell whether the email went out: the job is labelled `EMAIL_UNCERTAIN`, and the alert
and the message say to check the inbox before sending again.

**Error workflow.** "BookLeaf - Error Handler" is the error workflow of Royalty Summary, Approve
Draft, Job Status and the Stuck Job Sweeper (the two sub-workflows have none: their caller's node
fails instead). n8n gives it the failed execution's id, last node and error. Fail Job (3 tries) ends
the job whose `execution_id` is that id, only while it is still QUEUED/PROCESSING, and always returns
the `alert_email` setting. Alert Address remembers that address in the workflow's static data; when
Fail Job cannot reach the database, it alerts the last remembered address instead, saying the
database was down, at most once every 15 minutes (`TUNING.dbDownAlertEveryMinutes`: an outage fails
the sweeper every minute). Send Alert emails the address (empty = no alert; with the database down
before any address was remembered, nobody can be told). A duplicate request's run owns no job, so it
can never fail the earlier one. It needs no n8n API key. If the alert itself fails, the Error
Handler's run fails and shows in n8n's executions list.

**Stuck job.** Any step can die silently (a restart, out of memory). The sweeper is a separate
scheduled workflow that looks at the ledger, not at n8n executions, so it catches jobs that no
longer have a running execution. It saves only failed sweeps.

## Failure drills

A request may force a failure with `drills`, honoured only when the `allow_drills` setting is true
(otherwise 400, never ignored). It is true on the local stack and, for this demo, in production.

| Drill | Effect | Expected result |
|---|---|---|
| `ai_down` | Both AI calls ask for a model that does not exist | FAILED `AI_UNAVAILABLE`, naming both providers |
| `primary_down` | Only the Anthropic call fails | The OpenAI fallback writes the email; SENT |
| `email_down` | Deliver Email uses an SMTP server that cannot be reached | FAILED `EMAIL_FAILED` with `ECONNREFUSED` |
| `data_down` | The author data is withheld | FAILED `DATA_UNAVAILABLE`, no AI call |
| `crash` | Build Context throws, like a bug | The Error Handler fails the job `INTERNAL` and sends the alert |

They exist so the error paths can be shown live and tested, instead of only described.

## Tests

`npm run test:contract` runs against a live n8n (`--env` picks it): `01` authentication (403 without
or with a wrong key, no execution started; job-status keeps no successful run) and validation; `02`
the `ai_down`, `email_down` and `data_down` drills and an integrity failure; `03` sends; `04` drafts
and approval (check, `EDIT_BLOCKED`, send once, `ALREADY_SENT`, discard, `NOT_FOUND`, `primary_down`);
`05` three identical requests at once give one job; `06` the `crash` drill ends `INTERNAL` and the
Error Handler sends its alert. `npm run test:db` runs the ledger SQL (enqueue, Deliver Email, approval,
Fail Job, the sweeper) on real Postgres; `npm test` runs the unit and build tests.
