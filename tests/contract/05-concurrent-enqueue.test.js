import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { payloadFor } from '../fixtures/payloads.js';
import { DEMO_INBOX, enqueue, waitForJob } from './client.js';

/**
 * A burst of identical clicks reaches n8n at the same moment: enqueue_royalty_job's advisory lock lets
 * exactly one become a job; the others get that job back as duplicates. The data_down drill ends the
 * job before any AI call, and a fresh note makes the request new on every run (no AI, no email).
 */
const CLICKS = 3;

describe('simultaneous identical requests', () => {
  it(`${CLICKS} at once → exactly one 202; the others are 200 duplicates of the same job`, async () => {
    const payload = payloadFor('AUTH004', { demo_inbox: DEMO_INBOX, drills: { data_down: true }, note: `burst ${randomUUID()}` });
    const answers = await Promise.all(Array.from({ length: CLICKS }, () => enqueue(payload)));
    const accepted = answers.filter((a) => a.status === 202);
    expect(accepted, JSON.stringify(answers)).toHaveLength(1);
    const jobId = accepted[0].body.job_id;
    expect(accepted[0].body).toEqual({ job_id: jobId, status: 'QUEUED', duplicate: false });
    const duplicates = answers.filter((a) => a.status !== 202);
    expect(duplicates.map((a) => a.status)).toEqual(Array(CLICKS - 1).fill(200));
    for (const d of duplicates) expect(d.body).toMatchObject({ job_id: jobId, duplicate: true });
    const job = await waitForJob(jobId);
    expect(job).toMatchObject({ status: 'FAILED', error_code: 'DATA_UNAVAILABLE', ai_attempts: 0 });
  });
});
