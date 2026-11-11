import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { pgCommand } from '../db/pg-command.js';

/** GitHub Actions runs the gates that need no n8n: unit tests, the build check and the ledger SQL on real Postgres 16. */
const CI_FILE = new URL('../../.github/workflows/ci.yml', import.meta.url);
const ci = () => readFileSync(CI_FILE, 'utf8');

describe('CI workflow', () => {
  it('exists', () => {
    expect(existsSync(CI_FILE)).toBe(true);
  });
  it('installs from the lockfile, then runs the unit tests, the build check and the Postgres tests, in that order', () => {
    const steps = ['npm ci', 'npm test', 'node n8n/build.mjs --check', 'npm run test:db'].map((cmd) => ci().indexOf(`run: ${cmd}`));
    expect(steps.every((at) => at > 0), String(steps)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });
  it('gives the Postgres tests a Postgres 16 service, the major version the stack runs, and reaches it directly', () => {
    expect(ci()).toMatch(/image: postgres:16-alpine/);
    expect(readFileSync(new URL('../../docker/docker-compose.local.yml', import.meta.url), 'utf8')).toMatch(/image: postgres:16-alpine/);
    expect(ci()).toMatch(/BOOKLEAF_PG_DIRECT: '1'/);
  });
  it('reads the repo only and never runs the contract suite (it needs a live n8n, AI keys and SMTP)', () => {
    expect(ci()).toMatch(/permissions:\n {2}contents: read/);
    const steps = ci().replace(/^\s*#.*$/gm, '');
    expect(steps).not.toMatch(/test:contract|secrets\.|\.secrets/);
  });
});

describe('pgCommand', () => {
  const ARGS = ['-X', '-d', 'postgres'];
  it('runs the tool inside the local stack\'s container by default', () => {
    expect(pgCommand('psql', ARGS, {})).toEqual({ file: 'docker', args: ['exec', '-i', 'bookleaf-n8n-local-postgres-1', 'psql', ...ARGS] });
    expect(pgCommand('pg_dump', ARGS, { BOOKLEAF_PG_CONTAINER: 'pg' }).args.slice(0, 4)).toEqual(['exec', '-i', 'pg', 'pg_dump']);
  });
  it('runs it directly with BOOKLEAF_PG_DIRECT=1 (CI: the server comes from PGHOST and PGPORT)', () => {
    expect(pgCommand('psql', ARGS, { BOOKLEAF_PG_DIRECT: '1' })).toEqual({ file: 'psql', args: ARGS });
    expect(pgCommand('psql', ARGS, { BOOKLEAF_PG_DIRECT: '0' }).file).toBe('docker');
  });
  it('refuses any other BOOKLEAF_PG_DIRECT value instead of guessing', () => {
    expect(() => pgCommand('psql', ARGS, { BOOKLEAF_PG_DIRECT: 'yes' })).toThrow(/BOOKLEAF_PG_DIRECT must be 1 or 0/);
  });
});
