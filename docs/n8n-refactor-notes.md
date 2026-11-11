# n8n clean-up — running log (branch `refactor/n8n-clean`)

One entry per step: what changed, node counts and Code sizes, deviations from the design and why,
and what the next builder or the release engineer must know. Newest step last.

**Starting point (main @ f57df75):** 80 working nodes (royalty-summary 45, approve-draft 20,
job-status 7, error-handler 6, sweeper 2); 23 Code nodes, 415.1 KB of generated Code; 17 Switch nodes.

**Worktree set-up (local only, never committed):** `.secrets`, `node_modules` and `.env` are symlinks
to the main checkout. `.env` was added in step 1: `n8n/deploy.mjs` reads the SMTP account from
`<repo>/.env`, so a worktree without it cannot deploy. All three paths are git-ignored.

---

## Step 1 — tree-shaking

- **Changed:** `"sideEffects": false` in the root `package.json`, so esbuild leaves out every module
  a Code node never calls. New `n8n/tests/code-size.test.js`: all Code nodes together ≤ 250 KB,
  no single Code node > 40 KB (it failed before the fix: 415.1 KB, Build Context 42.5 KB).
- **Sizes:** 23 Code nodes, **415.1 → 233.9 KB**. Largest: Check Draft 34.7, Build Context 33.5,
  Decide 31.3, Prepare Job 25.7. Thin nodes now carry only their own code (Mark Sent 14.1 → 0.8 KB).
  Node counts unchanged (80).
- **Deviations:** none.
- **Next builder:** lower `TOTAL_BUDGET_KB` as Code nodes are removed (the design projects ~185 KB).
  `n8n/src` must stay free of import-time side effects (top-level code = imports, exports and
  declarations only): with this flag, anything a module does on import is silently dropped from
  the bundles. Only `n8n/build.mjs` bundles with esbuild, so the flag affects nothing else.
