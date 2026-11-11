# Royalty summary webhook: the contract Bubble sends

Three endpoints, all protected by the header `X-BookLeaf-Key`, which n8n checks itself (the webhooks'
Header Auth). A missing or wrong key gets **403** with n8n's plain-text body `Authorization data is
wrong!` (not JSON) before the workflow starts: no execution, no database work.

| Endpoint | Purpose |
|---|---|
| `POST /webhook/royalty-summary` | Queue one royalty-summary email (or draft). Answers at once (**202**), never waits for the AI or SMTP. |
| `GET /webhook/royalty-summary/jobs?ids=<id>,<id>[&include=html]` | Poll the status of up to 50 jobs. |
| `POST /webhook/royalty-summary/approve` | Check, send or discard a draft (`delivery: "draft"`). |

**The key.** One key, `BOOKLEAF_WEBHOOK_KEY` in `.secrets/webhook.env` (generated on the first
deploy; 32–256 printable characters, no spaces). `n8n/deploy.mjs` writes it into the n8n credential
**BookLeaf Webhook Key** (Header Auth on `X-BookLeaf-Key`, usable by no HTTP Request node). n8n
compares it as a plain string (not constant-time). The request headers, key included, stay in the
saved execution data of royalty-summary and approve-draft, and of failed job-status runs (job-status
keeps no successful run). Only n8n users can open them, and n8n deletes executions after 14 days
(`EXECUTIONS_DATA_MAX_AGE` 336 hours in both compose files). n8n's own execution-data redaction (the
workflow setting `redactionPolicy`) needs an Enterprise licence: a Community instance drops the
setting when the workflow is saved, so the header cannot be redacted there.

**Key rotation.** Header Auth checks exactly one key, so there is a short gap: put a new
`BOOKLEAF_WEBHOOK_KEY` in `.secrets/webhook.env`, run `n8n/deploy.mjs` (the credential changes at
once; Bubble's calls get 403 from here), then paste the new key into Bubble's API Connector. Do it
when no one is sending. `BOOKLEAF_WEBHOOK_KEY_NEXT` is no longer used; the deploy stops if it is set.

## POST body

Flat on purpose, so a Bubble API Connector call can build it with dynamic values. Amounts are whole
rupees (numbers; quoted whole numbers such as `"3570"` are accepted). Dates are `YYYY-MM-DD`, a
Bubble date (ISO instant, read in India time), or empty.

```json
{
  "author_id": "1731234567890x123456789",
  "log_id": "1731234567999x987654321",
  "batch_id": "",
  "requested_by": "admin@bookleaf.in",
  "mode": "single",
  "reference_date": "2025-12-31",
  "demo_inbox": "akshykmr@loopmethods.com",
  "attempt": 1,
  "drills": { "ai_down": false, "email_down": false, "data_down": false, "primary_down": false },
  "delivery": "send",
  "tone": "warm",
  "length": "standard",
  "note": "",
  "sign_off": "",
  "author": { "code": "AUTH002", "name": "Rohit Kapoor", "email": "rohit.kapoor@email.com", "city": "Delhi" },
  "books": [
    {
      "code": "BK003", "title": "Code & Karma", "isbn": "978-93-5XXXX-03-5", "genre": "Self-Help",
      "status": "Published & Live", "publication_date": "2023-02-14", "mrp": 350, "royalty_per_copy": 30,
      "print_partner": "In-House", "platforms": ["Amazon India", "Flipkart"],
      "copies_sold": 876, "earned": 26280, "paid": 21000, "pending": 5280, "last_payout_date": "2025-09-01"
    }
  ]
}
```

| Field | Rule |
|---|---|
| `author_id` | Required. Bubble unique id, 1-64 chars, letters/digits/`_`/`-`. |
| `log_id` | Optional. The Bubble NotificationLog id; returned with the job. |
| `batch_id` | Optional. Groups a bulk send. |
| `requested_by` | Required. Admin email or name, 1-254 chars. |
| `mode` | Required. `single` or `bulk`. |
| `reference_date` | Optional. "Figures as of" date. Empty = the `reference_date_default` setting (2025-12-31, or `today`). |
| `demo_inbox` | Optional email. **Emails never go to `author.email`.** Empty = the `default_demo_inbox` setting; neither set = job refused with `NO_RECIPIENT` (422). |
| `attempt` | Optional, 1-20, default 1. Bump it for a deliberate "send again" within the duplicate window (see idempotency). |
| `drills` | Optional. Failure drills, honoured only when the `allow_drills` setting is true (otherwise **400**, never silently ignored). `ai_down` fails both AI providers; `primary_down` fails only Anthropic, so the OpenAI fallback writes the email (the job's `provider`/`model` show OpenAI); `email_down` points SMTP at an unreachable server; `data_down` fails the data step; `crash` makes the workflow throw after the 202 (like a bug), so the error workflow ends the job `INTERNAL` and sends the alert. Bubble maps its flat `ai_down`/`email_down`/`data_down`/`primary_down` parameters into this object. |
| `delivery` | Optional. `send` (default): write, check and send. `draft`: write, check and render, then stop as `DRAFTED` for an admin to approve (see the approve endpoint). |
| `tone` | Optional. `warm` (default, BookLeaf's usual tone), `formal` or `concise`. |
| `length` | Optional. `short` (about 80-180 words of prose), `standard` (default, 150-300) or `detailed` (250-450). The prompt and the word-count warning follow it. |
| `note` | Optional admin style guidance, 0-300 characters after trimming; control characters (line breaks included) become spaces. It goes into the AI's user message in a fenced block and may change wording and style only: it can never change or add figures, dates or policy, and the fact check still blocks any figure that is not in the data. |
| `sign_off` | Optional signature name, 0-60 characters: letters, spaces and `. , ' & ( ) -` (no digits). Empty = the `sender_name` setting (`BookLeaf Author Relations`). The signature is rendered from data (escaped), never written by the AI: `Warm regards,` / `Kind regards,` (formal) / `Best regards,` (concise), then the name. |
| `author` | Required: `code`, `name` (first word = greeting name), `email`, `city`. n8n never reads Bubble's data itself. |
| `books[]` | Required, up to 50. `status` is the status text; anything starting with "In Production" is treated as in production and its stage (e.g. "Cover Design") is used in the email. `platforms` may be a list or comma-separated text. |

