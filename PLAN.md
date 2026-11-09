# PLAN.md — Architecture and decisions

## What this is
BookLeaf Assignment 2: an Author Royalty Dashboard in Bubble.io, and an n8n workflow that
writes and sends a personalised AI royalty-summary email, then reports Success/Failed back
to Bubble.

## Architecture
```
Bubble (author + admin portals, privacy rules, NotificationLog)
  │ API Connector (server-side, private header X-BookLeaf-Key)
  ├─ POST /webhook/royalty-summary {author_id, log_id, requested_by, mode}
  │     n8n: auth → validate → idempotency (Postgres unique key) → job QUEUED → 202 {job_id}
  │       → fetch author data (Bubble Data API) → integrity check → facts
  │       → AI email (JSON) → fact-check → one retry → provider failover
  │       → HTML render → SMTP (AWS SES) → job SENT / FAILED + reason
  │       → push callback: Bubble Workflow API `notification_result`
  └─ pull mode (free plan): Bubble sends the full payload and polls GET /jobs
n8n error workflow + sweeper: no job is left "processing".
```

## Decisions log
| Date | Decision | Why |
|---|---|---|
| 2026-11-08 | Separate repo in `bubble/`, private | Keep Assignment 2 apart from Assignment 1; the brief is confidential |
| 2026-11-08 | Bubble Starter trial for the integration; `.bubble` export + migration runbook as backup | The free plan has no app API, a 200-record cap and no live URL |
| 2026-11-08 | `CALLBACK_MODE = push \| pull` | The app keeps working if no trial is active |
| 2026-11-08 | Status reference date defaults to 2025-12-31, switchable to today | The dataset's as-of date (same as Assignment 1); from today every pending book would be red |
| 2026-11-08 | n8n on its own t4g.small (ap-south-1) | The Assignment 1 server is full; keeps the two apart |
| 2026-11-08 | Figures in emails come only from data; AI prose is fact-checked | A wrong ₹ figure must never reach an author |
