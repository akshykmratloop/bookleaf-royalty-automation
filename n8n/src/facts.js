import { badgeFor, BADGE_LABELS, statusTextFor } from './badge.js';
import { formatDate, payoutDeadlineFor, parseIso, toIsoDate } from './dates.js';
import { PAYOUT_THRESHOLD_RUPEES, KB_FACTS } from './kb.js';
import { formatInr, toPaise } from './money.js';

const rec = (book, field) => ({ kind: 'RECORD', book, field });
const money = (id, label, rupees, source) => ({ id, label, type: 'MONEY', value: toPaise(rupees), display: formatInr(rupees), source });
const dateFact = (id, label, iso, source) => ({ id, label, type: 'DATE', value: iso, display: formatDate(iso), source });
const count = (id, label, n, source) => ({ id, label, type: 'COUNT', value: n, display: String(n), source });
const text = (id, label, s, source) => ({ id, label, type: 'TEXT', value: s, display: s, source });

/** @param {import('./types.js').Book} b @returns {import('./facts-types.js').Fact[]} */
function bookFactList(b) {
  const id = (k) => `book.${b.code}.${k}`;
  const lbl = (w) => `${b.title}: ${w}`;
  const out = [
    money(id('earned'), lbl('royalty earned'), b.earned, rec(b.code, 'earned')),
    money(id('paid'), lbl('royalty paid'), b.paid, rec(b.code, 'paid')),
    money(id('pending'), lbl('royalty pending'), b.pending, rec(b.code, 'pending')),
    count(id('copies'), lbl('copies sold'), b.copiesSold, rec(b.code, 'copies_sold')),
    money(id('royalty_per_copy'), lbl('royalty per copy'), b.royaltyPerCopy, rec(b.code, 'royalty_per_copy')),
    money(id('mrp'), lbl('MRP'), b.mrp, rec(b.code, 'mrp')),
    b.lastPayoutDate === null
      ? text(id('last_payout'), lbl('last payout'), 'No payout yet', rec(b.code, 'last_payout_date'))
      : dateFact(id('last_payout'), lbl('last payout'), b.lastPayoutDate, rec(b.code, 'last_payout_date')),
  ];
  if (b.publicationDate) out.push(dateFact(id('publication_date'), lbl('publication date'), b.publicationDate, rec(b.code, 'publication_date')));
  return out;
}

const sum = (books, key) => books.reduce((t, b) => t + b[key], 0);
const derived = (rule) => ({ kind: 'DERIVED', rule });

/**
 * Deterministic facts for one author: every figure that may appear in an email.
 * @param {import('./types.js').AuthorBundle} bundle @param {string} referenceDate YYYY-MM-DD
 * @returns {import('./facts-types.js').AuthorFacts}
 */
export function buildFacts(bundle, referenceDate) {
  const published = bundle.books.filter((b) => b.status === 'PUBLISHED');
  const totals = { earned: sum(published, 'earned'), paid: sum(published, 'paid'), pending: sum(published, 'pending') };
  const belowThreshold = totals.pending < PAYOUT_THRESHOLD_RUPEES;
  const books = bundle.books.map((b) => {
    const badge = badgeFor(b, referenceDate);
    return {
      code: b.code, title: b.title, badge, badgeLabel: BADGE_LABELS[badge], statusText: statusTextFor(badge, b, belowThreshold),
      copiesSold: b.copiesSold, earned: b.earned, paid: b.paid, pending: b.pending, mrp: b.mrp,
      royaltyPerCopy: b.royaltyPerCopy, lastPayoutDate: b.lastPayoutDate, publicationDate: b.publicationDate,
    };
  });
  const nextPayoutDate = toIsoDate(payoutDeadlineFor(parseIso(referenceDate)));
  const inProduction = bundle.books.filter((b) => b.status === 'IN_PRODUCTION')
    .map((b) => ({ code: b.code, title: b.title, statusLabel: b.statusLabel }));
  const facts = [
    ...published.flatMap(bookFactList),
    money('totals.earned', 'Total royalty earned', totals.earned, derived('sum of earned over published books')),
    money('totals.paid', 'Total royalty paid', totals.paid, derived('sum of paid over published books')),
    money('totals.pending', 'Total royalty pending', totals.pending, derived('sum of pending over published books')),
    dateFact('payout.next_date', 'Next payout cycle closes by', nextPayoutDate, derived('end of current quarter + 45 days')),
    dateFact('reference.date', 'Figures as of', referenceDate, derived('reference date')),
    count('author.book_count', 'Number of books', bundle.books.length, derived('count of books')),
    ...KB_FACTS,
  ];
  return {
    referenceDate, books, totals, totalBooks: bundle.books.length, publishedCount: published.length, inProduction,
    allPaid: totals.pending === 0 && published.some((b) => b.earned > 0),
    eligibleForPayout: !belowThreshold, nextPayoutDate, facts,
  };
}
