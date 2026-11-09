import { calendarDate } from './dates.js';
import { validateBundle } from './validate.js';

/** @typedef {import('./types.js').AuthorBundle} AuthorBundle */

const PRODUCTION_PREFIX = /^in production/i;
const WHOLE_NUMBER_TEXT = /^\d+(\.0+)?$/;

/** Bundle field → payload field, so validation errors point at what Bubble actually sent. */
const BOOK_FIELD_NAMES = Object.freeze({
  statusLabel: 'status', status: 'status', publicationDate: 'publication_date', royaltyPerCopy: 'royalty_per_copy',
  copiesSold: 'copies_sold', lastPayoutDate: 'last_payout_date', printPartner: 'print_partner',
});
const AUTHOR_FIELD_NAMES = Object.freeze({ firstName: 'name', id: 'author_id' });

/** Bubble's API Connector sometimes quotes numbers ("3570"); whole-number text becomes a number. */
const num = (v) => (typeof v === 'string' && WHOLE_NUMBER_TEXT.test(v.trim()) ? Number(v.trim()) : v);
const textOrNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null);

/** @param {unknown} v list, comma-separated text, or empty @returns {unknown} */
function platformList(v) {
  if (v === undefined || v === null || v === '') return [];
  if (typeof v === 'string') return v.split(',').map((p) => p.trim()).filter(Boolean);
  return v;
}

/** @param {Object} b payload book @returns {Object} bundle book (not yet validated) */
function bookFromPayload(b) {
  if (typeof b !== 'object' || b === null) return b;
  const label = typeof b.status === 'string' ? b.status : '';
  return {
    code: b.code,
    title: b.title,
    isbn: b.isbn ?? '',
    genre: b.genre ?? '',
    status: PRODUCTION_PREFIX.test(label.trim()) ? 'IN_PRODUCTION' : 'PUBLISHED',
    statusLabel: b.status,
    publicationDate: calendarDate(b.publication_date),
    mrp: num(b.mrp ?? 0),
    royaltyPerCopy: num(b.royalty_per_copy ?? 0),
    copiesSold: num(b.copies_sold ?? 0),
    earned: num(b.earned ?? 0),
    paid: num(b.paid ?? 0),
    pending: num(b.pending ?? 0),
    lastPayoutDate: calendarDate(b.last_payout_date),
    printPartner: textOrNull(b.print_partner),
    platforms: platformList(b.platforms),
  };
}

/**
 * Converts the pull-mode webhook payload (see n8n/PAYLOAD.md) into an AuthorBundle.
 * Tolerant mapping only; call validateBundle on the result (or use validatedBundleFromPayload).
 * @param {{author_id:string, author:Object, books:Object[]}} payload @returns {AuthorBundle}
 */
export function bundleFromPayload(payload) {
  const a = payload.author ?? {};
  const name = a.name;
  return {
    author: {
      id: payload.author_id,
      code: a.code,
      name,
      firstName: typeof name === 'string' ? name.trim().split(/\s+/)[0] : name,
      email: a.email,
      city: a.city ?? '',
    },
    books: Array.isArray(payload.books) ? payload.books.map(bookFromPayload) : payload.books,
  };
}

/** Rewrites bundle error paths (books[0].copiesSold) to payload paths (books[0].copies_sold). */
function toPayloadPath(path) {
  return path
    .replace(/^books\[(\d+)\]\.(\w+)/, (_, i, f) => `books[${i}].${BOOK_FIELD_NAMES[f] ?? f}`)
    .replace(/^author\.(\w+)/, (_, f) => (f === 'id' ? 'author_id' : `author.${AUTHOR_FIELD_NAMES[f] ?? f}`));
}

/**
 * @param {{author_id:string, author:Object, books:Object[]}} payload
 * @returns {{ok:true, value:AuthorBundle}|{ok:false, errors:import('./types.js').ValidationError[]}}
 */
export function validatedBundleFromPayload(payload) {
  const r = validateBundle(bundleFromPayload(payload));
  if (r.ok) return r;
  const seen = new Set();
  const errors = r.errors
    .map((e) => ({ ...e, path: toPayloadPath(e.path) }))
    .filter((e) => !seen.has(`${e.path}|${e.code}`) && seen.add(`${e.path}|${e.code}`));
  return { ok: false, errors };
}
