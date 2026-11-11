import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomSecret, readEnvFile, requireKeys, writeSecretEnvFile } from './env-file.mjs';

/**
 * Collects every secret the credentials need, from local files (never from tracked files).
 * Nothing here prints a value.
 */
const DEFAULT_SSM_PARAM = '/bookleaf-a2/postgres/password';

/** A header value n8n compares exactly: printable ASCII without spaces, 32+ characters (too long to guess). */
const STRONG_KEY = /^[\x21-\x7e]{32,256}$/;

/**
 * The webhook key, BOOKLEAF_WEBHOOK_KEY in .secrets/webhook.env (mode 600; generated once). The
 * webhooks' Header Auth checks exactly one key, so a leftover BOOKLEAF_WEBHOOK_KEY_NEXT from the
 * old two-key rotation is refused: rotate by changing the key, deploying, then updating Bubble.
 * @param {string} path @returns {string}
 * @throws {Error} naming the variable (never the value) when the key is missing, weak or not alone
 */
export function webhookKey(path) {
  if (!existsSync(path)) writeSecretEnvFile(path, { BOOKLEAF_WEBHOOK_KEY: randomSecret(32) });
  const env = readEnvFile(path);
  const key = requireKeys(env, ['BOOKLEAF_WEBHOOK_KEY'], path).BOOKLEAF_WEBHOOK_KEY;
  if (env.BOOKLEAF_WEBHOOK_KEY_NEXT !== undefined) {
    throw new Error(`${path}: BOOKLEAF_WEBHOOK_KEY_NEXT is not used any more (one key, checked by n8n); remove it`);
  }
  if (!STRONG_KEY.test(key)) throw new Error(`${path}: BOOKLEAF_WEBHOOK_KEY must be 32 to 256 printable characters without spaces`);
  return key;
}

/** Postgres settings from the target env file; the password may come from AWS SSM (production). */
export function databaseSettings(target) {
  const db = {
    host: target.BOOKLEAF_DB_HOST || 'postgres', port: Number(target.BOOKLEAF_DB_PORT || 5432),
    database: target.BOOKLEAF_DB_NAME || 'bookleaf', user: target.BOOKLEAF_DB_USER || 'n8n', password: target.BOOKLEAF_DB_PASSWORD,
  };
  if (db.password) return db;
  const name = target.BOOKLEAF_DB_PASSWORD_SSM || DEFAULT_SSM_PARAM;
  const args = ['ssm', 'get-parameter', '--name', name, '--with-decryption', '--query', 'Parameter.Value', '--output', 'text',
    '--profile', target.AWS_PROFILE || 'loopmethods', '--region', target.AWS_REGION || 'ap-south-1'];
  const password = execFileSync('aws', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (!password) throw new Error(`SSM parameter ${name} is empty`);
  return { ...db, password };
}

/** SMTP account from bubble/.env. */
export function smtpSettings(path) {
  const e = requireKeys(readEnvFile(path), ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER_EMAIL', 'SMTP_USER_PASSWORD'], path);
  const secure = (readEnvFile(path).SMTP_SECURE ?? '').toLowerCase() === 'true';
  return { host: e.SMTP_HOST, port: Number(e.SMTP_PORT), secure, user: e.SMTP_USER_EMAIL, password: e.SMTP_USER_PASSWORD };
}

/** AI keys from the parent repo's .env. */
export const aiKeys = (path) => requireKeys(readEnvFile(path), ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'], path);

/**
 * Credential name → {type, data}, keyed like workflows-src/lib/credentials.mjs.
 * @returns {Record<string, Object>}
 */
export function credentialData({ db, smtp, ai, n8nApiKey, webhookKey: key }) {
  const only = (domain) => ({ allowedHttpRequestDomains: 'domains', allowedDomains: domain });
  return {
    postgres: { ...db, ssl: 'disable', allowUnauthorizedCerts: false, sshTunnel: false },
    anthropic: { name: 'x-api-key', value: ai.ANTHROPIC_API_KEY, ...only('api.anthropic.com') },
    openai: { token: ai.OPENAI_API_KEY, ...only('api.openai.com') },
    smtp: { ...smtp, disableStartTls: false },
    smtpDrill: { host: '127.0.0.1', port: 9, secure: false, user: 'drill', password: 'drill', disableStartTls: true },
    n8nApi: { name: 'X-N8N-API-KEY', value: n8nApiKey },
    webhookKey: { name: 'X-BookLeaf-Key', value: key, allowedHttpRequestDomains: 'none' },
  };
}
