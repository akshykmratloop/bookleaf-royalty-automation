import { describe, expect, it } from 'vitest';
import * as anthropic from '../src/providers/anthropic.js';
import * as openai from '../src/providers/openai.js';
import { getProvider, PROVIDER_NAMES } from '../src/providers/registry.js';
import { sectionsSchema, strictSectionsSchema } from '../src/providers/schema.js';
import { costUsd, PRICES } from '../src/providers/cost.js';

const sections = {
  subject: 'Your royalty summary',
  greeting: 'Hi Priya,',
  intro: 'Intro.',
  bookParagraphs: [{ code: 'BK001', text: 'About it.' }],
  totalsParagraph: 'Totals.',
  payoutParagraph: 'Payout.',
  closing: 'Regards',
};
const input = { system: 'SYS', user: 'USR', schema: sectionsSchema, maxTokens: 2000 };

describe('schema', () => {
  it('requires the mandatory sections and forbids extras', () => {
    expect(sectionsSchema.required).toEqual(['subject', 'greeting', 'intro', 'bookParagraphs', 'totalsParagraph', 'payoutParagraph', 'closing']);
    expect(sectionsSchema.additionalProperties).toBe(false);
    expect(sectionsSchema.properties.bookParagraphs.items.additionalProperties).toBe(false);
  });
  it('strict variant lists every property as required, optional ones nullable', () => {
    expect(strictSectionsSchema.required.sort()).toEqual(Object.keys(strictSectionsSchema.properties).sort());
    expect(strictSectionsSchema.properties.productionParagraph.type).toEqual(['string', 'null']);
  });
});

describe('anthropic provider', () => {
  it('builds a Messages API request with json_schema output and no secret', () => {
    const r = anthropic.buildRequest({ ...input, model: 'claude-sonnet-5-5' });
    expect(r.url).toBe('https://api.anthropic.com/v1/messages');
    expect(r.headers['anthropic-version']).toBe('2023-06-01');
    expect(r.headers['x-api-key']).toBe(anthropic.CREDENTIAL_PLACEHOLDER);
    expect(r.body).toMatchObject({
      model: 'claude-sonnet-5-5', max_tokens: 2000,
      system: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'USR' }],
    });
    expect(r.body.output_config.format).toEqual({ type: 'json_schema', schema: sectionsSchema });
    expect(r.body.output_config.effort).toBe('medium');
    expect(r.body.fallbacks).toBe('default');
    expect(r.headers['anthropic-beta']).toBe(anthropic.FALLBACK_BETA);
    expect(r.body).not.toHaveProperty('temperature');
    expect(r.body).not.toHaveProperty('thinking');
    expect(JSON.stringify(r)).not.toMatch(/sk-ant/);
  });
  it('defaults the model', () => {
    expect(anthropic.buildRequest(input).body.model).toBe(anthropic.DEFAULT_MODEL);
    expect(anthropic.DEFAULT_MODEL).toBe('claude-sonnet-5-5');
  });
  const ok = (text, extra = {}) => ({ id: 'msg_1', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text }], usage: { input_tokens: 900, output_tokens: 300 }, ...extra });
  it('parses structured output and usage', () => {
    const r = anthropic.parseResponse(ok(JSON.stringify(sections)));
    expect(r).toEqual({ ok: true, sections, usage: { inputTokens: 900, outputTokens: 300, cacheWriteTokens: 0, cacheReadTokens: 0 }, model: 'claude-sonnet-5-5' });
  });
  it('skips thinking blocks', () => {
    const j = ok(JSON.stringify(sections)); j.content.unshift({ type: 'thinking', thinking: '' });
    expect(anthropic.parseResponse(j).ok).toBe(true);
  });
  it.each([
    ['API error', { type: 'error', error: { type: 'overloaded_error', message: 'busy' } }, 'API_ERROR'],
    ['refusal', ok('', { stop_reason: 'refusal' }), 'REFUSED'],
    ['truncated', ok('{"subj', { stop_reason: 'max_tokens' }), 'TRUNCATED'],
    ['bad json', ok('not json'), 'INVALID_JSON'],
    ['wrong shape', ok(JSON.stringify({ subject: 'x' })), 'INVALID_SHAPE'],
    ['no text', { stop_reason: 'end_turn', content: [], usage: {} }, 'EMPTY'],
    ['garbage', null, 'INVALID_RESPONSE'],
  ])('maps %s to a typed error', (_n, json, code) => {
    const r = anthropic.parseResponse(json);
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe(code);
    expect(typeof r.error.message).toBe('string');
  });
});

