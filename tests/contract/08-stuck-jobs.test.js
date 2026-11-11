import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { psql } from '../db/psql.js';
import { BASE_URL, waitForJob } from './client.js';

/**
 * The Stuck Job Sweeper, end to end: two jobs left running 30 minutes ago (past stuck_job_minutes) are
 * failed by the next sweep, one stuck while sending (EMAIL_UNCERTAIN: it may have arrived) and one stuck
 * while writing (TIMEOUT). The jobs are written straight into the local stack's database, so it runs only
 * against the local n8n (never production). Bubble sees the result through job-status, as it would.
 */
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL);
const SWEEP_WAIT_MS = 150_000;

/** A PROCESSING job at `stage`, created and last moved 30 minutes ago. */
function stuckJob(stage) {
  const id = randomUUID();
  psql('bookleaf', `INSERT INTO royalty_jobs (job_id, author_id, mode, status, requested_by, stage, stage_at, created_at, updated_at)
    VALUES ('${id}', 'contract-sweeper', 'single', 'PROCESSING', 'contract@bookleaf.test', '${stage}',
      now() - interval '30 minutes', now() - interval '30 minutes', now() - interval '30 minutes');`);
  return id;
}

describe.skipIf(!LOCAL)('stuck jobs (local stack only)', () => {
  it('the sweeper fails a job stuck while sending as EMAIL_UNCERTAIN and one stuck while writing as TIMEOUT', async () => {
    const [sending, writing] = [stuckJob('sending'), stuckJob('writing')];
    const until = Date.now() + SWEEP_WAIT_MS;
    const settled = async (id) => {
      for (;;) {
        try {
          return await waitForJob(id, { until: ['FAILED'] });
        } catch (e) {
          if (Date.now() > until) throw e;
        }
      }
    };
    const [uncertain, timedOut] = [await settled(sending), await settled(writing)];
    expect(uncertain).toMatchObject({ status: 'FAILED', stage: 'failed', error_code: 'EMAIL_UNCERTAIN', completed_at: expect.any(String) });
    expect(uncertain.error).toMatch(/may or may not have arrived.*It was still sending \d+ minutes after it started/);
    expect(timedOut).toMatchObject({ status: 'FAILED', stage: 'failed', error_code: 'TIMEOUT' });
    expect(timedOut.error).toMatch(/did not finish within \d+ minutes/);
  }, SWEEP_WAIT_MS + 30_000);
});
