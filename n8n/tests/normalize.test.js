import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bundleFromSample } from '../src/normalize.js';

const data = JSON.parse(readFileSync(new URL('../../data/bookleaf_sample_data.json', import.meta.url), 'utf8'));
const byId = (id) => data.authors.find((a) => a.author_id === id);

describe('bundleFromSample', () => {
  it('maps author and published book', () => {
    const b = bundleFromSample(byId('AUTH001'));
    expect(b.author).toEqual({ id: 'AUTH001', code: 'AUTH001', name: 'Priya Sharma', firstName: 'Priya', email: 'priya.sharma@email.com', city: 'Mumbai' });
    expect(b.books).toHaveLength(2);
    expect(b.books[0]).toEqual({
      code: 'BK001', title: 'Whispers of the Ganges', isbn: '978-93-5XXXX-01-1', genre: 'Literary Fiction',
      status: 'PUBLISHED', statusLabel: 'Published & Live', publicationDate: '2023-06-20', mrp: 399,
      royaltyPerCopy: 35, copiesSold: 342, earned: 11970, paid: 8400, pending: 3570,
      lastPayoutDate: '2025-10-15', printPartner: 'In-House', platforms: ['Amazon India', 'Flipkart', 'BookLeaf Store'],
    });
  });
  it('maps in-production book with nulls', () => {
    const b = bundleFromSample(byId('AUTH007')).books.find((x) => x.code === 'BK013');
    expect(b.status).toBe('IN_PRODUCTION');
    expect(b.statusLabel).toBe('In Production - Cover Design');
    expect(b.publicationDate).toBeNull();
    expect(b.printPartner).toBeNull();
    expect(b.earned).toBe(0);
  });
  it('keeps null last payout', () => {
    expect(bundleFromSample(byId('AUTH003')).books[0].lastPayoutDate).toBeNull();
  });
});
