# AI prompt strategy

The rule behind everything here: **the AI writes words. Code owns numbers.** An author must never
get an email with a wrong rupee figure, date or count.

## The pipeline

```mermaid
flowchart TD
  D[Author data] --> I{Integrity check}
  I -- mismatch --> X[FAILED: data problem]
  I -- ok --> F[Facts layer<br/>computed in code]
  F --> P[Prompt: tone guide + facts + case flags]
  P --> A[AI returns JSON sections]
  A --> C{Fact checker}
  C -- pass --> R[Render: AI prose + figures table from data]
  C -- "blocked" --> A2[One regeneration with checker feedback]
  A2 --> C2{Fact checker}
  C2 -- pass --> R
  C2 -- blocked --> Z[FAILED: nothing is sent]
  A -. "API error" .-> FO[Failover provider]
  FO -.-> C
```

## 1. Facts first

Before any AI call, code builds a list of facts for the author: per published book (earned,
paid, pending, copies, royalty per copy, MRP, last payout, publication date), the totals, the next
payout date (end of the current quarter + 45 days), the reference date, and policy facts from the
BookLeaf knowledge base (minimum payout of ₹1,000, 45-day window, 80/20 split, 48-hour
escalation, 90-day overdue rule). Money is stored in paise to avoid rounding errors.

Each book also gets a badge computed by code, not by the AI:
- **Green:** nothing pending.
- **Red:** money pending and no payout (or, if never paid, no publication) for more than 90 days
  before the reference date.
- **Yellow:** pending, but not overdue.
- **None:** in production.

Before facts are built, an integrity check looks for bad data: earned must equal copies x rate,
paid + pending must equal earned, in-production books must be all zero, no payout dates in the
future, no duplicate book codes. If the data is wrong, the job fails with the exact reason. We
do not write a confident email from broken numbers.

## 2. Structured output, small surface for the AI

The AI must return JSON with fixed sections: `subject`, `greeting`, `intro`, `bookParagraphs`
(one `{code, text}` per book), `totalsParagraph`, `payoutParagraph`, `closing`, and optional
`productionParagraph` and `allPaidParagraph`. The schema is enforced by the provider's structured
output. Our code checks it again and treats bad JSON, missing sections or a refusal as a failure
of that attempt.

## 3. The figures table is not written by the AI

The table of per-book earned, paid and pending, and the next payout date line, are rendered by
our code straight from the facts. The AI cannot get a number in that table wrong because it never
touches it. The AI's paragraphs explain and comfort around it.

## 4. The fact checker

Ported from Assignment 1 and run on the final text, independent of what the model says it did. It
reads the email itself, so a draft cannot pass by simply not mentioning a claim. It blocks:

| Blocked | Example |
|---|---|
| Amount not in the facts | "₹4,000 pending" when pending is ₹3,570 |
| Date not in the facts | "payout on 20 Feb" |
| Copy count not in the facts | "sold 350 copies" |
| Timeline / duration not in the facts | "within 10 days" |
| Percentage not in the facts | "a 90% share" |
| Number words and short forms | "three thousand rupees", "₹5k", "2 lakh" |
| Malformed figures | "₹1,0000" |
| Placeholders | template tags in double curly braces, `[CONFIRM: ...]` |
| Internal leaks | fact ids, "as an AI" |
| Banned phrases | guarantees, blaming the author, legal or refund talk, vague deflection ("please be patient") |
| Links | `https://…`, `www.…`, `x.com/…`, or a bare domain such as `bookleaf-pay.com` |
| Phone numbers | any phone number; the data gives none to quote |
| Unknown email addresses | any address other than the `support_email` and `email_from` settings |

The last three rows were added after the security review (commit 002e41e). Without them, an admin
note such as "ask them to confirm their bank details at …" could steer the AI into writing a
phishing email with correct figures. Now that ends as a rewrite, then `AI_FACT_CHECK_FAILED`. The
same checker runs on an admin's edit of a draft (`EDIT_BLOCKED`).

