import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SELECT_JOBS } from '../../n8n/src/pipeline/sql.js';
import { dropDatabase, psql, scratchDatabase } from './psql.js';

/**
 * Select Jobs (job-status, polled by Bubble every few seconds) answers the whole response itself:
 * {jobs, missing}, jobs in the order asked, timestamps as ISO strings, html only with include=html.
 */
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const MISSING = '00000000-0000-4000-8000-0000000000ff';
const FIELDS = ['job_id', 'log_id', 'batch_id', 'author_id', 'author_code', 'mode', 'status', 'error_code', 'error', 'subject', 'sent_to',
  'figures_verified', 'ai_attempts', 'provider', 'model', 'input_tokens', 'output_tokens', 'cost_usd', 'requested_by', 'created_at',
  'updated_at', 'completed_at', 'callback_status', 'stage', 'stage_at', 'delivery', 'tone', 'length', 'issues', 'edit_text', 'drafted_at'];
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
let db;

beforeAll(() => { db = scratchDatabase(); });
afterAll(() => { if (db) dropDatabase(db); });
beforeEach(() => psql(db, `TRUNCATE royalty_jobs;
  INSERT INTO royalty_jobs (job_id, author_id, author_code, mode, status, requested_by, stage, stage_at, created_at, updated_at, completed_at,
    subject, html, text_body, sent_to, figures_verified, ai_attempts, provider, model, input_tokens, output_tokens, cost_usd, callback_status)
  VALUES ('${A}', 'author-1', 'AUTH001', 'single', 'SENT', 'admin@bookleaf.test', 'sent', '2026-11-12 09:00:01.5+00', '2026-11-12 09:00:00+00',
    '2026-11-12 09:00:02.25+00', '2026-11-12 09:00:02.25+00', 'Your summary', '<p>₹1</p>', '₹1', 'demo@inbox.test', 7, 1, 'anthropic',
    'claude-sonnet-5-5', 3000, 700, 0.00752, 'NOT_NEEDED'),
  ('${B}', 'author-2', 'AUTH002', 'single', 'DRAFTED', 'admin@bookleaf.test', 'drafted', now(), now(), now(), NULL,
    'Draft', '<p>d</p>', 'd', NULL, 5, 1, 'openai', 'gpt-4.1-mini', 10, 5, NULL, 'NOT_NEEDED');
  UPDATE royalty_jobs SET drafted_at = now(), edit_text = 'Dear Rohit' WHERE job_id = '${B}';`));

/** n8n's Postgres node writes the parameter into the SQL as a literal; so does this. */
const literal = (param) => `'${JSON.stringify(param).replaceAll("'", "''")}'`;
const answer = (param) => JSON.parse(psql(db, `SELECT response FROM (${SELECT_JOBS.replaceAll('$1', () => literal(param))}) AS r;`));

describe('Select Jobs answers {jobs, missing}', () => {
  it('returns one row holding the response: jobs in the order asked, unknown ids in missing', () => {
    const r = answer({ ids: [B, MISSING, A], include_html: false });
    expect(r.jobs.map((j) => j.job_id)).toEqual([B, A]);
    expect(r.missing).toEqual([MISSING]);
  });
  it('gives every job-status field, with timestamps as ISO strings (milliseconds, UTC) and numbers as numbers', () => {
    const [a] = answer({ ids: [A], include_html: false }).jobs;
    expect(Object.keys(a).sort()).toEqual([...FIELDS].sort());
    expect(a).toMatchObject({
      created_at: '2026-11-12T09:00:00.000Z', updated_at: '2026-11-12T09:00:02.250Z', completed_at: '2026-11-12T09:00:02.250Z',
      stage_at: '2026-11-12T09:00:01.500Z', drafted_at: null, cost_usd: 0.00752, figures_verified: 7, input_tokens: 3000, status: 'SENT',
    });
    const [b] = answer({ ids: [B], include_html: false }).jobs;
    expect(b.drafted_at).toMatch(ISO);
    expect(b).toMatchObject({ completed_at: null, cost_usd: null, edit_text: 'Dear Rohit' });
  });
  it('adds html and text_body only with include=html', () => {
    expect(answer({ ids: [A], include_html: false }).jobs[0]).not.toHaveProperty('html');
    expect(answer({ ids: [A], include_html: true }).jobs[0]).toMatchObject({ html: '<p>₹1</p>', text_body: '₹1' });
  });
  it('answers empty lists when nothing matches', () => {
    expect(answer({ ids: [MISSING], include_html: false })).toEqual({ jobs: [], missing: [MISSING] });
  });
});
