/** HTTP helpers for the contract suite. The webhook key is read from .secrets/webhook.env, never printed. */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvFile, requireKeys } from '../../n8n/tools/env-file.mjs';
import { n8nApi } from '../../n8n/tools/n8n-api.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ENV_FILE = process.env.CONTRACT_ENV_FILE ?? join(ROOT, '.secrets/n8n-local.env');
const target = requireKeys(readEnvFile(ENV_FILE), ['N8N_BASE_URL', 'N8N_API_KEY'], ENV_FILE);
export const BASE_URL = target.N8N_BASE_URL.replace(/\/+$/, '');
export const KEY = readEnvFile(join(ROOT, '.secrets/webhook.env')).BOOKLEAF_WEBHOOK_KEY;
export const DEMO_INBOX = process.env.CONTRACT_DEMO_INBOX || 'akshykmr@loopmethods.com';
export const POLL_LIMIT_MS = 90_000;
/** The same n8n's public API (to read executions); its key comes from the same env file, never printed. */
export const N8N_API = n8nApi({ baseUrl: BASE_URL, apiKey: target.N8N_API_KEY });

const headers = (key) => ({ 'content-type': 'application/json', ...(key === null ? {} : { 'X-BookLeaf-Key': key }) });

/** @returns {Promise<{status:number, body:any}>} */
export async function enqueue(body, key = KEY) {
  const r = await fetch(`${BASE_URL}/webhook/royalty-summary`, { method: 'POST', headers: headers(key), body: JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: parseOrText(text) };
}

/** POST /webhook/royalty-summary/approve. @returns {Promise<{status:number, body:any}>} */
export async function approve(body, key = KEY) {
  const r = await fetch(`${BASE_URL}/webhook/royalty-summary/approve`, { method: 'POST', headers: headers(key), body: JSON.stringify(body) });
  return { status: r.status, body: parseOrText(await r.text()) };
}

export async function jobStatus(query, key = KEY) {
  const r = await fetch(`${BASE_URL}/webhook/royalty-summary/jobs?${new URLSearchParams(query)}`, { headers: headers(key) });
  return { status: r.status, body: parseOrText(await r.text()) };
}

function parseOrText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Sends a payload as a NEW job: a run inside the same 10-minute window as an earlier run would be a
 * duplicate, so `attempt` is bumped until the webhook answers 202.
 */
export async function enqueueFresh(payload) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const r = await enqueue({ ...payload, attempt });
    if (r.status === 202) return { ...r, payload: { ...payload, attempt } };
    if (r.status !== 200 || !r.body.duplicate) throw new Error(`enqueue answered ${r.status}: ${JSON.stringify(r.body)}`);
  }
  throw new Error('no free attempt number in this 10-minute window');
}

/** Statuses a job rests in: SENT, FAILED, DRAFTED (waiting for approval) and DISCARDED. */
export const SETTLED = Object.freeze(['SENT', 'FAILED', 'DRAFTED', 'DISCARDED']);

/** Polls until the job reaches one of `until` (default: any settled status). */
export async function waitForJob(jobId, { includeHtml = false, until: statuses = SETTLED } = {}) {
  const until = Date.now() + POLL_LIMIT_MS;
  while (Date.now() < until) {
    const r = await jobStatus({ ids: jobId, ...(includeHtml ? { include: 'html' } : {}) });
    const job = r.body?.jobs?.[0];
    if (job && statuses.includes(job.status)) return job;
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`job ${jobId} did not finish within ${POLL_LIMIT_MS / 1000}s`);
}
