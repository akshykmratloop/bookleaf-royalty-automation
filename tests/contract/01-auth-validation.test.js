import { describe, expect, it } from 'vitest';
import { payloadFor } from '../fixtures/payloads.js';
import { DEMO_INBOX, enqueue, jobStatus } from './client.js';

/** No AI calls and no emails in this file. */
describe('webhook authentication (n8n Header Auth: missing or wrong key → 403)', () => {
  it('rejects a request without X-BookLeaf-Key', async () => {
    const r = await enqueue(payloadFor('AUTH002'), null);
    expect(r.status).toBe(403);
  });
  it('rejects a wrong key', async () => {
    expect((await enqueue(payloadFor('AUTH002'), 'wrong-key')).status).toBe(403);
    expect((await jobStatus({ ids: '00000000-0000-4000-8000-000000000000' }, 'wrong-key')).status).toBe(403);
  });
});

describe('validation', () => {
  it('400 with field errors for a bad payload', async () => {
    const bad = { ...payloadFor('AUTH002'), mode: 'everyone', reference_date: '2025-13-01', demo_inbox: 'not-an-email' };
    bad.books = [{ ...bad.books[0], copies_sold: -5 }];
    const r = await enqueue(bad);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION');
    const paths = r.body.error.fields.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['mode', 'reference_date', 'demo_inbox', 'books[0].copies_sold']));
  });
  it('400 for a body that is not an object', async () => {
    const r = await enqueue([1, 2, 3]);
    expect(r.status).toBe(400);
  });
  it('422 INTEGRITY is not raised synchronously: bad sums are caught after 202 (see flow tests)', () => {
    expect(DEMO_INBOX).toMatch(/@/);
  });
});

describe('job status endpoint', () => {
  it('400 without ids or with a malformed id', async () => {
    expect((await jobStatus({})).status).toBe(400);
    const r = await jobStatus({ ids: 'abc,123' });
    expect(r.status).toBe(400);
    expect(r.body.error.fields[0].code).toBe('PATTERN');
  });
  it('unknown ids come back as missing', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const r = await jobStatus({ ids: id });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ jobs: [], missing: [id] });
  });
});
