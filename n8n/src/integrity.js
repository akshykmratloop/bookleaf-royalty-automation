import { parseIso } from './dates.js';

/** @typedef {{code:string, bookCode:string|null, message:string}} IntegrityIssue */

/** @param {import('./types.js').Book} b @returns {IntegrityIssue[]} */
function bookIssues(b, referenceDate) {
  const out = [];
  const add = (code, message) => out.push({ code, bookCode: b.code, message });
  if (b.status === 'IN_PRODUCTION') {
    if ([b.copiesSold, b.earned, b.paid, b.pending].some((n) => n !== 0))
      add('PRODUCTION_HAS_FIGURES', 'In-production book must have zero figures');
    if (b.lastPayoutDate !== null) add('PRODUCTION_HAS_PAYOUT', 'In-production book has a payout date');
    return out;
  }
  if (b.earned !== b.copiesSold * b.royaltyPerCopy)
    add('EARNED_MISMATCH', 'earned must equal copies sold x royalty per copy');
  if (b.paid + b.pending !== b.earned) add('SPLIT_MISMATCH', 'paid + pending must equal earned');
  if (b.lastPayoutDate !== null && parseIso(b.lastPayoutDate) > parseIso(referenceDate))
    add('PAYOUT_IN_FUTURE', 'last payout date is after the reference date');
  return out;
}

/**
 * @param {import('./types.js').AuthorBundle} bundle
 * @param {string} referenceDate YYYY-MM-DD
 * @returns {IntegrityIssue[]}
 */
export function checkIntegrity(bundle, referenceDate) {
  const seen = new Set();
  const issues = [];
  for (const b of bundle.books) {
    if (seen.has(b.code))
      issues.push({ code: 'DUPLICATE_BOOK_CODE', bookCode: b.code, message: 'duplicate book code' });
    seen.add(b.code);
    issues.push(...bookIssues(b, referenceDate));
  }
  return issues;
}
