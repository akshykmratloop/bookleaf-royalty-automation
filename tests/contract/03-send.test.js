import { beforeAll, describe, expect, it } from 'vitest';
import { AUTHORS_BY_CLASS, payloadFor } from '../fixtures/payloads.js';
import { DEMO_INBOX, enqueue, enqueueFresh, jobStatus, waitForJob } from './client.js';

/** Real AI + real email: one author from each badge class (4 sends per run, all to the demo inbox). */
const started = {};
const done = {};

beforeAll(async () => {
  for (const [cls, author] of Object.entries(AUTHORS_BY_CLASS)) {
    started[cls] = await enqueueFresh(payloadFor(author, { demo_inbox: DEMO_INBOX, log_id: `contract_${cls}` }));
  }
  const finished = await Promise.all(Object.values(started).map((s) => waitForJob(s.body.job_id, { includeHtml: true })));
  Object.keys(started).forEach((cls, i) => { done[cls] = finished[i]; });
});

describe('enqueue', () => {
  it('answers 202 with a job id at once', () => {
    for (const s of Object.values(started)) expect(s.body).toMatchObject({ status: 'QUEUED', duplicate: false, job_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  });
  it('the same request again (a double click) returns the same job, marked duplicate', async () => {
    const s = started.overdue;
    const again = await enqueue(s.payload);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ job_id: s.body.job_id, duplicate: true });
  });
});

describe.each(Object.keys(AUTHORS_BY_CLASS))('%s author', (cls) => {
  it('is SENT to the demo inbox with verified figures and recorded cost', () => {
    const job = done[cls];
    expect(job, JSON.stringify({ error_code: job.error_code, error: job.error })).toMatchObject({ status: 'SENT', sent_to: DEMO_INBOX, error_code: null });
    expect(job.figures_verified).toBeGreaterThan(0);
    expect(job.ai_attempts).toBeGreaterThanOrEqual(1);
    expect(['anthropic', 'openai']).toContain(job.provider);
    expect(job.cost_usd).toBeGreaterThan(0);
    expect(job.html).toContain('BookLeaf');
    expect(job.text_body).toMatch(/Warm regards,\nBookLeaf Author Relations/);
  });
});

describe('content per badge class (figures come from data)', () => {
  it('overdue: table shows the totals; prose owns the delay and gives the 48-hour review', () => {
    expect(done.overdue.html).toContain('₹13,024');
    expect(done.overdue.text_body).toMatch(/48 hours/);
  });
  it('below threshold: explains the ₹1,000 minimum', () => {
    expect(done.belowThreshold.text_body).toContain('₹1,000');
    expect(done.belowThreshold.text_body).toContain('₹850');
  });
  it('all paid: nothing pending', () => expect(done.allPaid.html).toMatch(/Total<\/td>[\s\S]*₹0/));
  it('in production: lists the book with its stage', () => expect(done.inProduction.html).toContain('In Production - Cover Design'));
});

describe('job status endpoint', () => {
  it('returns several jobs in request order and hides html unless asked', async () => {
    const ids = Object.values(started).map((s) => s.body.job_id);
    const r = await jobStatus({ ids: ids.join(',') });
    expect(r.status).toBe(200);
    expect(r.body.jobs.map((j) => j.job_id)).toEqual(ids);
    expect(r.body.jobs[0]).not.toHaveProperty('html');
  });
});
