import { describe, expect, it } from 'vitest';
import { afterAi } from '../../src/pipeline/after-ai.js';
import { APPROVE_ROUTES, claimOutcome, decideApproval, discardOutcome } from '../../src/pipeline/approve.js';
import { approveResponse, validateApprove } from '../../src/pipeline/approve-request.js';
import { buildContext } from '../../src/pipeline/context.js';
import { draftUpdate } from '../../src/pipeline/finalize.js';
import { prepareJob } from '../../src/pipeline/prepare.js';
import { fixedRandom, NOW, SETTINGS } from './settings-fixture.js';
import { payloadFor } from './fixtures.js';
import { anthropicOk } from './ai-fixtures.js';

const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const job = prepareJob(payloadFor('AUTH002', { delivery: 'draft', sign_off: 'Anita Rao' }), SETTINGS, NOW, fixedRandom).job;
const ctx = buildContext(job).ctx;
const ai = afterAi({ response: anthropicOk(), ctx, job, attempt: 1 }).ai;
const draft = draftUpdate({ ctx, job, ai });
/** The SELECT_DRAFT row for this draft (jsonb columns come back parsed). */
const row = (over = {}) => ({
  job_id: ID, status: 'DRAFTED', stage: 'drafted', tone: job.tone, length: job.length, sign_off: job.sign_off,
  recipient: job.recipient, sections: draft.sections, facts: draft.facts, titles: draft.titles, drills: job.drills, fresh: true, ...over,
});
const req = (over = {}) => ({ job_id: ID, action: 'check', subject: draft.subject, body: draft.edit_text, ...over });
const decide = (r, rw = row(), settings = SETTINGS) => decideApproval({ request: req(r), row: rw, settings });

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
    expect(decide({}, row({ fresh: false })).response).toMatchObject({
      ok: false, error_code: 'DRAFT_EXPIRED', status: 'DRAFTED', error: 'This draft is more than 24 hours old. Create a new draft.',
    });
    expect(decide({}, row({ fresh: false }), { ...SETTINGS, draft_ttl_hours: 6 }).response.error).toContain('more than 6 hours old');
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
  it('send: a clean edit is claimed, then handed to Deliver Email for the stored demo inbox', () => {
    const r = decide({ action: 'send', subject: 'Edited subject' });
    expect(r.route).toBe(APPROVE_ROUTES.CLAIM);
    expect(JSON.parse(r.params)).toEqual({ job_id: ID });
    expect(Object.keys(r.deliver)).toEqual(['job_id', 'email', 'drill', 'record']);
    expect(r.deliver).toMatchObject({ job_id: ID, drill: false, record: {} });
    expect(r.deliver.email).toMatchObject({ to: 'demo@inbox.test', subject: 'Edited subject', from: 'BookLeaf Author Relations <sender@bookleaf.test>' });
    expect(r.deliver.email.text).toMatch(/Warm regards,\nAnita Rao$/);
    expect(r.deliver.email.html).toContain('₹13,024');
    expect(r.response).toMatchObject({ ok: true, status: 'PROCESSING', passed: true, html: '' });
  });
  it('send: sender, brand and default signature come from the settings', () => {
    const { email } = decide({ action: 'send' }, row({ sign_off: '' }), { ...SETTINGS, sender_name: 'Royalty Desk', brand_name: 'Leaf Co' }).deliver;
    expect(email.from).toBe('Royalty Desk <sender@bookleaf.test>');
    expect(email.text).toMatch(/Warm regards,\nRoyalty Desk$/);
    expect(email.html).toContain('Leaf Co');
  });
  it('send: the email-down drill stored on the job is honoured', () => {
    expect(decide({ action: 'send' }, row({ drills: { email_down: true } })).deliver.drill).toBe(true);
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
});
