import { date, email, isObject, makeCtx, oneOf, str } from '../validate-fields.js';
import { validatedBundleFromPayload } from '../payload.js';
import { readStyle } from './style.js';

const ID = /^[A-Za-z0-9_-]+$/;
/**
 * Failure drills a request may force (with the allow_drills setting). primary_down fails only the
 * primary AI provider (Anthropic), so the OpenAI fallback writes the email; crash makes Build Context
 * throw, so the error workflow fails the job.
 */
export const DRILLS = Object.freeze(['ai_down', 'email_down', 'data_down', 'primary_down', 'crash']);
export const MAX_ATTEMPT = 20;

/**
 * @typedef {Object} EnqueueRequest
 * @property {string} author_id @property {string|null} log_id @property {string|null} batch_id
 * @property {string} requested_by @property {'single'|'bulk'} mode @property {string|null} reference_date
 * @property {string|null} demo_inbox @property {number} attempt
 * @property {{ai_down:boolean, email_down:boolean, data_down:boolean, primary_down:boolean, crash:boolean}} drills
 * @property {'send'|'draft'} delivery @property {'warm'|'formal'|'concise'} tone
 * @property {'short'|'standard'|'detailed'} length @property {string} note @property {string} sign_off
 * @property {import('../types.js').AuthorBundle} bundle the author and books sent with the request
 */

const optional = (v) => v === undefined || v === null || v === '';

function readDrills(ctx, v) {
  const off = Object.fromEntries(DRILLS.map((k) => [k, false]));
  if (optional(v)) return off;
  if (!isObject(v)) return ctx.fail('drills', 'TYPE', 'must be an object');
  const unknown = Object.keys(v).filter((k) => !DRILLS.includes(k));
  if (unknown.length) ctx.fail('drills', 'UNKNOWN', `unknown drill(s): ${unknown.join(', ')}`);
  for (const k of DRILLS) {
    if (!optional(v[k]) && typeof v[k] !== 'boolean') ctx.fail(`drills.${k}`, 'TYPE', 'must be true or false');
  }
  return Object.fromEntries(DRILLS.map((k) => [k, v[k] === true]));
}

function readAttempt(ctx, v) {
  if (optional(v)) return 1;
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(n) || n < 1 || n > MAX_ATTEMPT) return ctx.fail('attempt', 'RANGE', `must be a whole number from 1 to ${MAX_ATTEMPT}`);
  return n;
}

function readHeader(ctx, body) {
  return {
    author_id: str(ctx, 'author_id', body.author_id, 1, 64, ID),
    log_id: optional(body.log_id) ? null : str(ctx, 'log_id', body.log_id, 1, 64),
    batch_id: optional(body.batch_id) ? null : str(ctx, 'batch_id', body.batch_id, 1, 64),
    requested_by: str(ctx, 'requested_by', body.requested_by, 1, 254),
    mode: oneOf(ctx, 'mode', body.mode, ['single', 'bulk']),
    reference_date: optional(body.reference_date) ? null : date(ctx, 'reference_date', body.reference_date, false),
    demo_inbox: optional(body.demo_inbox) ? null : email(ctx, 'demo_inbox', body.demo_inbox),
    attempt: readAttempt(ctx, body.attempt),
    drills: readDrills(ctx, body.drills),
    ...readStyle(ctx, body),
  };
}

/** The author and books sent with the request. @returns {import('../types.js').AuthorBundle|undefined} undefined after an error */
function readBundle(ctx, body) {
  if (!isObject(body.author)) return ctx.fail('author', 'REQUIRED', 'is required: n8n reads the author data from the request');
  if (!Array.isArray(body.books)) return ctx.fail('books', 'REQUIRED', 'must be a list of books');
  const r = validatedBundleFromPayload(body);
  if (r.ok) return r.value;
  ctx.errors.push(...r.errors);
  return undefined;
}

/**
 * Validates the royalty-summary webhook body (contract: n8n/PAYLOAD.md), the author and books included.
 * @param {unknown} body
 * @returns {{ok:true, value:EnqueueRequest}|{ok:false, errors:import('../types.js').ValidationError[]}}
 */
export function validateRequest(body) {
  if (!isObject(body)) return { ok: false, errors: [{ path: '', code: 'TYPE', message: 'body must be a JSON object' }] };
  const ctx = makeCtx();
  const header = readHeader(ctx, body);
  const bundle = readBundle(ctx, body);
  if (ctx.errors.length) return { ok: false, errors: ctx.errors };
  return { ok: true, value: { ...header, bundle } };
}