describe('openai provider', () => {
  it('builds a Responses API request with strict json_schema', () => {
    const r = openai.buildRequest({ ...input, schema: strictSectionsSchema, model: 'gpt-4.1-mini' });
    expect(r.url).toBe('https://api.openai.com/v1/responses');
    expect(r.headers.authorization).toBe(openai.CREDENTIAL_PLACEHOLDER);
    expect(r.body).toMatchObject({ model: 'gpt-4.1-mini', instructions: 'SYS', input: 'USR', max_output_tokens: 2000 });
    expect(r.body.text.format).toMatchObject({ type: 'json_schema', strict: true, schema: strictSectionsSchema });
  });
  it('uses the strict schema even if the loose one is passed', () => {
    const r = openai.buildRequest(input);
    expect(r.body.text.format.schema).toEqual(strictSectionsSchema);
  });
  const ok = (text) => ({ status: 'completed', model: 'gpt-4.1-mini-2025', output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 800, output_tokens: 250 } });
  it('parses output and drops null optional sections', () => {
    const body = { ...sections, productionParagraph: null, allPaidParagraph: null };
    const r = openai.parseResponse(ok(JSON.stringify(body)));
    expect(r).toEqual({ ok: true, sections, usage: { inputTokens: 800, outputTokens: 250, cacheWriteTokens: 0, cacheReadTokens: 0 }, model: 'gpt-4.1-mini-2025' });
  });
  it.each([
    ['API error', { error: { code: 'rate_limit', message: 'slow down' } }, 'API_ERROR'],
    ['incomplete', { ...ok('{'), status: 'incomplete' }, 'TRUNCATED'],
    ['refusal', { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }], usage: {} }, 'REFUSED'],
    ['bad json', ok('nope'), 'INVALID_JSON'],
    ['wrong shape', ok('{}'), 'INVALID_SHAPE'],
    ['garbage', 'x', 'INVALID_RESPONSE'],
  ])('maps %s to a typed error', (_n, json, code) => expect(openai.parseResponse(json).error.code).toBe(code));
});

describe('registry', () => {
  it('returns providers by name', () => {
    expect(PROVIDER_NAMES).toEqual(['anthropic', 'openai']);
    expect(getProvider('anthropic').name).toBe('anthropic');
    expect(getProvider('openai').name).toBe('openai');
  });
  it('rejects unknown providers with a typed error', () => {
    expect(() => getProvider('x')).toThrow(/Unknown AI provider/);
  });
});

describe('costUsd', () => {
  it('prices Sonnet 5.5 at $2 / $10 per million', () => {
    expect(PRICES['claude-sonnet-5-5']).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10, cacheReadMultiplier: 0.1 });
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'claude-sonnet-5-5')).toBe(12);
    expect(costUsd({ inputTokens: 900, outputTokens: 300 }, 'claude-sonnet-5-5')).toBeCloseTo(0.0048, 6);
  });
  it('matches dated model ids by prefix', () => {
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 0 }, 'gpt-4.1-mini-2025-04-14')).toBeGreaterThan(0);
  });
  it('returns null for an unknown model rather than guessing', () => {
    expect(costUsd({ inputTokens: 10, outputTokens: 10 }, 'mystery')).toBeNull();
  });
});

describe('regeneration conversations', () => {
  const messages = [{ role: 'user', content: 'USR' }, { role: 'assistant', content: '{"x":1}' }, { role: 'user', content: 'FIX' }];
  it('anthropic sends the conversation and ends on a user turn (no prefill)', () => {
    const r = anthropic.buildRequest({ ...input, messages });
    expect(r.body.messages).toEqual(messages);
    expect(r.body.messages.at(-1).role).toBe('user');
  });
  it('anthropic can drop the server-side fallback', () => {
    const r = anthropic.buildRequest({ ...input, serverFallback: false });
    expect(r.body).not.toHaveProperty('fallbacks');
    expect(r.headers).not.toHaveProperty('anthropic-beta');
  });
  it('openai sends the conversation as input items', () => {
    expect(openai.buildRequest({ ...input, messages }).body.input).toEqual(messages);
  });
});

describe('cache-aware usage and cost', () => {
  it('anthropic reports cache writes and reads separately and prices them', () => {
    const u = anthropic.usageOf({ usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 2000, cache_read_input_tokens: 0 } });
    expect(u).toEqual({ inputTokens: 1000, outputTokens: 500, cacheWriteTokens: 2000, cacheReadTokens: 0 });
    expect(costUsd(u, 'claude-sonnet-5-5')).toBe((1000 * 2 + 2000 * 2 * 1.25 + 500 * 10) / 1e6);
    expect(costUsd({ ...u, cacheWriteTokens: 0, cacheReadTokens: 2000 }, 'claude-sonnet-5-5')).toBe((1000 * 2 + 2000 * 0.2 + 500 * 10) / 1e6);
  });
  it('openai cached tokens are carved out of input_tokens', () => {
    const u = openai.usageOf({ usage: { input_tokens: 3000, output_tokens: 100, input_tokens_details: { cached_tokens: 1024 } } });
    expect(u).toEqual({ inputTokens: 1976, outputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 1024 });
  });
});
