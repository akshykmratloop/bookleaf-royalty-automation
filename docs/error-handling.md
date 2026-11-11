# Error handling

**Principle: never silent.** Every request ends as Sent or Failed, with a reason a person can
read. Nothing is left spinning, nothing is swallowed, and a wrong email is never preferred over
a failed one.

Every failure does three things: it is detected at its own boundary, it sets the job (and the
Bubble log) to Failed with a reason, and it is written to the job ledger with an error code.

## Failure table

| Failure | How it is detected | What the user sees in Bubble | Log entry |
|---|---|---|---|
| Missing or wrong key | Webhook auth check | Toast: "Could not reach the email service". Log set to Failed. | n8n: 401, no job created |
| Invalid payload (bad id, bad date, too long) | Schema validation, field by field | Failed, with the field that was wrong | 400 with error list; no job |
| Data integrity mismatch (earned is not copies x rate, paid + pending is not earned) | Integrity check before any AI call | Failed: "Data problem: ..." names the book and rule | Job FAILED, code from `integrity` |
| Author not found | Empty Data API result | Failed: "Author not found" | Job FAILED |
| Bubble Data API unreachable (push mode) | HTTP error or timeout, retried with backoff | Failed: "Could not read author data" | Job FAILED, retries counted |
| AI down, timeout or API error | HTTP error from the provider | Nothing yet: fails over to the second provider. If both fail: Failed. | Provider name and error code on the job |
| AI refusal, truncated or empty answer | Stop reason / missing content | Same as above | `REFUSED`, `TRUNCATED`, `EMPTY` |
| AI returns invalid JSON or missing sections | Parser and shape check | One more attempt, then failover, then Failed | `INVALID_JSON`, `INVALID_SHAPE` |
| Fact-check failure (wrong figure, banned phrase, placeholder) | Checker on the finished text | One regeneration with feedback. If still blocked: Failed, "AI wrote a figure that does not match the data". Nothing is sent. | Job FAILED with the blocked excerpts |
| SMTP failure (rejected, timeout) | Send node error | Failed: "Email could not be delivered" | Job FAILED, code `SMTP_*` |
| Callback to Bubble fails (push mode) | Non-2xx or timeout | Log may stay Processing briefly; result is held and reconciled | `callback_status = FAILED` after 3 retries |
| n8n unreachable from Bubble | API Connector error or timeout | Toast with the error; the log is marked Failed. No endless spinner. | Bubble log only (n8n never saw it) |
| Webhook slow (more than about 50 s) | Not applicable: webhook replies 202 at once | Normal "Queued" then "Sent" | - |
| Crash in the workflow (unhandled) | n8n error workflow | Job becomes Failed, reason "Unexpected error" | Job FAILED, execution id kept |
| Job stuck (worker died, n8n restarted) | Sweeper runs every 5 minutes; looks for QUEUED/PROCESSING older than a limit | Log moves to Failed: "Timed out" | Job FAILED, code `STUCK` |
| Rate limit (too many requests) | Webhook limiter and provider 429 | 429 on the webhook: Bubble shows "Too many requests, try again". Provider 429: retried, then failover. | Code `RATE_LIMITED` {{VERIFY}} |
| Duplicate request | `enqueue_royalty_job` (one advisory lock; same author + fingerprint within `duplicate_window_minutes`) | The second click is marked Duplicate and points to the first job | The function returns the existing job |

Exact retry counts, limits and on-screen wording: {{VERIFY}} against the final workflow and app.

## Detail on the important paths

**Fact-check failure.** This is the safety net. The checker can block, the AI gets one more try with
the exact list of problems, and if it still fails the email is not sent. The author never sees a
number that was not in the data.

**Stuck job.** Any step can die silently (server restart, out of memory). The sweeper is a separate
scheduled workflow. It looks at the ledger, not at n8n executions, so it catches jobs that no
longer have a running execution. Each swept job is reported back to Bubble like any other failure.

**Callback failure.** The email may already be sent when the callback fails. So the ledger keeps the
result and `callback_status`. When Bubble is reachable again, the result is delivered, so a log is
never wrong about a sent email.

**Error workflow.** One shared n8n error workflow catches anything that escapes. It marks the job
FAILED with the execution id, so a person can open the exact run.

## Failure drills

Admin switches in Bubble Settings, honoured by n8n only when `ALLOW_DRILLS=true` on the server:

| Drill | Effect | Expected result |
|---|---|---|
| AI down | The AI calls fail on purpose | Failover, then Failed with an AI reason |
| Email down | The send step fails on purpose | Failed with an email reason |
| Data down | The Data API fetch fails on purpose (push mode) | Failed with a data reason |

They exist so the error paths can be shown live and tested, instead of only described. On the
production-style server `ALLOW_DRILLS` is {{TODO}}.

## Tests

Contract tests cover 401, 400, 202, duplicate request, every sample author sent, and each drill
returning FAILED with a reason. {{VERIFY}}
