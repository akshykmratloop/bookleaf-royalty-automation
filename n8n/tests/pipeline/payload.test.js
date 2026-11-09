import { describe, expect, it } from 'vitest';
import { bundleFromPayload, validatedBundleFromPayload } from '../../src/payload.js';
import { bundleFromSample } from '../../src/normalize.js';
import { payloadFor, sampleAuthor } from './fixtures.js';

describe('bundleFromPayload', () => {
  it('maps the pull-mode payload to the same bundle as the sample data (except the Bubble id)', () => {
    for (const code of ['AUTH001', 'AUTH007', 'AUTH009']) {
      const fromPayload = bundleFromPayload(payloadFor(code));
      const fromSample = bundleFromSample(sampleAuthor(code));
      expect(fromPayload.books).toEqual(fromSample.books);
      expect({ ...fromPayload.author, id: 'x' }).toEqual({ ...fromSample.author, id: 'x' });
      expect(fromPayload.author.id).toBe(`bubble_${code.toLowerCase()}`);
    }
  });
  it('accepts Bubble quirks: quoted numbers, ISO instants, comma lists, empty texts', () => {
    const p = payloadFor('AUTH001');
    p.books[0] = { ...p.books[0], earned: '11970', last_payout_date: '2025-10-14T18:30:00.000Z', platforms: 'Amazon India, Flipkart', print_partner: '' };
    const b = bundleFromPayload(p).books[0];
    expect(b.earned).toBe(11970);
    expect(b.lastPayoutDate).toBe('2025-10-15');
    expect(b.platforms).toEqual(['Amazon India', 'Flipkart']);
    expect(b.printPartner).toBeNull();
  });
  it('treats "In Production - X" as in production and keeps the label', () => {
    const b = bundleFromPayload(payloadFor('AUTH009')).books.find((x) => x.code === 'BK015');
    expect(b).toMatchObject({ status: 'IN_PRODUCTION', statusLabel: 'In Production - Typesetting', publicationDate: null });
  });
});

describe('validatedBundleFromPayload', () => {
  it('accepts every sample author', () => {
    for (const code of ['AUTH001', 'AUTH002', 'AUTH008', 'AUTH009', 'AUTH010']) expect(validatedBundleFromPayload(payloadFor(code)).ok).toBe(true);
  });
  it('reports errors with payload field names', () => {
    const p = payloadFor('AUTH001');
    p.books[0] = { ...p.books[0], copies_sold: 1.5, last_payout_date: '2025-02-30', status: '' };
    p.author = { ...p.author, email: 'nope' };
    const r = validatedBundleFromPayload(p);
    expect(r.ok).toBe(false);
    const paths = r.errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['books[0].copies_sold', 'books[0].last_payout_date', 'books[0].status', 'author.email']));
  });
  it('rejects decimal rupees and negative amounts', () => {
    const p = payloadFor('AUTH001');
    p.books[0] = { ...p.books[0], paid: -1, pending: '12.5' };
    const r = validatedBundleFromPayload(p);
    expect(r.errors.map((e) => e.path)).toEqual(['books[0].paid', 'books[0].pending']);
  });
});
