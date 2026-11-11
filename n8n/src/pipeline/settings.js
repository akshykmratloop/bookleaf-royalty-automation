import { isRealDate } from '../dates.js';
import { isEmail } from '../validate-fields.js';
import { failure } from './errors.js';
import { timingProblem } from './settings-timing.js';

/**
 * The server settings: one row each in the `bookleaf_settings` table of the `bookleaf` database.
 * This schema is the single source of their defaults (n8n/tools/settings-seed.mjs writes the seed SQL
 * into infra/db) and of the checks a stored value must pass before a workflow uses it.
 * `perEnvironment`: the value differs between local and production and is written per environment,
 * never committed; the default is only a safe placeholder.
 */

/** @param {boolean} ok @param {string} text @returns {string|null} */
const unless = (ok, text) => (ok ? null : text);
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (max) => (v) => unless(typeof v === 'string' && v.trim() !== '' && v.length <= max, `must be text of 1 to ${max} characters`);
/** Safe as the display name of an email From line: nothing that would split or extend the address list. */
const displayName = (max) => (v) => text(max)(v)
  ?? unless(!/["\\,;:<>@\u0000-\u001f\u007f]/.test(v), 'must not contain quotes, commas, semicolons, colons, angle brackets, @, backslashes or line breaks');
const email = (v) => unless(isEmail(v), 'must be an email address');
const emailOrEmpty = (v) => unless(v === '' || isEmail(v), 'must be an email address, or empty');
const flag = (v) => unless(typeof v === 'boolean', 'must be true or false');
const whole = (min, max) => (v) => unless(Number.isInteger(v) && v >= min && v <= max, `must be a whole number from ${min} to ${max}`);
const oneOf = (...allowed) => (v) => unless(allowed.includes(v), `must be one of ${allowed.join(', ')}`);
const dateOrToday = (v) => unless(v === 'today' || isRealDate(v), 'must be a date YYYY-MM-DD or "today"');
const rate = (v) => unless(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000, 'must be a number from 0 to 1000');

/** An object with exactly these fields, each passing its check. */
const fields = (spec) => (v) => {
  if (!isPlainObject(v)) return 'must be an object';
  const unknown = Object.keys(v).filter((k) => !Object.hasOwn(spec, k));
  if (unknown.length) return `has unknown field(s) ${unknown.join(', ')}`;
  for (const [k, check] of Object.entries(spec)) {
    const problem = check(v[k]);
    if (problem) return `${k} ${problem}`;
  }
  return null;
};

const price = fields({ inputPerMTok: rate, outputPerMTok: rate, cacheWriteMultiplier: rate, cacheReadMultiplier: rate });

function priceTable(v) {
  if (!isPlainObject(v) || Object.keys(v).length === 0) return 'must map at least one model name to its price';
  for (const [model, p] of Object.entries(v)) {
    const problem = text(100)(model) ?? price(p);
    if (problem) return `"${model}" ${problem}`;
  }
  return null;
}

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (typeof v === 'object' && v !== null) deepFreeze(v);
  return Object.freeze(o);
};

const PRICE_SOURCES = 'claude-sonnet-5-5: Anthropic list price (claude-api model table, 2026-10-06); '
  + 'gpt-4.1-mini: OpenAI standard tier (developers.openai.com/api/docs/pricing, checked 2026-11-11).';

export const SETTINGS_SCHEMA = deepFreeze({
  brand_name: {
    default: 'BookLeaf Publishing', check: text(80),
    description: 'Publisher name shown in the email header, subject line and footer.',
  },
  sender_name: {
    default: 'BookLeaf Author Relations', check: displayName(80),
    description: 'Name in the From line of every email and in the default signature.',
  },
  email_from: {
    default: '', check: email, perEnvironment: true,
    description: 'Sender address. Required: set it for each environment to an address the SMTP account may send from.',
  },
  support_email: {
    default: '', check: emailOrEmpty,
    description: 'Support address printed in the email footer; empty leaves the line out.',
  },
  default_demo_inbox: {
    default: '', check: emailOrEmpty, perEnvironment: true,
    description: 'Inbox for requests that name no demo_inbox; empty makes such requests fail with NO_RECIPIENT. Never an author address.',
  },
  allow_drills: {
    default: false, check: flag, perEnvironment: true,
    description: 'true lets a request force failure drills (ai_down, email_down, data_down, primary_down, crash); keep false where real authors are emailed.',
  },
  reference_date_default: {
    default: '2025-12-31', check: dateOrToday,
    description: 'Date the royalty status is worked out against when a request gives none: YYYY-MM-DD, or "today" (IST).',
  },
  ai_primary: {
    default: { model: 'claude-sonnet-5-5', effort: 'medium', max_tokens: 8000 },
    check: fields({ model: text(100), effort: oneOf('low', 'medium', 'high'), max_tokens: whole(256, 64000) }),
    description: 'Primary AI writer (Anthropic Messages API): model, effort (low, medium or high) and output token limit.',
  },
  ai_fallback: {
    default: { model: 'gpt-4.1-mini', max_tokens: 4000 },
    check: fields({ model: text(100), max_tokens: whole(256, 64000) }),
    description: 'Fallback AI writer (OpenAI Responses API), used when the primary fails: model and output token limit.',
  },
  ai_timeout_ms: {
    default: 45000, check: whole(5000, 120000),
    description: 'Time limit for one AI request, in milliseconds. All AI calls of a run at worst (draft and rewrite, two providers, two tries each) plus 60 s must end within stuck_job_minutes and the 600 s run timeout; 62500 is the most that fits.',
  },
  model_prices: {
    default: {
      'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1 },
      'gpt-4.1-mini': { inputPerMTok: 0.4, outputPerMTok: 1.6, cacheWriteMultiplier: 1, cacheReadMultiplier: 0.25 },
    },
    check: priceTable,
    description: `USD per million tokens by model, for cost_usd; cache multipliers apply to the input price, and a model with no entry records no cost. ${PRICE_SOURCES}`,
  },
  max_sends_per_hour: {
    default: 60, check: whole(1, 10000),
    description: 'Jobs accepted per rolling hour (failed and discarded jobs do not count); beyond it the webhook answers 429.',
  },
  duplicate_window_minutes: {
    default: 10, check: whole(1, 1440),
    description: 'A request identical to one accepted within this many minutes gets that job back (duplicate) instead of a new one.',
  },
  draft_ttl_hours: {
    default: 24, check: whole(1, 720),
    description: 'Hours a draft can still be approved and sent; after that, approval answers DRAFT_EXPIRED.',
  },
  stuck_job_minutes: {
    default: 10, check: whole(5, 240),
    description: 'A job still running after this many minutes is stopped by the sweeper and marked failed. Must leave room for the AI worst case (see ai_timeout_ms).',
  },
  alert_email: {
    default: '', check: emailOrEmpty, perEnvironment: true,
    description: 'Address told about unexpected workflow errors; empty sends no alert.',
  },
});

/**
 * The validated settings a workflow run uses, keyed as stored.
 * @typedef {Object} Settings
 * @property {string} brand_name @property {string} sender_name @property {string} email_from @property {string} support_email
 * @property {string} default_demo_inbox @property {boolean} allow_drills @property {string} reference_date_default
 * @property {{model:string, effort:'low'|'medium'|'high', max_tokens:number}} ai_primary
 * @property {{model:string, max_tokens:number}} ai_fallback @property {number} ai_timeout_ms
 * @property {Record<string, import('../providers/cost.js').Price>} model_prices @property {number} max_sends_per_hour
 * @property {number} duplicate_window_minutes @property {number} draft_ttl_hours @property {number} stuck_job_minutes
 * @property {string} alert_email
 */

/**
 * @param {string} key @param {unknown} value
 * @returns {string|null} what is wrong with `value` for setting `key` (prefixed with the key), or null when it is fine
 */
export function settingProblem(key, value) {
  if (!Object.hasOwn(SETTINGS_SCHEMA, key)) return `"${key}" is not a known setting`;
  const problem = SETTINGS_SCHEMA[key].check(value);
  return problem ? `${key} ${problem}` : null;
}

/**
 * Checks the "Load Settings" row (every bookleaf_settings row as one object) before a run uses it.
 * Every known setting must be there and valid; a key this code does not know is ignored, so a newer
 * migration never breaks older workflows. Problems name the setting, never its value (the timing check
 * names the AI timeout and stuck_job_minutes, which are not secret). The AI worst case must fit before
 * stuck_job_minutes and the run timeout (settings-timing.js).
 * @param {unknown} stored @returns {{ok:true, settings:Settings}|import('./errors.js').Failure} INTERNAL (500) when unusable
 */
export function readSettings(stored) {
  if (!isPlainObject(stored)) return failure('INTERNAL', 'The server settings could not be read: bookleaf_settings is empty or missing.');
  const keys = Object.keys(SETTINGS_SCHEMA);
  const problems = keys.map((k) => (Object.hasOwn(stored, k) ? settingProblem(k, stored[k]) : `${k} is missing`)).filter(Boolean);
  if (problems.length) return failure('INTERNAL', `Server settings are invalid: ${problems.join('; ')}.`);
  const settings = Object.fromEntries(keys.map((k) => [k, stored[k]]));
  const timing = timingProblem(settings);
  if (timing) return failure('INTERNAL', `Server settings do not fit together: ${timing}.`);
  return { ok: true, settings };
}
