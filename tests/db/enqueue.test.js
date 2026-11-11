import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enqueueParams, prepareJob } from '../../n8n/src/pipeline/prepare.js';
import { ENQUEUE_JOB } from '../../n8n/src/pipeline/sql.js';
import { seedSql } from '../../n8n/tools/settings-seed.mjs';
import { NOW, SETTINGS } from '../../n8n/tests/pipeline/settings-fixture.js';
import { payloadFor } from '../fixtures/payloads.js';
import { dropDatabase, psql, psqlAsync, scratchDatabase, until } from './psql.js';

const LOCK = "hashtextextended('bookleaf.enqueue_royalty_job', 0)";
/** Fingerprint data: what the email depends on (Validate Body sends the author, books, recipient and style). */
const data = (c) => ({ book: String(c), paid: 100 });
const FINGERPRINT_OF = data('a');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** The jobs the cap counts: all but discarded ones and failures that never reached the AI. */
const COUNTED = "status <> 'DISCARDED' AND NOT (status = 'FAILED' AND ai_attempts = 0)";
let db;
let seq = 0;

beforeAll(() => { db = scratchDatabase(); });
afterAll(() => { if (db) dropDatabase(db); });
beforeEach(() => psql(db, `TRUNCATE royalty_jobs; DELETE FROM bookleaf_settings;\n${seedSql()}`));

/** A request shaped like Validate Body's: every click runs in a new execution. */
function request(over = {}) {
  seq += 1;
  return {
    execution_id: String(1000 + seq), fingerprint_of: FINGERPRINT_OF, author_id: 'author-1', author_code: 'AUTH001',
    log_id: null, batch_id: null, mode: 'single', requested_by: 'admin@bookleaf.test', delivery: 'send', tone: 'warm',
    length: 'standard', note: '', sign_off: '', recipient: 'demo@inbox.test', drills: { ai_down: false }, ...over,
  };
}
const callSql = (req) => `SELECT row_to_json(e) FROM enqueue_royalty_job($j$${JSON.stringify(req)}$j$::jsonb) AS e;`;
const enqueue = (req) => JSON.parse(psql(db, callSql(req)));
const setting = (key, value) => psql(db, `UPDATE bookleaf_settings SET value = '${JSON.stringify(value)}' WHERE key = '${key}';`);
const count = (where = 'true') => Number(psql(db, `SELECT count(*) FROM royalty_jobs WHERE ${where};`));
/** @returns {string} SHA-256 hex of the canonical jsonb text, as Postgres computes it */
const sha256Of = (value) => psql(db, `SELECT encode(sha256(convert_to($j$${JSON.stringify(value)}$j$::jsonb::text, 'UTF8')), 'hex');`);
const update = (jobId, set) => psql(db, `UPDATE royalty_jobs SET ${set} WHERE job_id = '${jobId}';`);

