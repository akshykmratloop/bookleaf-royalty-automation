# TASKS.md — Assignment 2 ledger

Legend: ⬜ TODO · 🔄 In progress · ✅ Done (commit SHA) · ⛔ Blocked

## Step 0 — Set-up and spike
- ✅ Repo scaffold, coordination files, private GitHub repo (416360c)
- ✅ Bubble account + app `bookleaf-royalties-81850` (free plan); editor automation spike passed
- ⬜ Email sender credentials (SMTP or Resend) in `bubble/.env` — from the user

## Step 1 — n8n
- ✅ `n8n/src` logic modules, 175 unit tests (d190336) — prompt text still to write
- ⬜ Workflow build (`n8n/build.mjs`) + deploy script
- ⬜ Terraform + Compose n8n host, deployed
- ⬜ Contract tests (pull mode) green

## Step 2 — Bubble data (free plan)
- ✅ Option sets + data types, verified against `bubble-app/schema.mjs`
- ⬜ Privacy rules
- ⬜ Seed CSVs + upload; 10 author logins + 1 admin

## Step 3 — Author portal (free plan)
- ⬜ Login, KPI tiles, My Books, Royalty Overview + badges, statements
- ⬜ e2e privacy check

## Step 4 — Trial #1 + integration + admin portal
- ⬜ Data API + Workflow API, push mode, backend workflows
- ⬜ Admin overview, filters, detail, send, log, bulk, settings, drills
- ⬜ First `.bubble` export

## Step 5 — Hardening
- ⬜ Full e2e, failure paths, reviews, migration dry run

## Step 6 — Delivery
- ⬜ README + docs, n8n export, video, Drive folder, reviewer n8n login, draft reply
