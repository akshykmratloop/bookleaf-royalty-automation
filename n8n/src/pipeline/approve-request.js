import { isObject, makeCtx, oneOf, str } from '../validate-fields.js';
import { failure } from './errors.js';
import { UUID } from './ids.js';

/**
 * POST /webhook/royalty-summary/approve: request validation and the uniform answer.
 * Every business outcome is HTTP 200 with the same fields (Bubble's API Connector maps one typed
 * 200 body far more reliably than error bodies); 400/403 are only for a bad body or a bad key.
 */
export const APPROVE_ACTIONS = Object.freeze(['check', 'send', 'discard']);
export const SUBJECT_MAX = 200;
export const BODY_MAX = 8000;

export const APPROVE_ERRORS = Object.freeze({
  NOT_FOUND: 'No job has this id.',
  NOT_A_DRAFT: 'This job is not a draft waiting for approval.',
  DRAFT_EXPIRED: 'This draft is more than 24 hours old. Create a new draft.',
  EDIT_BLOCKED: 'The edited email has problems the fact check will not let through, so it was not sent.',
  ALREADY_SENT: 'This draft has already been sent (or is being sent).',
});

/**
 * @typedef {Object} ApproveRequest
 * @property {string} job_id @property {'check'|'send'|'discard'} action
 * @property {string} subject '' for discard @property {string} body '' for discard
 */

const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

function readSubject(ctx, v) {
  if (typeof v === 'string' && /[\r\n]/.test(v.trim())) return ctx.fail('subject', 'PATTERN', 'must be a single line');
  return str(ctx, 'subject', v, 1, SUBJECT_MAX);
}

function readBody(ctx, v) {
  if (typeof v !== 'string') return ctx.fail('body', 'TYPE', 'must be a string');
  const s = v.replace(/\r\n?/g, '\n').replace(CONTROL_EXCEPT_NEWLINE, '').normalize('NFC').trim();
  if (s.length < 1) return ctx.fail('body', 'TOO_SHORT', 'must be at least 1 character');
  if (s.length > BODY_MAX) return ctx.fail('body', 'TOO_LONG', `must be at most ${BODY_MAX} characters`);
  return s;
}

/**
 * @param {unknown} body webhook body
 * @returns {{ok:true, value:ApproveRequest}|import('./errors.js').Failure}
 */
export function validateApprove(body) {
  if (!isObject(body)) return failure('VALIDATION', 'The body must be a JSON object.', [{ path: '', code: 'TYPE', message: 'body must be a JSON object' }]);
  const ctx = makeCtx();
  const id = str(ctx, 'job_id', body.job_id, 1, 64);
  if (id !== undefined && !UUID.test(id)) ctx.fail('job_id', 'PATTERN', 'must be a job id (UUID)');
  const action = oneOf(ctx, 'action', body.action, APPROVE_ACTIONS);
  const needsText = action === 'check' || action === 'send';
  const subject = needsText ? readSubject(ctx, body.subject) : '';
  const text = needsText ? readBody(ctx, body.body) : '';
  if (ctx.errors.length) return failure('VALIDATION', `${ctx.errors.length} field(s) need attention.`, ctx.errors);
  return { ok: true, value: { job_id: id.toLowerCase(), action, subject, body: text } };
}

/**
 * @param {Partial<{ok:boolean, job_id:string, status:string, passed:boolean, issues:string, issue_count:number,
 *   html:string, words:number, figures_verified:number, error_code:string, error:string}>} fields
 * @returns {{ok:boolean, job_id:string, status:string, passed:boolean, issues:string, issue_count:number,
 *   html:string, words:number, figures_verified:number, error_code:string, error:string}}
 */
export function approveResponse(fields) {
  return {
    ok: false, job_id: '', status: '', passed: false, issues: '', issue_count: 0, html: '', words: 0,
    figures_verified: 0, error_code: '', error: '', ...fields,
  };
}

/** @param {keyof typeof APPROVE_ERRORS} code @param {string} jobId @param {string|null|undefined} status @param {Object} [extra] */
export const approveError = (code, jobId, status, extra = {}) =>
  approveResponse({ ...extra, ok: false, job_id: jobId, status: status ?? '', error_code: code, error: APPROVE_ERRORS[code] });
