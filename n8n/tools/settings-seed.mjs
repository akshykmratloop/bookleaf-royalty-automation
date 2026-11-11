#!/usr/bin/env node
/**
 * Writes the bookleaf_settings seed, generated from n8n/src/pipeline/settings.js, between the seed
 * markers of every SQL file that creates the table. Run it after changing a default or a description;
 * n8n/tests/ledger-schema.test.js fails while a file is out of date.
 *   node n8n/tools/settings-seed.mjs
 * The seed never overwrites a stored row (ON CONFLICT DO NOTHING): per-environment values survive re-runs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SETTINGS_SCHEMA } from '../src/pipeline/settings.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SEEDED_FILES = Object.freeze(['infra/db/init/01-bookleaf.sql', 'infra/db/migrations/03-settings-enqueue.sql']);
export const SEED_BEGIN = '-- BEGIN settings seed: generated from n8n/src/pipeline/settings.js by n8n/tools/settings-seed.mjs; do not edit by hand.';
export const SEED_END = '-- END settings seed';

/** @param {unknown} s @returns {string} a standard SQL string literal */
const literal = (s) => `'${String(s).replaceAll("'", "''")}'`;

/**
 * @param {Record<string, {default:unknown, description:string}>} [schema]
 * @returns {string} one INSERT of every key with its JSON default and description
 */
export function seedSql(schema = SETTINGS_SCHEMA) {
  const rows = Object.entries(schema).map(([key, s]) => `  (${literal(key)}, ${literal(JSON.stringify(s.default))}, ${literal(s.description)})`);
  return ['INSERT INTO bookleaf_settings (key, value, description) VALUES', rows.join(',\n'), 'ON CONFLICT (key) DO NOTHING;'].join('\n');
}

/**
 * @param {string} sql a file holding SEED_BEGIN ... SEED_END @param {string} seed
 * @returns {string} the file with the lines between the markers replaced by `seed`
 * @throws {Error} when the markers are missing
 */
export function withSeed(sql, seed) {
  const begin = sql.indexOf(SEED_BEGIN);
  const end = sql.indexOf(SEED_END, begin);
  if (begin < 0 || end < 0) throw new Error(`settings seed markers not found (${SEED_BEGIN} ... ${SEED_END})`);
  return `${sql.slice(0, begin + SEED_BEGIN.length)}\n${seed}\n${sql.slice(end)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const file of SEEDED_FILES) {
    const path = join(ROOT, file);
    writeFileSync(path, withSeed(readFileSync(path, 'utf8'), seedSql()));
    console.log(`settings seed written: ${file}`);
  }
}
