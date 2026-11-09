import { callbackRequest } from '../bubble-client.js';

/**
 * Push mode (paid Bubble plan): the POST to Bubble's Workflow API `notification_result` for a
 * finished job. The token comes from the n8n credential; the placeholder header is dropped.
 * @param {Object} row UPDATE_JOB row @param {{bubbleAppBase:string}} config
 * @returns {{url:string, body:Object}|null} null when the job has no Bubble log to report to
 */
export function callbackFor(row, config) {
  if (!row?.log_id || !['SENT', 'FAILED'].includes(row.status)) return null;
  const completed = row.completed_at instanceof Date ? row.completed_at.toISOString() : row.completed_at ?? undefined;
  const req = callbackRequest(config.bubbleAppBase, {
    log_id: row.log_id, job_id: row.job_id, status: row.status,
    error: row.error ? `${row.error_code}: ${row.error}` : undefined,
    subject: row.subject ?? undefined, html: row.html ?? undefined,
    figures_verified: row.figures_verified ?? undefined, model: row.model ?? undefined,
    cost_usd: row.cost_usd === null || row.cost_usd === undefined ? undefined : Number(row.cost_usd), completed_at: completed,
  });
  return { url: req.url, body: req.body };
}
