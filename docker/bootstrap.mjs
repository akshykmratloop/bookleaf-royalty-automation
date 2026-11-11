#!/usr/bin/env node
/**
 * Local n8n bootstrap: writes generated secrets into .secrets/, starts the compose stack, writes the
 * local settings into bookleaf_settings, creates the owner account and a public-API key, and saves
 * them to .secrets/n8n-local.env.
 * Idempotent: an existing owner / API key file is reused. Secret values are never printed.
 *
 *   node docker/bootstrap.mjs [--no-up]
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomSecret, readEnvFile, requireKeys, writeSecretEnvFile } from '../n8n/tools/env-file.mjs';
import { perEnvironmentValues, settingsSql } from '../n8n/tools/settings-sql.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS = join(ROOT, '.secrets');
const COMPOSE_ENV = join(SECRETS, 'n8n-local.compose.env');
const API_ENV = join(SECRETS, 'n8n-local.env');
const COMPOSE_FILE = join(ROOT, 'docker', 'docker-compose.local.yml');
const BASE_URL = 'http://localhost:5678';
const VERSION = readFileSync(join(ROOT, 'docker', 'N8N_VERSION'), 'utf8').trim();
const OWNER_EMAIL = 'owner@bookleaf.local';
/** Demo inbox for every test email (lead's decision); override with DEMO_INBOX=... */
const DEMO_INBOX = process.env.DEMO_INBOX || 'akshykmr@loopmethods.com';

const smtpAccount = () => requireKeys(readEnvFile(join(ROOT, '.env')), ['SMTP_USER_EMAIL'], 'bubble/.env').SMTP_USER_EMAIL;

function ensureComposeEnv() {
  const old = existsSync(COMPOSE_ENV) ? readEnvFile(COMPOSE_ENV) : {};
  const pgPassword = old.POSTGRES_PASSWORD || randomSecret(24);
  writeSecretEnvFile(COMPOSE_ENV, {
    POSTGRES_PASSWORD: pgPassword,
    DB_POSTGRESDB_PASSWORD: pgPassword,
    N8N_ENCRYPTION_KEY: old.N8N_ENCRYPTION_KEY || randomSecret(32),
    DEFAULT_DEMO_INBOX: DEMO_INBOX,
    EMAIL_FROM: smtpAccount(),
  });
  console.log(`compose env ready: ${COMPOSE_ENV}`);
}

function composeUp() {
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d'], {
    stdio: 'inherit',
    env: { ...process.env, N8N_VERSION: VERSION },
  });
}

/** This stack's own settings: the SMTP account sends, the demo inbox receives and gets the alerts, drills are on. */
function applyLocalSettings() {
  const values = perEnvironmentValues({ EMAIL_FROM: smtpAccount(), DEFAULT_DEMO_INBOX: DEMO_INBOX, ALLOW_DRILLS: 'true', ALERT_EMAIL: DEMO_INBOX });
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'postgres', 'psql', '-X', '-q', '-U', 'n8n', '-d', 'bookleaf', '-v', 'ON_ERROR_STOP=1'], {
    input: settingsSql(values), stdio: ['pipe', 'ignore', 'inherit'], env: { ...process.env, N8N_VERSION: VERSION },
  });
  console.log('local settings written to bookleaf_settings');
}

async function waitHealthy(timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const ok = await fetch(`${BASE_URL}/healthz/readiness`).then((r) => r.ok, () => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`n8n did not become ready at ${BASE_URL} within ${timeoutMs / 1000}s`);
}

async function rest(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${BASE_URL}/rest${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, setCookie: res.headers.getSetCookie?.() ?? [] };
}

async function ensureOwner(password) {
  const settings = await rest('/settings');
  const needsSetup = settings.json?.data?.userManagement?.showSetupOnFirstLoad;
  if (!needsSetup) return;
  const r = await rest('/owner/setup', {
    method: 'POST',
    body: { email: OWNER_EMAIL, firstName: 'BookLeaf', lastName: 'Admin', password },
  });
  if (r.status !== 200) throw new Error(`owner setup failed: HTTP ${r.status} ${r.json?.message ?? ''}`);
  console.log('owner account created');
}

async function login(password) {
  const r = await rest('/login', { method: 'POST', body: { emailOrLdapLoginId: OWNER_EMAIL, password } });
  if (r.status !== 200) {
    throw new Error(`login failed: HTTP ${r.status}. If .secrets/n8n-local.env was lost, reset the local stack: ` +
      'docker compose -f docker/docker-compose.local.yml down && rm -rf docker/.data');
  }
  const auth = r.setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('n8n-auth='));
  if (!auth) throw new Error('login returned no n8n-auth cookie');
  return auth;
}

async function createApiKey(cookie) {
  const scopes = await rest('/api-keys/scopes', { cookie });
  const body = { label: `bookleaf-deploy-${Date.now()}`, expiresAt: null, scopes: scopes.json?.data ?? [] };
  const r = await rest('/api-keys', { method: 'POST', body, cookie });
  const key = r.json?.data?.rawApiKey;
  if (r.status !== 200 || !key) throw new Error(`API key creation failed: HTTP ${r.status} ${r.json?.message ?? ''}`);
  return key;
}

async function apiKeyWorks(key) {
  const res = await fetch(`${BASE_URL}/api/v1/workflows?limit=1`, { headers: { 'X-N8N-API-KEY': key } });
  return res.ok;
}

async function main() {
  ensureComposeEnv();
  if (!process.argv.includes('--no-up')) composeUp();
  await waitHealthy();
  applyLocalSettings();
  const old = existsSync(API_ENV) ? readEnvFile(API_ENV) : {};
  const password = old.N8N_OWNER_PASSWORD || `Bl-${randomSecret(18)}`;
  await ensureOwner(password);
  if (old.N8N_API_KEY && (await apiKeyWorks(old.N8N_API_KEY))) {
    console.log(`n8n ${VERSION} ready; existing API key still valid (${API_ENV})`);
    return;
  }
  const key = await createApiKey(await login(password));
  const pg = readEnvFile(COMPOSE_ENV).POSTGRES_PASSWORD;
  writeSecretEnvFile(API_ENV, {
    N8N_BASE_URL: BASE_URL, N8N_API_KEY: key, N8N_OWNER_EMAIL: OWNER_EMAIL, N8N_OWNER_PASSWORD: password,
    BOOKLEAF_DB_HOST: 'postgres', BOOKLEAF_DB_PORT: '5432', BOOKLEAF_DB_NAME: 'bookleaf', BOOKLEAF_DB_USER: 'n8n',
    BOOKLEAF_DB_PASSWORD: pg,
  });
  console.log(`n8n ${VERSION} ready; owner + API key saved to ${API_ENV}`);
}

main().catch((e) => {
  console.error(`bootstrap failed: ${e.message}`);
  process.exit(1);
});