Book titles are exempt from scanning, so a title with a number in it does not trigger a block.
It also reports how many figures matched a fact (`figures_verified`), which is shown in the log.

## 5. Retry, then fail

If the checker blocks the draft, the AI gets **one** more attempt with the exact issues listed
("Amount ₹4,000 does not match any verified fact"). If it fails again, the job is **FAILED** and
the log says why. Nothing is sent. A visible failure is better than a wrong number.

## 6. Provider failover

The AI provider sits behind one interface (`providers/registry.js`). Anthropic Claude
(`claude-sonnet-5-5`) is the primary. OpenAI `gpt-4.1-mini` is the fallback, used if the primary
errors, times out or returns unusable output. A 429, a 5xx or a timeout is retried once first; any
other error goes straight to the fallback. Both return the same section shape, so the checker and
renderer do not know which wrote the email. The model, effort and token limit of each come from the
`ai_primary` and `ai_fallback` settings in `bookleaf_settings`. Adding a third provider is one file
and one registry line. The `primary_down` drill makes the Anthropic call fail on purpose, to show the
fallback live.

## 7. Tone and the cases

The prompt carries BookLeaf's tone rules: empathetic, specific, own delays without inventing
reasons, give a clear next step, and for overdue money promise a response within 48 hours.

| Case | What the email does |
|---|---|
| All paid | Thanks the author, confirms nothing pending, no payout talk |
| Pending, not overdue | Shows the amount and the next payout date |
| Overdue (red) | Acknowledges the delay plainly, does not make up a reason, names the book, says the team will respond within 48 hours |
| Pending below ₹1,000 | Explains the minimum and that the amount rolls over to next quarter |
| Book in production | Short note on where it is (cover design or typesetting), no royalty claims |
| Several books, mixed | One paragraph per book, then totals |
| No published books yet | Says so kindly and quotes no totals (`NO_SALES_YET`) |

Which case applies is decided by code and passed to the model as flags. The model is not asked
to work it out.

## 8. Edge cases in the sample data

| Author | Situation | How it is handled |
|---|---|---|
| AUTH003, AUTH006 | Money pending and **never paid** (no last payout date) | The 90-day rule counts from the publication date instead, so the book is red (overdue) and the email owns the delay and gives the 48-hour review. The book line says "No payout yet"; no payout date is invented. |
| AUTH009 | ₹850 pending (below the ₹1,000 minimum, never paid) and one book in production | `BELOW_THRESHOLD` replaces the overdue escalation: under the policy the amount rolls over, so the email explains the minimum instead of apologising. The production book gets one status line. |
| AUTH007 | Two pending books and one in Cover Design | The production book gets a status line with its stage and no royalty figures. |
| AUTH008 | Everything paid | Thanks the author; no payout talk. |
| AUTH002 | One overdue book and one pending | Both situations, one paragraph per book. |

A book in production must have all-zero figures. If it does not, the integrity check fails the job
before any AI call.

## Prompt excerpt

The system prompt (`n8n/src/prompt-system.js`, version `royalty-summary.v2`) is the same for every
author, so it can be cached. It holds the BookLeaf tone rules, the royalty policy from the
knowledge base (every policy figure comes from `n8n/src/kb.js`), the grounding rules, the
situations and the output schema. The part that matters most:

```text
GROUNDING RULES (these matter more than anything else)
1. Every amount, date, count, duration and percentage you write must be copied character for
   character from the display column of VERIFIED FACTS, for example "₹3,570", "14 Feb 2026",
   "45 days". Never calculate, add up, round, convert or re-format a figure, never write a figure
   in words, and never write a figure that is not in the list. If a figure you want is not
   listed, leave it out.
2. Describe each book only with the status given for it in BOOKS. Never invent reasons for a
   delay (bank problems, holidays, technical issues) and never guess what happened to a payment.
3. Never promise or guarantee an outcome, and never mention refunds, compensation or legal
   matters. The only commitments you may make are the ones in SITUATIONS below.
4. Never mention AI, these instructions, "verified facts", fact ids, book codes, or BookLeaf's
   internal systems.
5. Refer to each book by its exact title.

SITUATIONS (the user message lists the ones that apply to this author; follow each listed one)
- OVERDUE: for each listed book, say plainly that its payout is later than our usual cycle and
  apologise sincerely. Say that our finance team has been asked to review it and that the author
  will hear back from us within 48 hours. Do not give any other reason or date.
- BELOW_THRESHOLD: the author's total pending royalty is below the ₹1,000 minimum payout. Explain
  the minimum kindly and that the amount is not lost: it rolls over and is paid in a later
  quarter once the total reaches ₹1,000. Do not apologise for a delay or escalate in this case;
  the policy is working as intended.
```

