#!/usr/bin/env node
/**
 * Writes an environment's own settings (the `perEnvironment` keys of n8n/src/pipeline/settings.js)
 * into bookleaf_settings: prints idempotent SQL on stdout, to be piped straight into psql.
 *   node n8n/tools/settings-sql.mjs --env <file> [--env <file> ...] | <psql on the bookleaf database>
 * Each env file may set EMAIL_FROM, DEFAULT_DEMO_INBOX, ALLOWED_DEMO_INBOXES (comma-separated addresses,
 * empty = none), ALLOW_DRILLS (true|false) and ALERT_EMAIL;
 * `--env -` reads stdin, and a later file wins. EMAIL_FROM falls back to SMTP_USER_EMAIL, the SMTP
 * account the deploy used as the sender before settings existed. A setting the input does not name
 * keeps its stored value. Values are checked against the schema; an error names the variable, never
 * its value. The SQL holds real addresses: pipe it, never commit or paste it.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { settingProblem } from '../src/pipeline/settings-checks.js';
import { SETTINGS_SCHEMA } from '../src/pipeline/settings.js';
import { parseEnvText, readEnvFile } from './env-file.mjs';
import { literal } from './settings-seed.mjs';

const PER_ENVIRONMENT = Object.keys(SETTINGS_SCHEMA).filter((k) => SETTINGS_SCHEMA[k].perEnvironment);
/** Env-file name → setting key (EMAIL_FROM → email_from, ...). */
export const ENV_NAMES = Object.freeze(Object.fromEntries(PER_ENVIRONMENT.map((k) => [k.toUpperCase(), k])));
const FLAGS = Object.freeze({ true: true, false: false });

/** A comma-separated env value as a list: entries trimmed, empty entries dropped ('' = no entries). */
const list = (raw) => raw.split(',').map((s) => s.trim()).filter(Boolean);

/** @returns {unknown} the env text typed like the setting's default (boolean, list or text); undefined = not a flag */
function typed(key, raw) {
  const sample = SETTINGS_SCHEMA[key].default;
  if (typeof sample === 'boolean') return FLAGS[raw];
  return Array.isArray(sample) ? list(raw) : raw;
}

/** @returns {{value?:unknown, problem?:string}} the typed value of one variable, or what is wrong with it */
function parseOne(name, raw) {
  const key = ENV_NAMES[name];
  const value = typed(key, raw);
  if (value === undefined) return { problem: `${name}: must be true or false` };
  const problem = settingProblem(key, value);
  return problem ? { problem: `${name}: ${problem}` } : { value };
}

/**
 * @param {Record<string, string>} env merged env-file values
 * @returns {Record<string, unknown>} setting key → typed, checked value, for the names present
 * @throws {Error} listing every bad variable (by name), or when none is present
 */
export function perEnvironmentValues(env) {
  const vars = { ...(env.SMTP_USER_EMAIL === undefined ? {} : { EMAIL_FROM: env.SMTP_USER_EMAIL }), ...env };
  const names = Object.keys(ENV_NAMES).filter((n) => Object.hasOwn(vars, n));
  if (names.length === 0) throw new Error(`the input sets none of ${Object.keys(ENV_NAMES).join(', ')}`);
  const parsed = names.map((n) => [ENV_NAMES[n], parseOne(n, vars[n])]);
  const problems = parsed.filter(([, r]) => r.problem).map(([, r]) => r.problem);
  if (problems.length) throw new Error(`invalid setting(s): ${problems.join('; ')}`);
  return Object.fromEntries(parsed.map(([k, r]) => [k, r.value]));
}

/**
 * @param {Record<string, unknown>} values per-environment setting key → checked value
 * @returns {string} one transaction; a row changes (and its updated_at moves) only when its value differs
 */
export function settingsSql(values) {
  const keys = Object.keys(values);
  if (keys.length === 0) throw new Error('nothing to write');
  const other = keys.find((k) => !PER_ENVIRONMENT.includes(k));
  if (other) throw new Error(`${other} is not a per-environment setting`);
  const rows = keys.map((k) => [
    'INSERT INTO bookleaf_settings (key, value, description) VALUES',
    `  (${literal(k)}, ${literal(JSON.stringify(values[k]))}, ${literal(SETTINGS_SCHEMA[k].description)})`,
    'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
    'WHERE bookleaf_settings.value IS DISTINCT FROM EXCLUDED.value;',
  ].join('\n'));
  return ['BEGIN;', ...rows, 'COMMIT;', ''].join('\n');
}

/** @param {string[]} argv @returns {Record<string, string>} the --env files merged in order */
function readInputs(argv) {
  const files = argv.flatMap((a, i) => (a === '--env' && argv[i + 1] ? [argv[i + 1]] : []));
  if (files.length === 0) throw new Error('usage: settings-sql.mjs --env <file> [--env <file> ...]  (- = stdin)');
  return Object.assign({}, ...files.map((f) => (f === '-' ? parseEnvText(readFileSync(0, 'utf8')) : readEnvFile(f))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(settingsSql(perEnvironmentValues(readInputs(process.argv.slice(2)))));
  } catch (e) {
    console.error(`settings-sql: ${e.message}`);
    process.exit(1);
  }
}
