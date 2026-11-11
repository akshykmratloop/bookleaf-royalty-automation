/** The job-ledger SQL files, read by the unit pins (n8n/tests) and the real-Postgres tests (tests/db). */
import { readFileSync } from 'node:fs';

export const FRESH_INSTALL_FILE = 'infra/db/init/01-bookleaf.sql';
export const MIGRATION_FILES = Object.freeze({
  '02': 'infra/db/migrations/02-drafts-stages.sql',
  '03': 'infra/db/migrations/03-settings-enqueue.sql',
});

/** @param {string} path repo-relative @returns {string} */
export const readRepoFile = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

export const freshInstall = () => readRepoFile(FRESH_INSTALL_FILE);

/** @param {keyof typeof MIGRATION_FILES} n @returns {string} */
export const migration = (n) => readRepoFile(MIGRATION_FILES[n]);

/** The part of the fresh install that runs inside the `bookleaf` database (after `\connect bookleaf`). */
export function freshSchema() {
  const parts = freshInstall().split('\n\\connect bookleaf\n');
  if (parts.length !== 2) throw new Error(`${FRESH_INSTALL_FILE}: expected exactly one "\\connect bookleaf" line`);
  return parts[1];
}

/** @returns {string} the text from `start` through the first `end` after it, both included */
export function block(sql, start, end) {
  const from = sql.indexOf(start);
  const to = from < 0 ? -1 : sql.indexOf(end, from);
  if (to < 0) throw new Error(`no block from "${start}" to "${end}"`);
  return sql.slice(from, to + end.length);
}

/** @returns {string} the SQL without `--` comments (none of the ledger files has `--` inside a string) */
export const withoutComments = (sql) => sql.replace(/--.*$/gm, '');
