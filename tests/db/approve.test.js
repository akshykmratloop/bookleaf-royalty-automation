import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CLAIM_DRAFT, DISCARD_DRAFT } from '../../n8n/src/pipeline/sql-approve.js';
import { seedSql } from '../../n8n/tools/settings-seed.mjs';
import { dropDatabase, psql, scratchDatabase } from './psql.js';

/**
 * Approve Draft's two updates against real Postgres. n8n runs each with alwaysOutputData: no row comes
 * back as an empty item, which "Claimed?" and "Respond Discard" read as "not this click".
 */
const JOB = '00000000-0000-4000-8000-000000000001';
let db;

beforeAll(() => { db = scratchDatabase(); });
afterAll(() => { if (db) dropDatabase(db); });
beforeEach(() => psql(db, `TRUNCATE royalty_jobs; DELETE FROM bookleaf_settings;\n${seedSql()}
  INSERT INTO royalty_jobs (job_id, author_id, mode, status, requested_by, stage, stage_at, drafted_at, execution_id)
  VALUES ('${JOB}', 'author-1', 'single', 'DRAFTED', 'admin@bookleaf.test', 'drafted', now() - interval '1 hour', now() - interval '1 hour', '100');`));

/** @returns {Object[]} the rows the query returned */
const run = (sql, param) => JSON.parse(psql(db, `WITH r AS (${sql.replaceAll('$1', () => `$p$${JSON.stringify(param)}$p$`)})
  SELECT coalesce(json_agg(r), '[]') FROM r;`));
const job = () => JSON.parse(psql(db, `SELECT row_to_json(j) FROM (SELECT status, stage, execution_id,
  stage_at > now() - interval '5 seconds' AS staged_now, completed_at IS NOT NULL AS completed FROM royalty_jobs) AS j;`));

describe('Claim Draft', () => {
  it('claims a fresh draft for this execution: PROCESSING at stage sending, its execution id recorded', () => {
    expect(run(CLAIM_DRAFT, { job_id: JOB, execution_id: '512' })).toEqual([{ job_id: JOB, status: 'PROCESSING' }]);
    expect(job()).toEqual({ status: 'PROCESSING', stage: 'sending', execution_id: '512', staged_now: true, completed: false });
  });
  it('a second click claims nothing, and the first claim keeps its execution id', () => {
    run(CLAIM_DRAFT, { job_id: JOB, execution_id: '512' });
    expect(run(CLAIM_DRAFT, { job_id: JOB, execution_id: '513' })).toEqual([]);
    expect(job().execution_id).toBe('512');
  });
  it('never claims a draft older than draft_ttl_hours', () => {
    psql(db, "UPDATE royalty_jobs SET drafted_at = now() - interval '25 hours';");
    expect(run(CLAIM_DRAFT, { job_id: JOB, execution_id: '512' })).toEqual([]);
    expect(job()).toMatchObject({ status: 'DRAFTED', execution_id: '100' });
  });
});

describe('Discard Draft', () => {
  it('discards a draft (also an expired one) and returns it', () => {
    psql(db, "UPDATE royalty_jobs SET drafted_at = now() - interval '25 hours';");
    expect(run(DISCARD_DRAFT, { job_id: JOB })).toEqual([{ job_id: JOB, status: 'DISCARDED' }]);
    expect(job()).toMatchObject({ status: 'DISCARDED', stage: 'discarded', completed: true });
  });
  it('returns nothing once the draft is no longer a draft', () => {
    run(CLAIM_DRAFT, { job_id: JOB, execution_id: '512' });
    expect(run(DISCARD_DRAFT, { job_id: JOB })).toEqual([]);
    expect(job().status).toBe('PROCESSING');
  });
});
