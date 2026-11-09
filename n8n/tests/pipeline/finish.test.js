import { describe, expect, it } from 'vitest';
import { afterAi } from '../../src/pipeline/after-ai.js';
import { callbackFor } from '../../src/pipeline/callback.js';
import { classifyInsert, INSERT_ROUTES } from '../../src/pipeline/classify.js';
import { buildContext } from '../../src/pipeline/context.js';
import { errorBody, failure } from '../../src/pipeline/errors.js';
import { internalFailureUpdate, jobIdFromExecution } from '../../src/pipeline/error-handler.js';
import { failedUpdate, renderForSend, sentUpdate } from '../../src/pipeline/finalize.js';
import { nodeErrorSummary } from '../../src/pipeline/node-errors.js';
import { prepareJob } from '../../src/pipeline/prepare.js';
import { parseStatusQuery, shapeJobs } from '../../src/pipeline/status.js';
import { ENV, fixedRandom, NOW } from './env.js';
import { payloadFor } from './fixtures.js';
import { anthropicOk } from './ai-fixtures.js';

const job = prepareJob(payloadFor('AUTH002'), ENV, NOW, fixedRandom).job;
const ctx = buildContext(job).ctx;
const ai = afterAi({ response: anthropicOk(), ctx, job, attempt: 1 }).ai;
const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('classifyInsert', () => {
  const config = { maxSendsPerHour: 60 };
  it('new row → 202 QUEUED', () => {
    expect(classifyInsert({ job_id: ID, status: 'QUEUED', inserted: true }, config))
      .toMatchObject({ route: INSERT_ROUTES.QUEUED, http_status: 202, response: { job_id: ID, status: 'QUEUED', duplicate: false } });
  });
  it('existing row → 200 duplicate with its current status', () => {
    expect(classifyInsert({ job_id: ID, status: 'SENT', inserted: false }, config))
      .toMatchObject({ route: INSERT_ROUTES.DUPLICATE, http_status: 200, response: { job_id: ID, status: 'SENT', duplicate: true } });
  });
  it('no row → 429 RATE_LIMITED', () => {
    const r = classifyInsert({ job_id: null, inserted: false, recent_sends: 60 }, config);
    expect(r).toMatchObject({ route: INSERT_ROUTES.RATE_LIMITED, http_status: 429, response: { error: { code: 'RATE_LIMITED' } } });
  });
});

describe('renderForSend / updates', () => {
  it('renders an email to the demo inbox with figures from data', () => {
    const { email, update } = renderForSend({ ctx, job, ai });
    expect(email).toMatchObject({ to: 'demo@inbox.test', from: 'BookLeaf Author Relations <sender@bookleaf.test>', subject: 'Your BookLeaf royalty summary' });
    expect(email.html).toContain('₹13,024');
    expect(email.text).toContain('Warm regards,\nBookLeaf Author Relations');
    expect(update).toMatchObject({ job_id: job.job_id, author_code: 'AUTH002', sent_to: 'demo@inbox.test', provider: 'anthropic', ai_attempts: 1 });
    expect(update.figures_verified).toBe(ai.verified_figures);
  });
  it('sentUpdate marks SENT; failedUpdate marks FAILED with a capped message', () => {
    const { update } = renderForSend({ ctx, job, ai });
    expect(sentUpdate(job, update)).toMatchObject({ status: 'SENT', callback_status: 'NOT_NEEDED' });
    const f = failedUpdate(job, failure('EMAIL_FAILED', 'x'.repeat(5000)));
    expect(f).toMatchObject({ job_id: job.job_id, status: 'FAILED', error_code: 'EMAIL_FAILED' });
    expect(f.error.length).toBeLessThanOrEqual(1000);
  });
  it('errorBody carries code, message and field errors', () => {
    const f = failure('VALIDATION', 'bad', [{ path: 'mode', code: 'ENUM', message: 'm' }]);
    expect(errorBody(f)).toEqual({ error: { code: 'VALIDATION', message: expect.stringContaining('bad'), retryable: false, fields: [{ path: 'mode', code: 'ENUM', message: 'm' }] } });
    expect(() => failure('NOPE')).toThrow(TypeError);
  });
});

