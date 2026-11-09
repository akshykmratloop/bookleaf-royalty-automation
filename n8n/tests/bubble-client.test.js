import { describe, expect, it } from 'vitest';
import { authorQuery, booksQuery, royaltiesQuery, bundleFromBubble, callbackRequest, BUBBLE_TOKEN_PLACEHOLDER } from '../src/bubble-client.js';
import { validateBundle } from '../src/validate.js';

const BASE = 'https://x.bubbleapps.io/version-test';
const decode = (url) => JSON.parse(decodeURIComponent(new URL(url).searchParams.get('constraints')));

describe('queries', () => {
  it('builds the author lookup', () => {
    const r = authorQuery(BASE, 'abc123');
    expect(r.method).toBe('GET');
    expect(r.url.startsWith(`${BASE}/api/1.1/obj/author?constraints=`)).toBe(true);
    expect(decode(r.url)).toEqual([{ key: '_id', constraint_type: 'equals', value: 'abc123' }]);
    expect(r.headers.authorization).toBe(BUBBLE_TOKEN_PLACEHOLDER);
  });
  it('builds books and royalties queries by author', () => {
    for (const [fn, type] of [[booksQuery, 'book'], [royaltiesQuery, 'royaltyrecord']]) {
      const r = fn(`${BASE}/`, 'abc123');
      expect(r.url.startsWith(`${BASE}/api/1.1/obj/${type}?constraints=`)).toBe(true);
      expect(decode(r.url)).toEqual([{ key: 'author', constraint_type: 'equals', value: 'abc123' }]);
    }
  });
  it('url-encodes the constraint and supports a cursor', () => {
    const r = booksQuery(BASE, 'a"b&c', { cursor: 100 });
    expect(r.url).not.toContain('"');
    expect(decode(r.url)[0].value).toBe('a"b&c');
    expect(new URL(r.url).searchParams.get('cursor')).toBe('100');
  });
  it('rejects a bad appBase or empty id', () => {
    expect(() => authorQuery('javascript:alert(1)', 'a')).toThrow(/appBase/);
    expect(() => authorQuery(BASE, '')).toThrow(/authorId/);
  });
});

const wrap = (results) => ({ response: { results, remaining: 0, count: results.length } });
const author = { _id: '1700x1', code: 'AUTH001', name: 'Priya Sharma', email: 'priya.sharma@email.com', phone: '+91', city: 'Mumbai', joined_date: '2023-03-14T18:30:00.000Z' };
const book = (over = {}) => ({ _id: 'b1', code: 'BK001', title: 'Whispers of the Ganges', isbn: '978', genre: 'Fiction', status: 'Published & Live',
  publication_date: '2023-06-19T18:30:00.000Z', mrp: 399, royalty_per_copy: 35, print_partner: 'In-House', platforms: ['Amazon India'], author: '1700x1', ...over });
const roy = (over = {}) => ({ _id: 'r1', book: 'b1', author: '1700x1', copies_sold: 342, earned: 11970, paid: 8400, pending: 3570, last_payout_date: '2025-10-14T18:30:00.000Z', ...over });

