import { describe, expect, it } from 'vitest';
import { afterAi } from '../../src/pipeline/after-ai.js';
import {
  APPROVE_ROUTES, approvedFailedUpdate, approvedSentUpdate, claimOutcome, decideApproval, discardOutcome,
} from '../../src/pipeline/approve.js';
import { approveResponse, validateApprove } from '../../src/pipeline/approve-request.js';
import { buildContext } from '../../src/pipeline/context.js';
import { draftUpdate } from '../../src/pipeline/finalize.js';
import { prepareJob } from '../../src/pipeline/prepare.js';
import { ENV, fixedRandom, NOW } from './env.js';
import { payloadFor } from './fixtures.js';
import { anthropicOk } from './ai-fixtures.js';

const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const job = prepareJob(payloadFor('AUTH002', { delivery: 'draft', sign_off: 'Anita Rao' }), ENV, NOW, fixedRandom).job;
const ctx = buildContext(job).ctx;
const ai = afterAi({ response: anthropicOk(), ctx, job, attempt: 1 }).ai;
const draft = draftUpdate({ ctx, job, ai });
const config = { emailFrom: 'sender@bookleaf.test', brand: { name: 'BookLeaf Publishing', supportEmail: '' } };
/** The SELECT_DRAFT row for this draft (jsonb columns come back parsed). */
const row = (over = {}) => ({
  job_id: ID, status: 'DRAFTED', stage: 'drafted', tone: job.tone, length: job.length, sign_off: job.sign_off,
  recipient: job.recipient, sections: draft.sections, facts: draft.facts, titles: draft.titles, drills: job.drills, fresh: true, ...over,
});
const req = (over = {}) => ({ job_id: ID, action: 'check', subject: draft.subject, body: draft.edit_text, ...over });
const decide = (r, rw = row()) => decideApproval({ request: req(r), row: rw, config });

describe('draftUpdate', () => {
  it('stores a DRAFTED row with sections, facts, titles and editable text', () => {
    expect(draft).toMatchObject({ job_id: job.job_id, status: 'DRAFTED', stage: 'drafted', author_code: 'AUTH002', provider: 'anthropic' });
    expect(draft.edit_text).toContain('\n\n[FIGURES TABLE]\n\n');
    expect(draft.titles).toEqual(['Code & Karma', 'Startup Sutra']);
    expect(draft.facts.totals.pending).toBe(13024);
    expect(draft.text_body).toMatch(/Warm regards,\nAnita Rao$/);
    expect(draft).not.toHaveProperty('sent_to');
  });
});

describe('validateApprove', () => {
  it('accepts check/send with subject and body, discard without', () => {
    expect(validateApprove(req())).toMatchObject({ ok: true, value: { job_id: ID, action: 'check' } });
    expect(validateApprove({ job_id: ID.toUpperCase(), action: 'discard' })).toMatchObject({ ok: true, value: { job_id: ID, action: 'discard' } });
  });
  it.each([
    [{ job_id: '' }, 'job_id'], [{ job_id: 'x'.repeat(65) }, 'job_id'], [{ job_id: 'not-a-uuid' }, 'job_id'],
    [{ action: 'approve' }, 'action'], [{ subject: '' }, 'subject'], [{ subject: 'a\nb' }, 'subject'],
    [{ subject: 's'.repeat(201) }, 'subject'], [{ body: '' }, 'body'], [{ body: 'b'.repeat(8001) }, 'body'], [{ body: 7 }, 'body'],
  ])('400 for %j', (over, path) => {
    const r = validateApprove(req(over));
    expect(r).toMatchObject({ ok: false, code: 'VALIDATION', http_status: 400 });
    expect(r.fields.map((f) => f.path)).toContain(path);
  });
  it('rejects a body that is not an object', () => expect(validateApprove(null)).toMatchObject({ ok: false, http_status: 400 }));
});

describe('approveResponse', () => {
  it('always has the same fields', () => {
    expect(approveResponse({ job_id: ID })).toEqual({
      ok: false, job_id: ID, status: '', passed: false, issues: '', issue_count: 0, html: '', words: 0, figures_verified: 0, error_code: '', error: '',
    });
  });
});

