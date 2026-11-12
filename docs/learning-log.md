# Learning log

What went wrong or surprised me, what I did about it, and what I learned. Dates are from the git
history (the repo starts on 10 Nov 2026).

## Bubble's free plan has no app API
I planned for n8n to read data from Bubble (Data API) and report back into it (Workflow API),
using Bubble's Starter trial, with a pull mode as the backup. On the free plan Bubble can call out,
but nothing can call in: no Data API, no Workflow API, no backend workflows. The trial was never
started, and the whole app was built and runs on the free plan. So pull mode became the only mode:
Bubble sends the author's data with each request and polls n8n every 3 seconds for the result.
n8n keeps each job in Postgres, so the result is there whenever Bubble asks. On 11 Nov
(commit 7a2ddf7) I deleted the push path from the workflows: 11 nodes and the Bubble credential
went, leaving one tested path. See decision 12 in [decisions.md](decisions.md).

## The 200-record cap, and no CSV upload
The free plan stops at 200 records, and CSV upload is a paid feature. The sample data (10 authors,
18 books) fits, but I had to load it without CSV. On 10 Nov (commit 847f2ca) I added a temporary
admin-only setup page with three forms (author, book, royalty) that link records by code: a book
names its author by `AUTH001`, not by a Bubble id. `scripts/editor/seed-forms.mjs` filled the forms
in a browser for every record and waited for each "saved" message. Bubble's date pickers ignore
typed text, so the script sets dates through the picker's own API. The result: 10 authors, 18 books
with their royalty records, and 11 logins (10 authors and 1 admin). Before anything was loaded,
`scripts/make-seed.mjs` checked that copies x rate = earned and paid + pending = earned for every
book. Because each email adds a log row, the admin page keeps the newest 100 log entries and
deletes older ones when it loads.

## Building a Bubble app from code
Bubble has no way to define an app in code, and clicking through the editor is slow and easy to
get subtly wrong. I did it in two steps.

- **Database (10 Nov, commit c3f41fb).** The intended schema is data in `bubble-app/schema.mjs`. I
  gave Bubble's built-in AI Agent exact specs (field names, types, option sets) and did not trust the
  result: `scripts/editor/verify-schema.mjs` reads the live editor and lists every missing, extra or
  wrongly typed field.
- **Admin page (11 Nov, commit 6584611).** The page's elements, workflows and states are generated
  as Bubble's own JSON from `bubble-app/admin/` and written into the editor by
  `scripts/editor/write-admin.mjs`. `bubble-app/admin/page.test.js` checks every element id, state,
  field and option value before anything is written.

What I learned about Bubble on the way:

- **Conditions can be silently empty.** Bubble cannot chain "is no" after an "and"/"or" or after a
  comparison. Six conditions in the admin page were read as empty with no error (fixed 11 Nov,
  commit c4365ea). A page test now fails on that pattern.
- **A privacy rule can hide search results.** The "Own statements" rule did not let an author see the
  `owner` field, so the author's statements search returned nothing. The browser check of all 10
  authors caught it (commit 0ec7080); `owner` is now viewable and searchable for an author's own
  Sent logs.
- **Option values have two kinds of id.** Values made in the editor get a snake_case id; values the
  AI Agent made use their name. `OPTION_IDS` in `schema.mjs` records the difference.
- **The API Connector times out at about 50 seconds.** An AI email can take longer, so n8n answers
  202 at once and Bubble polls.
- **Private headers stay on the server.** The webhook key is a "Private" API Connector header, so it
  never reaches the browser.
- **Polling and bulk sends run in the open admin page.** On the free plan there are no backend
  workflows, so a page workflow polls every 3 seconds, and the bulk send schedules itself one author
  at a time. A request n8n never answered is failed by Bubble after 12 minutes (commit f57df75).

## n8n Code nodes cannot import npm modules
I wanted real tests for validation, the checker and the date logic. n8n's Code node cannot import
packages, and testing code inside nodes is painful. So the logic is plain ESM modules in `n8n/src`
with unit tests (Vitest), and `n8n/build.mjs` bundles them into the Code nodes of the workflow JSON.
The cost is a generated file, so `node n8n/build.mjs --check` (run in CI) fails if the committed
JSON is out of date, and `n8n/tests/build.test.js` checks the same inside `npm test`.

