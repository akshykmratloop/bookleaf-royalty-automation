import { describe, expect, it } from 'vitest';
import { afterAi } from '../../src/pipeline/after-ai.js';
import { buildContext } from '../../src/pipeline/context.js';
import { CrashDrillError } from '../../src/pipeline/drills.js';
import { errorBody, failure } from '../../src/pipeline/errors.js';
import { deliveryFor, failedUpdate } from '../../src/pipeline/finalize.js';
import { nodeErrorSummary } from '../../src/pipeline/node-errors.js';
import { prepareJob } from '../../src/pipeline/prepare.js';
import { parseStatusQuery, shapeJobs } from '../../src/pipeline/status.js';
import { fixedRandom, NOW, SETTINGS } from './settings-fixture.js';
import { payloadFor } from './fixtures.js';
import { anthropicOk } from './ai-fixtures.js';

const job = prepareJob(payloadFor('AUTH002'), SETTINGS, NOW, fixedRandom).job;
const ctx = buildContext(job).ctx;
const ai = afterAi({ response: anthropicOk(), ctx, job, attempt: 1 }).ai;
const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('deliveryFor / updates', () => {
  it('renders an email to the demo inbox with figures from data: the Deliver Email inputs', () => {
    const { job_id, email, drill, record } = deliveryFor({ ctx, job, ai });
    expect(job_id).toBe(job.job_id);
    expect(email).toMatchObject({ to: 'demo@inbox.test', from: 'BookLeaf Author Relations <sender@bookleaf.test>', subject: 'Your BookLeaf royalty summary' });
    expect(email.html).toContain('₹13,024');
    expect(email.text).toContain('Warm regards,\nBookLeaf Author Relations');
    expect(drill).toBe(false);
    expect(record).toEqual({
      author_code: 'AUTH002', provider: 'anthropic', model: ai.model, ai_attempts: 1, input_tokens: ai.input_tokens,
      output_tokens: ai.output_tokens, cost_usd: ai.cost_usd, figures_verified: ai.verified_figures,
    });
  });
  it('deliveryFor passes the email_down drill on', () => {
    const drilled = { ...job, drills: { ...job.drills, email_down: true } };
    expect(deliveryFor({ ctx, job: drilled, ai }).drill).toBe(true);
  });
  it('failedUpdate marks FAILED with a capped message', () => {
    const f = failedUpdate(job, failure('AI_UNAVAILABLE', 'x'.repeat(5000)));
    expect(f).toMatchObject({ job_id: job.job_id, status: 'FAILED', error_code: 'AI_UNAVAILABLE' });
    expect(f).not.toHaveProperty('callback_status');
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

describe('the crash drill', () => {
  it('throws a CrashDrillError from buildContext, so the run fails and the error workflow takes over', () => {
    const r = prepareJob(payloadFor('AUTH002', { drills: { crash: true } }), SETTINGS, NOW, fixedRandom);
    expect(() => buildContext(r.job)).toThrow(CrashDrillError);
    expect(() => buildContext(r.job)).toThrow('Failure drill: the workflow crashed on purpose.');
  });
});

describe('node error summaries', () => {
  it('nodeErrorSummary is one line and redacts secrets', () => {
    const s = nodeErrorSummary({ error: { httpCode: '401', message: 'Bad key sk-ant-abcdefghijk', description: 'Bearer abcdefghijkl' } }, 'anthropic');
    expect(s).toBe('anthropic: 401 - Bad key [redacted] - [redacted]');
  });
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

describe('sender, brand and plain-text table details', () => {
  it('the From line and default signature use sender_name; header and footer use brand_name and support_email', () => {
    const settings = { ...SETTINGS, sender_name: 'Royalty Desk', brand_name: 'Leaf & Co', support_email: 'help@bookleaf.test' };
    const { email } = deliveryFor({ ctx, job: { ...job, settings }, ai });
    expect(email.from).toBe('Royalty Desk <sender@bookleaf.test>');
    expect(email.text).toMatch(/Warm regards,\nRoyalty Desk$/);
    expect(email.html).toContain('Leaf &amp; Co &middot; help@bookleaf.test');
  });
  it('a book never paid reads "no payout yet" in the text table', async () => {
    const kavita = prepareJob(payloadFor('AUTH009'), SETTINGS, NOW, fixedRandom).job;
    const kctx = buildContext(kavita).ctx;
    const { email } = deliveryFor({ ctx: kctx, job: kavita, ai: { ...ai, sections: { ...ai.sections, bookParagraphs: [] } } });
    expect(email.text).toContain('pending ₹850 | no payout yet | Overdue');
  });
});
