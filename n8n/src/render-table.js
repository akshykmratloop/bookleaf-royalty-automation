import { escapeHtml } from './html-escape.js';
import { formatDate } from './dates.js';
import { formatInr } from './money.js';

const PILL = Object.freeze({
  GREEN: { fg: '#1e6b3c', bg: '#e1f1e7' },
  YELLOW: { fg: '#8a5a00', bg: '#fff1cc' },
  RED: { fg: '#b3261e', bg: '#fde7e5' },
});
const TD = 'padding:8px 6px;border-bottom:1px solid #e6e0d6;font-size:13px;color:#2b2b2b;';
const TH = 'padding:8px 6px;border-bottom:2px solid #1f4d3a;font-size:12px;color:#5a5a5a;text-align:left;font-weight:bold;';

const lastPayout = (b) => (b.lastPayoutDate ? formatDate(b.lastPayoutDate) : 'No payout yet');

function pill(book) {
  const c = PILL[book.badge];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:bold;color:${c.fg};background:${c.bg};">${escapeHtml(book.badgeLabel)}</span>`;
}

function row(b) {
  const cells = [escapeHtml(b.title), b.copiesSold, formatInr(b.earned), formatInr(b.paid), formatInr(b.pending), lastPayout(b)];
  return `<tr>${cells.map((c) => `<td style="${TD}">${typeof c === 'number' ? c : escapeHtml(c)}</td>`).join('')}<td style="${TD}">${pill(b)}</td></tr>`;
}

/**
 * The royalty figures table, rendered only from deterministic facts (never AI text).
 * @param {import('./facts-types.js').AuthorFacts} facts @returns {string} HTML
 */
export function figuresTable(facts) {
  const rows = facts.books.filter((b) => b.badge !== 'NONE');
  if (rows.length === 0) return '';
  const head = ['Book', 'Copies', 'Earned', 'Paid', 'Pending', 'Last payout', 'Status'];
  const t = facts.totals;
  const bold = `${TD}font-weight:bold;`;
  const total = `<tr><td style="${bold}">Total</td><td style="${bold}"></td><td style="${bold}">${formatInr(t.earned)}</td><td style="${bold}">${formatInr(t.paid)}</td><td style="${bold}">${formatInr(t.pending)}</td><td style="${bold}"></td><td style="${bold}"></td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;"><tr>${head
    .map((h) => `<th style="${TH}">${h}</th>`)
    .join('')}</tr>${rows.map(row).join('')}${total}</table>`;
}

/** @param {import('./facts-types.js').AuthorFacts} facts @returns {string} HTML list of books still in production */
export function productionList(facts) {
  if (facts.inProduction.length === 0) return '';
  const items = facts.inProduction
    .map((b) => `<li style="margin:4px 0;">${escapeHtml(b.title)} &mdash; ${escapeHtml(b.statusLabel)}</li>`)
    .join('');
  return `<p style="margin:16px 0 4px;font-weight:bold;">Books in production</p><ul style="margin:0 0 12px 18px;padding:0;font-size:14px;">${items}</ul>`;
}
