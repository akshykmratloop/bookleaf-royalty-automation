import { calendarDate, IST_OFFSET_MINUTES } from './dates.js';

/** Replaced by the n8n credential; never a real token. */
export const BUBBLE_TOKEN_PLACEHOLDER = 'Bearer __BUBBLE_API_TOKEN__';
const DEFAULT_TZ_OFFSET_MINUTES = IST_OFFSET_MINUTES;
const PRODUCTION_PREFIX = /^in production/i;
const STATUSES = ['SENT', 'FAILED'];

/** @typedef {{method:'GET'|'POST', url:string, headers:Object, body?:Object}} RequestDescriptor */

function base(appBase) {
  if (typeof appBase !== 'string' || !/^https?:\/\/[^\s/]+(\/[^\s?#]*)?$/.test(appBase)) throw new TypeError('appBase must be an http(s) URL');
  return appBase.replace(/\/+$/, '');
}

function search(appBase, type, constraints, cursor) {
  const params = new URLSearchParams({ constraints: JSON.stringify(constraints) });
  if (cursor !== undefined) params.set('cursor', String(cursor));
  return {
    method: 'GET',
    url: `${base(appBase)}/api/1.1/obj/${type}?${params.toString()}`,
    headers: { authorization: BUBBLE_TOKEN_PLACEHOLDER },
  };
}

function need(id) {
  if (typeof id !== 'string' || id.trim() === '') throw new TypeError('authorId must be a non-empty string');
  return id;
}

/** @param {string} appBase e.g. https://x.bubbleapps.io/version-test @param {string} authorId Bubble unique id @returns {RequestDescriptor} */
export const authorQuery = (appBase, authorId) =>
  search(appBase, 'author', [{ key: '_id', constraint_type: 'equals', value: need(authorId) }]);

/** @param {{cursor?:number}} [opts] Bubble returns 100 results per page; pass `cursor` for the next page. @returns {RequestDescriptor} */
export const booksQuery = (appBase, authorId, opts = {}) =>
  search(appBase, 'book', [{ key: 'author', constraint_type: 'equals', value: need(authorId) }], opts.cursor);

/** @returns {RequestDescriptor} */
export const royaltiesQuery = (appBase, authorId, opts = {}) =>
  search(appBase, 'royaltyrecord', [{ key: 'author', constraint_type: 'equals', value: need(authorId) }], opts.cursor);

/** @param {unknown} x Bubble envelope, array or single object @returns {Object[]} */
function results(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') return Array.isArray(x.response?.results) ? x.response.results : [x];
  return [];
}

/** Bubble stores instants in UTC; the calendar date is taken in the business time zone. */
const toDate = (v, offsetMinutes) => (typeof v === 'string' ? calendarDate(v, offsetMinutes) : null);

const num = (v) => (typeof v === 'number' ? v : 0);

function foldRoyalties(records, offset) {
  const total = { copiesSold: 0, earned: 0, paid: 0, pending: 0, lastPayoutDate: null };
  for (const r of records) {
    total.copiesSold += num(r.copies_sold);
    total.earned += num(r.earned);
    total.paid += num(r.paid);
    total.pending += num(r.pending);
    const d = toDate(r.last_payout_date, offset);
    if (d && (total.lastPayoutDate === null || d > total.lastPayoutDate)) total.lastPayoutDate = d;
  }
  return total;
}

function mapBook(b, records, offset) {
  const label = String(b.status ?? '');
  return {
    code: b.code, title: b.title, isbn: b.isbn ?? '', genre: b.genre ?? '',
    status: PRODUCTION_PREFIX.test(label) ? 'IN_PRODUCTION' : 'PUBLISHED',
    statusLabel: label,
    publicationDate: toDate(b.publication_date, offset),
    mrp: num(b.mrp), royaltyPerCopy: num(b.royalty_per_copy),
    ...foldRoyalties(records.filter((r) => r.book === b._id), offset),
    printPartner: b.print_partner ?? null,
    platforms: Array.isArray(b.platforms) ? [...b.platforms] : [],
  };
}

/**
 * Maps Bubble Data API results to an AuthorBundle. Royalty records of the same book are summed.
 * @param {{author:unknown, books:unknown, royalties:unknown, timeZoneOffsetMinutes?:number}} input
 * @returns {import('./types.js').Result}
 */
export function bundleFromBubble({ author, books, royalties, timeZoneOffsetMinutes = DEFAULT_TZ_OFFSET_MINUTES }) {
  const a = results(author)[0];
  if (!a) return { ok: false, errors: [{ path: 'author', code: 'AUTHOR_NOT_FOUND', message: 'No author returned by Bubble' }] };
  const recs = results(royalties);
  return {
    ok: true,
    value: {
      author: {
        id: a._id, code: a.code ?? a._id, name: a.name, firstName: String(a.name ?? '').trim().split(/\s+/)[0],
        email: a.email, city: a.city ?? '',
      },
      books: results(books).map((b) => mapBook(b, recs, timeZoneOffsetMinutes)),
    },
  };
}

const CALLBACK_FIELDS = ['log_id', 'job_id', 'status', 'error', 'subject', 'html', 'figures_verified', 'model', 'cost_usd', 'completed_at'];

/**
 * @param {string} appBase
 * @param {{log_id:string, job_id:string, status:'SENT'|'FAILED', error?:string, subject?:string, html?:string, figures_verified?:number, model?:string, cost_usd?:number, completed_at?:string}} result
 * @returns {RequestDescriptor}
 */
export function callbackRequest(appBase, result) {
  if (!STATUSES.includes(result.status)) throw new TypeError(`status must be one of ${STATUSES.join(', ')}`);
  const full = { ...result, completed_at: result.completed_at ?? new Date().toISOString() };
  const body = Object.fromEntries(CALLBACK_FIELDS.filter((k) => full[k] !== undefined).map((k) => [k, full[k]]));
  return {
    method: 'POST',
    url: `${base(appBase)}/api/1.1/wf/notification_result`,
    headers: { 'content-type': 'application/json', authorization: BUBBLE_TOKEN_PLACEHOLDER },
    body,
  };
}
