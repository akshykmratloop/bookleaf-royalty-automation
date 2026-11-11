import { signatureFor } from '../signature.js';
import { approveError, approveResponse } from './approve-request.js';
import { checkEdited, formatIssues, renderEdited } from './edit.js';
import { brandOf, senderFor } from './finalize.js';

/** What "Decide" chose; the Action Switch names its outputs after these: answer now, discard, or claim and send. */
export const APPROVE_ACTIONS = Object.freeze({ ANSWER: 'answer', DISCARD: 'discard', SEND: 'send' });
const SENDING = ['PROCESSING', 'SENT'];

/**
 * @typedef {Object} DraftRow SELECT_DRAFT row (jsonb columns parsed)
 * @property {string} job_id @property {string} status @property {string} tone @property {string} length
 * @property {string} sign_off @property {string} recipient @property {Object} sections
 * @property {import('../facts-types.js').AuthorFacts} facts @property {string[]} titles
 * @property {{email_down?:boolean}|null} drills @property {boolean} fresh drafted within draft_ttl_hours
 */

const respond = (response) => ({ action: APPROVE_ACTIONS.ANSWER, response });

/** Status checks shared by every action. @returns {Object|null} an answer, or null to go on */
function statusGate(request, row) {
  const id = request.job_id;
  if (!row || !row.job_id) return respond(approveError('NOT_FOUND', id, ''));
  if (request.action === 'send' && SENDING.includes(row.status)) return respond(approveError('ALREADY_SENT', id, row.status));
  if (row.status !== 'DRAFTED') return respond(approveError('NOT_A_DRAFT', id, row.status));
  return null;
}

/**
 * Check Edit: the edited subject and prose through the same fact checker as the AI draft, when the
 * answer depends on it (a fresh draft that is checked or sent); null otherwise, so Decide answers alone.
 * @param {{request:import('./approve-request.js').ApproveRequest, row:DraftRow|Object}} input
 * @returns {ReturnType<typeof checkEdited>|null}
 */
export function editCheck({ request, row }) {
  if (request.action === 'discard' || statusGate(request, row) || !row.fresh) return null;
  return checkEdited({ subject: request.subject, body: request.body, facts: row.facts, titles: row.titles ?? [], length: row.length });
}

/** The edited email, rendered with figures from facts, and its check summary. */
function renderChecked(request, row, settings, check) {
  const signature = signatureFor(row.tone, row.sign_off, settings.sender_name);
  const rendered = renderEdited({ subject: request.subject, parsed: check.parsed, facts: row.facts, brand: brandOf(settings), signature });
  const summary = {
    job_id: request.job_id, status: row.status, passed: check.passed, issues: formatIssues(check.issues),
    issue_count: check.issues.length, words: check.words, figures_verified: check.verifiedFigures,
  };
  return { rendered, summary };
}

/**
 * The "Decide" step after the draft row is loaded. It works out every answer the request can get, so the
 * nodes after it only pick one: `response` when the discard or claim takes the row, `fallback` when
 * it does not (the draft changed meanwhile, or another click claimed it). A clean send is claimed by
 * this execution, then `deliver` goes to the Deliver Email sub-workflow: the edited email for the job's
 * stored demo inbox, with the drill stored on the job and nothing else to record.
 * `check` is Check Edit's result (editCheck), present whenever the answer needs it.
 * @param {{request:import('./approve-request.js').ApproveRequest, row:DraftRow|Object,
 *   settings:import('./settings.js').Settings, executionId:string, check:ReturnType<typeof editCheck>}} input
 */
export function decideApproval({ request, row, settings, executionId, check }) {
  const gated = statusGate(request, row);
  if (gated) return gated;
  const id = request.job_id;
  if (request.action === 'discard') {
    const response = approveResponse({ ok: true, job_id: id, status: 'DISCARDED' });
    return { action: APPROVE_ACTIONS.DISCARD, params: JSON.stringify({ job_id: id }), response, fallback: approveError('NOT_A_DRAFT', id, '') };
  }
  if (!row.fresh) return respond(approveError('DRAFT_EXPIRED', id, row.status, {}, { hours: settings.draft_ttl_hours }));
  const { rendered, summary } = renderChecked(request, row, settings, check);
  if (request.action === 'check') return respond(approveResponse({ ...summary, ok: true, html: rendered.html }));
  if (!check.passed) return respond(approveError('EDIT_BLOCKED', id, row.status, summary));
  const email = { from: senderFor(settings), to: row.recipient, subject: rendered.subject, html: rendered.html, text: rendered.text };
  /** @type {import('./finalize.js').Delivery} */
  const deliver = { job_id: id, email, drill: row.drills?.email_down === true, record: {} };
  return {
    action: APPROVE_ACTIONS.SEND, params: JSON.stringify({ job_id: id, execution_id: executionId }), deliver,
    response: approveResponse({ ...summary, ok: true, status: 'PROCESSING' }), fallback: approveError('ALREADY_SENT', id, 'PROCESSING'),
  };
}
