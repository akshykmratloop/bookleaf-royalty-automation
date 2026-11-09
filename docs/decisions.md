# Decisions

Short records of the choices that shaped this build. Newest decisions are at the bottom.

## 1. Separate private repo for Assignment 2 (2026-11-08)
**Context:** Assignment 1 already had its own repo, and the brief is confidential.
**Decision:** A new private repo in `bubble/`, with the brief PDF ignored by git.
**Consequence:** Clean history for each assignment. Nothing from Assignment 1 is touched.

## 2. Use Bubble's Starter trial for the integration (2026-11-08)
**Context:** The free plan has no app API, a 200-record cap and no live URL.
**Decision:** Build data and screens on the free plan first. Start the trial for the integration:
Data API, Workflow API, backend workflows, a live URL.
**Consequence:** Full push-mode integration while the trial runs. Start late, to cover the review period.
A `.bubble` export and a migration runbook are the backup if the trial ends. {{VERIFY}}

## 3. Push and pull callback modes (2026-11-08)
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

## 8. Bubble app on the free plan first (2026-11-10)
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
**Consequence:** The workflow file is generated. A test checks that it matches `src/`. {{VERIFY}}

## 11. Mail goes only to a demo inbox
**Context:** The sample addresses use `@email.com`, a real domain.
**Decision:** All mail is redirected to a configured demo inbox.
**Consequence:** No real person can be emailed by a demo.
