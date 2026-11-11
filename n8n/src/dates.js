import { PAYOUT_WINDOW_DAYS } from './kb.js';

/** Payout calendar (UTC): royalties are paid within PAYOUT_WINDOW_DAYS (kb.js) of quarter end. */
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** @param {Date} date @returns {Date} last day of the calendar quarter containing date */
export function quarterEnd(date) {
  const lastMonth = Math.floor(date.getUTCMonth() / 3) * 3 + 2;
  return new Date(Date.UTC(date.getUTCFullYear(), lastMonth + 1, 0));
}

/** @param {Date} date @returns {Date} quarter end + PAYOUT_WINDOW_DAYS */
export function payoutDeadlineFor(date) {
  return addDays(quarterEnd(date), PAYOUT_WINDOW_DAYS);
}

/**
 * @param {string} setting the reference_date_default setting: YYYY-MM-DD or "today"
 * @param {number} nowMs @returns {string} YYYY-MM-DD; "today" is the date in India
 */
export function resolveReferenceDate(setting, nowMs) {
  return setting === 'today' ? toIsoDate(new Date(nowMs + IST_OFFSET_MINUTES * 60_000)) : setting;
}

/** @param {Date} date @param {number} days @returns {Date} */
export function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

/** @param {Date} d @returns {string} YYYY-MM-DD (UTC) */
export const toIsoDate = (d) => d.toISOString().slice(0, 10);

/** @param {Date} from @param {Date} to @returns {number} whole days */
export function daysBetween(from, to) {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/** @param {string} iso YYYY-MM-DD @returns {Date} UTC midnight */
export const parseIso = (iso) => new Date(`${iso}T00:00:00Z`);

/** @param {string} iso YYYY-MM-DD @returns {string} e.g. "14 Feb 2026" */
export function formatDate(iso) {
  const d = parseIso(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** @param {unknown} s @returns {boolean} true for a real calendar date YYYY-MM-DD */
export function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseIso(s);
  return !Number.isNaN(d.getTime()) && toIsoDate(d) === s;
}

/** Asia/Kolkata, the business time zone. */
export const IST_OFFSET_MINUTES = 330;

/**
 * Calendar date of a Bubble value: YYYY-MM-DD stays as is; an ISO instant (Bubble stores UTC) is
 * read in the business time zone; empty becomes null. Anything else is returned unchanged so that
 * validation can reject it.
 * @param {unknown} v @param {number} [offsetMinutes] @returns {string|null|unknown}
 */
export function calendarDate(v, offsetMinutes = IST_OFFSET_MINUTES) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? v : toIsoDate(new Date(t.getTime() + offsetMinutes * 60_000));
}
