import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Minimal KEY=VALUE env-file reader. Values are returned, never printed.
 * @param {string} path @returns {Record<string, string>}
 */
export function readEnvFile(path) {
  if (!existsSync(path)) throw new Error(`Env file not found: ${path}`);
  return parseEnvText(readFileSync(path, 'utf8'));
}

/**
 * Supports blank lines, # comments (whole-line and inline after unquoted values), optional `export `,
 * and single/double quotes. Lines that are not KEY=value are skipped.
 * @param {string} text @returns {Record<string, string>}
 */
export function parseEnvText(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = unquote(m[2].trim());
  }
  return out;
}

/** Quoted values are taken literally; unquoted values lose an inline ` # comment`. */
function unquote(v) {
  const q = v[0];
  if ((q === '"' || q === "'") && v.lastIndexOf(q) > 0) return v.slice(1, v.lastIndexOf(q));
  return v.replace(/\s+#.*$/, '').trim();
}

/** @param {Record<string, string>} env @param {string[]} keys @returns {Record<string, string>} */
export function requireKeys(env, keys, label) {
  const missing = keys.filter((k) => typeof env[k] !== 'string' || env[k] === '');
  if (missing.length) throw new Error(`${label}: missing ${missing.join(', ')}`);
  return Object.fromEntries(keys.map((k) => [k, env[k]]));
}

/**
 * Writes an env file with mode 600 inside a mode-700 directory.
 * @param {string} path @param {Record<string, string>} values
 */
export function writeSecretEnvFile(path, values) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const body = Object.entries(values).map(([k, v]) => `${k}=${quoteIfNeeded(v)}`).join('\n');
  writeFileSync(path, `${body}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

const quoteIfNeeded = (v) => (/[\s#"']/.test(v) ? `'${v.replace(/'/g, '')}'` : v);

/** @param {number} [bytes] @returns {string} URL-safe random secret */
export const randomSecret = (bytes = 32) => randomBytes(bytes).toString('base64url');
