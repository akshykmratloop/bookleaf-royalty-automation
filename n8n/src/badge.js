import { daysBetween, parseIso } from './dates.js';
import { KB_TEXT, OVERDUE_AFTER_DAYS } from './kb.js';

export const BADGE_LABELS = Object.freeze({ GREEN: 'Fully paid', YELLOW: 'Pending', RED: 'Overdue', NONE: 'In production' });

/**
 * Brief rule: GREEN fully paid; RED pending with last payout (or, if never paid, publication)
 * more than OVERDUE_AFTER_DAYS (kb.js) before the reference date; otherwise YELLOW. In-production books get NONE.
 * @param {import('./types.js').Book} book @param {string} referenceDate
 * @returns {'GREEN'|'YELLOW'|'RED'|'NONE'}
 */
export function badgeFor(book, referenceDate) {
  if (book.status !== 'PUBLISHED') return 'NONE';
  if (book.pending === 0) return 'GREEN';
  const anchor = book.lastPayoutDate ?? book.publicationDate;
  if (anchor === null) return 'YELLOW';
  return daysBetween(parseIso(anchor), parseIso(referenceDate)) > OVERDUE_AFTER_DAYS ? 'RED' : 'YELLOW';
}

/** @param {'GREEN'|'YELLOW'|'RED'|'NONE'} badge @param {import('./types.js').Book} book @param {boolean} belowThreshold */
export function statusTextFor(badge, book, belowThreshold) {
  if (badge === 'NONE') return book.statusLabel;
  const base = {
    GREEN: 'Fully paid — nothing pending on this book',
    YELLOW: 'Pending amount is due in the next payout cycle',
    RED: book.lastPayoutDate === null
      ? `Overdue — no payout has been made yet and the book has been published for over ${KB_TEXT.overdueWindow}`
      : `Overdue — no payout for over ${KB_TEXT.overdueWindow}`,
  }[badge];
  const note = belowThreshold && book.pending > 0
    ? `. Below the ${KB_TEXT.threshold} payout minimum — rolls over to the next quarter` : '';
  return base + note;
}
