# How Bubble and n8n work together

Bubble is the app people use. n8n does the slow, risky work: fetch data, call the AI, check the
result, send the email. They talk over two HTTP calls and one status record.

The exact request and response shapes are in [`n8n/PAYLOAD.md`](../n8n/PAYLOAD.md). This page
explains the flow and the reasons behind it.

## The webhook contract (summary)

- `POST /webhook/royalty-summary`, JSON body.
- Core fields: `author_id` (Bubble id), `mode` (`single` or `bulk`), `log_id` (the
  NotificationLog row), `requested_by`, and optionally `reference_date`.
- In **pull** mode the body also carries the author's data (`payload`: author and books), because
  n8n cannot read Bubble.
- Every field is checked for type, length and format. Bad input gets **400** with a list of
  errors. A missing or wrong key gets **401**.
- Success is **202 Accepted** with a `job_id`. The email is not sent yet. The caller then
  waits for the result (push) or asks for it (pull).

## Job lifecycle

```mermaid
stateDiagram-v2
  [*] --> QUEUED: webhook accepted
  QUEUED --> PROCESSING: worker starts
  PROCESSING --> SENT: email delivered
  PROCESSING --> FAILED: any error, with reason
  QUEUED --> FAILED: sweeper (never started)
  PROCESSING --> FAILED: sweeper (stuck)
  SENT --> [*]
  FAILED --> [*]
```

A retry from the admin creates a new job. It does not re-open an old one, so the history stays true.

## Single send, push mode (Bubble paid plan)

```mermaid
sequenceDiagram
  actor Admin
  participant Bub as Bubble
  participant N8 as n8n
  participant PG as Postgres
  participant AI as AI provider
  participant SMTP
  Admin->>Bub: Generate & Send (button disabled)
  Bub->>Bub: Create NotificationLog (Queued)
  Bub->>N8: POST webhook {author_id, log_id}
  N8->>PG: enqueue_royalty_job (locked: duplicate, hourly cap, insert)
  N8-->>Bub: 202 {job_id}
  N8->>Bub: Data API: author, books, royalties
  N8->>N8: integrity check, build facts
  N8->>AI: prompt + facts
  AI-->>N8: JSON sections
  N8->>N8: fact check (retry once if blocked)
  N8->>SMTP: send HTML + text
  N8->>PG: job SENT
  N8->>Bub: Workflow API notification_result
  Bub->>Bub: Log = Sent, email preview saved
  Bub-->>Admin: Sent
```

## Single send, pull mode (Bubble free plan)

The free plan has no incoming API, so n8n cannot call Bubble. Bubble does all the talking.

```mermaid
sequenceDiagram
  actor Admin
  participant Bub as Bubble
  participant N8 as n8n
  participant PG as Postgres
  Admin->>Bub: Generate & Send
  Bub->>Bub: Create NotificationLog (Queued)
  Bub->>N8: POST webhook {author_id, log_id, payload}
  N8->>PG: INSERT job
  N8-->>Bub: 202 {job_id}
  Note over N8: same pipeline as push mode,<br/>using the payload instead of the Data API
  loop every few seconds, up to a time limit
    Bub->>N8: GET /jobs?ids=job_id
    N8-->>Bub: status, error, subject, html, cost
  end
  Bub->>Bub: Log = Sent or Failed
```

## Bulk send

```mermaid
sequenceDiagram
  actor Admin
  participant Bub as Bubble
  participant N8 as n8n
  Admin->>Bub: Bulk send (authors with pending money)
  Bub->>Bub: Create one Queued log per author, one batch_id
  Bub->>Bub: Schedule a backend workflow per author {{VERIFY}}
  loop each author
    Bub->>N8: POST webhook (mode=bulk)
    N8-->>Bub: 202 {job_id}
  end
  Note over Bub,N8: Push: n8n calls back per job.<br/>Pull: Bubble polls /jobs for all job ids in one call.
  Bub-->>Admin: progress x / N, Retry failed
```

Each author is a separate job. One failure never stops the others.

## Why pull mode exists

- Bubble's free plan has no app API. n8n can neither read Bubble data nor call a Bubble workflow.
- Bubble's API Connector call times out at about 50 seconds. An AI email takes 10 to 30 seconds
  and can run longer with a retry. So the webhook must not wait for the email.
- The answer to both is the same: reply **202 at once**, keep the job in a database, let
  Bubble ask for the result. Push mode is faster and simpler for the user, but pull mode keeps
  the whole product working on any Bubble plan, including after a trial ends. The mode is the
  `callback_mode` setting in Bubble, and `CALLBACK_MODE` in n8n.

## Authentication

| Direction | How |
|---|---|
| Bubble to n8n | Header `X-BookLeaf-Key`. The key is stored in Bubble's API Connector marked "Private", so it is applied on Bubble's server and never reaches the browser. n8n checks it itself (Header Auth on all three webhooks): a missing or wrong key gets 403 and no workflow runs. |
| n8n to Bubble | None. n8n never calls Bubble; Bubble polls the job status (see "Upgrade path" in `n8n/PAYLOAD.md`). |

**Key rotation:** n8n checks one key. To rotate: put a new key in `.secrets/webhook.env`, run
`n8n/deploy.mjs` (n8n switches at once), then change the key in Bubble. Calls in between get 403,
so rotate when no one is sending.

The key is compared as a plain string, not in constant time. It does not appear in n8n's logs at
the default log level, but the request headers (key included) are kept in saved executions, which
only n8n users can open.

## Idempotency (a double click must not send two emails)

1. **In the UI:** the button is disabled while a send is in flight.
2. **In n8n:** each request gets a fingerprint (a SHA-256 of everything that shapes the email).
   The Postgres function `enqueue_royalty_job` holds one advisory lock while it decides, so
   simultaneous requests are handled one at a time: the same author and fingerprint within the
   last `duplicate_window_minutes` (10, sliding) returns the first job's id (HTTP 200,
   `duplicate: true`); otherwise the hourly cap (`max_sends_per_hour`, exact) or a new job. Two
   clicks at the same moment can never both create a job. Bubble marks the extra log row `Duplicate`.
3. **On the callback:** applying a result is idempotent per job id, so a retried callback cannot
   change a finished log twice.

The fingerprint covers the author's figures and the writing options. If the data changes (a payout
is recorded), the fingerprint changes and a new email is allowed immediately.

## The job ledger

One Postgres table, `royalty_jobs` (see `infra/db/init/01-bookleaf.sql`): job id, fingerprint
and n8n execution id, Bubble log id, status, error code and message, the subject and HTML sent, recipient,
figures verified, AI attempts, provider, model, tokens, cost, callback status, timestamps.

It is the source of truth for a send. Bubble's log is a copy for the user. If a callback fails,
the result is still in the ledger and can be delivered later.

## Callback delivery

Push mode: n8n retries the callback 3 times with growing waits. If Bubble is still down, the job
keeps `callback_status = FAILED` and the result is held. The next time Bubble asks (page load
or poll) it is reconciled. {{VERIFY}}
