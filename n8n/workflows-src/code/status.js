/** Entry points for the job-status, error-handler and sweeper workflows' Code nodes. */
import { authFailure, isAuthorized } from '../../src/pipeline/auth.js';
import { errorBody } from '../../src/pipeline/errors.js';
import { internalFailureUpdate, jobIdFromExecution } from '../../src/pipeline/error-handler.js';
import { parseStatusQuery, shapeJobs } from '../../src/pipeline/status.js';

const item = (json) => [{ json }];

/** route 0 = reject (403 bad key, 400 bad query), 1 = query. */
export function parseQuery({ query, headers, keyHashes }) {
  const r = isAuthorized(headers, keyHashes) ? parseStatusQuery(query) : authFailure();
  if (!r.ok) return item({ route: 0, http_status: r.http_status, response: errorBody(r) });
  return item({ route: 1, ids: r.ids, include_html: r.includeHtml, params: r.params });
}

export function respondJobs({ rows, ids, includeHtml }) {
  return item({ http_status: 200, response: shapeJobs(rows, ids, includeHtml) });
}

/** route 0 = no job found in the failed execution (nothing to update), 1 = mark it FAILED. */
export function failedJob({ trigger, execution }) {
  const jobId = jobIdFromExecution(execution);
  if (!jobId) return item({ route: 0, reason: 'no job id in the failed execution' });
  return item({ route: 1, update: internalFailureUpdate(jobId, trigger) });
}
