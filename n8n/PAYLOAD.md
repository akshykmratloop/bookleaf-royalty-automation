# Royalty summary webhook: the contract Bubble sends

Two endpoints, both protected by the header `X-BookLeaf-Key` (n8n Header Auth credential).
A missing or wrong key gets **403** from n8n before any workflow runs.

| Endpoint | Purpose |
|---|---|
| `POST /webhook/royalty-summary` | Queue one royalty-summary email. Answers at once (**202**), never waits for the AI or SMTP. |
| `GET /webhook/royalty-summary/jobs?ids=<id>,<id>[&include=html]` | Poll the status of up to 50 jobs. |

## POST body (pull mode, `DATA_SOURCE=payload`)

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
  "drills": { "ai_down": false, "email_down": false, "data_down": false },
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
| `log_id` | Optional. The Bubble NotificationLog id; returned with the job and used for push callbacks. |
| `batch_id` | Optional. Groups a bulk send. |
| `requested_by` | Required. Admin email or name, 1-254 chars. |
| `mode` | Required. `single` or `bulk`. |
| `reference_date` | Optional. "Figures as of" date. Empty = server default `REFERENCE_DATE_DEFAULT` (2025-12-31, or `today`). |
| `demo_inbox` | Optional email. **Emails never go to `author.email`.** Empty = server `DEFAULT_DEMO_INBOX`; neither set = job refused with `NO_RECIPIENT` (422). |
| `attempt` | Optional, 1-20, default 1. Bump it for a deliberate "send again" within 10 minutes (see idempotency). |
| `drills` | Optional. Failure drills, honoured only when the server runs `ALLOW_DRILLS=true` (otherwise **400**, never silently ignored). |
| `author` | Required in pull mode: `code`, `name` (first word = greeting name), `email`, `city`. |
| `books[]` | Required in pull mode, up to 50. `status` is the status text; anything starting with "In Production" is treated as in production and its stage (e.g. "Cover Design") is used in the email. `platforms` may be a list or comma-separated text. |

In push mode with `DATA_SOURCE=bubble` (paid Bubble plan), `author` and `books` are not needed:
n8n reads the author, books and royalty records through the Bubble Data API.

## Answers

| Status | When | Body |
|---|---|---|
| 202 | New job queued | `{ "job_id": "…", "status": "QUEUED", "duplicate": false }` |
| 200 | Same request within the idempotency window (double click) | `{ "job_id": "<the existing job>", "status": "<its current status>", "duplicate": true }` |
| 400 | Validation | `{ "error": { "code": "VALIDATION", "message": "…", "retryable": false, "fields": [{ "path": "books[0].copies_sold", "code": "TYPE", "message": "must be an integer" }] } }` |
| 403 | Missing / wrong `X-BookLeaf-Key` | n8n's plain-text `Authorization data is wrong!` |
| 422 | `NO_RECIPIENT` | error object as above |
| 429 | More than `MAX_SENDS_PER_HOUR` jobs (not failed) in the last hour | `{ "error": { "code": "RATE_LIMITED", … } }` |
| 500 | n8n itself failed before answering | `{ "message": "Error in workflow" }` |

**Idempotency:** the key is author id + a SHA-256 fingerprint of everything that shapes the email
(books, figures, reference date, recipient, drills, attempt) + the 10-minute window. The same click
twice returns the same job; changed data, a new `attempt` or the next window makes a new job.

## GET /webhook/royalty-summary/jobs

`ids`: comma-separated job ids (UUIDs), 1-50. `include=html` adds `html` and `text_body`.

```json
{
  "jobs": [{
    "job_id": "…", "log_id": "…", "batch_id": null, "author_id": "…", "author_code": "AUTH002", "mode": "single",
    "status": "SENT", "error_code": null, "error": null, "subject": "Your BookLeaf quarterly royalty summary",
    "sent_to": "akshykmr@loopmethods.com", "figures_verified": 12, "ai_attempts": 1, "provider": "anthropic",
    "model": "claude-sonnet-5-5", "input_tokens": 3496, "output_tokens": 481, "cost_usd": 0.00752,
    "requested_by": "admin@bookleaf.in", "created_at": "…", "updated_at": "…", "completed_at": "…",
    "callback_status": "NOT_NEEDED"
  }],
  "missing": []
}
```

`status` moves QUEUED → PROCESSING → SENT or FAILED. A job never stays in between: the error
workflow marks unexpected failures `INTERNAL`, and the sweeper marks anything older than 10 minutes
`TIMEOUT`. Poll every 3-5 seconds; a normal job finishes in about 10-20 seconds.

## Error codes (`error_code`)

| Code | Meaning | Retry helps? |
|---|---|---|
| `VALIDATION` | Bad request fields (answered synchronously). | No |
| `NO_RECIPIENT` | No safe demo inbox (synchronous). | No |
| `RATE_LIMITED` | Hourly limit reached (synchronous). | Later |
| `INTEGRITY` | Figures do not add up (earned ≠ copies × royalty, paid + pending ≠ earned, payout in the future). No email is written. | No, fix the data |
| `DATA_UNAVAILABLE` | Author data could not be loaded (Bubble Data API, or the `data_down` drill). | Yes |
| `AI_UNAVAILABLE` | Anthropic failed and the OpenAI fallback failed too (or the answer was unusable twice). | Yes |
| `AI_FACT_CHECK_FAILED` | The draft quoted a figure not in the data, and the one regeneration with feedback did too. Nothing was sent. | Yes |
| `EMAIL_FAILED` | The SMTP server refused or could not be reached. The draft is kept on the job. | Yes |
| `TIMEOUT` | Not finished within 10 minutes (sweeper). | Yes |
| `INTERNAL` | Unexpected workflow error; `error` names the node. | Yes |

## Push mode (paid Bubble plan): result callback

With `CALLBACK_MODE=push`, n8n also POSTs the finished job to Bubble's Workflow API
`/api/1.1/wf/notification_result` (Bubble API token credential, 3 retries) with
`log_id, job_id, status, error, subject, html, figures_verified, model, cost_usd, completed_at`,
and records `callback_status` DONE or FAILED. Pull-mode polling keeps working either way.
