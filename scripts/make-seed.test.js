import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authorRows, bookRows, bubbleDate, csvField, royaltyRows, toCsv } from './make-seed.mjs';

const dataset = JSON.parse(readFileSync(new URL('../data/bookleaf_sample_data.json', import.meta.url)));
const users = dataset.authors.map((a, i) => ({ email: a.email, id: `u${i}` }));
const authors = dataset.authors.map((a, i) => ({ code: a.author_id, id: `a${i}` }));
const books = dataset.authors.flatMap((a) => a.books).map((b, i) => ({ code: b.book_id, id: `b${i}` }));

describe('seed CSVs', () => {
  it('quotes fields with commas and quotes', () => {
    expect(csvField('Amazon India, Flipkart')).toBe('"Amazon India, Flipkart"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField(null)).toBe('');
  });

  it('writes dates as US dates at noon, and blanks for none', () => {
    expect(bubbleDate('2025-10-15')).toBe('10/15/2025 12:00 pm');
    expect(bubbleDate(null)).toBe('');
  });

  it('links authors to their user ids, all 10', () => {
    const rows = authorRows(dataset, users);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ code: 'AUTH001', user: 'u0' });
  });

  it('builds 18 books with owner and author, in-production books with blanks', () => {
    const rows = bookRows(dataset, users, authors);
    expect(rows).toHaveLength(18);
    const bk013 = rows.find((r) => r.code === 'BK013');
    expect(bk013).toMatchObject({ publication_date: '', print_partner: '', mrp: '', platforms: '' });
    expect(rows.find((r) => r.code === 'BK001').platforms).toBe('Amazon India, Flipkart, BookLeaf Store');
  });

  it('builds 18 royalty records whose paid + pending = earned', () => {
    const rows = royaltyRows(dataset, users, authors, books);
    expect(rows).toHaveLength(18);
    for (const r of rows) expect(r.paid + r.pending).toBe(r.earned);
  });

  it('fails loudly when a previous stage is missing', () => {
    expect(() => bookRows(dataset, users, [])).toThrow(/run the previous stage/);
  });

  it('produces a header row and one line per record', () => {
    const csv = toCsv(authorRows(dataset, users));
    expect(csv.split('\n')[0]).toBe('code,name,email,phone,city,joined_date,user');
    expect(csv.trim().split('\n')).toHaveLength(11);
  });
});
