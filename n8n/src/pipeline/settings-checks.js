import { isRealDate } from '../dates.js';
import { isEmail } from '../validate-fields.js';
import { failure } from './errors.js';
import { timingProblem } from './settings-timing.js';

/**
 * The checks a stored setting must pass before a workflow uses it, and readSettings, which the Check
 * Settings Code node runs. Kept apart from the defaults and descriptions (settings.js), which only the
 * seed tool and the tests need, so the workflows do not carry them.
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


/** The check each stored setting must pass, by key (settings.js adds defaults and descriptions). */
export const SETTING_CHECKS = Object.freeze({
  brand_name: text(80),
  sender_name: displayName(80),
  email_from: email,
  support_email: emailOrEmpty,
  default_demo_inbox: emailOrEmpty,
  allow_drills: flag,
  reference_date_default: dateOrToday,
  ai_primary: fields({ model: text(100), effort: oneOf('low', 'medium', 'high'), max_tokens: whole(256, 64000) }),
  ai_fallback: fields({ model: text(100), max_tokens: whole(256, 64000) }),
  ai_timeout_ms: whole(5000, 120000),
  model_prices: priceTable,
  max_sends_per_hour: whole(1, 10000),
  duplicate_window_minutes: whole(1, 1440),
  draft_ttl_hours: whole(1, 720),
  stuck_job_minutes: whole(5, 240),
  alert_email: emailOrEmpty,
});

/**
 * @param {string} key @param {unknown} value
 * @returns {string|null} what is wrong with `value` for setting `key` (prefixed with the key), or null when it is fine
 */
export function settingProblem(key, value) {
  if (!Object.hasOwn(SETTING_CHECKS, key)) return `"${key}" is not a known setting`;
  const problem = SETTING_CHECKS[key](value);
  return problem ? `${key} ${problem}` : null;
}

/**
 * Checks the "Load Settings" row (every bookleaf_settings row as one object) before a run uses it.
 * Every known setting must be there and valid; a key this code does not know is ignored, so a newer
 * migration never breaks older workflows. Problems name the setting, never its value (the timing check
 * names the AI timeout and stuck_job_minutes, which are not secret). The AI worst case must fit before
 * stuck_job_minutes and the run timeout (settings-timing.js).
 * @param {unknown} stored @returns {{ok:true, settings:import('./settings.js').Settings}|import('./errors.js').Failure} INTERNAL (500) when unusable
 */
export function readSettings(stored) {
  if (!isPlainObject(stored)) return failure('INTERNAL', 'The server settings could not be read: bookleaf_settings is empty or missing.');
  const keys = Object.keys(SETTING_CHECKS);
  const problems = keys.map((k) => (Object.hasOwn(stored, k) ? settingProblem(k, stored[k]) : `${k} is missing`)).filter(Boolean);
  if (problems.length) return failure('INTERNAL', `Server settings are invalid: ${problems.join('; ')}.`);
  const settings = Object.fromEntries(keys.map((k) => [k, stored[k]]));
  const timing = timingProblem(settings);
  if (timing) return failure('INTERNAL', `Server settings do not fit together: ${timing}.`);
  return { ok: true, settings };
}
