import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MARK_EMAIL_FAILED, MARK_SENDING, MARK_SENT } from '../../n8n/src/pipeline/sql.js';
import { dropDatabase, psql, scratchDatabase } from './psql.js';

/**
 * The three queries of "BookLeaf - Deliver Email" against real Postgres: Mark Sending,
 * Mark Sent and Mark Failed. n8n's Postgres node writes its parameter into the SQL as a literal, and
 * so does run().
 */
const JOB = '00000000-0000-4000-8000-000000000001';
const EMAIL = { subject: 'Your BookLeaf royalty summary', html: "<p>₹13,024 isn't late</p>", text_body: 'Dear Rohit,\n\n₹13,024' };
const RECORD = { author_code: 'AUTH002', provider: 'anthropic', model: 'claude-sonnet-5-5', ai_attempts: 1, cost_usd: 0.00752 };
const STANDARD = 'The email server did not accept the email.';
let db;

beforeAll(() => { db = scratchDatabase(); });
afterAll(() => { if (db) dropDatabase(db); });
beforeEach(() => psql(db, `TRUNCATE royalty_jobs;
  INSERT INTO royalty_jobs (job_id, author_id, mode, status, requested_by, stage, stage_at)
  VALUES ('${JOB}', 'author-1', 'single', 'PROCESSING', 'admin@bookleaf.test', 'checking', now() - interval '1 minute');`));

/** @returns {Object[]} the rows the query returned */
const run = (sql, param) => JSON.parse(psql(db, `WITH r AS (${sql.replaceAll('$1', () => `$p$${JSON.stringify(param)}$p$`)})
  SELECT coalesce(json_agg(r), '[]') FROM r;`));
const job = () => JSON.parse(psql(db, `SELECT row_to_json(j) FROM (SELECT status, stage, stage_at > now() - interval '5 seconds' AS staged_now,
  error_code, error, subject, html, text_body, sent_to, author_code, provider, model, ai_attempts, cost_usd::float8 AS cost_usd,
  completed_at IS NOT NULL AS completed FROM royalty_jobs) AS j;`));
const set = (assignments) => psql(db, `UPDATE royalty_jobs SET ${assignments};`);
/** Mark Sending's parameter, as the sub-workflow builds it: the caller's record, then the job, stage and email. */
const sending = (record = RECORD) => ({ ...record, job_id: JOB, stage: 'sending', ...EMAIL });
const failWith = (error) => run(MARK_EMAIL_FAILED, { job_id: JOB, error });

describe('Mark Sending', () => {
  it('saves the email and the record on a running job, at stage sending, and returns the row', () => {
    expect(run(MARK_SENDING, sending())).toEqual([{ job_id: JOB, status: 'PROCESSING', stage: 'sending', error_code: null }]);
    expect(job()).toMatchObject({ status: 'PROCESSING', stage: 'sending', staged_now: true, ...EMAIL, ...RECORD, sent_to: null, completed: false });
  });
  it('an empty record saves just the email (an approved draft)', () => {
    set("author_code = 'AUTH002', provider = 'openai'");
    run(MARK_SENDING, sending({}));
    expect(job()).toMatchObject({ stage: 'sending', ...EMAIL, author_code: 'AUTH002', provider: 'openai' });
  });
  it('writes only the email and the AI usage: a record naming status, error, recipient or stage changes none of them', () => {
    const forged = { ...RECORD, status: 'SENT', stage: 'sent', error_code: 'TIMEOUT', error: 'forged', sent_to: 'other@inbox.test', edit_text: 'x' };
    expect(run(MARK_SENDING, sending(forged))).toEqual([{ job_id: JOB, status: 'PROCESSING', stage: 'sending', error_code: null }]);
    expect(job()).toMatchObject({ status: 'PROCESSING', stage: 'sending', error_code: null, error: null, sent_to: null, completed: false, ...RECORD });
  });
  it('returns nothing and changes nothing once the job has ended (the sweeper failed it): nothing is sent', () => {
    set("status = 'FAILED', stage = 'failed', error_code = 'TIMEOUT', completed_at = now()");
    const before = job();
    expect(run(MARK_SENDING, sending())).toEqual([]);
    expect(job()).toEqual(before);
  });
});

describe('Mark Sent', () => {
  it('ends the job SENT at stage sent, with the recipient and a completion time; the saved email stays', () => {
    run(MARK_SENDING, sending());
    expect(run(MARK_SENT, { job_id: JOB, sent_to: 'demo@inbox.test' })).toEqual([{ job_id: JOB, status: 'SENT', stage: 'sent' }]);
    expect(job()).toMatchObject({ status: 'SENT', stage: 'sent', staged_now: true, sent_to: 'demo@inbox.test', completed: true, ...EMAIL });
  });
  it('never overwrites a job that has already ended', () => {
    set("status = 'FAILED', stage = 'failed', error_code = 'TIMEOUT'");
    expect(run(MARK_SENT, { job_id: JOB, sent_to: 'demo@inbox.test' })).toEqual([]);
    expect(job()).toMatchObject({ status: 'FAILED', error_code: 'TIMEOUT', sent_to: null });
  });
});

describe('Mark Failed (EMAIL_FAILED)', () => {
  it('ends the job FAILED with the standard message and the server\'s; the email stays for the log, sent_to stays empty', () => {
    run(MARK_SENDING, sending());
    expect(failWith('connect ECONNREFUSED 127.0.0.1:9')).toEqual([{ job_id: JOB, status: 'FAILED', stage: 'failed', error_code: 'EMAIL_FAILED' }]);
    expect(job()).toMatchObject({
      status: 'FAILED', stage: 'failed', error_code: 'EMAIL_FAILED', error: `${STANDARD} smtp: connect ECONNREFUSED 127.0.0.1:9`,
      sent_to: null, completed: true, ...EMAIL, ...RECORD,
    });
  });
  it('puts a multi-line server reply on one line', () => {
    failWith('Invalid login: 535-5.7.8 Username and Password not accepted.\n535 5.7.8  https://support.example/?p=BadCredentials ');
    expect(job().error).toBe(`${STANDARD} smtp: Invalid login: 535-5.7.8 Username and Password not accepted. 535 5.7.8 https://support.example/?p=BadCredentials`);
  });
  it('says "unknown error" when the node gave no text', () => {
    failWith(null);
    expect(job().error).toBe(`${STANDARD} smtp: unknown error`);
    set("status = 'PROCESSING'");
    failWith(' \n ');
    expect(job().error).toBe(`${STANDARD} smtp: unknown error`);
  });
  it('keeps at most 300 characters of "smtp: …", like every other node error', () => {
    failWith('x'.repeat(5000));
    expect(job().error).toBe(`${STANDARD} smtp: ${'x'.repeat(300 - 'smtp: '.length)}`);
  });
  it('never overwrites a job that has already ended', () => {
    set("status = 'SENT', stage = 'sent', sent_to = 'demo@inbox.test'");
    expect(failWith('late error')).toEqual([]);
    expect(job()).toMatchObject({ status: 'SENT', error_code: null, error: null, sent_to: 'demo@inbox.test' });
  });
});