describe('decideApproval', () => {
  it('NOT_FOUND, NOT_A_DRAFT, ALREADY_SENT and DRAFT_EXPIRED answer at once with HTTP 200', () => {
    expect(decide({}, {}).response).toMatchObject({ ok: false, error_code: 'NOT_FOUND', status: '' });
    expect(decide({}, row({ status: 'SENT' })).response).toMatchObject({ ok: false, error_code: 'NOT_A_DRAFT', status: 'SENT' });
    expect(decide({ action: 'send' }, row({ status: 'SENT' })).response).toMatchObject({ error_code: 'ALREADY_SENT', status: 'SENT' });
    expect(decide({ action: 'send' }, row({ status: 'PROCESSING' })).response).toMatchObject({ error_code: 'ALREADY_SENT' });
    expect(decide({}, row({ fresh: false })).response).toMatchObject({ ok: false, error_code: 'DRAFT_EXPIRED', status: 'DRAFTED' });
    for (const r of [decide({}, {}), decide({}, row({ fresh: false }))]) expect(r).toMatchObject({ route: APPROVE_ROUTES.RESPOND, http_status: 200 });
  });
  it('check: runs the checker, returns a preview, changes nothing', () => {
    const r = decide({});
    expect(r.route).toBe(APPROVE_ROUTES.RESPOND);
    expect(r.response).toMatchObject({ ok: true, status: 'DRAFTED', passed: true, error_code: '' });
    expect(r.response.html).toContain('₹13,024');
    expect(r.response.figures_verified).toBe(ai.verified_figures);
    expect(r.response.words).toBeGreaterThan(50);
  });
  it('check: an edited wrong amount fails with the issue listed', () => {
    const r = decide({ body: draft.edit_text.replace('₹5,280', '₹9,999') });
    expect(r.response).toMatchObject({ ok: true, passed: false, issue_count: expect.any(Number) });
    expect(r.response.issues).toContain('₹9,999');
  });
  it('send: blocking issues → EDIT_BLOCKED, nothing claimed', () => {
    const r = decide({ action: 'send', body: draft.edit_text.replace('₹5,280', '₹9,999') });
    expect(r.route).toBe(APPROVE_ROUTES.RESPOND);
    expect(r.response).toMatchObject({ ok: false, error_code: 'EDIT_BLOCKED', passed: false, html: '' });
  });
  it('send: a clean edit is claimed, with the email to the stored demo inbox', () => {
    const r = decide({ action: 'send', subject: 'Edited subject' });
    expect(r.route).toBe(APPROVE_ROUTES.CLAIM);
    expect(JSON.parse(r.params)).toEqual({ job_id: ID });
    expect(r.email).toMatchObject({ to: 'demo@inbox.test', subject: 'Edited subject', from: 'BookLeaf Author Relations <sender@bookleaf.test>' });
    expect(r.email.text).toMatch(/Warm regards,\nAnita Rao$/);
    expect(r.drill).toBe(false);
    expect(r.response).toMatchObject({ ok: true, status: 'PROCESSING', passed: true, html: '' });
  });
  it('send: the email-down drill stored on the job is honoured', () => {
    expect(decide({ action: 'send' }, row({ drills: { email_down: true } })).drill).toBe(true);
  });
  it('discard: routes to the discard update (even for an expired draft)', () => {
    expect(decide({ action: 'discard' }, row({ fresh: false })).route).toBe(APPROVE_ROUTES.DISCARD);
  });
});

describe('claim and discard outcomes', () => {
  const decided = decide({ action: 'send' });
  it('a claimed row continues to the email; no row means a double click → ALREADY_SENT', () => {
    expect(claimOutcome({ row: { job_id: ID, status: 'PROCESSING' }, decided })).toMatchObject({ route: 1, response: decided.response });
    expect(claimOutcome({ row: {}, decided })).toMatchObject({ route: 0, http_status: 200, response: { ok: false, error_code: 'ALREADY_SENT' } });
  });
  it('discard: DISCARDED, or NOT_A_DRAFT when it changed meanwhile', () => {
    expect(discardOutcome({ row: { job_id: ID, status: 'DISCARDED' }, jobId: ID }).response).toMatchObject({ ok: true, status: 'DISCARDED' });
    expect(discardOutcome({ row: {}, jobId: ID }).response).toMatchObject({ ok: false, error_code: 'NOT_A_DRAFT' });
  });
  it('final updates: SENT with the edited email, or FAILED keeping it for the log', () => {
    expect(approvedSentUpdate(ID, decided.email)).toMatchObject({ job_id: ID, status: 'SENT', stage: 'sent', subject: decided.email.subject, sent_to: 'demo@inbox.test' });
    const f = approvedFailedUpdate(ID, decided.email, { error: { message: 'connect ECONNREFUSED 127.0.0.1:9' } });
    expect(f).toMatchObject({ job_id: ID, status: 'FAILED', error_code: 'EMAIL_FAILED', html: decided.email.html });
    expect(f.error).toContain('smtp: connect ECONNREFUSED');
    expect(f).not.toHaveProperty('sent_to');
  });
});
