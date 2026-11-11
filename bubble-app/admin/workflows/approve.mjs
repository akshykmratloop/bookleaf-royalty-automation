// The "Approve draft" API call (n8n POST /webhook/royalty-summary/approve) and its result helpers.
// n8n answers HTTP 200 for every business outcome with one shape:
//   { ok, job_id, status, passed, issues, issue_count, html, words, figures_verified, error_code, error }
import { chain, op, text, now, prevStep, optionValue, jsonSafe } from '../expr.mjs';
import { apiCall, change, API } from './actions.mjs';

/** JSON value for the body template: a quoted, escaped text, or null when there is none (discard). */
const jsonText = (expr) => (expr ? text(chain(expr, jsonSafe())) : text('null'));

/** `log(...ops)` reads the draft's log; subject/body are text-valued expressions, or null for discard. */
export const approveCall = (id, log, action, subject = null, body = null) =>
  apiCall(API.approve, {
    body_params_job_id: text(log(op('job_id_text'))),
    body_params_action: text(action),
    body_params_subject: jsonText(subject),
    body_params_body: jsonText(body),
  }, id);

export const out = (stepId, ...ops) => chain(prevStep(stepId), op('_api_c2_body'), ...ops);
const reached = (stepId) => chain(prevStep(stepId), op('_api_c2_returned_an_error'), op('is_false'));
/** The call went through and n8n said ok. */
export const okOf = (stepId) => chain(reached(stepId), op('and_', { args: out(stepId, op('_api_c2_ok'), op('is_true')) }));
export const notOkOf = (stepId) => chain(okOf(stepId), op('is_false'));

/** What to tell the admin when n8n refused: the checker's issues, or the error, or the HTTP failure. */
export const reasonOf = (stepId) => text(
  out(stepId, op('_api_c2_issues'), op('defaulting_to', { args: out(stepId, op('_api_c2_error')) }),
    op('defaulting_to', { args: chain(prevStep(stepId), op('_api_c2_error'), op('_api_c2_body')) })),
);

const status = (v) => optionValue('sendstatus', v);

/** Log changes once n8n accepted the send: Processing again, timed from now, stepper in send mode. */
export const markSending = (logExpr, id, extra = {}) =>
  change(logExpr, {
    status_option_sendstatus: status('Processing'), stage_text: text('sending'), delivery_text: text('send'),
    requested_at_date: now(), issues_text: text(''), ...extra,
  }, id);

export const markDiscarded = (logExpr, id) =>
  change(logExpr, { status_option_sendstatus: status('Discarded'), stage_text: text('discarded'), completed_at_date: now() }, id);
