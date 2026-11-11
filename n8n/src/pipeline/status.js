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

const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);

/**
 * @param {Object[]} rows SELECT_JOBS rows (an empty {} row when nothing matched)
 * @param {string[]} ids requested ids, in order @param {boolean} includeHtml
 * @returns {{jobs:Object[], missing:string[]}}
 */
export function shapeJobs(rows, ids, includeHtml) {
  const byId = new Map(rows.filter((r) => r && r.job_id).map((r) => [r.job_id, r]));
  const jobs = ids.filter((id) => byId.has(id)).map((id) => {
    const { html, text_body: textBody, ...r } = byId.get(id);
    const out = {
      ...r, created_at: iso(r.created_at), updated_at: iso(r.updated_at), completed_at: iso(r.completed_at),
      ...('stage_at' in r ? { stage_at: iso(r.stage_at) } : {}), ...('drafted_at' in r ? { drafted_at: iso(r.drafted_at) } : {}),
    };
    return includeHtml ? { ...out, html: html ?? null, text_body: textBody ?? null } : out;
  });
  return { jobs, missing: ids.filter((id) => !byId.has(id)) };
}