describe('job status query', () => {
  it('parses ids, de-duplicates and lower-cases them', () => {
    const r = parseStatusQuery({ ids: `${ID.toUpperCase()}, ${ID}`, include: 'html' });
    expect(r).toMatchObject({ ok: true, ids: [ID], includeHtml: true });
    expect(JSON.parse(r.params)).toEqual({ ids: [ID], include_html: true });
  });
  it.each([
    [{}, 'REQUIRED'], [{ ids: 'abc' }, 'PATTERN'], [{ ids: Array(51).fill(0).map((_, i) => ID.slice(0, -2) + String(i).padStart(2, '0')).join(',') }, 'TOO_MANY'],
  ])('rejects %j', (q, code) => expect(parseStatusQuery(q)).toMatchObject({ ok: false, code: 'VALIDATION', fields: [{ code }] }));
  it('shapes rows in request order, hides html unless asked, reports missing ids', () => {
    const other = ID.replace(/^0/, '1');
    const rows = [{ job_id: ID, status: 'SENT', html: '<p>x</p>', text_body: 'x', created_at: new Date(0) }, {}];
    const r = shapeJobs(rows, [other, ID], false);
    expect(r.jobs).toEqual([{ job_id: ID, status: 'SENT', created_at: '1970-01-01T00:00:00.000Z', updated_at: null, completed_at: null }]);
    expect(r.missing).toEqual([other]);
    expect(shapeJobs(rows, [ID], true).jobs[0].html).toBe('<p>x</p>');
  });
});

describe('error workflow helpers', () => {
  const execution = { data: { resultData: { runData: { 'Insert Job': [{ data: { main: [[{ json: { job_id: ID } }]] } }] } } } };
  it('finds the job id in the failed execution', () => {
    expect(jobIdFromExecution(execution)).toBe(ID);
    expect(jobIdFromExecution({ data: { resultData: { runData: { 'Prepare Job': [{ data: { main: [[{ json: { job: { job_id: ID } } }]] } }] } } } })).toBe(ID);
    expect(jobIdFromExecution({})).toBeNull();
  });
  it('builds an INTERNAL failure naming the node', () => {
    const u = internalFailureUpdate(ID, { execution: { lastNodeExecuted: 'Update Job', error: { message: 'connection refused' } } });
    expect(u).toMatchObject({ job_id: ID, status: 'FAILED', error_code: 'INTERNAL' });
    expect(u.error).toContain('Node "Update Job": connection refused');
  });
  it('nodeErrorSummary is one line and redacts secrets', () => {
    const s = nodeErrorSummary({ error: { httpCode: '401', message: 'Bad key sk-ant-abcdefghijk', description: 'Bearer abcdefghijkl' } }, 'anthropic');
    expect(s).toBe('anthropic: 401 - Bad key [redacted] - [redacted]');
  });
});

describe('callbackFor (push mode)', () => {
  const config = { bubbleAppBase: 'https://app.bubbleapps.io/version-test' };
  it('posts the finished job to the notification_result workflow', () => {
    const r = callbackFor({ job_id: ID, log_id: 'L1', status: 'FAILED', error_code: 'EMAIL_FAILED', error: 'down', cost_usd: '0.0130', completed_at: new Date(0) }, config);
    expect(r.url).toBe('https://app.bubbleapps.io/version-test/api/1.1/wf/notification_result');
    expect(r.body).toMatchObject({ log_id: 'L1', job_id: ID, status: 'FAILED', error: 'EMAIL_FAILED: down', cost_usd: 0.013, completed_at: '1970-01-01T00:00:00.000Z' });
  });
  it('skips jobs without a Bubble log', () => expect(callbackFor({ job_id: ID, status: 'SENT' }, config)).toBeNull());
});

describe('nodeErrorSummary for HTTP errors', () => {
  it('extracts the API message from n8n\'s "404 - <json>" format', () => {
    const msg = '404 - "{\\"type\\":\\"error\\",\\"error\\":{\\"type\\":\\"not_found_error\\",\\"message\\":\\"model: x\\"}}"';
    expect(nodeErrorSummary({ error: { message: msg, httpCode: '404' } }, 'anthropic')).toBe('anthropic: 404 model: x');
  });
  it('keeps non-JSON messages as they are', () => {
    expect(nodeErrorSummary({ error: { message: 'connect ECONNREFUSED 127.0.0.1:9' } }, 'smtp')).toBe('smtp: connect ECONNREFUSED 127.0.0.1:9');
  });
});

describe('sender and plain-text table details', () => {
  it('from is null without EMAIL_FROM (the Send Email node then uses the SMTP account)', () => {
    const noFrom = { ...job, config: { ...job.config, emailFrom: '' } };
    expect(renderForSend({ ctx, job: noFrom, ai }).email.from).toBeNull();
  });
  it('a book never paid reads "no payout yet" in the text table', async () => {
    const kavita = prepareJob(payloadFor('AUTH009'), ENV, NOW, fixedRandom).job;
    const kctx = buildContext(kavita).ctx;
    const { email } = renderForSend({ ctx: kctx, job: kavita, ai: { ...ai, sections: { ...ai.sections, bookParagraphs: [] } } });
    expect(email.text).toContain('pending ₹850 | no payout yet | Overdue');
  });
});
