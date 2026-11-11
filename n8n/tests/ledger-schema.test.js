import { describe, expect, it } from 'vitest';
import { SETTINGS_SCHEMA } from '../src/pipeline/settings.js';
import { SEEDED_FILES, seedSql, withSeed } from '../tools/settings-seed.mjs';
import {
  block, FRESH_INSTALL_FILE, freshInstall, migration, MIGRATION_FILES, readRepoFile, withoutComments,
} from '../../tests/fixtures/ledger-sql.js';

/** The SQL runs against real Postgres in tests/db (npm run test:db); these pin its shape. */
const m03 = migration('03');
const code03 = withoutComments(m03);
const fresh = freshInstall();
const enqueueFn = block(m03, 'CREATE OR REPLACE FUNCTION enqueue_royalty_job', 'END $$;');
const at = (text) => {
  const i = enqueueFn.indexOf(text);
  if (i < 0) throw new Error(`enqueue_royalty_job lacks: ${text}`);
  return i;
};

describe('settings seed', () => {
  it('is written into the fresh install and into migration 03', () => {
    expect(SEEDED_FILES).toEqual([FRESH_INSTALL_FILE, MIGRATION_FILES['03']]);
  });
  it.each(SEEDED_FILES)('%s carries the seed generated from the settings schema (node n8n/tools/settings-seed.mjs)', (file) => {
    const sql = readRepoFile(file);
    expect(withSeed(sql, seedSql())).toBe(sql);
  });
  it('seeds every schema key once and never overwrites a stored value', () => {
    const keys = [...seedSql().matchAll(/^ {2}\('([a-z_]+)', /gm)].map((m) => m[1]);
    expect(keys).toEqual(Object.keys(SETTINGS_SCHEMA));
    expect(seedSql()).toMatch(/\nON CONFLICT \(key\) DO NOTHING;$/);
  });
  it('writes values as JSON and quotes every literal', () => {
    const seed = seedSql({ k: { default: { a: "it's" }, description: "Bob's setting" } });
    expect(seed).toContain(`  ('k', '{"a":"it''s"}', 'Bob''s setting')`);
  });
  it('refuses a file without the seed markers', () => {
    expect(() => withSeed('SELECT 1;', 'x')).toThrow(/markers/);
  });
});

describe('migration 03 is additive and re-runnable', () => {
  it('runs in one transaction', () => {
    expect(code03.trim()).toMatch(/^BEGIN;[\s\S]*\nCOMMIT;$/);
  });
  it('drops, deletes and retypes nothing', () => {
    expect(code03).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|FUNCTION|CONSTRAINT)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bTYPE\s+\w+\s*(USING|;)/i);
  });
  it('creates only with IF NOT EXISTS or OR REPLACE, and seeds with ON CONFLICT DO NOTHING', () => {
    expect(code03).not.toMatch(/^CREATE (?!OR REPLACE FUNCTION |TABLE IF NOT EXISTS |INDEX IF NOT EXISTS )/m);
    expect(code03).toMatch(/ADD COLUMN IF NOT EXISTS execution_id\s+text,\s+ADD COLUMN IF NOT EXISTS fingerprint\s+text;/);
  });
  it('keeps idem_key and its unique index for old rows, but new jobs may leave it empty', () => {
    expect(code03).toContain('ALTER TABLE royalty_jobs ALTER COLUMN idem_key DROP NOT NULL;');
    expect(fresh).toMatch(/\n {2}idem_key\s+text UNIQUE,/);
  });
});

describe('enqueue_royalty_job (one transaction-scoped advisory lock)', () => {
  it('is VOLATILE (a fresh snapshot per statement) and waits at most 5 s for the lock', () => {
    expect(enqueueFn).toMatch(/\)\nLANGUAGE plpgsql VOLATILE\nSET lock_timeout = '5s'\nAS \$\$/);
  });
  it('takes the lock before it looks back for duplicates or counts the hour', () => {
    const lock = at("PERFORM pg_advisory_xact_lock(hashtextextended('bookleaf.enqueue_royalty_job', 0));");
    expect(lock).toBeLessThan(at("r.author_id = job->>'author_id' AND r.fingerprint = job->>'fingerprint'"));
    expect(lock).toBeLessThan(at('SELECT count(*)::integer INTO sends'));
  });
  it('looks back over a sliding window read from duplicate_window_minutes, whatever the status', () => {
    at("window_minutes integer := bookleaf_setting('duplicate_window_minutes')::integer;");
    at('r.created_at > now() - make_interval(mins => window_minutes)');
    expect(block(enqueueFn, 'SELECT r.job_id, r.status', 'LIMIT 1;')).not.toMatch(/status (NOT )?IN/);
  });
  it('caps at exactly max_sends_per_hour per rolling hour, failed and discarded jobs not counted', () => {
    at("max_sends integer := bookleaf_setting('max_sends_per_hour')::integer;");
    at("WHERE r.created_at > now() - interval '1 hour' AND r.status NOT IN ('FAILED', 'DISCARDED');");
    at('IF sends >= max_sends THEN');
  });
  it('answers a duplicate before it checks the cap, so a double click at the limit still gets its job', () => {
    expect(at("'duplicate'::text")).toBeLessThan(at('SELECT count(*)::integer INTO sends'));
  });
  it('stores the execution id and fingerprint, and never writes idem_key', () => {
    at("job->>'fingerprint', job->>'execution_id'");
    expect(enqueueFn).not.toContain('idem_key');
  });
});

describe('the fresh install mirrors migration 03', () => {
  it.each([
    ['the settings table', 'CREATE TABLE IF NOT EXISTS bookleaf_settings', '\n);'],
    ['bookleaf_setting()', 'CREATE OR REPLACE FUNCTION bookleaf_setting', 'END $$;'],
    ['enqueue_royalty_job()', 'CREATE OR REPLACE FUNCTION enqueue_royalty_job', 'END $$;'],
  ])('%s is identical', (_, start, end) => {
    expect(block(fresh, start, end)).toBe(block(m03, start, end));
  });
  it('creates the same indexes', () => {
    const indexes = m03.match(/^CREATE INDEX IF NOT EXISTS .*;$/gm);
    expect(indexes).toHaveLength(3);
    for (const line of indexes) expect(fresh).toContain(line);
  });
  it('ends royalty_jobs with execution_id and fingerprint, in the order the migration adds them', () => {
    expect(block(fresh, 'CREATE TABLE IF NOT EXISTS royalty_jobs', '\n);')).toMatch(/\n {2}execution_id\s+text,[^\n]*\n {2}fingerprint\s+text\s+--[^\n]*\n\);$/);
  });
});
