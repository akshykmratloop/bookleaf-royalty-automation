#!/usr/bin/env node
/**
 * Runs the contract suite against a live n8n.
 *   npm run test:contract                              # local stack (.secrets/n8n-local.env)
 *   npm run test:contract -- --env .secrets/n8n.env    # production
 * Real emails go to the demo inbox (CONTRACT_DEMO_INBOX, default akshykmr@loopmethods.com).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const i = process.argv.indexOf('--env');
const envFile = resolve(ROOT, i > -1 && process.argv[i + 1] ? process.argv[i + 1] : '.secrets/n8n-local.env');
const r = spawnSync('npx', ['vitest', 'run', '--config', 'tests/contract/vitest.config.js'], {
  cwd: ROOT, stdio: 'inherit', env: { ...process.env, CONTRACT_ENV_FILE: envFile },
});
process.exit(r.status ?? 1);
