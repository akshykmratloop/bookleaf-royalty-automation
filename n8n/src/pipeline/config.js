import { isRealDate, toIsoDate, IST_OFFSET_MINUTES } from '../dates.js';
import { failure } from './errors.js';

const EMAIL = /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\.]+$/;
const DEFAULT_REFERENCE_DATE = '2025-12-31';
const DEFAULT_MAX_SENDS = 60;
const EFFORTS = ['low', 'medium', 'high'];

/**
 * @typedef {Object} Config
 * @property {number} maxSendsPerHour @property {string} referenceDateDefault YYYY-MM-DD or "today"
 * @property {boolean} allowDrills @property {string} defaultDemoInbox '' when unset
 * @property {string} emailFrom '' = the SMTP account address (filled in at deploy) @property {string} primaryModel
 * @property {string} fallbackModel @property {string} effort @property {{name:string, supportEmail:string}} brand
 */

const pick = (env, k) => (typeof env?.[k] === 'string' ? env[k].trim() : '');
const oneOfOr = (v, allowed, dflt) => (v === '' ? dflt : allowed.includes(v) ? v : null);

function parseMaxSends(v) {
  if (v === '') return DEFAULT_MAX_SENDS;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : null;
}

/** @param {Record<string,string|undefined>} env n8n $env @returns {{ok:true, config:Config}|import('./errors.js').Failure} */
export function readConfig(env) {
  const cfg = {
    maxSendsPerHour: parseMaxSends(pick(env, 'MAX_SENDS_PER_HOUR')),
    referenceDateDefault: pick(env, 'REFERENCE_DATE_DEFAULT') || DEFAULT_REFERENCE_DATE,
    allowDrills: pick(env, 'ALLOW_DRILLS') === 'true',
    defaultDemoInbox: pick(env, 'DEFAULT_DEMO_INBOX'),
    emailFrom: pick(env, 'EMAIL_FROM'),
    primaryModel: pick(env, 'AI_PRIMARY_MODEL') || 'claude-sonnet-5-5',
    fallbackModel: pick(env, 'AI_FALLBACK_MODEL') || 'gpt-4.1-mini',
    effort: oneOfOr(pick(env, 'AI_EFFORT'), EFFORTS, 'medium'),
    brand: { name: 'BookLeaf Publishing', supportEmail: pick(env, 'BRAND_SUPPORT_EMAIL') },
  };
  const bad = configProblems(cfg);
  return bad.length ? failure('INTERNAL', `Server settings are invalid: ${bad.join('; ')}.`) : { ok: true, config: cfg };
}

function configProblems(c) {
  const out = [];
  if (!c.maxSendsPerHour) out.push('MAX_SENDS_PER_HOUR must be a whole number from 1 to 10000');
  if (!c.effort) out.push(`AI_EFFORT must be one of ${EFFORTS.join(', ')}`);
  if (c.referenceDateDefault !== 'today' && !isRealDate(c.referenceDateDefault)) out.push('REFERENCE_DATE_DEFAULT must be YYYY-MM-DD or today');
  if (c.defaultDemoInbox && !EMAIL.test(c.defaultDemoInbox)) out.push('DEFAULT_DEMO_INBOX is not a valid email');
  if (c.emailFrom && !EMAIL.test(c.emailFrom)) out.push('EMAIL_FROM must be a valid email (or unset to use the SMTP account)');
  return out;
}

/** @param {string} setting YYYY-MM-DD or "today" @param {number} nowMs @returns {string} YYYY-MM-DD */
export function resolveReferenceDate(setting, nowMs) {
  return setting === 'today' ? toIsoDate(new Date(nowMs + IST_OFFSET_MINUTES * 60_000)) : setting;
}

export const isEmail = (s) => typeof s === 'string' && EMAIL.test(s);
