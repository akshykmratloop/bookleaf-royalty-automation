/**
 * psql and pg_dump inside the local stack's Postgres 16 container (docker/docker-compose.local.yml),
 * so the ledger SQL is tested against real Postgres. Tests only use throwaway databases made by
 * scratchDatabase(); the `bookleaf` database is never touched.
 * BOOKLEAF_PG_CONTAINER and BOOKLEAF_PG_USER override the local stack's container and user.
 */
import { execFile, execFileSync } from 'node:child_process';
import { freshSchema } from '../fixtures/ledger-sql.js';

const CONTAINER = process.env.BOOKLEAF_PG_CONTAINER || 'bookleaf-n8n-local-postgres-1';
const USER = process.env.BOOKLEAF_PG_USER || 'n8n';
const psqlArgs = (db) => ['exec', '-i', CONTAINER, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', USER, '-d', db];

export class PsqlError extends Error {}

/** Runs `sql` in one session. @returns {string} the rows, one per line @throws {PsqlError} with psql's message */
export function psql(db, sql) {
  try {
    return execFileSync('docker', psqlArgs(db), { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    throw new PsqlError(`psql: ${String(e.stderr || e.message).trim()}`);
  }
}

/** Like psql(), in a session of its own that runs alongside others. Never rejects: the caller asserts on `ok`. */
export function psqlAsync(db, sql) {
  return new Promise((resolve) => {
    const child = execFile('docker', psqlArgs(db), { encoding: 'utf8' }, (error, out, err) => {
      resolve({ ok: !error, out: out.trim(), err: err.trim() });
    });
    child.stdin.end(sql);
  });
}

/** @returns {string} the schema of `db` as pg_dump prints it */
export const schemaDump = (db) => execFileSync('docker', ['exec', CONTAINER, 'pg_dump', '-U', USER, '--schema-only', '--no-owner', '-d', db], { encoding: 'utf8' });

/**
 * A new database holding the fresh-install schema (infra/db/init/01-bookleaf.sql).
 * @throws {PsqlError} when the local stack is not running (start it: node docker/bootstrap.mjs)
 */
export function scratchDatabase() {
  const name = `bookleaf_test_${process.pid}_${Date.now()}`;
  psql('postgres', `CREATE DATABASE ${name};`);
  psql(name, freshSchema());
  return name;
}

export const dropDatabase = (name) => psql('postgres', `DROP DATABASE IF EXISTS ${name} WITH (FORCE);`);

/** Polls `check` every 100 ms until it is true. @throws {Error} naming `what` after `timeoutMs` */
export async function until(check, what, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}
