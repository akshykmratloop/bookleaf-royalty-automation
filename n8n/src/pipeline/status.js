import { failure } from './errors.js';
import { UUID } from './ids.js';

export const MAX_IDS = 50;

/**
 * Validates GET /royalty-summary/jobs?ids=a,b&include=html.
 * @param {Record<string, unknown>} query
 * @returns {{ok:true, ids:string[], includeHtml:boolean, params:string}|import('./errors.js').Failure}
 */
export function parseStatusQuery(query) {
  const raw = typeof query?.ids === 'string' ? query.ids : '';
  const ids = [...new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const fail = (code, message) => failure('VALIDATION', message, [{ path: 'ids', code, message }]);
  if (ids.length === 0) return fail('REQUIRED', 'ids is required: a comma-separated list of job ids');
  if (ids.length > MAX_IDS) return fail('TOO_MANY', `at most ${MAX_IDS} job ids per request`);
  const bad = ids.filter((id) => !UUID.test(id));
  if (bad.length) return fail('PATTERN', `not a job id: ${bad.slice(0, 3).join(', ')}`.slice(0, 200));
  const includeHtml = String(query?.include ?? '').split(',').map((s) => s.trim()).includes('html');
  return { ok: true, ids, includeHtml, params: JSON.stringify({ ids, include_html: includeHtml }) };
}
