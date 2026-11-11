import { describe, expect, it } from 'vitest';
import { ERROR_CODES, MAX_ERROR_LENGTH } from '../../src/pipeline/errors.js';
import { FAIL_JOB, SWEEP_STUCK } from '../../src/pipeline/sql-failures.js';

/** Pins for the error handler's query; tests/db/failures.test.js runs it on real Postgres. */
describe('FAIL_JOB (error handler)', () => {
  it('finds the job by the failed execution\'s id, and only while it is still running', () => {
    expect(FAIL_JOB).toContain("WHERE execution_id = $1::jsonb->>'execution_id'");
    expect(FAIL_JOB).toContain("AND status IN ('QUEUED', 'PROCESSING')");
    expect(FAIL_JOB).not.toMatch(/job_id = \(/);
  });
  it('labels a job stopped while sending EMAIL_UNCERTAIN, anything else INTERNAL', () => {
    expect(FAIL_JOB).toContain("CASE WHEN stage = 'sending' THEN 'EMAIL_UNCERTAIN' ELSE 'INTERNAL' END");
    expect(FAIL_JOB).toContain(ERROR_CODES.EMAIL_UNCERTAIN.message.replaceAll("'", "''"));
    expect(FAIL_JOB).toContain(ERROR_CODES.INTERNAL.message);
    expect(FAIL_JOB).toContain(`, ${MAX_ERROR_LENGTH})`);
  });
  it('always returns one row with the alert address and the From line from the settings', () => {
    expect(FAIL_JOB).toMatch(/\)\s*SELECT \(SELECT job_id FROM failed LIMIT 1\) AS job_id/);
    expect(FAIL_JOB).toContain("bookleaf_setting('alert_email') #>> '{}' AS alert_to");
    expect(FAIL_JOB).toContain("bookleaf_setting('sender_name') #>> '{}'");
    expect(FAIL_JOB).toContain("bookleaf_setting('email_from') #>> '{}'");
  });
  it('EMAIL_UNCERTAIN is a known error code that is not retried blindly', () => {
    expect(ERROR_CODES.EMAIL_UNCERTAIN).toMatchObject({ retryable: false });
    expect(ERROR_CODES.EMAIL_UNCERTAIN.message).toMatch(/inbox/);
  });
});

describe('SWEEP_STUCK (sweeper)', () => {
  it('only fails QUEUED/PROCESSING jobs, never drafts', () => {
    expect(SWEEP_STUCK).toMatch(/WHERE status IN \('QUEUED', 'PROCESSING'\)/);
    expect(SWEEP_STUCK).not.toMatch(/DRAFTED|DISCARDED/);
    expect(SWEEP_STUCK).toMatch(/stage = 'failed'/);
  });
  it('waits stuck_job_minutes and says so in the error', () => {
    expect(SWEEP_STUCK).toContain("bookleaf_setting('stuck_job_minutes')::int");
    expect(SWEEP_STUCK).toContain('< now() - make_interval(mins => s.minutes)');
    expect(SWEEP_STUCK).toContain("format('The job did not finish within %s minutes");
    expect(SWEEP_STUCK).not.toMatch(/interval '\d+ minutes'/);
  });
  it('labels a job stuck at stage sending EMAIL_UNCERTAIN, anything else TIMEOUT', () => {
    expect(SWEEP_STUCK).toContain("CASE WHEN j.stage = 'sending' THEN 'EMAIL_UNCERTAIN' ELSE 'TIMEOUT' END");
    expect(SWEEP_STUCK).toContain(ERROR_CODES.EMAIL_UNCERTAIN.message);
    expect(SWEEP_STUCK).toMatch(/RETURNING .*error_code/);
  });
});
