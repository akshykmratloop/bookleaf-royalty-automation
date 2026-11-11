import { describe, expect, it } from 'vitest';
import { enqueueParams, prepareJob, rateLimitedResponse } from '../../src/pipeline/prepare.js';
import { resolveReferenceDate } from '../../src/dates.js';
import { recipientFor } from '../../src/pipeline/recipient.js';
import { NOW, SETTINGS } from './settings-fixture.js';
import { payloadFor } from './fixtures.js';

const prep = (body, settings = SETTINGS, now = NOW) => prepareJob(body, settings, now);
/** What enqueue_royalty_job hashes (SHA-256 of its canonical jsonb text) into the job's fingerprint. */
const fingerprintOf = (body, settings, now) => JSON.parse(enqueueParams(prep(body, settings, now).job, '1')).fingerprint_of;
/** The fields enqueue_royalty_job reads (infra/db/migrations/03-settings-enqueue.sql). */
const ENQUEUE_FIELDS = ['author_code', 'author_id', 'batch_id', 'delivery', 'drills', 'execution_id', 'fingerprint_of', 'length',
  'log_id', 'mode', 'note', 'recipient', 'requested_by', 'sign_off', 'tone'];
const FINGERPRINT_FIELDS = ['attempt', 'author_id', 'bundle', 'delivery', 'drills', 'length', 'note', 'recipient', 'reference_date', 'sign_off', 'tone'];

