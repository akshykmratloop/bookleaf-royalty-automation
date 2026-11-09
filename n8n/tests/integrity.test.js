import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bundleFromSample } from '../src/normalize.js';
import { checkIntegrity } from '../src/integrity.js';

const data = JSON.parse(readFileSync(new URL('../../data/bookleaf_sample_data.json', import.meta.url), 'utf8'));
const base = () => bundleFromSample(data.authors[0]);
const codes = (b, ref = '2025-12-31') => checkIntegrity(b, ref).map((i) => i.code);

describe('checkIntegrity', () => {
  it('passes the whole sample dataset', () => {
    for (const a of data.authors) expect(checkIntegrity(bundleFromSample(a), '2025-12-31'), a.author_id).toEqual([]);
  });
  it('flags earned mismatch', () => {
    const b = base(); b.books[0].earned += 1;
    expect(codes(b)).toContain('EARNED_MISMATCH');
  });
  it('flags paid + pending mismatch', () => {
    const b = base(); b.books[0].pending += 1;
    expect(codes(b)).toContain('SPLIT_MISMATCH');
  });
  it('flags in-production with figures or payout', () => {
    const b = bundleFromSample(data.authors[6]);
    const p = b.books.find((x) => x.status === 'IN_PRODUCTION');
    p.copiesSold = 3; p.lastPayoutDate = '2025-01-01';
    expect(codes(b)).toEqual(expect.arrayContaining(['PRODUCTION_HAS_FIGURES', 'PRODUCTION_HAS_PAYOUT']));
  });
  it('flags payout after reference date', () => {
    expect(codes(base(), '2025-10-01')).toContain('PAYOUT_IN_FUTURE');
  });
  it('flags duplicate book codes', () => {
    const b = base(); b.books[1].code = b.books[0].code;
    expect(codes(b)).toContain('DUPLICATE_BOOK_CODE');
  });
});