describe('bundleFromBubble', () => {
  it('maps Bubble fields to an AuthorBundle that validates', () => {
    const r = bundleFromBubble({ author: wrap([author]), books: wrap([book()]), royalties: wrap([roy()]) });
    expect(r.ok).toBe(true);
    expect(r.value.author).toEqual({ id: '1700x1', code: 'AUTH001', name: 'Priya Sharma', firstName: 'Priya', email: 'priya.sharma@email.com', city: 'Mumbai' });
    expect(r.value.books[0]).toEqual({
      code: 'BK001', title: 'Whispers of the Ganges', isbn: '978', genre: 'Fiction', status: 'PUBLISHED', statusLabel: 'Published & Live',
      publicationDate: '2023-06-20', mrp: 399, royaltyPerCopy: 35, copiesSold: 342, earned: 11970, paid: 8400, pending: 3570,
      lastPayoutDate: '2025-10-15', printPartner: 'In-House', platforms: ['Amazon India'],
    });
    expect(validateBundle(r.value).ok).toBe(true);
  });
  it('accepts plain arrays/objects as well as Bubble envelopes', () => {
    expect(bundleFromBubble({ author, books: [book()], royalties: [roy()] }).ok).toBe(true);
  });
  it('handles in-production books with no royalty record and null fields', () => {
    const b = book({ _id: 'b2', code: 'BK013', status: 'In Production - Cover Design', publication_date: null, mrp: null, royalty_per_copy: null, print_partner: null, platforms: undefined });
    const r = bundleFromBubble({ author, books: [b], royalties: [] });
    expect(r.value.books[0]).toMatchObject({ status: 'IN_PRODUCTION', publicationDate: null, printPartner: null, platforms: [], earned: 0, mrp: 0, lastPayoutDate: null });
  });
  it('null last payout stays null; date-only strings pass through', () => {
    const r = bundleFromBubble({ author, books: [book({ publication_date: '2024-07-05' })], royalties: [roy({ last_payout_date: null })] });
    expect(r.value.books[0].lastPayoutDate).toBeNull();
    expect(r.value.books[0].publicationDate).toBe('2024-07-05');
  });
  it('sums several royalty records for the same book', () => {
    const r = bundleFromBubble({ author, books: [book()], royalties: [roy({ copies_sold: 100, earned: 3500, paid: 3500, pending: 0, last_payout_date: '2025-01-01' }),
      roy({ _id: 'r2', copies_sold: 242, earned: 8470, paid: 4900, pending: 3570 })] });
    expect(r.value.books[0]).toMatchObject({ copiesSold: 342, earned: 11970, paid: 8400, pending: 3570, lastPayoutDate: '2025-10-15' });
  });
  it('ignores royalty records of other books', () => {
    const r = bundleFromBubble({ author, books: [book()], royalties: [roy({ book: 'other' })] });
    expect(r.value.books[0].earned).toBe(0);
  });
  it('returns a typed error when the author is missing', () => {
    const r = bundleFromBubble({ author: wrap([]), books: [], royalties: [] });
    expect(r).toMatchObject({ ok: false });
    expect(r.errors[0].code).toBe('AUTHOR_NOT_FOUND');
  });
  it('honours a different timezone offset', () => {
    const r = bundleFromBubble({ author, books: [book()], royalties: [], timeZoneOffsetMinutes: 0 });
    expect(r.value.books[0].publicationDate).toBe('2023-06-19');
  });
});

describe('callbackRequest', () => {
  const done = { log_id: 'L1', job_id: 'J1', status: 'SENT', subject: 'S', html: '<p>x</p>', figures_verified: 7, model: 'claude-sonnet-5-5', cost_usd: 0.0123, completed_at: '2026-11-10T10:00:00.000Z' };
  it('builds the Bubble workflow POST', () => {
    const r = callbackRequest(BASE, done);
    expect(r.method).toBe('POST');
    expect(r.url).toBe(`${BASE}/api/1.1/wf/notification_result`);
    expect(r.headers.authorization).toBe(BUBBLE_TOKEN_PLACEHOLDER);
    expect(r.body).toEqual(done);
  });
  it('omits undefined fields, carries errors, defaults completed_at', () => {
    const r = callbackRequest(BASE, { log_id: 'L', job_id: 'J', status: 'FAILED', error: 'Checker blocked' });
    expect(r.body).toMatchObject({ log_id: 'L', job_id: 'J', status: 'FAILED', error: 'Checker blocked' });
    expect(r.body).not.toHaveProperty('html');
    expect(new Date(r.body.completed_at).toString()).not.toBe('Invalid Date');
  });
  it('rejects an invalid status', () => {
    expect(() => callbackRequest(BASE, { ...done, status: 'DONE' })).toThrow(/status/);
  });
});
