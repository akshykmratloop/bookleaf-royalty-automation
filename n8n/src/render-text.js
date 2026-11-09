import { formatDate } from './dates.js';
import { formatInr } from './money.js';

const lastPayout = (b) => (b.lastPayoutDate ? formatDate(b.lastPayoutDate) : 'no payout yet');

/** @param {import('./facts-types.js').BookFacts} b @returns {string} */
const bookLine = (b) =>
  `- ${b.title}: ${b.copiesSold} copies | earned ${formatInr(b.earned)} | paid ${formatInr(b.paid)} | ` +
  `pending ${formatInr(b.pending)} | last payout ${lastPayout(b)} | ${b.badgeLabel}`;

/** @param {import('./facts-types.js').AuthorFacts} facts @returns {string} plain-text figures block */
export function figuresText(facts) {
  const rows = facts.books.filter((b) => b.badge !== 'NONE');
  const t = facts.totals;
  const lines = rows.map(bookLine);
  if (rows.length > 0)
    lines.push(`Total: earned ${formatInr(t.earned)} | paid ${formatInr(t.paid)} | pending ${formatInr(t.pending)}`);
  lines.push(`Next payout cycle closes by ${formatDate(facts.nextPayoutDate)}`);
  if (facts.inProduction.length > 0) {
    lines.push('', 'Books in production:', ...facts.inProduction.map((b) => `- ${b.title} - ${b.statusLabel}`));
  }
  return lines.join('\n');
}
