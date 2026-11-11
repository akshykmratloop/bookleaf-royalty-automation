import { describe, expect, it } from 'vitest';
import { insertParams, prepareJob } from '../../src/pipeline/prepare.js';
import { resolveReferenceDate } from '../../src/dates.js';
import { recipientFor } from '../../src/pipeline/recipient.js';
import { UUID } from '../../src/pipeline/ids.js';
import { fixedRandom, NOW, SETTINGS } from './settings-fixture.js';
import { payloadFor } from './fixtures.js';

const prep = (body, settings = SETTINGS, now = NOW) => prepareJob(body, settings, now, fixedRandom);
const WINDOW_MS = SETTINGS.duplicate_window_minutes * 60_000;

describe('prepareJob', () => {
  it('accepts a valid payload and builds the job', () => {
    const r = prep(payloadFor('AUTH002'));
    expect(r.ok).toBe(true);
    expect(r.job).toMatchObject({
      author_id: 'bubble_auth002', author_code: 'AUTH002', log_id: 'log_auth002', mode: 'single',
      reference_date: '2025-12-31', recipient: 'demo@inbox.test', attempt: 1,
      drills: { ai_down: false, email_down: false, data_down: false, primary_down: false },
      delivery: 'send', tone: 'warm', length: 'standard', note: '', sign_off: '',
    });
    expect(r.job.job_id).toMatch(UUID);
    expect(r.job.bundle.books).toHaveLength(2);
    expect(r.job.settings).toEqual(SETTINGS);
  });
  it('a double click (same data, same duplicate window) gives the same idempotency key', () => {
    const a = prep(payloadFor('AUTH002'));
    const b = prep(payloadFor('AUTH002', { log_id: 'another_log' }), SETTINGS, NOW + 60_000);
    expect(b.job.idem_key).toBe(a.job.idem_key);
  });
  it('changed data, a new attempt, a drill or the next window give a new key', () => {
    const base = prep(payloadFor('AUTH002')).job.idem_key;
    const changed = payloadFor('AUTH002');
    changed.books[0].paid += 1;
    expect(prep(changed).job.idem_key).not.toBe(base);
    expect(prep(payloadFor('AUTH002', { attempt: 2 })).job.idem_key).not.toBe(base);
    expect(prep(payloadFor('AUTH002', { drills: { ai_down: true } })).job.idem_key).not.toBe(base);
    expect(prep(payloadFor('AUTH002'), SETTINGS, NOW + WINDOW_MS).job.idem_key).not.toBe(base);
  });
  it('the window is the duplicate_window_minutes setting', () => {
    const oneMinute = { ...SETTINGS, duplicate_window_minutes: 1 };
    const at = (ms) => prep(payloadFor('AUTH002'), oneMinute, ms).job.idem_key;
    expect(at(NOW + 59_000)).toBe(at(NOW));
    expect(at(NOW + 60_000)).not.toBe(at(NOW));
  });
  it('delivery, tone, length, note and sign-off each change the idempotency key', () => {
    const base = prep(payloadFor('AUTH002')).job.idem_key;
    for (const over of [{ delivery: 'draft' }, { tone: 'formal' }, { length: 'short' }, { note: 'Be brief.' }, { sign_off: 'Priya' }]) {
      expect(prep(payloadFor('AUTH002', over)).job.idem_key, JSON.stringify(over)).not.toBe(base);
    }
    expect(prep(payloadFor('AUTH002', { tone: 'warm', length: 'standard', delivery: 'send' })).job.idem_key).toBe(base);
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
  it('fails INTERNAL (HTTP 500) on invalid or missing server settings, naming them, before reading the body', () => {
    const r = prep('not even an object', { ...SETTINGS, max_sends_per_hour: 'lots', email_from: '' });
    expect(r).toMatchObject({ ok: false, code: 'INTERNAL', http_status: 500 });
    expect(r.message).toContain('max_sends_per_hour must be a whole number');
    expect(r.message).toContain('email_from must be an email address');
    expect(prep(payloadFor('AUTH001'), null)).toMatchObject({ ok: false, code: 'INTERNAL' });
  });
  it('uses the reference_date_default setting when the request gives no date', () => {
    expect(prep(payloadFor('AUTH001', { reference_date: '' }), { ...SETTINGS, reference_date_default: '2025-09-30' }).job.reference_date).toBe('2025-09-30');
  });
  it('insertParams is one JSON value with the rate limit from max_sends_per_hour', () => {
    const p = JSON.parse(insertParams(prep(payloadFor('AUTH001'), { ...SETTINGS, max_sends_per_hour: 5 }).job));
    expect(p).toMatchObject({ author_id: 'bubble_auth001', max_sends: 5, mode: 'single' });
    expect(p).not.toHaveProperty('callback_status');
    expect(p).toMatchObject({ delivery: 'send', tone: 'warm', length: 'standard', note: '', sign_off: '', recipient: 'demo@inbox.test' });
    expect(p.drills).toEqual({ ai_down: false, email_down: false, data_down: false, primary_down: false });
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
