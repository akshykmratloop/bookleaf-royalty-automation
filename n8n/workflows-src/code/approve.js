/** Entry points for the approve-draft workflow's Code nodes. All logic lives in n8n/src/pipeline. */
import { approvedFailedUpdate, approvedSentUpdate, claimOutcome, decideApproval, discardOutcome } from '../../src/pipeline/approve.js';
import { validateApprove } from '../../src/pipeline/approve-request.js';
import { authFailure, isAuthorized } from '../../src/pipeline/auth.js';
import { errorBody } from '../../src/pipeline/errors.js';
import { readSettings } from '../../src/pipeline/settings.js';

const item = (json) => [{ json }];
const rejected = (f) => item({ route: 0, http_status: f.http_status, response: errorBody(f) });

/** Key, server settings (Load Settings) and body. route 0 = reject (403/400/500), 1 = load the draft. */
export function parseApprove({ body, headers, keyHashes, settings }) {
  if (!isAuthorized(headers, keyHashes)) return rejected(authFailure());
  const read = readSettings(settings);
  if (!read.ok) return rejected(read);
  const r = validateApprove(body);
  if (!r.ok) return rejected(r);
  return item({ route: 1, job_id: r.value.job_id, request: r.value, settings: read.settings, params: JSON.stringify({ job_id: r.value.job_id }) });
}

/** routes: 0 answer now, 1 discard, 2 claim and send (approve.js APPROVE_ROUTES). */
export const decide = ({ request, row, settings }) => item(decideApproval({ request, row, settings }));

export const discarded = ({ row, jobId }) => item(discardOutcome({ row, jobId }));

/** route 0 = nothing claimed (another click won), 1 = claimed: answer, then send. */
export const claimed = ({ row, decided }) => item(claimOutcome({ row, decided }));

export const approvedSent = ({ jobId, email }) => item({ update: approvedSentUpdate(jobId, email) });

export const approvedFailed = ({ jobId, email, error }) => item({ update: approvedFailedUpdate(jobId, email, error) });
