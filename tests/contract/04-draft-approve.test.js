import { beforeAll, describe, expect, it } from 'vitest';
import { payloadFor } from '../fixtures/payloads.js';
import { approve, DEMO_INBOX, enqueue, enqueueFresh, jobStatus, waitForJob } from './client.js';

/**
 * Drafts, the approve endpoint, writing options, the primary-down drill and live stages.
 * Real AI (3 drafts/sends) and 2 real emails, all to the demo inbox.
 */
const STAGES = ['queued', 'reading_data', 'writing', 'checking', 'rewriting', 'sending', 'sent', 'drafted', 'failed', 'discarded'];
const UNKNOWN_JOB = '00000000-0000-4000-8000-000000000000';
const drafts = {};
let primaryDown;

/** The edited body with its first rupee amount changed to one that is in no record. */
const withWrongAmount = (text) => text.replace(/₹[\d,]+/, '₹98,765');
const act = (job, action, over = {}) => approve({ job_id: job.job_id, action, subject: job.subject, body: job.edit_text, ...over });

beforeAll(async () => {
  const started = await Promise.all([
    enqueueFresh(payloadFor('AUTH002', { demo_inbox: DEMO_INBOX, delivery: 'draft', log_id: 'contract_draft_send' })),
    enqueueFresh(payloadFor('AUTH001', {
      demo_inbox: DEMO_INBOX, delivery: 'draft', tone: 'formal', length: 'short', sign_off: 'Anita Rao', log_id: 'contract_draft_discard',
    })),
    enqueueFresh(payloadFor('AUTH008', { demo_inbox: DEMO_INBOX, drills: { primary_down: true }, log_id: 'contract_primary_down' })),
  ]);
  const [send, discard, primary] = await Promise.all(started.map((s) => waitForJob(s.body.job_id, { includeHtml: true })));
  Object.assign(drafts, { send, discard });
  primaryDown = primary;
});

describe('delivery=draft', () => {
  it('ends DRAFTED (stage drafted) with editable text holding the figures-table marker, nothing sent', () => {
    const d = drafts.send;
    expect(d, JSON.stringify({ error_code: d.error_code, error: d.error })).toMatchObject({ status: 'DRAFTED', stage: 'drafted', delivery: 'draft', sent_to: null });
    expect(d.edit_text).toContain('\n\n[FIGURES TABLE]\n\n');
    expect(d.drafted_at).toBeTruthy();
    expect(d.figures_verified).toBeGreaterThan(0);
    expect(d.html).toContain('₹13,024');
  });
  it('stores tone and length; the custom sign-off is rendered from data', () => {
    expect(drafts.discard).toMatchObject({ status: 'DRAFTED', tone: 'formal', length: 'short' });
    expect(drafts.discard.text_body).toMatch(/Kind regards,\nAnita Rao$/);
  });
});

describe('approve: check', () => {
  it('the unedited draft passes and returns an HTML preview', async () => {
    const r = await act(drafts.send, 'check');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, status: 'DRAFTED', passed: true, error_code: '', error: '' });
    expect(r.body.html).toContain('₹13,024');
    expect(r.body.html).not.toContain('[FIGURES TABLE]');
  });
  it('an edited wrong ₹ amount fails the check with the issue listed', async () => {
    const r = await act(drafts.send, 'check', { body: withWrongAmount(drafts.send.edit_text) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, passed: false });
    expect(r.body.issue_count).toBeGreaterThanOrEqual(1);
    expect(r.body.issues).toContain('₹98,765');
  });
});

describe('approve: send', () => {
  it('a wrong amount is EDIT_BLOCKED and the draft stays a draft', async () => {
    const r = await act(drafts.send, 'send', { body: withWrongAmount(drafts.send.edit_text) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, error_code: 'EDIT_BLOCKED', passed: false });
    expect((await jobStatus({ ids: drafts.send.job_id })).body.jobs[0].status).toBe('DRAFTED');
  });
  it('a valid send is answered at once, a second click is ALREADY_SENT, and the job ends SENT', async () => {
    const subject = `${drafts.send.subject} (approved)`;
    const first = await act(drafts.send, 'send', { subject });
    expect(first.body).toMatchObject({ ok: true, status: 'PROCESSING', passed: true });
    const second = await act(drafts.send, 'send', { subject });
    expect(second.body).toMatchObject({ ok: false, error_code: 'ALREADY_SENT' });
    const job = await waitForJob(drafts.send.job_id, { until: ['SENT', 'FAILED'], includeHtml: true });
    expect(job, JSON.stringify({ error_code: job.error_code, error: job.error })).toMatchObject({ status: 'SENT', stage: 'sent', sent_to: DEMO_INBOX, subject });
    expect(job.text_body).toMatch(/Warm regards,\nBookLeaf Author Relations$/);
  });
});

describe('approve: discard and errors', () => {
  it('discard → DISCARDED; the job can no longer be checked or sent', async () => {
    const r = await act(drafts.discard, 'discard');
    expect(r.body).toMatchObject({ ok: true, status: 'DISCARDED' });
    const job = (await jobStatus({ ids: drafts.discard.job_id })).body.jobs[0];
    expect(job).toMatchObject({ status: 'DISCARDED', stage: 'discarded' });
    expect((await act(drafts.discard, 'send')).body).toMatchObject({ ok: false, error_code: 'NOT_A_DRAFT', status: 'DISCARDED' });
  });
  it('unknown job → NOT_FOUND (HTTP 200)', async () => {
    const r = await approve({ job_id: UNKNOWN_JOB, action: 'discard' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, error_code: 'NOT_FOUND' });
  });
  it('a bad key is 403, a bad body 400', async () => {
    expect((await approve({ job_id: UNKNOWN_JOB, action: 'discard' }, 'wrong-key')).status).toBe(403);
    const r = await approve({ job_id: 'nope', action: 'publish' });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.map((f) => f.path)).toEqual(['job_id', 'action']);
  });
});

describe('writing options and the primary-down drill', () => {
  it('an unknown tone is rejected with 400', async () => {
    const r = await enqueue(payloadFor('AUTH002', { demo_inbox: DEMO_INBOX, tone: 'angry', length: 'epic' }));
    expect(r.status).toBe(400);
    expect(r.body.error.fields.map((f) => f.path)).toEqual(['tone', 'length']);
  });
  it('primary_down: Anthropic fails, the OpenAI fallback writes and the email is SENT', () => {
    expect(primaryDown, JSON.stringify({ error_code: primaryDown.error_code, error: primaryDown.error })).toMatchObject({ status: 'SENT', stage: 'sent', provider: 'openai' });
    expect(primaryDown.model).toMatch(/^gpt-/);
  });
  it('job status reports a known stage for every job', () => {
    for (const j of [primaryDown, drafts.send, drafts.discard]) expect(STAGES).toContain(j.stage);
  });
});
