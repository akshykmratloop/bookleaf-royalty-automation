import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SETTINGS_SCHEMA } from '../../n8n/src/pipeline/settings.js';
import { migration } from '../fixtures/ledger-sql.js';
import { dropDatabase, psql, schemaDump, scratchDatabase } from './psql.js';

let db;
beforeAll(() => { db = scratchDatabase(); });
afterAll(() => { if (db) dropDatabase(db); });

const json = (sql) => JSON.parse(psql(db, sql));
const DEFAULTS = Object.fromEntries(Object.entries(SETTINGS_SCHEMA).map(([k, s]) => [k, s.default]));
/** pg_dump's schema without its per-run \restrict key lines. */
const schema = () => schemaDump(db).replace(/^\\(un)?restrict .*$/gm, '');

describe('the fresh install (infra/db/init/01-bookleaf.sql)', () => {
  it('creates bookleaf_settings seeded with every default of the settings schema', () => {
    expect(json('SELECT json_object_agg(key, value) FROM bookleaf_settings;')).toEqual(DEFAULTS);
  });
  it('then runs migrations 02 and 03 (03 twice) without an error and without a single change', () => {
    const before = schema();
    psql(db, migration('02'));
    psql(db, migration('03'));
    psql(db, migration('03'));
    expect(schema()).toBe(before);
  });
  it('keeps a value an environment has set when 03 runs again', () => {
    psql(db, `UPDATE bookleaf_settings SET value = '"sender@bookleaf.test"' WHERE key = 'email_from';`);
    psql(db, migration('03'));
    expect(psql(db, "SELECT value #>> '{}' FROM bookleaf_settings WHERE key = 'email_from';")).toBe('sender@bookleaf.test');
  });
});

describe('bookleaf_setting()', () => {
  it('returns the stored JSON value', () => {
    expect(psql(db, "SELECT bookleaf_setting('max_sends_per_hour')::integer + 1;")).toBe('61');
    expect(json("SELECT bookleaf_setting('ai_primary');")).toEqual(DEFAULTS.ai_primary);
  });
  it('raises for a key that is not there instead of returning NULL', () => {
    expect(() => psql(db, "SELECT bookleaf_setting('nope');")).toThrow(/bookleaf setting "nope" is missing/);
  });
});

describe('royalty_jobs.idem_key', () => {
  const insert = (id, idemKey) => psql(db, `INSERT INTO royalty_jobs (job_id, idem_key, author_id, mode, status)
    VALUES ('00000000-0000-4000-8000-00000000000${id}', ${idemKey}, 'author-1', 'single', 'QUEUED');`);
  it('may be left empty by new jobs, and stays unique for rows written by the old workflows', () => {
    insert(1, 'NULL');
    insert(2, 'NULL');
    insert(3, "'author-1:1:abc'");
    expect(() => insert(4, "'author-1:1:abc'")).toThrow(/royalty_jobs_idem_key_key/);
  });
});
