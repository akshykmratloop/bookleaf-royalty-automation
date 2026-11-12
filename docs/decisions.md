# Decisions

Short records of the choices that shaped this build. Newest decisions are at the bottom.

## 1. Separate private repo for Assignment 2 (2026-11-08)
**Context:** Assignment 1 already had its own repo, and the brief is confidential.
**Decision:** A new private repo in `bubble/`, with the brief PDF ignored by git.
**Consequence:** Clean history for each assignment. Nothing from Assignment 1 is touched.

## 2. Use Bubble's Starter trial for the integration (2026-11-08) (superseded by 12)
**Context:** The free plan has no app API, a 200-record cap and no live URL.
**Decision:** Build data and screens on the free plan first. Start the trial for the integration:
Data API, Workflow API, backend workflows, a live URL.
**Consequence (as planned):** Full push-mode integration while the trial runs, started late to cover
the review period.
**What happened:** The trial was never started. The whole app was built and runs on the free plan
(decision 12). No `.bubble` export or migration runbook was made, because none was needed.

## 3. Push and pull callback modes (2026-11-08) (superseded by 12)
**Context:** Trials end. A reviewer might open the app after that.
**Decision:** `CALLBACK_MODE = push | pull`. Pull mode makes Bubble send the data and poll for the result.
**Consequence:** The app works on any Bubble plan. Two code paths to test; both are covered
by the same contract tests.

## 4. Status reference date (2026-11-08)
**Context:** The sample data ends on 31 Dec 2025. Measured from today, every pending book is more than
90 days old, so all would be red.
**Decision:** A `reference_date` setting, default 2025-12-31, shown on screen, with a switch to today.
**Consequence:** The badges show green, yellow and red as the data was designed to. The email says
"as of" the date it used.

## 5. n8n on its own small server (2026-11-08)
**Context:** The Assignment 1 server is full.
**Decision:** A separate t4g.small in ap-south-1, built with Terraform, running n8n, Postgres and
Caddy (HTTPS) with Docker Compose.
**Consequence:** Isolation and a repeatable setup, for a small monthly cost.

## 6. Figures come only from data; AI prose is fact-checked (2026-11-08)
**Context:** A wrong rupee figure in an author email is a real harm.
**Decision:** Facts computed in code; AI writes prose only; the figures table is rendered from data;
a checker scans the final text; one retry; then FAILED.
**Consequence:** Some emails fail instead of sending. That is intended. See
[ai-prompt-strategy.md](ai-prompt-strategy.md).

## 7. Email sender is configurable: SMTP or Resend, no AWS SES (2026-11-10)
**Context:** SES account review can take weeks, and SES starts in sandbox mode.
**Decision:** `EMAIL_PROVIDER = smtp | resend`. SMTP uses n8n's Send Email node.
**Consequence:** Mail works at once, and any provider can be swapped by config.
**Update (2026-11-12):** Only SMTP was built, through an existing IONOS (1&1) mailbox. Resend was
never needed, so there is no `EMAIL_PROVIDER` switch in the code. Another SMTP provider is a change
to the "BookLeaf SMTP" credential and the `email_from` setting.

## 8. Bubble app on the free plan first (2026-11-10) (trial part superseded by 12)
**Context:** Bubble allows a trial up to 10 days after an app is created, per app.
**Decision:** App `bookleaf-royalties-81850` is created now on the free plan. The trial starts when
the integration work begins.
**Consequence:** Trial days are not spent on screens that do not need them.

## 9. Build Bubble with its Agent, verify with a script (2026-11-10)
**Context:** Clicking through the editor is slow and easy to get subtly wrong.
**Decision:** Give Bubble's built-in Agent exact specs, then check the result against
`bubble-app/schema.mjs` with `scripts/editor/verify-schema.mjs`.
**Consequence:** Faster, and nothing is trusted without a check.

## 10. Logic as tested modules (2026-11-10)
**Context:** n8n Code nodes cannot import npm packages, and logic written inside nodes is hard to test.
**Decision:** Plain ESM modules in `n8n/src` with unit tests. `n8n/build.mjs` inlines them
into the workflow JSON.
**Consequence:** The workflow files are generated. `node n8n/build.mjs --check` fails if the
committed JSON in `n8n/workflows/` is out of date; CI runs it on every push. Inside `npm test`,
`n8n/tests/build.test.js` ("are committed and up to date") checks the same, and
`n8n/tests/export.test.js` checks that `n8n/export/` matches the build and holds no secret.

## 11. Mail goes only to a demo inbox
**Context:** The sample addresses use `@email.com`, a real domain.
**Decision:** All mail is redirected to a configured demo inbox.
**Consequence:** No real person can be emailed by a demo. Since 2026-11-12 n8n enforces it: a
`demo_inbox` that is not the `default_demo_inbox` setting or in `allowed_demo_inboxes` gets 422
`RECIPIENT_NOT_ALLOWED` and no job (security review fix, commit 3650d35).

## 12. Pull mode only; push mode removed (2026-11-11)
**Context:** The Bubble free plan blocks every inbound API: no Data API and no Workflow API. n8n can
neither read Bubble's data nor call a Bubble workflow. The trial in decision 2 was never started.
**Decision:** Supersedes decisions 2 and 3. Bubble's API Connector sends the author and their books
with each request (header `X-BookLeaf-Key`); n8n answers 202 with a job id; Bubble polls the
job-status webhook every 3 seconds and updates the NotificationLog. The push path (n8n reading the
Data API and calling back into Bubble) was deleted from the workflows (commit 7a2ddf7).
**Consequence:** One tested path that works on any Bubble plan. n8n holds no Bubble credential.
Bubble's `callback_mode` setting field is left over and has no effect. On a paid plan, push could come back
as described in [`n8n/PAYLOAD.md`](../n8n/PAYLOAD.md).
