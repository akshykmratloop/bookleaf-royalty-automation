/** Entry points for the job-status workflow's Code nodes. */
import { errorBody } from '../../src/pipeline/errors.js';
import { parseStatusQuery } from '../../src/pipeline/status.js';

const item = (json) => [{ json }];

/** ok: Select Jobs gets `params` and answers the request itself; not ok: the 400 answer for a bad query. */
export function parseQuery({ query }) {
  const r = parseStatusQuery(query);
  if (!r.ok) return item({ ok: false, http_status: r.http_status, response: errorBody(r) });
  return item({ ok: true, ids: r.ids, include_html: r.includeHtml, params: r.params });
}
