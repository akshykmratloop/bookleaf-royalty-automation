import { beforeAll, describe, expect, it } from 'vitest';
import { payloadFor } from '../fixtures/payloads.js';
import { DEMO_INBOX, enqueueFresh, waitForJob } from './client.js';

/** Failure paths, forced with drills (server must run ALLOW_DRILLS=true). Only email_down makes one AI call. */
const drill = (author, drills) => payloadFor(author, { demo_inbox: DEMO_INBOX, drills });

describe('failure drills end as FAILED with a specific code, never silently', () => {
  const jobs = {};
  beforeAll(async () => {
    const started = await Promise.all([
      enqueueFresh(drill('AUTH001', { ai_down: true })),
      enqueueFresh(drill('AUTH005', { email_down: true })),
      enqueueFresh(drill('AUTH010', { data_down: true })),
    ]);
    const [ai, email, data] = await Promise.all(started.map((s) => waitForJob(s.body.job_id)));
    Object.assign(jobs, { ai, email, data });
  });

  it('AI down (both providers fail) → AI_UNAVAILABLE, naming both providers', () => {
    expect(jobs.ai).toMatchObject({ status: 'FAILED', error_code: 'AI_UNAVAILABLE', sent_to: null });
    expect(jobs.ai.error).toMatch(/anthropic: .*openai: /);
  });
  it('email down (SMTP unreachable) → EMAIL_FAILED with the server\'s own message, the draft is kept for the log', () => {
    expect(jobs.email).toMatchObject({ status: 'FAILED', stage: 'failed', error_code: 'EMAIL_FAILED', sent_to: null });
    expect(jobs.email.error).toMatch(/^The email server did not accept the email\. smtp: .*ECONNREFUSED/);
    expect(jobs.email.subject).toBeTruthy();
    expect(jobs.email.ai_attempts).toBeGreaterThanOrEqual(1);
    expect(['anthropic', 'openai']).toContain(jobs.email.provider);
  });
  it('data down → DATA_UNAVAILABLE before any AI call', () => {
    expect(jobs.data).toMatchObject({ status: 'FAILED', error_code: 'DATA_UNAVAILABLE', ai_attempts: 0 });
  });
  it('every failed job has a completion time', () => {
    for (const j of Object.values(jobs)) expect(j.completed_at).toBeTruthy();
  });
});

describe('figures that do not add up', () => {
  it('→ INTEGRITY, before any AI call', async () => {
    const p = drill('AUTH003', {});
    p.books = [{ ...p.books[0], pending: p.books[0].pending + 1 }];
    const s = await enqueueFresh(p);
    const job = await waitForJob(s.body.job_id);
    expect(job).toMatchObject({ status: 'FAILED', error_code: 'INTEGRITY', ai_attempts: 0 });
  });
});
