import { describe, expect, it } from 'vitest';
import { SETTINGS_SCHEMA, settingProblem } from '../../src/pipeline/settings.js';
import { DEFAULT_BRAND } from '../../src/brand.js';
import { DEFAULT_SIGN_OFF } from '../../src/signature.js';
import { readConfig } from '../../src/pipeline/config.js';
import { IDEMPOTENCY_WINDOW_MS } from '../../src/pipeline/ids.js';
import { SWEEP_STUCK } from '../../src/pipeline/sql.js';
import { CLAIM_DRAFT } from '../../src/pipeline/sql-approve.js';
import { PRICES } from '../../src/providers/cost.js';
import * as anthropic from '../../src/providers/anthropic.js';
import * as openai from '../../src/providers/openai.js';
import { buildWorkflow } from '../../build.mjs';

const KEYS = [
  'brand_name', 'sender_name', 'email_from', 'support_email', 'default_demo_inbox', 'allow_drills', 'reference_date_default',
  'ai_primary', 'ai_fallback', 'ai_timeout_ms', 'model_prices', 'max_sends_per_hour', 'duplicate_window_minutes',
  'draft_ttl_hours', 'stuck_job_minutes', 'alert_email',
];
const PER_ENVIRONMENT = ['email_from', 'default_demo_inbox', 'allow_drills', 'alert_email'];
const dflt = (key) => SETTINGS_SCHEMA[key].default;

describe('settings schema', () => {
  it('has exactly the agreed keys, each with a default, a description and a check', () => {
    expect(Object.keys(SETTINGS_SCHEMA)).toEqual(KEYS);
    for (const [key, s] of Object.entries(SETTINGS_SCHEMA)) {
      expect(s.default, key).not.toBeUndefined();
      expect(s.description, key).toMatch(/^[A-Za-z].{20,400}$/);
      expect(typeof s.check, key).toBe('function');
    }
  });
  it('marks the values that differ between local and production', () => {
    expect(KEYS.filter((k) => SETTINGS_SCHEMA[k].perEnvironment)).toEqual(PER_ENVIRONMENT);
  });
  it('every default is valid, except email_from, which each environment must set', () => {
    const invalid = KEYS.filter((k) => settingProblem(k, dflt(k)) !== null);
    expect(invalid).toEqual(['email_from']);
    expect(settingProblem('email_from', '')).toMatch(/^email_from must be an email address/);
  });
  it('is frozen, defaults included', () => {
    expect(Object.isFrozen(SETTINGS_SCHEMA)).toBe(true);
    expect(Object.isFrozen(dflt('ai_primary'))).toBe(true);
    expect(Object.isFrozen(dflt('model_prices')['gpt-4.1-mini'])).toBe(true);
  });
});

describe('settingProblem', () => {
  it.each([
    ['brand_name', '', 'must be text of 1 to 80 characters'],
    ['brand_name', 'x'.repeat(81), 'must be text of 1 to 80 characters'],
    ['email_from', 'sender@', 'must be an email address'],
    ['support_email', 'nope', 'must be an email address, or empty'],
    ['allow_drills', 'true', 'must be true or false'],
    ['reference_date_default', '2025-02-30', 'must be a date YYYY-MM-DD or "today"'],
    ['ai_primary', { model: 'm', effort: 'max', max_tokens: 8000 }, 'effort must be one of low, medium, high'],
    ['ai_primary', { model: 'm', effort: 'low' }, 'max_tokens must be a whole number from 256 to 64000'],
    ['ai_fallback', { model: 'm', max_tokens: 4000, effort: 'low' }, 'has unknown field(s) effort'],
    ['ai_fallback', 'gpt-4.1-mini', 'must be an object'],
    ['ai_timeout_ms', 4999, 'must be a whole number from 5000 to 120000'],
    ['model_prices', {}, 'must map at least one model name to its price'],
    ['model_prices', { m: { inputPerMTok: -1, outputPerMTok: 1, cacheWriteMultiplier: 1, cacheReadMultiplier: 1 } }, '"m" inputPerMTok must be a number from 0 to 1000'],
    ['max_sends_per_hour', 0, 'must be a whole number from 1 to 10000'],
    ['max_sends_per_hour', 1.5, 'must be a whole number from 1 to 10000'],
    ['duplicate_window_minutes', '10', 'must be a whole number from 1 to 1440'],
    ['draft_ttl_hours', 721, 'must be a whole number from 1 to 720'],
    ['stuck_job_minutes', 4, 'must be a whole number from 5 to 240'],
  ])('%s = %j → "%s"', (key, value, problem) => {
    expect(settingProblem(key, value)).toBe(`${key} ${problem}`);
  });
  it('accepts good values', () => {
    expect(settingProblem('reference_date_default', 'today')).toBeNull();
    expect(settingProblem('email_from', 'sender@bookleaf.test')).toBeNull();
    expect(settingProblem('alert_email', '')).toBeNull();
    expect(settingProblem('ai_primary', { model: 'claude-x', effort: 'high', max_tokens: 64000 })).toBeNull();
  });
  it('names an unknown key', () => {
    expect(settingProblem('max_sends', 60)).toBe('"max_sends" is not a known setting');
  });
});

/** Until each step moves its reader onto the settings table, the seed must reproduce today's constants. */
describe('defaults reproduce the behaviour hard-coded today (delete a pin when its constant goes)', () => {
  it('brand, sender and AI writers', () => {
    expect(dflt('brand_name')).toBe(DEFAULT_BRAND.name);
    expect(dflt('sender_name')).toBe(DEFAULT_SIGN_OFF);
    expect(dflt('ai_primary')).toEqual({ model: anthropic.DEFAULT_MODEL, effort: anthropic.DEFAULT_EFFORT, max_tokens: anthropic.DEFAULT_MAX_TOKENS });
    expect(dflt('ai_fallback')).toEqual({ model: openai.DEFAULT_MODEL, max_tokens: openai.DEFAULT_MAX_TOKENS });
    expect(dflt('model_prices')).toEqual(PRICES);
  });
  it('limits and windows', async () => {
    const env = readConfig({}).config;
    expect(dflt('max_sends_per_hour')).toBe(env.maxSendsPerHour);
    expect(dflt('reference_date_default')).toBe(env.referenceDateDefault);
    expect(dflt('duplicate_window_minutes') * 60_000).toBe(IDEMPOTENCY_WINDOW_MS);
    expect(CLAIM_DRAFT).toContain(`interval '${dflt('draft_ttl_hours')} hours'`);
    expect(SWEEP_STUCK).toContain(`interval '${dflt('stuck_job_minutes')} minutes'`);
    const summary = await buildWorkflow('royalty-summary');
    const ai = summary.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest' && /anthropic|openai/.test(n.parameters.url));
    expect(ai.map((n) => n.parameters.options.timeout)).toEqual(ai.map(() => dflt('ai_timeout_ms')));
  });
  it('gpt-4.1-mini is priced at the published OpenAI standard rate (USD per 1M tokens)', () => {
    expect(dflt('model_prices')['gpt-4.1-mini']).toEqual({ inputPerMTok: 0.4, outputPerMTok: 1.6, cacheWriteMultiplier: 1, cacheReadMultiplier: 0.25 });
    expect(SETTINGS_SCHEMA.model_prices.description).toMatch(/gpt-4\.1-mini: OpenAI standard tier .*2026-11-11/);
  });
});
