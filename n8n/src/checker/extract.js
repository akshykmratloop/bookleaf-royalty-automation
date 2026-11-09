/**
 * Finds figures in free text and normalises them, so "Rs. 3570", "₹3,570.00" and
 * "3,570 rupees" all compare equal to 357000 paise.
 */
import { blankOut, BARE_MULT, MONTH, monthIndex, MULT, NUM, pad, toPaise } from './patterns.js';
import { stripTitle } from './titles.js';

const MONEY_PREFIX = new RegExp(
  `(?:₹|\\brs\\.?|\\binr)\\s*${NUM}(?:\\s*${MULT}\\b)?(?:\\s*(?:rupees|inr)\\b)?`,
  'gi',
);
const MONEY_SUFFIX = new RegExp(`\\b${NUM}\\s*(?:${MULT}\\s*)?(?:rupees|inr)\\b`, 'gi');
const MONEY_SCALED = new RegExp(`\\b${NUM}\\s*${BARE_MULT}\\b`, 'gi');
const DATE_DMY = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH},?\\s+(\\d{4})\\b`,
  'gi',
);
const DATE_MDY = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi');
const DATE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const DATE_SLASH = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
const DURATION =
  /\b(\d{1,3})(?:\s*(?:–|-|to)\s*(\d{1,3}))?\s*(business days|working days|days|hours|hrs|h)\b/gi;
const PERCENT = /\b(\d{1,3})\s*(?:%|percent\b)/gi;
const COPIES = /\b(\d{1,3}(?:,\d{3})+|\d+)\s+copies\b/gi;
export const PLACEHOLDER = /\[CONFIRM:[^\]]*\]/gi;

/** Text that looks numeric but is not a claim: ISBNs, ticket labels with any prefix (BL-1001, AC2-1001). */
const EXCLUSIONS = [/\b97[89][-\d\sX]{10,20}\b/gi, /\b[A-Z]{2,5}\d*-\d+\b/g];

export function stripExclusions(text, extra = []) {
  let out = text;
  for (const re of EXCLUSIONS) out = out.replace(re, ' ');
  for (const phrase of extra) out = stripTitle(out, phrase.trim());
  return out;
}

const toNumber = (s) => Number(s.replace(/,/g, ''));
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function findMoney(text) {
  const out = [];
  let rest = text;
  for (const re of [MONEY_PREFIX, MONEY_SUFFIX, MONEY_SCALED]) {
    for (const m of rest.matchAll(re)) out.push({ raw: m[0], value: toPaise(m[1], m[2]) });
    rest = blankOut(rest, re);
  }
  return out;
}

export function findDates(text) {
  const out = [];
  for (const m of text.matchAll(DATE_DMY))
    out.push({ raw: m[0], value: iso(+m[3], monthIndex(m[2]), +m[1]) });
  for (const m of text.matchAll(DATE_MDY))
    out.push({ raw: m[0], value: iso(+m[3], monthIndex(m[1]), +m[2]) });
  for (const m of text.matchAll(DATE_ISO)) out.push({ raw: m[0], value: iso(+m[1], +m[2], +m[3]) });
  for (const m of text.matchAll(DATE_SLASH)) out.push({ raw: m[0], value: slashDate(m) });
  return out;
}

/**
 * Slash dates are read day first. When the day and month could swap ("04/03/2026" is 4 March or
 * 3 April), the value matches no fact, so the reply asks for the date to be written out.
 */
function slashDate(m) {
  const [day, month, year] = [+m[1], +m[2], +m[3]];
  if (day <= 12 && month <= 12 && day !== month) return `ambiguous:${m[0]}`;
  return iso(year, month, day);
}

/** Normalised as "48 hours", "24-48 hours", "5-7 business days". */
export function findDurations(text) {
  return [...text.matchAll(DURATION)].map((m) => {
    const unit = (m[3] ?? '').toLowerCase();
    const normUnit = unit.startsWith('h')
      ? 'hours'
      : unit.includes('business') || unit.includes('working')
        ? 'business days'
        : 'days';
    const range = m[2] ? `${m[1]}-${m[2]}` : m[1];
    return { raw: m[0], value: `${range} ${normUnit}` };
  });
}

export function findPercents(text) {
  return [...text.matchAll(PERCENT)].map((m) => ({ raw: m[0], value: Number(m[1]) }));
}

export function findCopyCounts(text) {
  return [...text.matchAll(COPIES)].map((m) => ({ raw: m[0], value: toNumber(m[1]) }));
}

export function findPlaceholders(text) {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[0]);
}