describe('enqueue_royalty_job', () => {
  it('queues a new job with an id it makes: QUEUED at stage queued, with its execution id and fingerprint, and no idem_key', () => {
    const req = request();
    const answer = enqueue(req);
    expect(answer).toEqual({ outcome: 'queued', job_id: expect.stringMatching(UUID_V4), status: 'QUEUED', error_code: null, recent_sends: 1 });
    const row = JSON.parse(psql(db, `SELECT row_to_json(j) FROM (SELECT job_id, status, stage, stage_at IS NOT NULL AS staged, execution_id,
      fingerprint, idem_key, callback_status, author_code, recipient, drills FROM royalty_jobs) AS j;`));
    expect(row).toEqual({
      job_id: answer.job_id, status: 'QUEUED', stage: 'queued', staged: true, execution_id: req.execution_id,
      fingerprint: sha256Of(FINGERPRINT_OF), idem_key: null,
      callback_status: 'NOT_NEEDED', author_code: 'AUTH001', recipient: 'demo@inbox.test', drills: { ai_down: false },
    });
  });
  it('gives an identical request within the window the same job back, whatever its status', () => {
    const first = enqueue(request());
    update(first.job_id, "status = 'FAILED', error_code = 'AI_UNAVAILABLE'");
    expect(enqueue(request())).toEqual({ outcome: 'duplicate', job_id: first.job_id, status: 'FAILED', error_code: 'AI_UNAVAILABLE', recent_sends: null });
    expect(count()).toBe(1);
  });
  it('slides the window: duplicate_window_minutes counts back from now, not from a fixed bucket', () => {
    setting('duplicate_window_minutes', 5);
    const first = enqueue(request());
    update(first.job_id, "created_at = now() - interval '4 minutes 50 seconds'");
    expect(enqueue(request()).outcome).toBe('duplicate');
    update(first.job_id, "created_at = now() - interval '5 minutes 10 seconds'");
    expect(enqueue(request()).outcome).toBe('queued');
    expect(count()).toBe(2);
  });
  it('fingerprints the data, not its key order: the same data sent in another order is a duplicate', () => {
    const first = enqueue(request({ fingerprint_of: { a: 1, b: { c: [1, 2], d: 'x' } } }));
    expect(enqueue(request({ fingerprint_of: { b: { d: 'x', c: [1, 2] }, a: 1 } }))).toMatchObject({ outcome: 'duplicate', job_id: first.job_id });
  });
  it('treats different data or another author as a new job', () => {
    enqueue(request());
    expect(enqueue(request({ fingerprint_of: data('b') })).outcome).toBe('queued');
    expect(enqueue(request({ author_id: 'author-2' })).outcome).toBe('queued');
  });
  it('caps at exactly max_sends_per_hour; discarded, older and failed-before-the-AI jobs do not count; duplicates still answered', () => {
    setting('max_sends_per_hour', 3);
    const [failed, discarded, old] = ['c', 'd', 'e'].map((c) => enqueue(request({ fingerprint_of: data(c) })));
    update(failed.job_id, "status = 'FAILED', ai_attempts = 0");
    update(discarded.job_id, "status = 'DISCARDED', ai_attempts = 1");
    update(old.job_id, "status = 'SENT', created_at = now() - interval '61 minutes'");
    const answers = [1, 2, 3, 4].map((i) => enqueue(request({ fingerprint_of: data(i) })));
    expect(answers.map((a) => [a.outcome, a.recent_sends])).toEqual([['queued', 1], ['queued', 2], ['queued', 3], ['rate_limited', 3]]);
    expect(answers[3]).toMatchObject({ job_id: null, status: null, error_code: null });
    expect(enqueue(request({ fingerprint_of: data(1) }))).toMatchObject({ outcome: 'duplicate', job_id: answers[0].job_id });
    expect(count(`created_at > now() - interval '1 hour' AND ${COUNTED}`)).toBe(3);
  });
  it('counts a failed job that called the AI: it spent money, and retrying it must not get round the cap', () => {
    setting('max_sends_per_hour', 2);
    const spent = enqueue(request({ fingerprint_of: data('f') }));
    update(spent.job_id, "status = 'FAILED', error_code = 'AI_FACT_CHECK_FAILED', ai_attempts = 2");
    expect([1, 2].map((i) => enqueue(request({ fingerprint_of: data(i) })).outcome)).toEqual(['queued', 'rate_limited']);
  });
  it('takes Enqueue Job\'s query with the parameter Validate Body builds, and answers what the Outcome switch reads', () => {
    const job = prepareJob(payloadFor('AUTH002'), SETTINGS, NOW).job;
    const call = (param) => JSON.parse(psql(db, `SELECT row_to_json(e) FROM (${ENQUEUE_JOB.replace('$1', `$j$${param}$j$`)}) AS e;`));
    const first = call(enqueueParams(job, '9001'));
    expect(first).toEqual({ outcome: 'queued', job_id: expect.stringMatching(UUID_V4), status: 'QUEUED', error_code: null });
    const again = prepareJob(payloadFor('AUTH002', { log_id: 'second_click' }), SETTINGS, NOW + 1000).job;
    expect(call(enqueueParams(again, '9002'))).toEqual({ outcome: 'duplicate', job_id: first.job_id, status: 'QUEUED', error_code: null });
    const row = JSON.parse(psql(db, 'SELECT row_to_json(j) FROM (SELECT execution_id, fingerprint, author_code, delivery FROM royalty_jobs) AS j;'));
    const fingerprint = sha256Of(JSON.parse(enqueueParams(job, '9001')).fingerprint_of);
    expect(row).toEqual({ execution_id: '9001', fingerprint, author_code: 'AUTH002', delivery: 'send' });
  });
  it('refuses a request without fingerprint data or an execution id, and inserts nothing', () => {
    expect(() => enqueue(request({ fingerprint_of: 'abc' }))).toThrow(/fingerprint_of must be a JSON object/);
    expect(() => enqueue(request({ fingerprint_of: undefined }))).toThrow(/fingerprint_of must be a JSON object/);
    expect(() => enqueue(request({ execution_id: '' }))).toThrow(/execution_id is required/);
    expect(count()).toBe(0);
  });
});

describe('enqueue_royalty_job under simultaneous calls', () => {
  const advisoryLocks = (granted) => Number(psql(db, `SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'
    AND granted = ${granted} AND database = (SELECT oid FROM pg_database WHERE datname = current_database());`));
  const holdLock = (seconds) => psqlAsync(db, `SELECT pg_advisory_lock(${LOCK}); SELECT pg_sleep(${seconds});`);

  /** Starts the calls while another session holds the enqueue lock, checks they all wait on it, then lets them run. */
  async function behindTheLock(calls) {
    const holder = holdLock(4);
    await until(() => advisoryLocks(true) === 1, 'the test session to hold the enqueue lock');
    const running = calls.map((req) => psqlAsync(db, callSql(req)));
    await until(() => advisoryLocks(false) === calls.length, `${calls.length} calls to wait on the enqueue lock`);
    await holder;
    const results = await Promise.all(running);
    for (const r of results) expect(r.err).toBe('');
    return results.map((r) => JSON.parse(r.out));
  }

  it('six identical requests at once (a burst of clicks) create exactly one job', async () => {
    const answers = await behindTheLock(Array.from({ length: 6 }, () => request()));
    const queued = answers.filter((a) => a.outcome === 'queued');
    expect(queued).toHaveLength(1);
    expect(answers.filter((a) => a.outcome === 'duplicate').map((a) => a.job_id)).toEqual(Array(5).fill(queued[0].job_id));
    expect(count()).toBe(1);
  });
  it('six different requests at once with one slot left under the cap create exactly one job', async () => {
    setting('max_sends_per_hour', 2);
    enqueue(request({ fingerprint_of: data('f') }));
    const answers = await behindTheLock([1, 2, 3, 4, 5, 6].map((i) => request({ fingerprint_of: data(i) })));
    expect(answers.map((a) => a.outcome).sort()).toEqual(['queued', ...Array(5).fill('rate_limited')]);
    expect(count()).toBe(2);
  });
  it('gives up after 5 s when the lock is never released, and inserts nothing', async () => {
    const holder = holdLock(7);
    await until(() => advisoryLocks(true) === 1, 'the test session to hold the enqueue lock');
    const started = Date.now();
    const call = await psqlAsync(db, callSql(request()));
    expect(call.ok).toBe(false);
    expect(call.err).toMatch(/canceling statement due to lock timeout/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(4500);
    await holder;
    expect(count()).toBe(0);
  });
});
