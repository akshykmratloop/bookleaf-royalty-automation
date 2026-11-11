import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedSql } from '../../n8n/tools/settings-seed.mjs';
import { dropDatabase, psql, psqlAsync, scratchDatabase, until } from './psql.js';

const LOCK = "hashtextextended('bookleaf.enqueue_royalty_job', 0)";
const FINGERPRINT = 'a'.repeat(64);
const hex = (c) => String(c).repeat(64);
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;
let seq = 0;

beforeAll(() => { db = scratchDatabase(); });
afterAll(() => { if (db) dropDatabase(db); });
beforeEach(() => psql(db, `TRUNCATE royalty_jobs; DELETE FROM bookleaf_settings;\n${seedSql()}`));

/** A request shaped like Prepare Job's: every click gets a new job id and runs in a new execution. */
function request(over = {}) {
  seq += 1;
  return {
    job_id: uuid(seq), execution_id: String(1000 + seq), fingerprint: FINGERPRINT, author_id: 'author-1', author_code: 'AUTH001',
    log_id: null, batch_id: null, mode: 'single', requested_by: 'admin@bookleaf.test', delivery: 'send', tone: 'warm',
    length: 'standard', note: '', sign_off: '', recipient: 'demo@inbox.test', drills: { ai_down: false }, ...over,
  };
}
const callSql = (req) => `SELECT row_to_json(e) FROM enqueue_royalty_job($j$${JSON.stringify(req)}$j$::jsonb) AS e;`;
const enqueue = (req) => JSON.parse(psql(db, callSql(req)));
const setting = (key, value) => psql(db, `UPDATE bookleaf_settings SET value = '${JSON.stringify(value)}' WHERE key = '${key}';`);
const count = (where = 'true') => Number(psql(db, `SELECT count(*) FROM royalty_jobs WHERE ${where};`));
const update = (jobId, set) => psql(db, `UPDATE royalty_jobs SET ${set} WHERE job_id = '${jobId}';`);

describe('enqueue_royalty_job', () => {
  it('queues a new job: QUEUED at stage queued, with its execution id and fingerprint, and no idem_key', () => {
    const req = request();
    expect(enqueue(req)).toEqual({ outcome: 'queued', job_id: req.job_id, status: 'QUEUED', error_code: null, recent_sends: 1 });
    const row = JSON.parse(psql(db, `SELECT row_to_json(j) FROM (SELECT status, stage, stage_at IS NOT NULL AS staged, execution_id,
      fingerprint, idem_key, callback_status, author_code, recipient, drills FROM royalty_jobs) AS j;`));
    expect(row).toEqual({
      status: 'QUEUED', stage: 'queued', staged: true, execution_id: req.execution_id, fingerprint: FINGERPRINT, idem_key: null,
      callback_status: 'NOT_NEEDED', author_code: 'AUTH001', recipient: 'demo@inbox.test', drills: { ai_down: false },
    });
  });
  it('gives an identical request within the window the same job back, whatever its status', () => {
    const first = request();
    enqueue(first);
    update(first.job_id, "status = 'FAILED', error_code = 'AI_UNAVAILABLE'");
    expect(enqueue(request())).toEqual({ outcome: 'duplicate', job_id: first.job_id, status: 'FAILED', error_code: 'AI_UNAVAILABLE', recent_sends: null });
    expect(count()).toBe(1);
  });
  it('slides the window: duplicate_window_minutes counts back from now, not from a fixed bucket', () => {
    setting('duplicate_window_minutes', 5);
    const first = request();
    enqueue(first);
    update(first.job_id, "created_at = now() - interval '4 minutes 50 seconds'");
    expect(enqueue(request()).outcome).toBe('duplicate');
    update(first.job_id, "created_at = now() - interval '5 minutes 10 seconds'");
    expect(enqueue(request()).outcome).toBe('queued');
    expect(count()).toBe(2);
  });
  it('treats a different fingerprint or another author as a new job', () => {
    enqueue(request());
    expect(enqueue(request({ fingerprint: hex('b') })).outcome).toBe('queued');
    expect(enqueue(request({ author_id: 'author-2' })).outcome).toBe('queued');
  });
  it('caps at exactly max_sends_per_hour; failed, discarded and older jobs do not count; duplicates still answered', () => {
    setting('max_sends_per_hour', 3);
    const [failed, discarded, old] = ['c', 'd', 'e'].map((c) => request({ fingerprint: hex(c) }));
    [failed, discarded, old].forEach(enqueue);
    update(failed.job_id, "status = 'FAILED'");
    update(discarded.job_id, "status = 'DISCARDED'");
    update(old.job_id, "status = 'SENT', created_at = now() - interval '61 minutes'");
    const answers = [1, 2, 3, 4].map((i) => enqueue(request({ fingerprint: hex(i) })));
    expect(answers.map((a) => [a.outcome, a.recent_sends])).toEqual([['queued', 1], ['queued', 2], ['queued', 3], ['rate_limited', 3]]);
    expect(answers[3]).toMatchObject({ job_id: null, status: null, error_code: null });
    expect(enqueue(request({ fingerprint: hex(1) }))).toMatchObject({ outcome: 'duplicate', job_id: answers[0].job_id });
    expect(count("created_at > now() - interval '1 hour' AND status NOT IN ('FAILED', 'DISCARDED')")).toBe(3);
  });
  it('refuses a request without a SHA-256 fingerprint or an execution id, and inserts nothing', () => {
    expect(() => enqueue(request({ fingerprint: 'abc' }))).toThrow(/fingerprint must be 64 lowercase hex characters/);
    expect(() => enqueue(request({ fingerprint: undefined }))).toThrow(/fingerprint must be 64 lowercase hex characters/);
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
    enqueue(request({ fingerprint: hex('f') }));
    const answers = await behindTheLock([1, 2, 3, 4, 5, 6].map((i) => request({ fingerprint: hex(i) })));
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
