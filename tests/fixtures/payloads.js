/**
 * Pull-mode webhook payloads built from data/bookleaf_sample_data.json, in the exact shape the Bubble
 * API Connector sends (n8n/PAYLOAD.md). Shared by the unit tests and the contract tests.
 */
import { readFileSync } from 'node:fs';

export const SAMPLE = JSON.parse(readFileSync(new URL('../../data/bookleaf_sample_data.json', import.meta.url), 'utf8'));

/** One author from each badge class (ids from the dataset). */
export const AUTHORS_BY_CLASS = Object.freeze({
  allPaid: 'AUTH008', // Farhan Sheikh: everything paid
  overdue: 'AUTH002', // Rohit Kapoor: one overdue book, one pending
  belowThreshold: 'AUTH009', // Kavita Deshmukh: ₹850 pending (BK016), one book in production
  inProduction: 'AUTH007', // Sneha Kulkarni: two pending books, one in Cover Design
});

const book = (b) => ({
  code: b.book_id, title: b.title, isbn: b.isbn, genre: b.genre, status: b.status,
  publication_date: b.publication_date ?? '', mrp: b.mrp ?? 0, royalty_per_copy: b.author_royalty_per_copy ?? 0,
  print_partner: b.print_partner ?? '', platforms: [...(b.available_on ?? [])],
  copies_sold: b.total_copies_sold ?? 0, earned: b.total_royalty_earned ?? 0, paid: b.royalty_paid ?? 0,
  pending: b.royalty_pending ?? 0, last_payout_date: b.last_royalty_payout_date ?? '',
});

/**
 * @param {string} authorCode e.g. "AUTH002"
 * @param {Object} [over] top-level overrides (log_id, drills, demo_inbox, attempt, ...)
 * @returns {Object} webhook body
 */
export function payloadFor(authorCode, over = {}) {
  const a = SAMPLE.authors.find((x) => x.author_id === authorCode);
  if (!a) throw new Error(`No sample author ${authorCode}`);
  return {
    author_id: `bubble_${authorCode.toLowerCase()}`,
    log_id: `log_${authorCode.toLowerCase()}`,
    requested_by: 'admin@bookleaf.test',
    mode: 'single',
    reference_date: '2025-12-31',
    demo_inbox: '',
    drills: { ai_down: false, email_down: false, data_down: false },
    author: { code: a.author_id, name: a.name, email: a.email, city: a.city },
    books: a.books.map(book),
    ...over,
  };
}
