// Turns the sample dataset into Bubble App-data upload CSVs, one stage at a time, because each
// stage links to the Bubble unique ids created by the stage before it.
//   node scripts/make-seed.mjs authors     needs data/bubble-ids/users.json
//   node scripts/make-seed.mjs books       needs + authors.json
//   node scripts/make-seed.mjs royalties   needs + books.json
// Output: data/seed/<stage>.csv
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

/** RFC 4180 field: quote when needed, double inner quotes. */
export function csvField(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(','), ...rows.map((r) => headers.map((h) => csvField(r[h])).join(','))];
  return `${lines.join('\n')}\n`;
}

/** Bubble's uploader reads unambiguous US dates; noon UTC avoids a day shift in IST. */
export const bubbleDate = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)} 12:00 pm` : '');

const idBy = (list, key) => Object.fromEntries(list.map((x) => [x[key], x.id]));

function must(map, key, what) {
  if (!map[key]) throw new Error(`No Bubble id for ${what} "${key}" — run the previous stage first`);
  return map[key];
}

export function authorRows(dataset, users) {
  const userId = idBy(users, 'email');
  return dataset.authors.map((a) => ({
    code: a.author_id, name: a.name, email: a.email, phone: a.phone, city: a.city,
    joined_date: bubbleDate(a.joined_date), user: must(userId, a.email, 'user'),
  }));
}

export function bookRows(dataset, users, authors) {
  const userId = idBy(users, 'email');
  const authorId = idBy(authors, 'code');
  return dataset.authors.flatMap((a) =>
    a.books.map((b) => ({
      code: b.book_id, title: b.title, isbn: b.isbn, genre: b.genre, status: b.status,
      publication_date: bubbleDate(b.publication_date), mrp: b.mrp ?? '',
      royalty_per_copy: b.author_royalty_per_copy ?? '', print_partner: b.print_partner ?? '',
      platforms: (b.available_on ?? []).join(', '),
      author: must(authorId, a.author_id, 'author'), owner: must(userId, a.email, 'user'),
    })),
  );
}

export function royaltyRows(dataset, users, authors, books) {
  const userId = idBy(users, 'email');
  const authorId = idBy(authors, 'code');
  const bookId = idBy(books, 'code');
  return dataset.authors.flatMap((a) =>
    a.books.map((b) => ({
      book: must(bookId, b.book_id, 'book'), author: must(authorId, a.author_id, 'author'),
      owner: must(userId, a.email, 'user'), copies_sold: b.total_copies_sold,
      earned: b.total_royalty_earned, paid: b.royalty_paid, pending: b.royalty_pending,
      last_payout_date: bubbleDate(b.last_royalty_payout_date),
    })),
  );
}

function main(stage) {
  const dataset = readJson('data/bookleaf_sample_data.json');
  const ids = (n) => readJson(`data/bubble-ids/${n}.json`);
  const build = {
    authors: () => authorRows(dataset, ids('users')),
    books: () => bookRows(dataset, ids('users'), ids('authors')),
    royalties: () => royaltyRows(dataset, ids('users'), ids('authors'), ids('books')),
  }[stage];
  if (!build) throw new Error('stage must be authors | books | royalties');
  const out = join(ROOT, 'data/seed', `${stage}.csv`);
  mkdirSync(dirname(out), { recursive: true });
  const rows = build();
  writeFileSync(out, toCsv(rows));
  console.log(`${rows.length} rows → ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv[2]);
