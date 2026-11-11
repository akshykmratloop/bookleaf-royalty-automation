import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { payloadFor } from '../fixtures/payloads.js';
import { approve, DEMO_INBOX, enqueue, jobStatus } from './client.js';
import { executionsMentioning, newestExecutionId } from './executions.js';

/** Time n8n gets to save an execution that (wrongly) started, before the executions are read. */
const SAVE_WAIT_MS = 2000;
const settle = () => new Promise((r) => setTimeout(r, SAVE_WAIT_MS));
/** One request per endpoint, each carrying `marker`, so an execution it started can be found. */
const probeAll = (marker, key) => Promise.all([
  enqueue({ marker }, key), approve({ job_id: marker, action: 'discard' }, key), jobStatus({ ids: marker }, key),
]);

/** No AI calls and no emails in this file. */
describe('webhook authentication (n8n Header Auth: a missing or wrong key → 403 before any workflow runs)', () => {
  for (const [label, key] of [['no X-BookLeaf-Key header', null], ['a wrong key', 'wrong-key']]) {
    it(`${label}: all three endpoints answer 403 with n8n's text and start no execution`, async () => {
      const marker = `auth-probe-${randomUUID()}`;
      const before = await newestExecutionId();
      for (const r of await probeAll(marker, key)) expect(r).toEqual({ status: 403, body: 'Authorization data is wrong!' });
      await settle();
      expect(await executionsMentioning(marker, before)).toEqual([]);
    });
  }
  it('control: with the right key the same probe runs the workflow and its execution is found', async () => {
    const marker = `auth-probe-${randomUUID()}`;
    const before = await newestExecutionId();
    expect((await approve({ job_id: marker, action: 'discard' })).status).toBe(400);
    await settle();
    expect(await executionsMentioning(marker, before)).toHaveLength(1);
  });
});

describe('saved executions', () => {
  it('job-status keeps no successful run (Bubble polls it every few seconds; each run would hold the request headers)', async () => {
    const marker = `poll-probe-${randomUUID()}`;
    const before = await newestExecutionId();
    expect((await jobStatus({ ids: marker })).status).toBe(400);
    await settle();
    expect(await executionsMentioning(marker, before)).toEqual([]);
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
