/** Entry points for the job-status workflow's Code nodes. */
import { errorBody } from '../../src/pipeline/errors.js';
import { parseStatusQuery, shapeJobs } from '../../src/pipeline/status.js';

const item = (json) => [{ json }];

/** route 0 = reject (400 bad query), 1 = query. */
export function parseQuery({ query }) {
  const r = parseStatusQuery(query);
  if (!r.ok) return item({ route: 0, http_status: r.http_status, response: errorBody(r) });
  return item({ route: 1, ids: r.ids, include_html: r.includeHtml, params: r.params });
}

export function respondJobs({ rows, ids, includeHtml }) {
  return item({ http_status: 200, response: shapeJobs(rows, ids, includeHtml) });
}
