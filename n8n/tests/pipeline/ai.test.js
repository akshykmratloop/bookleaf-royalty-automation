import { describe, expect, it } from 'vitest';
import { afterAi, AI_OUTCOMES, aiUnavailable, checkAnswer, detectProvider, readAnswer } from '../../src/pipeline/after-ai.js';
import { buildContext, DRILL_MODEL } from '../../src/pipeline/context.js';
import { prepareJob } from '../../src/pipeline/prepare.js';
import { fixedRandom, NOW, SETTINGS } from './settings-fixture.js';
import { payloadFor } from './fixtures.js';
import { anthropicOk, goodSections, openaiOk, wrongSections } from './ai-fixtures.js';

const jobFor = (code, over = {}, settings = SETTINGS) => prepareJob(payloadFor(code, over), settings, NOW, fixedRandom).job;
const ctxFor = (job) => buildContext(job).ctx;

describe('buildContext', () => {
  it('builds facts, prompt and both provider requests', () => {
    const job = jobFor('AUTH002');
    const ctx = ctxFor(job);
    expect(ctx.facts.totals.pending).toBe(13024);
    expect(ctx.prompt.situations).toEqual(['OVERDUE', 'PENDING']);
    expect(ctx.requests.anthropic).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 8000, output_config: { effort: 'medium' } });
    expect(ctx.requests.openai).toMatchObject({ model: 'gpt-4.1-mini', max_output_tokens: 4000 });
    expect(ctx.titles).toEqual(['Code & Karma', 'Startup Sutra']);
  });
  it('model, effort and token limits come from the ai_primary and ai_fallback settings', () => {
    const settings = { ...SETTINGS, ai_primary: { model: 'claude-x', effort: 'high', max_tokens: 1234 }, ai_fallback: { model: 'gpt-y', max_tokens: 567 } };
    const { requests } = ctxFor(jobFor('AUTH002', {}, settings));
    expect(requests.anthropic).toMatchObject({ model: 'claude-x', max_tokens: 1234, output_config: { effort: 'high' } });
    expect(requests.openai).toMatchObject({ model: 'gpt-y', max_output_tokens: 567 });
  });
  it('AI-down drill points both providers at a model that does not exist', () => {
    const ctx = ctxFor(jobFor('AUTH002', { drills: { ai_down: true } }));
    expect(ctx.requests.anthropic.model).toBe(DRILL_MODEL);
    expect(ctx.requests.openai.model).toBe(DRILL_MODEL);
  });
  it('primary-down drill fails only Anthropic, so the OpenAI fallback writes the email', () => {
    const ctx = ctxFor(jobFor('AUTH002', { drills: { primary_down: true } }));
    expect(ctx.requests.anthropic.model).toBe(DRILL_MODEL);
    expect(ctx.requests.openai.model).toBe('gpt-4.1-mini');
  });
  it('tone, length and the admin note go into the user message only', () => {
    const plain = ctxFor(jobFor('AUTH002'));
    const styled = ctxFor(jobFor('AUTH002', { tone: 'formal', length: 'short', note: 'Mention the dashboard.' }));
    expect(styled.prompt.system).toBe(plain.prompt.system);
    expect(styled.prompt.user).toContain('Tone: formal');
    expect(styled.prompt.user).toContain('80 to 180 words');
    expect(styled.prompt.user).toContain('Mention the dashboard.');
    expect(styled.requests.anthropic.messages[0].content).toBe(styled.prompt.user);
  });
  it('data-down drill fails DATA_UNAVAILABLE', () => {
    expect(buildContext(jobFor('AUTH002', { drills: { data_down: true } }))).toMatchObject({ ok: false, code: 'DATA_UNAVAILABLE' });
  });
  it('figures that do not add up fail INTEGRITY before any AI call', () => {
    const p = payloadFor('AUTH002');
    p.books[0].pending += 100;
    const job = prepareJob(p, SETTINGS, NOW, fixedRandom).job;
    const r = buildContext(job);
    expect(r).toMatchObject({ ok: false, code: 'INTEGRITY' });
    expect(r.message).toContain('BK003');
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
    expect(r.outcome).toBe(AI_OUTCOMES.PASS);
    expect(r.ai).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5', attempts: 1, input_tokens: 3000, output_tokens: 700, cost_usd: 0.013 });
    expect(r.ai.verified_figures).toBeGreaterThan(8);
    expect(r.ai.sections).toEqual(goodSections);
  });
  it('a wrong figure asks for one rewrite with feedback, with a request body for each provider', () => {
    const r = afterAi({ response: anthropicOk(wrongSections), ctx, job, attempt: 1 });
    expect(r.outcome).toBe(AI_OUTCOMES.REWRITE);
    expect(Object.keys(r.rewrite)).toEqual(['anthropic', 'openai']);
    const msgs = r.rewrite.anthropic.messages;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(msgs[2].content).toContain('₹84,500');
    expect(r.rewrite.anthropic).toMatchObject({ model: 'claude-sonnet-5-5', system: expect.anything() });
    expect(r.rewrite.openai.input.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(r.rewrite.openai.input[2].content).toContain('₹84,500');
    expect(r.rewrite.openai.model).toBe('gpt-4.1-mini');
    const viaOpenai = afterAi({ response: openaiOk(wrongSections), ctx, job, attempt: 1 });
    expect(viaOpenai.outcome).toBe(AI_OUTCOMES.REWRITE);
    expect(viaOpenai.rewrite.anthropic.messages).toHaveLength(3);
    expect(viaOpenai.rewrite.openai.input).toHaveLength(3);
  });
  it('the rewrite bodies keep the drills: primary_down still fails Anthropic, so OpenAI rewrites', () => {
    const drilled = jobFor('AUTH002', { drills: { primary_down: true } });
    const r = afterAi({ response: openaiOk(wrongSections), ctx: ctxFor(drilled), job: drilled, attempt: 1 });
    expect(r.rewrite.anthropic.model).toBe(DRILL_MODEL);
    expect(r.rewrite.openai.model).toBe('gpt-4.1-mini');
  });
  it('a second wrong draft fails AI_FACT_CHECK_FAILED and sums usage over both attempts', () => {
    const first = afterAi({ response: anthropicOk(wrongSections), ctx, job, attempt: 1 });
    const r = afterAi({ response: anthropicOk(wrongSections), ctx, job, attempt: 2, previous: first.ai });
    expect(r.outcome).toBe(AI_OUTCOMES.FAIL);
    expect(r.failure).toMatchObject({ code: 'AI_FACT_CHECK_FAILED' });
    expect(r.failure.message).toContain('₹84,500');
    expect(r.ai).toMatchObject({ attempts: 2, input_tokens: 6000, output_tokens: 1400, cost_usd: 0.026 });
  });
  it('prices the tokens with the model_prices setting; a model with no price records no cost', () => {
    const doubled = { ...SETTINGS.model_prices['claude-sonnet-5-5'], inputPerMTok: 4, outputPerMTok: 20 };
    const priced = jobFor('AUTH002', {}, { ...SETTINGS, model_prices: { 'claude-sonnet-5-5': doubled } });
    expect(afterAi({ response: anthropicOk(), ctx, job: priced, attempt: 1 }).ai.cost_usd).toBe(0.026);
    const unpriced = jobFor('AUTH002', {}, { ...SETTINGS, model_prices: { 'gpt-4.1-mini': SETTINGS.model_prices['gpt-4.1-mini'] } });
    expect(afterAi({ response: anthropicOk(), ctx, job: unpriced, attempt: 1 }).ai.cost_usd).toBeNull();
  });
  it('a fixed second draft passes', () => {
    const first = afterAi({ response: anthropicOk(wrongSections), ctx, job, attempt: 1 });
    const r = afterAi({ response: openaiOk(), ctx, job, attempt: 2, previous: first.ai });
    expect(r.outcome).toBe(AI_OUTCOMES.PASS);
    expect(r.ai.provider).toBe('openai');
    expect(r.ai.cost_usd).toBeCloseTo(0.013 + (2800 * 0.4 + 600 * 1.6) / 1e6, 6);
  });
  it('an unusable answer is retried once, then fails AI_UNAVAILABLE', () => {
    const truncated = anthropicOk(goodSections, { stop_reason: 'max_tokens' });
    const first = afterAi({ response: truncated, ctx, job, attempt: 1 });
    expect(first.outcome).toBe(AI_OUTCOMES.REWRITE);
    expect(first.rewrite.anthropic.messages).toHaveLength(1);
    expect(first.rewrite.openai.input).toHaveLength(1);
    const second = afterAi({ response: truncated, ctx, job, attempt: 2, previous: first.ai });
    expect(second).toMatchObject({ outcome: AI_OUTCOMES.FAIL, failure: { code: 'AI_UNAVAILABLE' } });
    expect(second.ai.input_tokens).toBe(6000);
  });
  it('flags layout problems as warnings without blocking', () => {
    const s = { ...goodSections, bookParagraphs: [goodSections.bookParagraphs[0], { code: 'BK999', text: 'Hello.' }], closing: 'Bye.' };
    const r = afterAi({ response: anthropicOk(s), ctx, job, attempt: 1 });
    expect(r.outcome).toBe(AI_OUTCOMES.PASS);
    expect(r.ai.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['UNKNOWN_BOOK', 'MISSING_BOOK']));
  });
  it('the word-count warning follows the chosen length', () => {
    const short = jobFor('AUTH002', { length: 'short' });
    const detailed = jobFor('AUTH002', { length: 'detailed' });
    const lengthWarn = (j) => afterAi({ response: anthropicOk(), ctx: ctxFor(j), job: j, attempt: 1 }).ai.warnings.find((w) => w.code === 'LENGTH');
    expect(lengthWarn(short)).toBeUndefined();
    expect(lengthWarn(detailed).message).toMatch(/target 250-450/);
  });
});

