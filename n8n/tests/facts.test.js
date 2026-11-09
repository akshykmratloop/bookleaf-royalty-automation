import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bundleFromSample } from '../src/normalize.js';
import { buildFacts } from '../src/facts.js';

const data = JSON.parse(readFileSync(new URL('../../data/bookleaf_sample_data.json', import.meta.url), 'utf8'));
const allBooks = data.authors.flatMap((a) => buildFacts(bundleFromSample(a), '2025-12-31').books);
const badge = (code) => allBooks.find((b) => b.code === code).badge;
const factsFor = (id, ref = '2025-12-31') => buildFacts(bundleFromSample(data.authors.find((a) => a.author_id === id)), ref);

describe('badges at 2025-12-31', () => {
  it.each([
    ['BK001', 'YELLOW'], ['BK002', 'GREEN'], ['BK003', 'RED'], ['BK004', 'YELLOW'], ['BK005', 'RED'],
    ['BK006', 'RED'], ['BK010', 'RED'], ['BK013', 'NONE'], ['BK016', 'RED'], ['BK018', 'RED'], ['BK017', 'YELLOW'],
    ['BK015', 'NONE'], ['BK007', 'GREEN'], ['BK014', 'GREEN'],
  ])('%s is %s', (code, expected) => expect(badge(code)).toBe(expected));

  it('90-day boundary: exactly 90 days is YELLOW, 91 is RED', () => {
    const b = bundleFromSample(data.authors[0]);
    b.books[0].lastPayoutDate = '2025-10-02'; // 90 days before 2025-12-31
    expect(buildFacts(b, '2025-12-31').books[0].badge).toBe('YELLOW');
    b.books[0].lastPayoutDate = '2025-10-01';
    expect(buildFacts(b, '2025-12-31').books[0].badge).toBe('RED');
  });
});

describe('totals and flags', () => {
  it('Kavita is below threshold with note', () => {
    const f = factsFor('AUTH009');
    expect(f.totals).toEqual({ earned: 850, paid: 0, pending: 850 });
    expect(f.eligibleForPayout).toBe(false);
    const bk = f.books.find((b) => b.code === 'BK016');
    expect(bk.badge).toBe('RED');
    expect(bk.statusText).toContain('Below the ₹1,000 payout minimum — rolls over to the next quarter');
    expect(f.inProduction).toEqual([{ code: 'BK015', title: 'Raising Roots', statusLabel: 'In Production - Typesetting' }]);
    expect(f.totalBooks).toBe(2);
    expect(f.publishedCount).toBe(1);
  });
  it('threshold applies to total pending, not per book', () => {
    const f = factsFor('AUTH010'); // 2540 + 1575
    expect(f.eligibleForPayout).toBe(true);
    expect(f.books.find((b) => b.code === 'BK018').statusText).not.toContain('Below');
  });
  it('allPaid only when pending 0 and something earned', () => {
    expect(factsFor('AUTH008').allPaid).toBe(true);
    expect(factsFor('AUTH001').allPaid).toBe(false);
    expect(factsFor('AUTH007').allPaid).toBe(false);
  });
  it('allPaid false for an author with no published earnings', () => {
    const b = bundleFromSample(data.authors[6]);
    b.books = b.books.filter((x) => x.status === 'IN_PRODUCTION');
    expect(buildFacts(b, '2025-12-31').allPaid).toBe(false);
  });
  it('next payout date', () => {
    expect(factsFor('AUTH001').nextPayoutDate).toBe('2026-02-14');
    expect(factsFor('AUTH001', '2026-11-10').nextPayoutDate).toBe('2027-02-14');
  });
});

describe('facts list', () => {
  const f = factsFor('AUTH001');
  const byId = (id) => f.facts.find((x) => x.id === id);
  it('has typed per-book facts in paise', () => {
    expect(byId('book.BK001.pending')).toMatchObject({ type: 'MONEY', value: 357000, display: '₹3,570' });
    expect(byId('book.BK001.copies')).toMatchObject({ type: 'COUNT', value: 342 });
    expect(byId('book.BK001.last_payout')).toMatchObject({ type: 'DATE', value: '2025-10-15', display: '15 Oct 2025' });
    expect(byId('book.BK001.royalty_per_copy')).toMatchObject({ type: 'MONEY', value: 3500 });
    expect(byId('book.BK001.mrp')).toMatchObject({ type: 'MONEY', value: 39900 });
    expect(byId('book.BK001.publication_date')).toMatchObject({ type: 'DATE', value: '2023-06-20' });
  });
  it('has totals, dates, count and KB facts', () => {
    expect(byId('totals.pending')).toMatchObject({ type: 'MONEY', value: 357000 });
    expect(byId('totals.earned').value).toBe(1_990_800);
    expect(byId('payout.next_date')).toMatchObject({ type: 'DATE', value: '2026-02-14', display: '14 Feb 2026' });
    expect(byId('reference.date').value).toBe('2025-12-31');
    expect(byId('author.book_count')).toMatchObject({ type: 'COUNT', value: 2 });
    expect(byId('kb.payout_threshold')).toMatchObject({ type: 'MONEY', value: 100000, display: '₹1,000' });
    expect(byId('kb.payout_window').display).toBe('45 days');
    expect(byId('kb.royalty_split_author')).toMatchObject({ type: 'PERCENT', value: 80 });
    expect(byId('kb.royalty_split_bookleaf').value).toBe(20);
    expect(byId('kb.escalation_window').display).toBe('48 hours');
  });
  it('never-paid book has a TEXT last-payout fact', () => {
    const k = factsFor('AUTH003');
    expect(k.facts.find((x) => x.id === 'book.BK005.last_payout')).toMatchObject({ type: 'TEXT', display: 'No payout yet' });
  });
  it('fact ids are unique', () => {
    const ids = allBooks.length && factsFor('AUTH007').facts.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