## Answers

| Status | When | Body |
|---|---|---|
| 202 | New job queued | `{ "job_id": "…", "status": "QUEUED", "duplicate": false }` |
| 200 | Same request within `duplicate_window_minutes` (double click) | `{ "job_id": "<the existing job>", "status": "<its current status>", "duplicate": true }` |
| 400 | Validation | `{ "error": { "code": "VALIDATION", "message": "…", "retryable": false, "fields": [{ "path": "books[0].copies_sold", "code": "TYPE", "message": "must be an integer" }] } }` |
| 403 | Missing / wrong `X-BookLeaf-Key` (n8n answers; the workflow never starts) | plain text `Authorization data is wrong!` |
| 422 | `NO_RECIPIENT` | error object as above |
| 429 | `max_sends_per_hour` jobs in the last hour (discarded ones, and failed ones that got no AI answer, not counted) | `{ "error": { "code": "RATE_LIMITED", … } }` |
| 500 | The server settings are missing or invalid (each one named, no value shown) | `{ "error": { "code": "INTERNAL", "message": "… Server settings are invalid: email_from must be an email address." } }` |
| 500 | n8n itself failed before answering | `{ "message": "Error in workflow" }` |

**Idempotency:** each request has a fingerprint, a SHA-256 of everything that shapes the email
(books, figures, reference date, recipient, drills, attempt, delivery, tone, length, note, sign_off).
The database function `enqueue_royalty_job` decides under one lock, so simultaneous clicks are
answered one at a time: the same author and fingerprint within the last `duplicate_window_minutes`
(10, a sliding window) returns that job (200, `duplicate: true`, with its `error_code` if it failed);
otherwise more than `max_sends_per_hour` jobs in the last hour is a 429; otherwise a new job (202).
Changed data or a new `attempt` makes a new job at once. However many identical clicks arrive at the
same moment, exactly one gets 202.

## GET /webhook/royalty-summary/jobs

