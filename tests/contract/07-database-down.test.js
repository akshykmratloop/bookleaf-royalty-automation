import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { psqlAsync } from '../db/psql.js';
import { payloadFor } from '../fixtures/payloads.js';
import { BASE_URL, DEMO_INBOX, enqueue } from './client.js';

/**
 * The database fails before the webhook has answered: Bubble gets the documented 503 DB_UNAVAILABLE
 * body, not n8n's unshaped 500. Made real by holding enqueue_royalty_job's advisory lock longer than
 * its 5 s lock_timeout, so Enqueue Job fails. It needs the local stack's Postgres container, so it runs
 * only against the local n8n (never production, whose database it would hold up).
 */
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL);
const LOCK = "SELECT pg_advisory_lock(hashtextextended('bookleaf.enqueue_royalty_job', 0)); SELECT pg_sleep(8);";

describe.skipIf(!LOCAL)('database down before the answer (local stack only)', () => {
  it('a failed Enqueue Job answers 503 DB_UNAVAILABLE (retryable)', async () => {
    const holder = psqlAsync('bookleaf', LOCK);
    await new Promise((r) => setTimeout(r, 1500));
    const payload = payloadFor('AUTH004', { demo_inbox: DEMO_INBOX, drills: { data_down: true }, note: `db down ${randomUUID()}` });
    const r = await enqueue(payload);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: { code: 'DB_UNAVAILABLE', message: expect.stringContaining('database'), retryable: true } });
    expect((await holder).ok).toBe(true);
  }, 30_000);
});
