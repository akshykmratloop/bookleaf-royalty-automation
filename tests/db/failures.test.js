import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../n8n/src/pipeline/errors.js';
import { FAIL_JOB, SWEEP_STUCK } from '../../n8n/src/pipeline/sql-failures.js';
import { seedSql } from '../../n8n/tools/settings-seed.mjs';
import { dropDatabase, psql, scratchDatabase } from './psql.js';

/**
 * The error handler's Fail Job and the sweeper against real Postgres. FAIL_JOB starts with a data-modifying WITH, which
 * Postgres allows only at the top level, so it runs as it is and its one row is read column by column.
 */
const JOB = '00000000-0000-4000-8000-000000000001';
const FAILED = { execution_id: '231', node: 'Build Context', message: 'Failure drill:\n  the workflow crashed on purpose.' };
let db;

beforeAll(() => { db = scratchDatabase(); });
afterAll(() => { if (db) dropDatabase(db); });
beforeEach(() => psql(db, `TRUNCATE royalty_jobs; DELETE FROM bookleaf_settings;\n${seedSql()}
  UPDATE bookleaf_settings SET value = '"ops@inbox.test"' WHERE key = 'alert_email';
  UPDATE bookleaf_settings SET value = '"sender@bookleaf.test"' WHERE key = 'email_from';
  INSERT INTO royalty_jobs (job_id, author_id, mode, status, requested_by, stage, stage_at, execution_id)
  VALUES ('${JOB}', 'author-1', 'single', 'PROCESSING', 'admin@bookleaf.test', 'writing', now() - interval '1 minute', '231');`));

const COLUMNS = ['job_id', 'error_code', 'alert_to', 'alert_from'];
/** @returns {Object[]} FAIL_JOB's rows, by column name */
function failJob(param) {
  const out = psql(db, FAIL_JOB.replaceAll('$1', () => `$p$${JSON.stringify(param)}$p$`));
  return out.split('\n').map((line) => Object.fromEntries(line.split('|').map((v, i) => [COLUMNS[i], v === '' ? null : v])));
}
const job = () => JSON.parse(psql(db, `SELECT row_to_json(j) FROM (SELECT status, stage, error_code, error,
  stage_at > now() - interval '5 seconds' AS staged_now, completed_at IS NOT NULL AS completed FROM royalty_jobs) AS j;`));
const set = (assignments) => psql(db, `UPDATE royalty_jobs SET ${assignments};`);
const ALERT = { alert_to: 'ops@inbox.test', alert_from: 'BookLeaf Author Relations <sender@bookleaf.test>' };

describe('Fail Job', () => {
  it('fails the running job of the failed execution as INTERNAL, naming the node and the message on one line', () => {
    expect(failJob(FAILED)).toEqual([{ job_id: JOB, error_code: 'INTERNAL', ...ALERT }]);
    expect(job()).toEqual({
      status: 'FAILED', stage: 'failed', error_code: 'INTERNAL', staged_now: true, completed: true,
      error: `${ERROR_CODES.INTERNAL.message} Node "Build Context": Failure drill: the workflow crashed on purpose.`,
    });
  });
  it('a job stopped while its email was being sent is EMAIL_UNCERTAIN: it may have gone out', () => {
    set("stage = 'sending'");
    expect(failJob(FAILED)[0]).toMatchObject({ job_id: JOB, error_code: 'EMAIL_UNCERTAIN' });
    expect(job()).toMatchObject({ status: 'FAILED', stage: 'failed', error_code: 'EMAIL_UNCERTAIN' });
    expect(job().error).toMatch(/^The workflow stopped while the email was being sent/);
  });
  it('never touches a job that has already ended, or another execution\'s job; still one row for the alert', () => {
    set("status = 'SENT', stage = 'sent'");
    const ended = job();
    expect(failJob(FAILED)).toEqual([{ job_id: null, error_code: null, ...ALERT }]);
    expect(job()).toEqual(ended);
    set("status = 'PROCESSING', stage = 'writing'");
    expect(failJob({ ...FAILED, execution_id: '232' })[0].job_id).toBeNull();
    expect(failJob({ execution_id: '', node: '', message: '' })[0].job_id).toBeNull();
    expect(job().status).toBe('PROCESSING');
  });
  it('a duplicate request\'s execution owns no job, so the earlier job is never failed by it', () => {
    expect(failJob({ ...FAILED, execution_id: '999' })).toEqual([{ job_id: null, error_code: null, ...ALERT }]);
    expect(job().status).toBe('PROCESSING');
  });
  it('defaults the node and message, caps the error at 1000 characters, and leaves alert_to empty when unset', () => {
    psql(db, "UPDATE bookleaf_settings SET value = '\"\"' WHERE key = 'alert_email';");
    expect(failJob({ execution_id: '231', node: '', message: 'x'.repeat(2000) })[0].alert_to).toBeNull();
    expect(job().error).toMatch(/Node "unknown node": x+$/);
    expect(job().error).toHaveLength(1000);
  });
});

describe('Sweep Stuck Jobs', () => {
  /** @returns {string[]} "job_id|error_code" per swept job */
  const sweep = () => psql(db, SWEEP_STUCK).split('\n').filter(Boolean).map((l) => l.split('|').filter((_, i) => i === 0 || i === 3).join('|'));
  it('fails a job not finished stuck_job_minutes (10) after it started as TIMEOUT', () => {
    set("created_at = now() - interval '11 minutes'");
    expect(sweep()).toEqual([`${JOB}|TIMEOUT`]);
    expect(job()).toMatchObject({ status: 'FAILED', stage: 'failed', error_code: 'TIMEOUT', completed: true });
    expect(job().error).toBe('The job did not finish within 10 minutes, so it was stopped. Send it again if needed.');
  });
  it('a job stuck at stage sending is EMAIL_UNCERTAIN: the email may have gone out', () => {
    set("created_at = now() - interval '11 minutes', stage = 'sending'");
    expect(sweep()).toEqual([`${JOB}|EMAIL_UNCERTAIN`]);
    expect(job().error).toBe(`${ERROR_CODES.EMAIL_UNCERTAIN.message} It was still sending 10 minutes after it started, so it was stopped.`);
  });
  it('leaves a younger job, an ended job and a draft alone; an approved draft counts from its claim', () => {
    set("created_at = now() - interval '9 minutes'");
    expect(sweep()).toEqual([]);
    set("created_at = now() - interval '2 days', status = 'DRAFTED', stage = 'drafted', drafted_at = now() - interval '2 days'");
    expect(sweep()).toEqual([]);
    set("status = 'PROCESSING', stage = 'sending', stage_at = now() - interval '1 minute'");
    expect(sweep()).toEqual([]);
    set("stage_at = now() - interval '11 minutes'");
    expect(sweep()).toEqual([`${JOB}|EMAIL_UNCERTAIN`]);
  });
});