`ids`: comma-separated job ids (UUIDs), 1-50. `include=html` adds `html` and `text_body`.
`edit_text` (a draft's editable prose) is always included, so Bubble can fill its editor from a
plain poll.

```json
{
  "jobs": [{
    "job_id": "…", "log_id": "…", "batch_id": null, "author_id": "…", "author_code": "AUTH002", "mode": "single",
    "status": "SENT", "error_code": null, "error": null, "subject": "Your BookLeaf quarterly royalty summary",
    "sent_to": "akshykmr@loopmethods.com", "figures_verified": 12, "ai_attempts": 1, "provider": "anthropic",
    "model": "claude-sonnet-5-5", "input_tokens": 3496, "output_tokens": 481, "cost_usd": 0.00752,
    "requested_by": "admin@bookleaf.in", "created_at": "…", "updated_at": "…", "completed_at": "…",
    "callback_status": "NOT_NEEDED",
    "stage": "sent", "stage_at": "…", "delivery": "send", "tone": "warm", "length": "standard",
    "issues": null, "edit_text": null, "drafted_at": null
  }],
  "missing": []
}
```

`callback_status` is always `NOT_NEEDED` (kept for the fields Bubble maps; see the upgrade path below).

`status` moves QUEUED → PROCESSING → SENT or FAILED, or (with `delivery: "draft"`) → DRAFTED, and
from there, through the approve endpoint, → PROCESSING → SENT/FAILED, or → DISCARDED. A job never
stays QUEUED/PROCESSING: the error workflow ends the job of a run that stopped unexpectedly
(`INTERNAL`, or `EMAIL_UNCERTAIN` when it stopped while sending) and emails `alert_email`, and the
sweeper (every minute) marks anything not finished `stuck_job_minutes` (10) after it started (an
approved draft: after it was claimed) `TIMEOUT` (`EMAIL_UNCERTAIN` if it sat at stage `sending`). The sweeper never touches DRAFTED or DISCARDED jobs. Poll every 3-5 seconds; a normal
job finishes in about 10-20 seconds.

`stage` shows live progress:

| Stage | Meaning |
|---|---|
| `queued` | Accepted, not started. |
| `reading_data` | Loading and checking the author's data (older jobs only: it takes milliseconds, so new jobs go from `queued` straight to `writing`). |
| `writing` | The AI is writing (Anthropic, or the OpenAI fallback). |
| `checking` | The draft is being fact-checked (older jobs only: the check takes milliseconds and is no longer shown). |
| `rewriting` | The draft failed the check; the AI is rewriting it once with the checker's notes (Anthropic, or the OpenAI fallback). |
| `sending` | The finished email is saved on the job and handed to SMTP, once (also right after an approved draft is claimed). |
| `sent` / `failed` | Final. |
| `drafted` | Final until approved: a checked draft is waiting (status `DRAFTED`). |
| `discarded` | The draft was discarded (status `DISCARDED`). |

For a draft, `edit_text` is the prose as plain text: paragraphs separated by one blank line, with a
line reading exactly `[FIGURES TABLE]` where the figures table, the payout-window line and the books
in production go (they come from data and are not editable). The signature is not in it either (it
is rendered from `sign_off`). `issues` lists checker warnings, one per line (e.g. the word count).

## POST /webhook/royalty-summary/approve

```json
{ "job_id": "…", "action": "check", "subject": "Your BookLeaf royalty summary", "body": "Dear Rohit,\n\n…\n\n[FIGURES TABLE]\n\n…" }
```

| Field | Rule |
|---|---|
| `job_id` | Required job id (UUID, 1-64 chars). |
| `action` | `check`, `send` or `discard`. |
| `subject` | Required for check/send: 1-200 characters, one line. |
| `body` | Required for check/send: 1-8000 characters, the edited `edit_text`. If `[FIGURES TABLE]` was removed, the data block goes after the second paragraph. |

**Every business outcome is HTTP 200 with the same fields** (400 only for an invalid body, 403 for
a bad key):

```json
{ "ok": true, "job_id": "…", "status": "DRAFTED", "passed": true, "issues": "", "issue_count": 0,
  "html": "<!doctype html>…", "words": 182, "figures_verified": 9, "error_code": "", "error": "" }
```

| Action | Result |
|---|---|
| `check` | Re-runs the same fact checker on the edited subject + body against the stored facts and returns `passed`, `issues` (one per line, `Blocked (CODE): …` or `Warning (CODE): …`), `issue_count`, `words`, `figures_verified` and the rendered `html` preview. Nothing changes. |
| `send` | Same check. Blocking issues → `ok:false, error_code:"EDIT_BLOCKED"`, nothing changes. Otherwise the draft is claimed atomically (`DRAFTED` → `PROCESSING`, stage `sending`) and the answer is `ok:true, status:"PROCESSING"` at once; the edited email then goes to the job's demo inbox (the same delivery step as a direct send) and the job ends `SENT` (with the final subject, html and text) or `FAILED` (`EMAIL_FAILED`). Poll job-status for the end. A second click gets `ALREADY_SENT`: one draft, one email. The `email_down` drill stored on the job is honoured. |
| `discard` | `DRAFTED` → `DISCARDED` (stage `discarded`): `ok:true, status:"DISCARDED"`. |

| `error_code` | When |
|---|---|
| `NOT_FOUND` | No job with this id. |
| `NOT_A_DRAFT` | The job is not `DRAFTED` (its `status` is in the answer). |
| `ALREADY_SENT` | `send` on a job already `PROCESSING`/`SENT`, or a second concurrent click. |
| `DRAFT_EXPIRED` | The draft is older than the `draft_ttl_hours` setting (24; check/send; discard still works). |
| `EDIT_BLOCKED` | `send` with an edit that fails the fact check. |

## Error codes (`error_code`)

| Code | Meaning | Retry helps? |
|---|---|---|
| `VALIDATION` | Bad request fields (answered synchronously). | No |
| `NO_RECIPIENT` | No safe demo inbox (synchronous). | No |
| `RATE_LIMITED` | Hourly limit reached (synchronous). | Later |
| `INTEGRITY` | Figures do not add up (earned ≠ copies × royalty, paid + pending ≠ earned, payout in the future). No email is written. | No, fix the data |
| `DATA_UNAVAILABLE` | The author data was withheld (the `data_down` drill). | Yes |
| `AI_UNAVAILABLE` | Anthropic failed and the OpenAI fallback failed too, for the first draft or for the rewrite (`error` names both providers' errors and says when it was the rewrite), or the answer was unusable twice. | Yes |
| `AI_FACT_CHECK_FAILED` | The draft quoted a figure not in the data, and the one rewrite with the checker's notes did too. Nothing was sent. | Yes |
| `EMAIL_FAILED` | The SMTP server refused the email or could not be reached. Sending is tried once (a second try after a lost answer could email the author twice); `error` ends with the server's own message (`… smtp: connect ECONNREFUSED …`). The email is kept on the job. | Yes |
| `TIMEOUT` | Not finished within `stuck_job_minutes` (sweeper). | Yes |
| `EMAIL_UNCERTAIN` | The run stopped while the email was being sent (stage `sending`), so it may or may not have arrived: the SMTP server may have taken it before the stop. Set by the error workflow, or by the sweeper when a job sat at stage `sending` for `stuck_job_minutes`. | Check the inbox first |
| `INTERNAL` | Unexpected workflow error (the error workflow found the job by its execution id); `error` names the node and its message. `alert_email` gets an email. | Yes |
| `DB_UNAVAILABLE` | Answered synchronously with HTTP 503 when the job database failed before the webhook answered (settings, enqueue, job status, or a draft's load, claim or discard). Nothing was changed. | Yes, shortly |

## Server settings

The workflows read their settings from the table `bookleaf_settings` (database `bookleaf`), one JSON
value per key, at the start of every request: a change applies to the next request, no redeploy.
Keys, defaults, descriptions and checks live in `n8n/src/pipeline/settings.js`; a missing or invalid
setting makes the request fail with **500** `INTERNAL` naming it. The per-environment ones are
written with `n8n/tools/settings-sql.mjs` and never committed. Job status reads no settings.

| Key | Default | Used for |
|---|---|---|
| `brand_name` | BookLeaf Publishing | Email header and footer |
| `sender_name` | BookLeaf Author Relations | From line and the default signature (no `" , ; : < > @ \`) |
| `email_from` | *(per environment, required)* | From address |
| `support_email` | empty | Footer line (left out when empty) |
| `default_demo_inbox` | *(per environment)* | Recipient when the request names no `demo_inbox` |
| `allow_drills` | false *(per environment)* | Whether `drills` are accepted |
| `reference_date_default` | 2025-12-31 | "Figures as of" when the request gives none (`today` = India date) |
| `ai_primary` | claude-sonnet-5-5, effort medium, 8000 tokens | Anthropic request |
| `ai_fallback` | gpt-4.1-mini, 4000 tokens | OpenAI request |
| `ai_timeout_ms` | 45000 | Time limit of each AI request |
| `model_prices` | USD per million tokens per model | `cost_usd` (a model with no price records none) |
| `max_sends_per_hour` | 60 | The 429 limit |
| `duplicate_window_minutes` | 10 | The duplicate window (sliding) |
| `draft_ttl_hours` | 24 | `DRAFT_EXPIRED` |
| `stuck_job_minutes` | 10 | The sweeper's `TIMEOUT` (`EMAIL_UNCERTAIN` for a job stuck at stage `sending`) |
| `alert_email` | *(per environment)* | Who the error workflow emails about an unexpected error (empty = nobody) |

AI retries (only a 429, a 5xx or a timeout; an email is sent once, never retried) and the sweeper's
schedule are fixed at build time in `n8n/src/pipeline/tuning.js`.

## Upgrade path (paid Bubble plan): push instead of poll

Bubble's free plan has no Data API and no Workflow API, so Bubble sends the data with each request
and polls `jobs`. The earlier push mode (n8n reading the Data API and POSTing each finished job to
the Workflow API `notification_result`) was removed to keep one tested path. On a paid plan it comes
back as one sub-workflow called after the result is recorded: POST `log_id, job_id, status, error,
subject, html, figures_verified, model, cost_usd, completed_at` to `/api/1.1/wf/notification_result`
with a Bubble API-token credential (allowed domain: the app's), retries with backoff, and record
`callback_status` (`DONE`/`FAILED`). Polling keeps working alongside it.
