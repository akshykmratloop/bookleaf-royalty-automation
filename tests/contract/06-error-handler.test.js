import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { payloadFor } from '../fixtures/payloads.js';
import { DEMO_INBOX, enqueueFresh, waitForJob } from './client.js';
import { newestExecutionId, waitForExecution } from './executions.js';

/**
 * The crash drill makes Build Context throw, like an unexpected bug. n8n then runs "BookLeaf - Error
 * Handler", which fails the job by its execution id and alerts alert_email (the demo inbox locally).
 * No AI call; one alert email.
 */
const ERROR_HANDLER = 'BookLeaf - Error Handler';
const ROYALTY_SUMMARY = 'BookLeaf - Royalty Summary';
const ranNodes = (execution) => Object.keys(execution.data?.resultData?.runData ?? {});

describe('an unexpected failure ends the job by its execution id and sends an alert', () => {
  let job;
  let handler;
  let crashed;
  const note = `crash ${randomUUID()}`;
  beforeAll(async () => {
    const before = await newestExecutionId();
    const started = await enqueueFresh(payloadFor('AUTH004', { demo_inbox: DEMO_INBOX, drills: { crash: true }, note }));
    expect(started.status).toBe(202);
    job = await waitForJob(started.body.job_id);
    handler = await waitForExecution(job.job_id, before, (e) => e.workflowData?.name === ERROR_HANDLER && e.finished);
    crashed = await waitForExecution(note, before, (e) => e.workflowData?.name === ROYALTY_SUMMARY && e.status === 'error');
  });

  it('the failed run is still saved (the error handler needs it), so the execution search finds a saved run', () => {
    expect(ranNodes(crashed)).toContain('Build Context');
  });

  it('the job is FAILED (INTERNAL), naming the node that crashed, at stage failed with a completion time', () => {
    expect(job).toMatchObject({ status: 'FAILED', stage: 'failed', error_code: 'INTERNAL', ai_attempts: 0, sent_to: null });
    expect(job.error).toMatch(/^An unexpected error stopped the workflow\. Node "Build Context": Failure drill: the workflow crashed on purpose\./);
    expect(job.completed_at).toBeTruthy();
  });
  it('the error handler found the job without the n8n API and sent the alert', () => {
    expect(handler.status).toBe('success');
    expect(ranNodes(handler)).toEqual(['Error Trigger', 'Fail Job', 'Alert Address', 'Alert Set?', 'Send Alert']);
    const [row] = handler.data.resultData.runData['Fail Job'][0].data.main[0];
    expect(row.json).toMatchObject({ job_id: job.job_id, error_code: 'INTERNAL', alert_to: expect.stringContaining('@') });
    const [address] = handler.data.resultData.runData['Alert Address'][0].data.main[0];
    expect(address.json).toMatchObject({ job_id: job.job_id, alert_to: row.json.alert_to, db_error: null });
  });
});