describe('aiUnavailable', () => {
  const anthropicError = { error: { httpCode: '529', message: 'Overloaded' } };
  const openaiError = { error: { message: 'connect ETIMEDOUT' } };
  it('the first draft: neither provider answered; both errors are named', () => {
    const f = aiUnavailable({ rewriting: false, anthropicError, openaiError });
    expect(f).toMatchObject({ ok: false, code: 'AI_UNAVAILABLE' });
    expect(f.message).toBe('Neither AI provider returned a usable draft. anthropic: 529 - Overloaded | openai: connect ETIMEDOUT');
  });
  it('the rewrite: says it was the rewrite that failed', () => {
    const f = aiUnavailable({ rewriting: true, anthropicError, openaiError });
    expect(f.message).toBe('Neither AI provider returned a usable draft. The rewrite failed. anthropic: 529 - Overloaded | openai: connect ETIMEDOUT');
  });
  it('a missing error item still reads as an error', () => {
    expect(aiUnavailable({ rewriting: false, anthropicError: undefined, openaiError: {} }).message)
      .toContain('anthropic: unknown error | openai: unknown error');
  });
});

describe('readAnswer and checkAnswer (the Read Answer and Check Draft nodes)', () => {
  it('together give what afterAi gives, for a pass, a rewrite and an unreadable answer', async () => {
    const { buildContext } = await import('../../src/pipeline/context.js');
    const { queuedJob } = await import('./job-fixture.js');
    const { anthropicOk, wrongSections } = await import('./ai-fixtures.js');
    const job = queuedJob('AUTH002');
    const ctx = buildContext(job).ctx;
    for (const response of [anthropicOk(), anthropicOk(wrongSections), { type: 'message', content: [], stop_reason: 'max_tokens', usage: { input_tokens: 5, output_tokens: 9 } }]) {
      const read = readAnswer({ response, job, attempt: 1, previous: null });
      expect(checkAnswer({ read, ctx, job, attempt: 1 })).toEqual(afterAi({ response, ctx, job, attempt: 1 }));
    }
  });
  it('readAnswer needs no context: it only reads the provider\'s answer and prices it', async () => {
    const { queuedJob } = await import('./job-fixture.js');
    const { anthropicOk } = await import('./ai-fixtures.js');
    const read = readAnswer({ response: anthropicOk(), job: queuedJob('AUTH002'), attempt: 1, previous: null });
    expect(read).toMatchObject({ ok: true, ai: { provider: 'anthropic', model: 'claude-sonnet-5-5', attempts: 1, input_tokens: 3000 } });
  });
});