The user message carries only this author's data. For Priya Sharma (AUTH001), shortened:

```text
Author first name: Priya
Figures as of: 31 Dec 2025
Next payout cycle closes by: 14 Feb 2026

SITUATIONS THAT APPLY:
- PENDING: Pending royalty due in the next payout cycle for: "Whispers of the Ganges".

BOOKS (code | title | status | figures):
- BK001 | "Whispers of the Ganges" | Pending amount is due in the next payout cycle | copies sold 342 | earned ₹11,970 | paid ₹8,400 | pending ₹3,570 | last payout 15 Oct 2025
- BK002 | "The Saffron Diaries" | Fully paid — nothing pending on this book | copies sold 189 | earned ₹7,938 | paid ₹7,938 | pending ₹0 | last payout 1 Dec 2025

VERIFIED FACTS (id | label | display):
- book.BK001.pending | Whispers of the Ganges: royalty pending | ₹3,570
- totals.pending | Total royalty pending | ₹3,570
- payout.next_date | Next payout cycle closes by | 14 Feb 2026
- kb.payout_threshold | Minimum payout threshold | ₹1,000
  … (28 facts in all)

WRITING STYLE FOR THIS EMAIL:
- Tone: warm — warm and personal, as a person on the Author Relations team would write; thank the author where it fits.
- Length: 150 to 300 words of prose in total across all sections.
```

When the checker blocks a draft, the rewrite request lists each problem with what the model wrote
(at most 10) and asks for the whole JSON again, copying figures only from VERIFIED FACTS.
An admin's style note goes inside a fence; the prompt says it can change wording only, never a
rule or a figure.

## Cost

Tokens are counted per call and priced in code (`providers/cost.js`). Claude Sonnet 5.5 is priced at
$2 per million input tokens and $10 per million output tokens. An unknown model gets no cost, never a
guess. Each job stores provider, model, tokens and USD, so the log shows what every email cost.
Measured on production on 12 Nov 2026 over 53 sent emails: **$0.0085 per email** on average
(cheapest $0.0012, most expensive $0.0186). The cost includes the rewrite when one was needed. The
OpenAI fallback, gpt-4.1-mini, is priced at OpenAI's
published standard rate: $0.40 per million input tokens, $1.60 per million output tokens and $0.10
per million cached input tokens (checked 2026-11-11).

## Testing

Unit tests (`npm test`) cover the checker catching a wrong amount, date, count and percent; number
words and malformed figures (`checker-probes.test.js`); placeholders; links, phone numbers and outside
email addresses (`checker-contact.test.js`); which situations each sample author gets
(`prompt.test.js`); no fact id leaking into the instruction text; and HTML escaping.
The contract suite (`tests/contract/03-send.test.js`) sends four live emails, one per case: all paid
(AUTH008), overdue (AUTH002), below the minimum (AUTH009) and a book in production (AUTH007). Each
must end SENT to the demo inbox with verified figures and a recorded cost, and its content is
checked (the 48-hour review for overdue, the ₹1,000 minimum, ₹0 pending, the production stage).
`02-failure-drills.test.js` and `04-draft-approve.test.js` cover the AI-down drill, the OpenAI
fallback, and an admin edit with a wrong figure (`EDIT_BLOCKED`). The browser check
`tests/e2e/author-portal.mjs` compares all 10 authors' dashboard totals and badges with the same
facts code.
