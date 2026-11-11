import { signatureFor } from '../signature.js';
import { approveError, approveResponse } from './approve-request.js';
import { checkEdited, formatIssues, renderEdited } from './edit.js';
import { brandOf, senderFor } from './finalize.js';

/** Switch outputs after "Decide": answer now, discard the draft, or claim it and send. */
export const APPROVE_ROUTES = Object.freeze({ RESPOND: 0, DISCARD: 1, CLAIM: 2 });
const SENDING = ['PROCESSING', 'SENT'];

/**
 * @typedef {Object} DraftRow SELECT_DRAFT row (jsonb columns parsed)
 * @property {string} job_id @property {string} status @property {string} tone @property {string} length
 * @property {string} sign_off @property {string} recipient @property {Object} sections
 * @property {import('../facts-types.js').AuthorFacts} facts @property {string[]} titles
 * @property {{email_down?:boolean}|null} drills @property {boolean} fresh drafted within draft_ttl_hours
 */

const respond = (response) => ({ route: APPROVE_ROUTES.RESPOND, http_status: 200, response });

/** Status checks shared by every action. @returns {Object|null} an answer, or null to go on */
function statusGate(request, row) {
  const id = request.job_id;
  if (!row || !row.job_id) return respond(approveError('NOT_FOUND', id, ''));
  if (request.action === 'send' && SENDING.includes(row.status)) return respond(approveError('ALREADY_SENT', id, row.status));
  if (row.status !== 'DRAFTED') return respond(approveError('NOT_A_DRAFT', id, row.status));
  return null;
}

/** The edited email, checked by the same fact checker and rendered with figures from facts. */
function checkAndRender(request, row, settings) {
  const check = checkEdited({ subject: request.subject, body: request.body, facts: row.facts, titles: row.titles ?? [], length: row.length });
  const signature = signatureFor(row.tone, row.sign_off, settings.sender_name);
  const rendered = renderEdited({ subject: request.subject, parsed: check.parsed, facts: row.facts, brand: brandOf(settings), signature });
  const summary = {
    job_id: request.job_id, status: row.status, passed: check.passed, issues: formatIssues(check.issues),
    issue_count: check.issues.length, words: check.words, figures_verified: check.verifiedFigures,
  };
  return { check, rendered, summary };
}

/**
 * The "Decide" step after the draft row is loaded. A clean send is claimed (route CLAIM), then
 * `deliver` goes to the Deliver Email sub-workflow: the edited email for the job's stored demo inbox,
 * with the drill stored on the job and nothing else to record.
 * @param {{request:import('./approve-request.js').ApproveRequest, row:DraftRow|Object, settings:import('./settings.js').Settings}} input
 */
export function decideApproval({ request, row, settings }) {
  const gated = statusGate(request, row);
  if (gated) return gated;
  const params = JSON.stringify({ job_id: request.job_id });
  if (request.action === 'discard') return { route: APPROVE_ROUTES.DISCARD, params };
  if (!row.fresh) return respond(approveError('DRAFT_EXPIRED', request.job_id, row.status, {}, { hours: settings.draft_ttl_hours }));
  const { check, rendered, summary } = checkAndRender(request, row, settings);
  if (request.action === 'check') return respond(approveResponse({ ...summary, ok: true, html: rendered.html }));
  if (!check.passed) return respond(approveError('EDIT_BLOCKED', request.job_id, row.status, summary));
  const email = { from: senderFor(settings), to: row.recipient, subject: rendered.subject, html: rendered.html, text: rendered.text };
  /** @type {import('./finalize.js').Delivery} */
  const deliver = { job_id: request.job_id, email, drill: row.drills?.email_down === true, record: {} };
  const response = approveResponse({ ...summary, ok: true, status: 'PROCESSING' });
  return { route: APPROVE_ROUTES.CLAIM, params, deliver, response };
}

/**
 * After CLAIM_DRAFT. route 1 = claimed (answer, then send); 0 = nothing claimed: another click won.
 * @param {{row:Object, decided:{params:string, response:Object}}} input
 */
export function claimOutcome({ row, decided }) {
  if (row && row.job_id) return { route: 1, http_status: 200, response: decided.response };
  const jobId = JSON.parse(decided.params).job_id;
  return { route: 0, http_status: 200, response: approveError('ALREADY_SENT', jobId, 'PROCESSING') };
}

/** After DISCARD_DRAFT. @param {{row:Object, jobId:string}} input */
export function discardOutcome({ row, jobId }) {
  if (row && row.job_id) return respond(approveResponse({ ok: true, job_id: jobId, status: 'DISCARDED' }));
  return respond(approveError('NOT_A_DRAFT', jobId, ''));
}
