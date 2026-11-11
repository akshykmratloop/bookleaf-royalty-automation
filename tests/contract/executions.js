/** Reads the live n8n's saved executions through its public API (the contract tests' own n8n). */
import { N8N_API } from './client.js';

const idOf = (execution) => Number(execution.id);

/** @returns {Promise<number>} the id of the newest saved execution (0 when there is none) */
export async function newestExecutionId() {
  const page = await N8N_API.call('GET', '/executions?limit=1');
  return page.data?.length ? idOf(page.data[0]) : 0;
}

/**
 * Executions saved after `afterId` whose data contains `marker` (the public API leaves out the
 * ones still running).
 * @param {string} marker @param {number} afterId @returns {Promise<string[]>} their ids
 */
export async function executionsMentioning(marker, afterId) {
  const page = await N8N_API.call('GET', '/executions?limit=100');
  const newer = (page.data ?? []).filter((e) => idOf(e) > afterId);
  const full = await Promise.all(newer.map((e) => N8N_API.call('GET', `/executions/${e.id}?includeData=true`)));
  return full.filter((e) => JSON.stringify(e).includes(marker)).map((e) => String(e.id));
}

/**
 * Polls until an execution saved after `afterId` mentions `marker` and passes `accept`.
 * @param {string} marker @param {number} afterId @param {(e: any) => boolean} accept
 * @returns {Promise<any>} that execution, with its data
 * @throws {Error} after `timeoutMs`
 */
export async function waitForExecution(marker, afterId, accept, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const page = await N8N_API.call('GET', '/executions?limit=50');
    const newer = (page.data ?? []).filter((e) => idOf(e) > afterId);
    const full = await Promise.all(newer.map((e) => N8N_API.call('GET', `/executions/${e.id}?includeData=true`)));
    const found = full.find((e) => JSON.stringify(e).includes(marker) && accept(e));
    if (found) return found;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`no execution mentioning ${marker} within ${timeoutMs / 1000}s`);
}
