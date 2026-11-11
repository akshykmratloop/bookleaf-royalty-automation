#!/usr/bin/env node
/**
 * Idempotent deploy of the BookLeaf workflows to an n8n instance through its public API.
 *   node n8n/deploy.mjs [--env .secrets/n8n-local.env]
 * The env file gives N8N_BASE_URL, N8N_API_KEY and the bookleaf DB settings (BOOKLEAF_DB_*; the
 * password falls back to AWS SSM). SMTP comes from bubble/.env, AI keys from the parent repo's .env,
 * the webhook key(s) from .secrets/webhook.env (generated once; BOOKLEAF_WEBHOOK_KEY_NEXT is accepted
 * too during a key rotation). Workflows get only SHA-256 hashes of the keys. No secret value is ever printed.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkflow, WORKFLOW_SOURCES } from './build.mjs';
import { CREDENTIALS, placeholderId } from './workflows-src/lib/credentials.mjs';
import { KEY_HASHES_PLACEHOLDER } from './workflows-src/lib/nodes.mjs';
import { keyHashesFor } from './src/pipeline/auth.js';
import { readEnvFile, requireKeys } from './tools/env-file.mjs';
import { n8nApi } from './tools/n8n-api.mjs';
import { aiKeys, credentialData, databaseSettings, smtpSettings, webhookKeys } from './tools/secrets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argValue = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

async function upsertCredentials(api, data) {
  const existing = await api.listAll('/credentials');
  const ids = {};
  for (const [key, def] of Object.entries(CREDENTIALS)) {
    const found = existing.find((c) => c.name === def.name && c.type === def.type);
    if (found) {
      await api.call('PATCH', `/credentials/${found.id}`, { name: def.name, type: def.type, data: data[key] });
      ids[key] = found.id;
      console.log(`credential updated: ${def.name}`);
    } else {
      const made = await api.call('POST', '/credentials', { name: def.name, type: def.type, data: data[key] });
      ids[key] = made.id;
      console.log(`credential created: ${def.name}`);
    }
  }
  return ids;
}

/** Swaps build placeholders (credential ids, error workflow id, key hashes) for real values. */
function resolvePlaceholders(wf, credIds, workflowIds, { keyHashes }) {
  let text = JSON.stringify(wf);
  for (const [key, id] of Object.entries(credIds)) text = text.split(placeholderId(key)).join(id);
  for (const [name, id] of Object.entries(workflowIds)) text = text.split(`__WORKFLOW_${name}__`).join(id);
  text = text.split(KEY_HASHES_PLACEHOLDER).join(keyHashes);
  const left = text.match(/__(CREDENTIAL|WORKFLOW)_[^"]*__|__WEBHOOK_KEY_HASHES__/);
  if (left) throw new Error(`Unresolved placeholder ${left[0]} in ${wf.name}`);
  return JSON.parse(text);
}

async function upsertWorkflow(api, wf, existing) {
  const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const found = existing.find((w) => w.name === wf.name && !w.isArchived);
  const saved = found ? await api.call('PUT', `/workflows/${found.id}`, body) : await api.call('POST', '/workflows', body);
  await api.call('POST', `/workflows/${saved.id}/publish`, {});
  console.log(`workflow ${found ? 'updated' : 'created'} and published: ${wf.name} (${saved.id})`);
  return saved.id;
}

/** Publishing registers webhooks asynchronously: wait until they answer (403 = registered, no key sent). */
async function waitForWebhooks(baseUrl, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  const probes = [['POST', 'royalty-summary'], ['GET', 'royalty-summary/jobs'], ['POST', 'royalty-summary/approve']];
  for (const [method, path] of probes) {
    let status = 404;
    while (status === 404 && Date.now() < until) {
      status = (await fetch(`${baseUrl}/webhook/${path}`, { method })).status;
      if (status === 404) await new Promise((r) => setTimeout(r, 1000));
    }
    if (status === 404) throw new Error(`webhook ${method} /webhook/${path} is still not registered`);
  }
}

async function main() {
  const envPath = resolve(ROOT, argValue('--env', '.secrets/n8n-local.env'));
  const target = readEnvFile(envPath);
  const { N8N_BASE_URL: baseUrl, N8N_API_KEY: apiKey } = requireKeys(target, ['N8N_BASE_URL', 'N8N_API_KEY'], envPath);
  const smtp = smtpSettings(join(ROOT, '.env'));
  const data = credentialData({
    db: databaseSettings(target), smtp, ai: aiKeys(join(ROOT, '..', '.env')), n8nApiKey: apiKey,
  });
  const keyHashes = keyHashesFor(webhookKeys(join(ROOT, '.secrets', 'webhook.env')));
  const api = n8nApi({ baseUrl, apiKey });
  console.log(`deploying to ${new URL(baseUrl).host}`);
  const credIds = await upsertCredentials(api, data);
  const existing = await api.listAll('/workflows');
  const workflowIds = {};
  for (const name of WORKFLOW_SOURCES) {
    const wf = resolvePlaceholders(await buildWorkflow(name), credIds, workflowIds, { keyHashes });
    workflowIds[wf.name] = await upsertWorkflow(api, wf, existing);
  }
  await waitForWebhooks(baseUrl);
  console.log(`done: ${Object.keys(workflowIds).length} workflows live at ${baseUrl}/webhook/royalty-summary (${keyHashes.split(',').length} webhook key(s) accepted)`);
}

main().catch((e) => {
  console.error(`deploy failed: ${e.message}`);
  process.exit(1);
});
