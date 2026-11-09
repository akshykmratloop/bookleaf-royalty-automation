/** @typedef {import('./types.js').AuthorBundle} AuthorBundle */

const PRODUCTION_PREFIX = /^in production/i;

/** @param {Object} b sample-data book @returns {import('./types.js').Book} */
function bookFromSample(b) {
  const label = String(b.status ?? '');
  return {
    code: b.book_id,
    title: b.title,
    isbn: b.isbn ?? '',
    genre: b.genre ?? '',
    status: PRODUCTION_PREFIX.test(label) ? 'IN_PRODUCTION' : 'PUBLISHED',
    statusLabel: label,
    publicationDate: b.publication_date ?? null,
    mrp: b.mrp ?? 0,
    royaltyPerCopy: b.author_royalty_per_copy ?? 0,
    copiesSold: b.total_copies_sold ?? 0,
    earned: b.total_royalty_earned ?? 0,
    paid: b.royalty_paid ?? 0,
    pending: b.royalty_pending ?? 0,
    lastPayoutDate: b.last_royalty_payout_date ?? null,
    printPartner: b.print_partner ?? null,
    platforms: [...(b.available_on ?? [])],
  };
}

/**
 * Converts one sample-data author into the canonical AuthorBundle (amounts in whole rupees).
 * @param {Object} a sample-data author object
 * @returns {AuthorBundle}
 */
export function bundleFromSample(a) {
  return {
    author: {
      id: a.author_id,
      code: a.author_id,
      name: a.name,
      firstName: String(a.name).trim().split(/\s+/)[0],
      email: a.email,
      city: a.city,
    },
    books: (a.books ?? []).map(bookFromSample),
  };
}
