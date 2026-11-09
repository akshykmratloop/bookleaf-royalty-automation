import { describe, expect, it } from 'vitest';
import { insertParams, prepareJob } from '../../src/pipeline/prepare.js';
import { readConfig, resolveReferenceDate } from '../../src/pipeline/config.js';
import { recipientFor } from '../../src/pipeline/recipient.js';
import { IDEMPOTENCY_WINDOW_MS, UUID } from '../../src/pipeline/ids.js';
import { ENV, fixedRandom, NOW } from './env.js';
import { payloadFor } from './fixtures.js';

const prep = (body, env = ENV, now = NOW) => prepareJob(body, env, now, fixedRandom);

describe('prepareJob', () => {
  it('accepts a valid payload and builds the job', () => {
    const r = prep(payloadFor('AUTH002'));
    expect(r.ok).toBe(true);
    expect(r.job).toMatchObject({
      author_id: 'bubble_auth002', author_code: 'AUTH002', log_id: 'log_auth002', mode: 'single',
      reference_date: '2025-12-31', recipient: 'demo@inbox.test', attempt: 1,
      drills: { ai_down: false, email_down: false, data_down: false },
    });
    expect(r.job.job_id).toMatch(UUID);
    expect(r.job.bundle.books).toHaveLength(2);
  });
  it('a double click (same data, same 10-minute window) gives the same idempotency key', () => {
    const a = prep(payloadFor('AUTH002'));
    const b = prep(payloadFor('AUTH002', { log_id: 'another_log' }), ENV, NOW + 60_000);
    expect(b.job.idem_key).toBe(a.job.idem_key);
  });
  it('changed data, a new attempt, a drill or the next window give a new key', () => {
    const base = prep(payloadFor('AUTH002')).job.idem_key;
    const changed = payloadFor('AUTH002');
    changed.books[0].paid += 1;
    expect(prep(changed).job.idem_key).not.toBe(base);
    expect(prep(payloadFor('AUTH002', { attempt: 2 })).job.idem_key).not.toBe(base);
    expect(prep(payloadFor('AUTH002', { drills: { ai_down: true } })).job.idem_key).not.toBe(base);
    expect(prep(payloadFor('AUTH002'), ENV, NOW + IDEMPOTENCY_WINDOW_MS).job.idem_key).not.toBe(base);
  });
  it('returns field errors for a bad payload (VALIDATION, HTTP 400)', () => {
    const r = prep({ ...payloadFor('AUTH001'), mode: 'all', author_id: 'bad id!', reference_date: '31-12-2025' });
    expect(r).toMatchObject({ ok: false, code: 'VALIDATION', http_status: 400 });
    expect(r.fields.map((f) => f.path)).toEqual(['author_id', 'mode', 'reference_date']);
  });
  it('rejects a non-object body', () => expect(prep('hello')).toMatchObject({ ok: false, code: 'VALIDATION' }));
  it('requires author and books in payload mode, not in bubble mode', () => {
    const { author, books, ...bare } = payloadFor('AUTH001');
    expect(prep(bare).fields.map((f) => f.path)).toEqual(['author']);
    const bubbleEnv = { ...ENV, DATA_SOURCE: 'bubble', BUBBLE_APP_BASE: 'https://x.bubbleapps.io/version-test' };
    expect(prep(bare, bubbleEnv)).toMatchObject({ ok: true, job: { bundle: null, author_code: null } });
  });
  it('rejects drills when the server has them off', () => {
    const r = prep(payloadFor('AUTH001', { drills: { email_down: true } }), { ...ENV, ALLOW_DRILLS: 'false' });
    expect(r).toMatchObject({ ok: false, code: 'VALIDATION', fields: [{ path: 'drills', code: 'DISABLED' }] });
    expect(prep(payloadFor('AUTH001'), { ...ENV, ALLOW_DRILLS: 'false' }).ok).toBe(true);
  });
  it('rejects unknown drills and non-boolean values', () => {
    const r = prep(payloadFor('AUTH001', { drills: { ai_down: 'yes', fire: true } }));
    expect(r.fields.map((f) => f.path)).toEqual(['drills', 'drills.ai_down']);
  });
  it('fails NO_RECIPIENT when neither the request nor the server has a demo inbox', () => {
    const r = prep(payloadFor('AUTH001'), { ...ENV, DEFAULT_DEMO_INBOX: '' });
    expect(r).toMatchObject({ ok: false, code: 'NO_RECIPIENT', http_status: 422 });
  });
  it('uses the request demo inbox over the server default', () => {
    expect(prep(payloadFor('AUTH001', { demo_inbox: 'qa@inbox.test' })).job.recipient).toBe('qa@inbox.test');
  });
  it('validates attempt bounds', () => {
    expect(prep(payloadFor('AUTH001', { attempt: 0 })).fields[0].path).toBe('attempt');
    expect(prep(payloadFor('AUTH001', { attempt: '3' })).job.attempt).toBe(3);
  });
  it('fails INTERNAL on invalid server settings', () => {
    expect(prep(payloadFor('AUTH001'), { ...ENV, MAX_SENDS_PER_HOUR: 'lots' })).toMatchObject({ ok: false, code: 'INTERNAL' });
  });
  it('insertParams is one JSON value with the rate limit and callback status', () => {
    const p = JSON.parse(insertParams(prep(payloadFor('AUTH001')).job));
    expect(p).toMatchObject({ author_id: 'bubble_auth001', max_sends: 60, callback_status: 'NOT_NEEDED', mode: 'single' });
  });
});

describe('recipientFor', () => {
  const config = { defaultDemoInbox: 'demo@inbox.test' };
  it('never uses the author dataset address', () => {
    const r = recipientFor({ demo_inbox: 'priya.sharma@email.com' }, config, 'Priya.Sharma@email.com');
    expect(r).toMatchObject({ ok: false, code: 'NO_RECIPIENT' });
  });
  it('falls back to the server inbox', () => expect(recipientFor({ demo_inbox: null }, config, 'a@b.co').recipient).toBe('demo@inbox.test'));
});

describe('readConfig', () => {
  it('applies defaults', () => {
    const r = readConfig({ EMAIL_FROM: 's@b.co' });
    expect(r.config).toMatchObject({ dataSource: 'payload', callbackMode: 'pull', maxSendsPerHour: 60, allowDrills: false, effort: 'medium' });
  });
  it('requires an https Bubble URL for bubble data or push callbacks', () => {
    expect(readConfig({ ...ENV, CALLBACK_MODE: 'push' })).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(readConfig({ ...ENV, CALLBACK_MODE: 'push', BUBBLE_APP_BASE: 'https://a.bubbleapps.io' }).ok).toBe(true);
  });
  it('resolves "today" in India time', () => {
    expect(resolveReferenceDate('today', Date.UTC(2026, 0, 31, 20, 0))).toBe('2026-02-01');
    expect(resolveReferenceDate('2025-12-31', NOW)).toBe('2025-12-31');
  });
});