## Status colours depend on the date
The badge rule is based on days since the last payout. The sample data ends in December 2025. Run
today, every book with money pending is more than 90 days old, so everything is red and the
dashboard looks broken. I added a reference date setting, default 31 Dec 2025, shown on the screen,
with a switch to today. The email states the date it used.

## Email: from AWS SES to SMTP
My first plan was AWS SES. Production access needs an account review that can take weeks, and
without it I can only send to verified addresses. I planned a switch between SMTP and Resend, but
only SMTP was needed: emails go out through an existing IONOS (1&1) mailbox, using n8n's Send
Email node. The sender is one n8n credential plus the `email_from` setting, so another provider is a
configuration change.

## Rebuilding the n8n workflows
The first version (10 to 11 Nov) worked end to end, but an independent review scored it 5/10. It had
23 Code nodes with 415 KB of generated code, 17 Switch nodes, settings read from `$env`, and the dead
push path. I rebuilt it on the branch `refactor/n8n-clean` (11 to 12 Nov): settings in a Postgres
table, n8n Header Auth on the webhooks, Write Draft and Deliver Email as sub-workflows, an error
workflow that finds the job by execution id, a sweeper, Switch nodes with named outputs, and CI.
A second review scored the rebuild 7.8/10 with 16 findings. They were fixed (commits c321bf6 to
25e56e1), except three left on purpose with the reasons written down. A security review then found
1 HIGH and 2 MEDIUM issues: the caller could choose the email recipient, the webhook key was kept in
saved runs, and an admin note could steer the AI into writing links (a phishing risk). All three
were fixed (commits 3650d35, 5bfee44, 002e41e). The rebuild went to production on 12 Nov; 43 of 43
contract tests passed there. Today the workflows have 13 Code nodes (about 170 KB) and 5 Switch
nodes. Every step is in [n8n-refactor-notes.md](n8n-refactor-notes.md).

## Keeping AI honest
The checker reads the finished email, not what the model says it did. What I can show:

- In the live check on 11 Nov, an admin edit of a draft with a wrong rupee figure was blocked
  before it could be approved (`EDIT_BLOCKED`).
- `n8n/tests/checker-probes.test.js` lists the ways a model can slip in a figure that the checker
  must catch: number words ("ten thousand rupees"), "₹5 lakh", "20 Feb" with no year, "within 2
  weeks", dollar and euro amounts, and more.
- The security review showed that checking figures is not enough: correct figures next to a fake
  payment link is still a harmful email. The checker now also blocks links, phone numbers and
  unknown email addresses.

Prompt changes made along the way: the policy figures in the prompt now come from `kb.js`, the
same source the facts use, so the prompt and the checker cannot disagree (commit 013cef5). When
admins got a free-text style note (commit 627db9e), the prompt began to fence it and say that a
figure in it is not a verified fact. I did not count how often the checker blocked a first draft
in production, so I make no claim about that rate.

## Lessons
1. **Test a platform's limits on day one.** I found how far the free-plan block went only after
   designing push mode around a trial. One test call into Bubble on day one would have saved that
   work.
2. **Write the spec once, as data, and let a script judge.** The schema check, the page test and
   the browser check of all 10 authors each caught real mistakes that looked fine on screen.
3. **Never let the AI own a number.** Compute facts in code, render the table from data, check the
   final text, and prefer a visible failure to a wrong email.
4. **Working is not the same as clean.** The first n8n version worked but scored 5/10. The rebuild
   took a day and made the workflows easier to read, test and operate.
5. **Get a security review even for a demo.** It found three real problems that my own tests did
   not look for.
6. **Put slow-to-approve dependencies behind an interface.** SES would have blocked email for weeks;
   SMTP behind one credential did not.

## What I would do next
- Remove the unused `callback_mode` field from Bubble, and make the System page name the n8n
  settings instead of fixed numbers.
- Delete the old n8n credentials kept in production for rollback.
- Run the browser check of the author portal in CI; today it runs by hand with a local browser tool.
- On a paid Bubble plan, move polling and bulk sends into backend workflows, so they do not need an
  open admin page.
- Accept two webhook keys during a rotation, so changing the key needs no gap.
