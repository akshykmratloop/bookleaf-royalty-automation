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
