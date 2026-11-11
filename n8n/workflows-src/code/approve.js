/** Entry points for the approve-draft workflow's Code nodes. All logic lives in n8n/src/pipeline. */
import { decideApproval } from '../../src/pipeline/approve.js';
import { validateApprove } from '../../src/pipeline/approve-request.js';
import { errorBody } from '../../src/pipeline/errors.js';
import { readSettings } from '../../src/pipeline/settings.js';

const item = (json) => [{ json }];
const rejected = (f) => item({ ok: false, http_status: f.http_status, response: errorBody(f) });

/** Server settings (Load Settings) and body. ok: load the draft; not ok: the 400/500 answer. */
export function parseApprove({ body, settings }) {
  const read = readSettings(settings);
  if (!read.ok) return rejected(read);
  const r = validateApprove(body);
  if (!r.ok) return rejected(r);
  return item({ ok: true, job_id: r.value.job_id, request: r.value, settings: read.settings, params: JSON.stringify({ job_id: r.value.job_id }) });
}

/** `action`: answer now, discard, or claim (by this execution) and send (approve.js APPROVE_ACTIONS). */
export const decide = ({ request, row, settings, executionId }) => item(decideApproval({ request, row, settings, executionId }));
