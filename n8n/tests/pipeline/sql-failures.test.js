import { describe, expect, it } from 'vitest';
import { ERROR_CODES, MAX_ERROR_LENGTH } from '../../src/pipeline/errors.js';
import { FAIL_JOB } from '../../src/pipeline/sql-failures.js';

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
