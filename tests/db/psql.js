/**
 * psql and pg_dump against real Postgres 16: the local stack's container (docker/docker-compose.local.yml),
 * or with BOOKLEAF_PG_DIRECT=1 a server reached directly (CI; see pg-command.js). Tests only use throwaway
 * databases made by scratchDatabase(); the `bookleaf` database is never touched.
 * BOOKLEAF_PG_USER overrides the user (n8n, as in the local stack and the CI service).
 */
import { execFile, execFileSync } from 'node:child_process';
import { freshSchema } from '../fixtures/ledger-sql.js';
import { pgCommand } from './pg-command.js';

const USER = process.env.BOOKLEAF_PG_USER || 'n8n';
const psqlCommand = (db) => pgCommand('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', USER, '-d', db]);

export class PsqlError extends Error {}

/** Runs `sql` in one session. @returns {string} the rows, one per line @throws {PsqlError} with psql's message */
export function psql(db, sql) {
  try {
    const { file, args } = psqlCommand(db);
    return execFileSync(file, args, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    throw new PsqlError(`psql: ${String(e.stderr || e.message).trim()}`);
  }
}

/** Like psql(), in a session of its own that runs alongside others. Never rejects: the caller asserts on `ok`. */
export function psqlAsync(db, sql) {
  return new Promise((resolve) => {
    const { file, args } = psqlCommand(db);
    const child = execFile(file, args, { encoding: 'utf8' }, (error, out, err) => {
      resolve({ ok: !error, out: out.trim(), err: err.trim() });
    });
    child.stdin.end(sql);
  });
}

/** @returns {string} the schema of `db` as pg_dump prints it */
export function schemaDump(db) {
  const { file, args } = pgCommand('pg_dump', ['-U', USER, '--schema-only', '--no-owner', '-d', db]);
  return execFileSync(file, args, { encoding: 'utf8' });
}

/**
 * A new database holding the fresh-install schema (infra/db/init/01-bookleaf.sql).
 * @throws {PsqlError} when the local stack is not running (start it: node docker/bootstrap.mjs, or point BOOKLEAF_PG_DIRECT=1 at one)
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