describe('prepareJob', () => {
  it('accepts a valid payload and builds the job', () => {
    const r = prep(payloadFor('AUTH002'));
    expect(r.ok).toBe(true);
    expect(r.job).toMatchObject({
      author_id: 'bubble_auth002', author_code: 'AUTH002', log_id: 'log_auth002', mode: 'single',
      reference_date: '2025-12-31', recipient: 'demo@inbox.test', attempt: 1,
      drills: { ai_down: false, email_down: false, data_down: false, primary_down: false, crash: false },
      delivery: 'send', tone: 'warm', length: 'standard', note: '', sign_off: '',
    });
    expect(r.job, 'enqueue_royalty_job makes the id').not.toHaveProperty('job_id');
    expect(r.job, 'enqueue_royalty_job makes the fingerprint').not.toHaveProperty('fingerprint');
    expect(r.job.bundle.books).toHaveLength(2);
    expect(r.job.settings).toEqual(SETTINGS);
  });
  it('a double click (same data) gives the same fingerprint data, whatever the time or log id', () => {
    const a = fingerprintOf(payloadFor('AUTH002'));
    expect(Object.keys(a).sort()).toEqual(FINGERPRINT_FIELDS);
    expect(fingerprintOf(payloadFor('AUTH002', { log_id: 'another_log' }), SETTINGS, NOW + 3_600_000)).toEqual(a);
    expect(prep(payloadFor('AUTH002')).job).not.toHaveProperty('idem_key');
  });
  it('changed data, a new attempt or a drill give new fingerprint data', () => {
    const base = fingerprintOf(payloadFor('AUTH002'));
    const changed = payloadFor('AUTH002');
    changed.books[0].paid += 1;
    expect(fingerprintOf(changed)).not.toEqual(base);
    expect(fingerprintOf(payloadFor('AUTH002', { attempt: 2 }))).not.toEqual(base);
    expect(fingerprintOf(payloadFor('AUTH002', { drills: { ai_down: true } }))).not.toEqual(base);
    expect(fingerprintOf(payloadFor('AUTH003'))).not.toEqual(base);
  });
  it('delivery, tone, length, note and sign-off each change the fingerprint data', () => {
    const base = fingerprintOf(payloadFor('AUTH002'));
    for (const over of [{ delivery: 'draft' }, { tone: 'formal' }, { length: 'short' }, { note: 'Be brief.' }, { sign_off: 'Priya' }]) {
      expect(fingerprintOf(payloadFor('AUTH002', over)), JSON.stringify(over)).not.toEqual(base);
    }
    expect(fingerprintOf(payloadFor('AUTH002', { tone: 'warm', length: 'standard', delivery: 'send' }))).toEqual(base);
  });
  it('carries the writing options on the job and rejects unknown values with 400', () => {
    const r = prep(payloadFor('AUTH002', { delivery: 'draft', tone: 'concise', length: 'detailed', note: ' Thank them. ', sign_off: 'Anita Rao' }));
    expect(r.job).toMatchObject({ delivery: 'draft', tone: 'concise', length: 'detailed', note: 'Thank them.', sign_off: 'Anita Rao' });
    const bad = prep(payloadFor('AUTH002', { delivery: 'email', tone: 'loud', length: 'epic' }));
    expect(bad).toMatchObject({ ok: false, code: 'VALIDATION', http_status: 400 });
    expect(bad.fields.map((f) => f.path)).toEqual(['delivery', 'tone', 'length']);
  });
  it('accepts the primary_down drill (only with the allow_drills setting)', () => {
    expect(prep(payloadFor('AUTH002', { drills: { primary_down: true } })).job.drills.primary_down).toBe(true);
    const off = prep(payloadFor('AUTH002', { drills: { primary_down: true } }), { ...SETTINGS, allow_drills: false });
    expect(off).toMatchObject({ ok: false, fields: [{ path: 'drills', code: 'DISABLED' }] });
  });
  it('accepts the crash drill (only with the allow_drills setting)', () => {
    expect(prep(payloadFor('AUTH002', { drills: { crash: true } })).job.drills.crash).toBe(true);
    const off = prep(payloadFor('AUTH002', { drills: { crash: true } }), { ...SETTINGS, allow_drills: false });
    expect(off).toMatchObject({ ok: false, fields: [{ path: 'drills', code: 'DISABLED' }] });
  });
  it('returns field errors for a bad payload (VALIDATION, HTTP 400)', () => {
    const r = prep({ ...payloadFor('AUTH001'), mode: 'all', author_id: 'bad id!', reference_date: '31-12-2025' });
    expect(r).toMatchObject({ ok: false, code: 'VALIDATION', http_status: 400 });
    expect(r.fields.map((f) => f.path)).toEqual(['author_id', 'mode', 'reference_date']);
  });
  it('rejects a non-object body', () => expect(prep('hello')).toMatchObject({ ok: false, code: 'VALIDATION' }));
  it('always requires the author and books in the request (n8n never reads Bubble data itself)', () => {
    const { author, books, ...bare } = payloadFor('AUTH001');
    expect(prep(bare).fields.map((f) => f.path)).toEqual(['author']);
    expect(prep({ ...bare, author }).fields.map((f) => f.path)).toEqual(['books']);
  });
  it('rejects drills when the server has them off', () => {
    const r = prep(payloadFor('AUTH001', { drills: { email_down: true } }), { ...SETTINGS, allow_drills: false });
    expect(r).toMatchObject({ ok: false, code: 'VALIDATION', fields: [{ path: 'drills', code: 'DISABLED', message: expect.stringContaining('allow_drills') }] });
    expect(prep(payloadFor('AUTH001'), { ...SETTINGS, allow_drills: false }).ok).toBe(true);
  });
  it('rejects unknown drills and non-boolean values', () => {
    const r = prep(payloadFor('AUTH001', { drills: { ai_down: 'yes', fire: true } }));
    expect(r.fields.map((f) => f.path)).toEqual(['drills', 'drills.ai_down']);
  });
  it('fails NO_RECIPIENT when neither the request nor the server has a demo inbox', () => {
    const r = prep(payloadFor('AUTH001'), { ...SETTINGS, default_demo_inbox: '' });
    expect(r).toMatchObject({ ok: false, code: 'NO_RECIPIENT', http_status: 422 });
    expect(r.message).toContain('default_demo_inbox');
  });
  it('uses the request demo inbox over the server default', () => {
    expect(prep(payloadFor('AUTH001', { demo_inbox: 'qa@inbox.test' })).job.recipient).toBe('qa@inbox.test');
  });
  it('validates attempt bounds', () => {
    expect(prep(payloadFor('AUTH001', { attempt: 0 })).fields[0].path).toBe('attempt');
    expect(prep(payloadFor('AUTH001', { attempt: '3' })).job.attempt).toBe(3);
  });
  it('uses the reference_date_default setting when the request gives no date', () => {
    expect(prep(payloadFor('AUTH001', { reference_date: '' }), { ...SETTINGS, reference_date_default: '2025-09-30' }).job.reference_date).toBe('2025-09-30');
  });
  it('enqueueParams is the one JSON value enqueue_royalty_job takes, with this execution\'s id', () => {
    const job = prep(payloadFor('AUTH001')).job;
    const p = JSON.parse(enqueueParams(job, '4711'));
    expect(Object.keys(p).sort()).toEqual(ENQUEUE_FIELDS);
    expect(p).toMatchObject({
      execution_id: '4711', author_id: 'bubble_auth001', author_code: 'AUTH001',
      mode: 'single', delivery: 'send', tone: 'warm', length: 'standard', note: '', sign_off: '', recipient: 'demo@inbox.test',
    });
    expect(p.drills).toEqual({ ai_down: false, email_down: false, data_down: false, primary_down: false, crash: false });
    expect(p.fingerprint_of).toMatchObject({ author_id: 'bubble_auth001', reference_date: '2025-12-31', recipient: 'demo@inbox.test', attempt: 1 });
    expect(p.fingerprint_of.bundle).toEqual(job.bundle);
  });
  it('enqueueParams refuses a missing execution id (the function would raise)', () => {
    expect(() => enqueueParams(prep(payloadFor('AUTH001')).job, '')).toThrow(TypeError);
  });
  it('the 429 answer names the max_sends_per_hour limit', () => {
    expect(rateLimitedResponse({ ...SETTINGS, max_sends_per_hour: 7 })).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many emails were sent in the last hour. The limit is 7 per hour; try again later.', retryable: true },
    });
  });
});

describe('recipientFor', () => {
  it('never uses the author dataset address', () => {
    const r = recipientFor({ demo_inbox: 'priya.sharma@email.com' }, SETTINGS, 'Priya.Sharma@email.com');
    expect(r).toMatchObject({ ok: false, code: 'NO_RECIPIENT' });
  });
  it('falls back to the server inbox', () => expect(recipientFor({ demo_inbox: null }, SETTINGS, 'a@b.co').recipient).toBe('demo@inbox.test'));
});

describe('resolveReferenceDate', () => {
  it('resolves "today" in India time', () => {
    expect(resolveReferenceDate('today', Date.UTC(2026, 0, 31, 20, 0))).toBe('2026-02-01');
    expect(resolveReferenceDate('2025-12-31', NOW)).toBe('2025-12-31');
  });
});
