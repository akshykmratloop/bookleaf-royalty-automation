# Learning log

What went wrong or surprised me, and what I did about it.

## Bubble's free plan has no app API
I planned for n8n to read data from Bubble and call back into it. On the free plan, Bubble does
not expose a Data API or Workflow API for the app. Bubble can call out, but nothing can call in.
I did not want the whole product to depend on a paid plan, so I designed two modes. In push mode
n8n uses the Bubble APIs. In pull mode Bubble sends the data in the request and polls n8n for the
result. n8n stores each job in Postgres, so the result is there when Bubble asks. I use the free plan to build the
screens and data, and the trial for push mode. {{TODO: trial start date and what push mode changed}}

## The 200-record cap, and no CSV upload
The free plan stops at 200 records. The sample data (10 authors, 18 books) fits, but CSV upload
is a paid feature. I needed to load the data without it. I built a temporary admin-only setup page
with forms that create records and link them by code (an author's books are found by author code,
not by pasting ids). I ran it once and then deleted the page. `scripts/make-seed.mjs` still
produces the CSVs, and checks that copies x rate = earned and paid + pending = earned before
anything is loaded. {{TODO: confirm final seeding route and record count}}

## Driving the Bubble editor by automation
Bubble has no way to define a database in code. I drove the editor with browser automation and
used Bubble's own AI Agent to build from exact specs: field names, types, option sets. I did not
trust the result. `bubble-app/schema.mjs` holds the intended schema as data, and
`scripts/editor/verify-schema.mjs` reads the live editor and compares. The first run caught
{{TODO: what the check caught}}. I learned to write the spec once, as data, and
let a script judge the output, instead of eyeballing screens.

## n8n Code nodes cannot import npm modules
I wanted real tests for validation, the checker and the date logic. n8n's Code node does not let
you import packages, and testing code inside nodes is painful. So I wrote the logic as plain ESM
modules with unit tests (Vitest) and a build step that inlines them into the workflow JSON. This
also keeps the workflow in git as reviewable code. The cost is a generated file, so I added a
check that the file matches `src/`. {{VERIFY}}

## Status colours depend on the date
The brief's badge rule is based on days since the last payout. The sample data ends in December
2025. Run today, every book with money pending is more than 90 days old, so everything is red and
the dashboard looks broken. I added a reference date setting, default 31 Dec 2025, shown on the
screen, with a switch to today. The email states the date it used.

## Email: from AWS SES to SMTP
My first plan was AWS SES. Production access needs an account review that can take weeks, and
without it I can only send to verified addresses. I moved the sender behind a config switch
(`smtp` or `resend`) and used SMTP through n8n's Send Email node. I learned to put the
slow-to-approve dependency behind an interface on day one. {{TODO: SMTP provider used}}

## Trial strategy
A Bubble trial lasts 14 days and can be started up to 10 days after the app is created. I built
as much as possible on the free plan first and keep a `.bubble` export and a migration runbook, in
case the review period outlasts the trial. {{TODO: actual trial start, and migration dry-run time}}

## Keeping AI honest
{{TODO: what the checker caught in real runs (which wrong figures, which phrases), and prompt changes made because of it}}

## What I would do next
{{TODO: honest list after the build is finished}}
