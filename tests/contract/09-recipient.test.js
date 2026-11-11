import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { psql } from '../db/psql.js';
import { payloadFor } from '../fixtures/payloads.js';
import { BASE_URL, enqueue } from './client.js';

/**
 * Emails go only to the configured demo inboxes. A request naming any other demo_inbox is refused before
 * a job exists (422 RECIPIENT_NOT_ALLOWED), so nothing is written by the AI and nothing is emailed; it is
 * never quietly redirected to the default inbox. On the local stack the database is also checked: no job
 * row carries the request's log id.
 */
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL);

describe('recipient allow-list', () => {
  it('a demo_inbox that is not allowed is refused with 422 RECIPIENT_NOT_ALLOWED, and no job is made', async () => {
    const marker = randomUUID();
    const outsider = `outsider-${marker}@example.com`;
    const r = await enqueue(payloadFor('AUTH002', { demo_inbox: outsider, log_id: `contract_recipient_${marker.slice(0, 8)}` }));
    expect(r.status).toBe(422);
    expect(r.body).toEqual({ error: { code: 'RECIPIENT_NOT_ALLOWED', message: expect.stringContaining('allowed_demo_inboxes'), retryable: false } });
    expect(r.body.error.message).not.toContain(outsider);
    if (LOCAL) {
      const rows = psql('bookleaf', `SELECT count(*) FROM royalty_jobs WHERE log_id = 'contract_recipient_${marker.slice(0, 8)}';`);
      expect(rows).toBe('0');
    }
  });
});
