# SHARED_PLAN.md — Multi-Session Coordination Brain

> Single source of truth for concurrent AI sessions and git branches in this repo.
> Protocol: read first → conflict-check → register before editing → update as you go → release on done.
> Companions: `TASKS.md` (ledger) · `PLAN.md` (architecture).

---

# Active Sessions

### 1. Assignment 2 — Bubble royalty dashboard + n8n royalty emails — `main`

| Field           | Value                                                                 |
| --------------- | --------------------------------------------------------------------- |
| **Session No.** | S217                                                                  |
| **Session ID**  | `ca0b78b8-152d-44fb-aac9-59b4bb523f6f`                                |
| **Branch**      | `main`                                                                |
| **Worktree**    | `/Users/aksykmr_mac/Loop Methods/experiments/bookleaf/bubble`         |
| **Base commit** | (initial)                                                             |
| **Started**     | 2026-11-10                                                            |
| **Status**      | 🔄 In Progress                                                         |

**Goal:** the whole Assignment 2 submission: Bubble app, n8n workflows, AWS n8n host, tests, README, video.

**CLAIMED PATHS:**

```
**
```

**Things another session should know (2026-11-12, Phase 3):** branch `refactor/n8n-clean` is merged into
`main` (7d68188). It was released to production on 12 Nov (migration 03, settings, 7 workflows, `$env` blocked);
production contracts 43/43 and a live Bubble send passed.
The book-themed UI was dropped; the current Bubble UI stays.

---

# Path Ownership Map

| Path | Owner | Free to claim? |
| ---- | ----- | -------------- |
| `**` | session 1 (S217) | ❌ No |

---

# Completed & Released

_(none yet)_

---

# Cross-Session Hard Rules

- The assignment is confidential: this repo stays private; the brief PDF is never committed.
- No Claude co-author lines in commits.
- Emails never go to dataset addresses: always the configured demo inbox.
