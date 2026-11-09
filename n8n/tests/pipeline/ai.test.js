import { describe, expect, it } from 'vitest';
import { afterAi, AI_ROUTES, detectProvider } from '../../src/pipeline/after-ai.js';
import { buildContext, DRILL_MODEL } from '../../src/pipeline/context.js';
import { prepareJob } from '../../src/pipeline/prepare.js';
import { ENV, fixedRandom, NOW } from './env.js';
import { payloadFor } from './fixtures.js';
import { anthropicOk, goodSections, openaiOk, wrongSections } from './ai-fixtures.js';

const jobFor = (code, over = {}) => prepareJob(payloadFor(code, over), ENV, NOW, fixedRandom).job;
const ctxFor = (job) => buildContext(job).ctx;

describe('buildContext', () => {
  it('builds facts, prompt and both provider requests', () => {
    const job = jobFor('AUTH002');
    const ctx = ctxFor(job);
    expect(ctx.facts.totals.pending).toBe(13024);
    expect(ctx.prompt.situations).toEqual(['OVERDUE', 'PENDING']);
    expect(ctx.requests.anthropic).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'medium' } });
    expect(ctx.requests.openai).toMatchObject({ model: 'gpt-4.1-mini' });
    expect(ctx.titles).toEqual(['Code & Karma', 'Startup Sutra']);
  });
  it('AI-down drill points both providers at a model that does not exist', () => {
    const ctx = ctxFor(jobFor('AUTH002', { drills: { ai_down: true } }));
    expect(ctx.requests.anthropic.model).toBe(DRILL_MODEL);
    expect(ctx.requests.openai.model).toBe(DRILL_MODEL);
  });
  it('data-down drill fails DATA_UNAVAILABLE', () => {
    expect(buildContext(jobFor('AUTH002', { drills: { data_down: true } }))).toMatchObject({ ok: false, code: 'DATA_UNAVAILABLE' });
  });
  it('figures that do not add up fail INTEGRITY before any AI call', () => {
    const p = payloadFor('AUTH002');
    p.books[0].pending += 100;
    const job = prepareJob(p, ENV, NOW, fixedRandom).job;
    const r = buildContext(job);
    expect(r).toMatchObject({ ok: false, code: 'INTEGRITY' });
    expect(r.message).toContain('BK003');
  });
  it('bubble mode maps Data API results', () => {
    const job = { ...jobFor('AUTH008'), bundle: null };
    const bubble = {
      author: { response: { results: [{ _id: 'u1', code: 'AUTH008', name: 'Farhan Sheikh', email: 'f@x.co', city: 'Pune' }] } },
      books: { response: { results: [{ _id: 'b1', code: 'BK014', title: 'T', status: 'Published & Live', publication_date: '2024-01-01', mrp: 300, royalty_per_copy: 30 }] } },
      royalties: { response: { results: [{ book: 'b1', copies_sold: 10, earned: 300, paid: 300, pending: 0, last_payout_date: '2025-12-01T00:00:00Z' }] } },
    };
    const r = buildContext(job, bubble);
    expect(r.ok).toBe(true);
    expect(r.ctx.facts.allPaid).toBe(true);
    expect(buildContext(job, { author: { response: { results: [] } } })).toMatchObject({ ok: false, code: 'DATA_UNAVAILABLE' });
  });
});

describe('afterAi', () => {
  const job = jobFor('AUTH002');
  const ctx = ctxFor(job);
  it('detects the provider from the response shape', () => {
    expect(detectProvider(anthropicOk())).toBe('anthropic');
    expect(detectProvider(openaiOk())).toBe('openai');
    expect(detectProvider('x')).toBeNull();
  });
  it('passes a grounded draft with usage, cost and verified figures', () => {
    const r = afterAi({ response: anthropicOk(), ctx, job, attempt: 1 });
    expect(r.route).toBe(AI_ROUTES.PASS);
    expect(r.ai).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5', attempts: 1, input_tokens: 3000, output_tokens: 700, cost_usd: 0.013 });
    expect(r.ai.verified_figures).toBeGreaterThan(8);
    expect(r.ai.sections).toEqual(goodSections);
  });
  it('a wrong figure triggers one regeneration with feedback, on the same provider', () => {
    const r = afterAi({ response: anthropicOk(wrongSections), ctx, job, attempt: 1 });
    expect(r.route).toBe(AI_ROUTES.REGENERATE_ANTHROPIC);
    const msgs = r.regenerate.body.messages;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(msgs[2].content).toContain('₹84,500');
    const viaOpenai = afterAi({ response: openaiOk(wrongSections), ctx, job, attempt: 1 });
    expect(viaOpenai.route).toBe(AI_ROUTES.REGENERATE_OPENAI);
    expect(viaOpenai.regenerate.body.input).toHaveLength(3);
  });
  it('a second wrong draft fails AI_FACT_CHECK_FAILED and sums usage over both attempts', () => {
    const first = afterAi({ response: anthropicOk(wrongSections), ctx, job, attempt: 1 });
    const r = afterAi({ response: anthropicOk(wrongSections), ctx, job, attempt: 2, previous: first.ai });
    expect(r.route).toBe(AI_ROUTES.FAIL);
    expect(r.failure).toMatchObject({ code: 'AI_FACT_CHECK_FAILED' });
    expect(r.failure.message).toContain('₹84,500');
    expect(r.ai).toMatchObject({ attempts: 2, input_tokens: 6000, output_tokens: 1400, cost_usd: 0.026 });
  });
  it('a fixed second draft passes', () => {
    const first = afterAi({ response: anthropicOk(wrongSections), ctx, job, attempt: 1 });
    const r = afterAi({ response: openaiOk(), ctx, job, attempt: 2, previous: first.ai });
    expect(r.route).toBe(AI_ROUTES.PASS);
    expect(r.ai.provider).toBe('openai');
    expect(r.ai.cost_usd).toBeCloseTo(0.013 + (2800 * 0.4 + 600 * 1.6) / 1e6, 6);
  });
  it('an unusable answer is retried once, then fails AI_UNAVAILABLE', () => {
    const truncated = anthropicOk(goodSections, { stop_reason: 'max_tokens' });
    const first = afterAi({ response: truncated, ctx, job, attempt: 1 });
    expect(first.route).toBe(AI_ROUTES.REGENERATE_ANTHROPIC);
    expect(first.regenerate.body.messages).toHaveLength(1);
    const second = afterAi({ response: truncated, ctx, job, attempt: 2, previous: first.ai });
    expect(second.failure).toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(second.ai.input_tokens).toBe(6000);
  });
  it('flags layout problems as warnings without blocking', () => {
    const s = { ...goodSections, bookParagraphs: [goodSections.bookParagraphs[0], { code: 'BK999', text: 'Hello.' }], closing: 'Bye.' };
    const r = afterAi({ response: anthropicOk(s), ctx, job, attempt: 1 });
    expect(r.route).toBe(AI_ROUTES.PASS);
    expect(r.ai.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['UNKNOWN_BOOK', 'MISSING_BOOK', 'SIGN_OFF']));
  });
});
