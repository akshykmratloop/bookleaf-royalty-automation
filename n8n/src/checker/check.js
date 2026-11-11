import { allowedValues } from './allowed.js';
import { contactIssues } from './contact.js';
import {
  findCopyCounts, findDates, findDurations, findMoney, findPercents, findPlaceholders, stripExclusions,
} from './extract.js';
import { findLoose } from './loose.js';
import { wordsToDigits } from './number-words.js';
import { PHRASE_RULES } from './phrases.js';

/**
 * @typedef {Object} CheckIssue
 * @property {string} code @property {'BLOCK'|'WARN'} severity @property {string} message
 * @property {string} [excerpt]
 *
 * @typedef {Object} CheckResult
 * @property {boolean} passed @property {CheckIssue[]} issues
 * @property {number} verifiedFigures figures found in the text that match a fact
 */

const MIN_LENGTH = 40;
const MAX_LENGTH = 4000;
const TEMPLATE_PLACEHOLDER = /\{\{[^}]*\}\}/g;

/** Splits found figures into unsupported issues and a count of verified ones. */
function judge(found, allowed, code, what, seen) {
  // NaN marks a malformed figure ("₹1,0000"): it never matches a fact.
  const isAllowed = (v) => !(typeof v === 'number' && Number.isNaN(v)) && allowed.has(v);
  const issues = [];
  let verified = 0;
  for (const f of found) {
    if (isAllowed(f.value)) verified += 1;
    else if (!seen.has(f.raw)) {
      seen.add(f.raw);
      issues.push({ code, severity: 'BLOCK', message: `${what} "${f.raw}" does not match any verified fact.`, excerpt: f.raw });
    }
  }
  return { issues, verified };
}

function figureResults(text, allowed) {
  const loose = findLoose(text);
  const seen = new Set();
  const rules = [
    [findMoney(text), allowed.money, 'UNSUPPORTED_AMOUNT', 'Amount'],
    [findDates(text), allowed.dates, 'UNSUPPORTED_DATE', 'Date'],
    [findDurations(text), allowed.durations, 'UNSUPPORTED_TIMELINE', 'Timeline'],
    [findPercents(text), allowed.percents, 'UNSUPPORTED_PERCENT', 'Percentage'],
    [findCopyCounts(text), allowed.counts, 'UNSUPPORTED_COUNT', 'Copy count'],
    [loose.foreign, allowed.foreign, 'UNSUPPORTED_AMOUNT', 'Amount'],
    [loose.shortDates, allowed.monthDays, 'UNSUPPORTED_DATE', 'Date'],
    [loose.longDurations, allowed.durations, 'UNSUPPORTED_TIMELINE', 'Timeline'],
    [loose.bare, allowed.figures, 'UNSUPPORTED_AMOUNT', 'Figure'],
  ];
  const results = rules.map(([found, set, code, what]) => judge(found, set, code, what, seen));
  return {
    issues: results.flatMap((r) => r.issues),
    verified: results.reduce((n, r) => n + r.verified, 0),
  };
}

function phraseIssues(text) {
  return PHRASE_RULES.flatMap((rule) => {
    const m = text.match(rule.pattern);
    return m ? [{ code: rule.code, severity: 'BLOCK', message: rule.message, excerpt: m[0] }] : [];
  });
}

function placeholderIssues(text) {
  const found = [...findPlaceholders(text), ...(text.match(TEMPLATE_PLACEHOLDER) ?? [])];
  return found.map((p) => ({ code: 'PLACEHOLDER', severity: 'BLOCK', message: 'Unfilled placeholder in text.', excerpt: p }));
}

function shapeIssues(text) {
  const len = text.trim().length;
  if (len < MIN_LENGTH) return [{ code: 'TOO_SHORT', severity: 'WARN', message: 'Email is very short.' }];
  if (len > MAX_LENGTH) return [{ code: 'TOO_LONG', severity: 'WARN', message: 'Email is very long.' }];
  return [];
}

/**
 * Independent of the model: scans the text itself, so a draft cannot pass by omitting claims.
 * Number words ("ten thousand rupees") are read as digits. Book titles are exempted from scanning.
 * Links, phone numbers and email addresses other than `allowedEmails` block (contact.js).
 * @param {{text: string, facts: readonly import('../facts-types.js').Fact[], titles?: readonly string[],
 *   allowedEmails?: readonly string[]}} input
 * @returns {CheckResult}
 */
export function checkEmail({ text, facts, titles = [], allowedEmails = [] }) {
  const withoutPlaceholders = text.replace(/\[CONFIRM:[^\]]*\]/gi, ' ').replace(TEMPLATE_PLACEHOLDER, ' ');
  const prose = stripExclusions(withoutPlaceholders, [...titles]);
  const figures = figureResults(wordsToDigits(prose), allowedValues(facts));
  const issues = [
    ...placeholderIssues(text), ...figures.issues, ...phraseIssues(withoutPlaceholders), ...contactIssues(prose, allowedEmails),
    ...shapeIssues(text),
  ];
  return { passed: !issues.some((i) => i.severity === 'BLOCK'), issues, verifiedFigures: figures.verified };
}
