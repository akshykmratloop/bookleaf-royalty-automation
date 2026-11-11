import { describe, expect, it } from 'vitest';
import { readSettings, SETTINGS_SCHEMA, settingProblem } from '../../src/pipeline/settings.js';
import { SETTINGS } from './settings-fixture.js';
import { DRILLS } from '../../src/pipeline/request.js';

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
  it('the allow_drills description names every drill a request may force', () => {
    expect(DRILLS).toEqual(['ai_down', 'email_down', 'data_down', 'primary_down', 'crash']);
    for (const d of DRILLS) expect(SETTINGS_SCHEMA.allow_drills.description).toContain(d);
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
  it('sender_name must be safe in an email From line', () => {
    for (const bad of ['Author Relations, BookLeaf', 'A "B"', 'A <b@c.d>', 'A;B', 'Team: all', 'A\nBcc: x@y.z', 'a@b'])
      expect(settingProblem('sender_name', bad), bad).toMatch(/^sender_name must not contain/);
    expect(settingProblem('sender_name', "Anita O'Brien & Team (Royalties)")).toBeNull();
  });
});

describe('readSettings (the Load Settings row, before a workflow uses it)', () => {
  it('returns every known setting, validated; a key this code does not know is ignored (a newer migration)', () => {
    const r = readSettings({ ...SETTINGS, added_later: 1 });
    expect(r).toEqual({ ok: true, settings: SETTINGS });
  });
  it('fails INTERNAL (500), naming each missing or invalid setting but no value', () => {
    const { brand_name: _gone, ...rest } = SETTINGS;
    const r = readSettings({ ...rest, email_from: 'not-an-address', max_sends_per_hour: 0 });
    expect(r).toMatchObject({ ok: false, code: 'INTERNAL', http_status: 500 });
    expect(r.message).toContain('brand_name is missing');
    expect(r.message).toContain('email_from must be an email address');
    expect(r.message).toContain('max_sends_per_hour must be a whole number from 1 to 10000');
    expect(r.message).not.toContain('not-an-address');
  });
  it('a fresh environment fails until email_from is set', () => {
    const seeded = Object.fromEntries(KEYS.map((k) => [k, dflt(k)]));
    expect(readSettings(seeded).message).toMatch(/Server settings are invalid: email_from must be an email address\.$/);
  });
  it('an empty or missing table (no row: the aggregate is NULL) fails INTERNAL', () => {
    for (const stored of [null, undefined, [], 'x']) expect(readSettings(stored)).toMatchObject({ ok: false, code: 'INTERNAL' });
  });
});

describe('seeded values', () => {
  it('gpt-4.1-mini is priced at the published OpenAI standard rate (USD per 1M tokens)', () => {
    expect(dflt('model_prices')['gpt-4.1-mini']).toEqual({ inputPerMTok: 0.4, outputPerMTok: 1.6, cacheWriteMultiplier: 1, cacheReadMultiplier: 0.25 });
    expect(SETTINGS_SCHEMA.model_prices.description).toMatch(/gpt-4\.1-mini: OpenAI standard tier .*2026-11-11/);
  });
});
