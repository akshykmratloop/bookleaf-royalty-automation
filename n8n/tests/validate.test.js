import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bundleFromSample } from '../src/normalize.js';
import { validateBundle, validateEnqueue } from '../src/validate.js';

const data = JSON.parse(readFileSync(new URL('../../data/bookleaf_sample_data.json', import.meta.url), 'utf8'));
const bundle = () => structuredClone(bundleFromSample(data.authors[0]));
const errPaths = (r) => (r.ok ? [] : r.errors.map((e) => e.path));

describe('validateEnqueue', () => {
  const ok = { author_id: 'AUTH001', mode: 'single' };
  it('accepts minimal body', () => expect(validateEnqueue(ok)).toEqual({ ok: true, value: ok }));
  it('rejects non-object', () => expect(validateEnqueue(null).ok).toBe(false));
  it('author_id boundaries and pattern', () => {
    expect(validateEnqueue({ ...ok, author_id: 'a'.repeat(64) }).ok).toBe(true);
    expect(validateEnqueue({ ...ok, author_id: 'a'.repeat(65) }).ok).toBe(false);
    expect(validateEnqueue({ ...ok, author_id: '' }).ok).toBe(false);
    expect(validateEnqueue({ ...ok, author_id: "a'; DROP" }).ok).toBe(false);
    expect(validateEnqueue({ ...ok, author_id: '1x_y-Z' }).ok).toBe(true);
  });
  it('mode enum', () => {
    expect(validateEnqueue({ ...ok, mode: 'bulk' }).ok).toBe(true);
    expect(errPaths(validateEnqueue({ ...ok, mode: 'all' }))).toContain('mode');
  });
  it('log_id and requested_by caps', () => {
    expect(validateEnqueue({ ...ok, log_id: 'x'.repeat(64) }).ok).toBe(true);
    expect(validateEnqueue({ ...ok, log_id: 'x'.repeat(65) }).ok).toBe(false);
    expect(validateEnqueue({ ...ok, requested_by: 'x'.repeat(254) }).ok).toBe(true);
    expect(validateEnqueue({ ...ok, requested_by: 'x'.repeat(255) }).ok).toBe(false);
  });
  it('reference_date must be real', () => {
    expect(validateEnqueue({ ...ok, reference_date: '2025-12-31' }).ok).toBe(true);
    expect(validateEnqueue({ ...ok, reference_date: '2025-02-30' }).ok).toBe(false);
    expect(validateEnqueue({ ...ok, reference_date: '31/12/2025' }).ok).toBe(false);
  });
  it('validates nested payload with prefixed paths', () => {
    const p = bundle(); p.books[0].earned = -1;
    expect(errPaths(validateEnqueue({ ...ok, payload: p }))).toContain('payload.books[0].earned');
    expect(validateEnqueue({ ...ok, payload: bundle() }).ok).toBe(true);
  });
  it('drops unknown fields', () => {
    const r = validateEnqueue({ ...ok, evil: 1 });
    expect(r.value).not.toHaveProperty('evil');
  });
});

describe('validateBundle', () => {
  it('accepts every sample author', () => {
    for (const a of data.authors) expect(validateBundle(bundleFromSample(a)).ok, a.author_id).toBe(true);
  });
  it('trims and strips control chars', () => {
    const b = bundle(); b.author.name = '  Priya\u0000 Sharma\u0007 ';
    expect(validateBundle(b).value.author.name).toBe('Priya Sharma');
  });
  it('name 1-80', () => {
    const b = bundle();
    b.author.name = 'a'.repeat(80); expect(validateBundle(b).ok).toBe(true);
    b.author.name = 'a'.repeat(81); expect(errPaths(validateBundle(b))).toContain('author.name');
    b.author.name = '   '; expect(errPaths(validateBundle(b))).toContain('author.name');
  });
  it('email 5-254 and pattern', () => {
    const b = bundle();
    b.author.email = 'a@b.c'; expect(validateBundle(b).ok).toBe(true);
    b.author.email = 'a@b.'; expect(validateBundle(b).ok).toBe(false);
    b.author.email = `${'a'.repeat(250)}@b.co`; expect(validateBundle(b).ok).toBe(false);
    b.author.email = 'not-an-email'; expect(validateBundle(b).ok).toBe(false);
  });
  it('title 1-200, isbn 32, genre 80, city 80', () => {
    const b = bundle(); const k = b.books[0];
    k.title = 'a'.repeat(200); expect(validateBundle(b).ok).toBe(true);
    k.title = 'a'.repeat(201); expect(errPaths(validateBundle(b))).toContain('books[0].title');
    k.title = 'ok'; k.isbn = 'x'.repeat(33); expect(errPaths(validateBundle(b))).toContain('books[0].isbn');
    k.isbn = 'x'.repeat(32); k.genre = 'g'.repeat(81); expect(errPaths(validateBundle(b))).toContain('books[0].genre');
    k.genre = 'g'; b.author.city = 'c'.repeat(81); expect(errPaths(validateBundle(b))).toContain('author.city');
  });
  it('platforms max 10 items each 40', () => {
    const b = bundle();
    b.books[0].platforms = Array.from({ length: 10 }, () => 'p'.repeat(40)); expect(validateBundle(b).ok).toBe(true);
    b.books[0].platforms.push('x'); expect(validateBundle(b).ok).toBe(false);
    b.books[0].platforms = ['p'.repeat(41)]; expect(validateBundle(b).ok).toBe(false);
  });
  it('numbers are non-negative integers <= 1e9', () => {
    const b = bundle(); const k = b.books[0];
    k.mrp = 1e9; expect(validateBundle(b).ok).toBe(true);
    k.mrp = 1e9 + 1; expect(errPaths(validateBundle(b))).toContain('books[0].mrp');
    k.mrp = 1.5; expect(validateBundle(b).ok).toBe(false);
    k.mrp = '399'; expect(validateBundle(b).ok).toBe(false);
    k.mrp = Number.NaN; expect(validateBundle(b).ok).toBe(false);
    k.mrp = 0; expect(validateBundle(b).ok).toBe(true);
  });
  it('dates must be real or null', () => {
    const b = bundle(); const k = b.books[0];
    k.publicationDate = '2023-02-29'; expect(errPaths(validateBundle(b))).toContain('books[0].publicationDate');
    k.publicationDate = null; k.lastPayoutDate = null; expect(validateBundle(b).ok).toBe(true);
    k.lastPayoutDate = 'yesterday'; expect(validateBundle(b).ok).toBe(false);
  });
  it('books 0-50', () => {
    const b = bundle();
    b.books = []; expect(validateBundle(b).ok).toBe(true);
    b.books = Array.from({ length: 50 }, (_, i) => ({ ...bundle().books[0], code: `B${i}` })); expect(validateBundle(b).ok).toBe(true);
    b.books.push({ ...b.books[0], code: 'B50' }); expect(errPaths(validateBundle(b))).toContain('books');
  });
  it('status enum and missing fields', () => {
    const b = bundle(); b.books[0].status = 'LIVE';
    expect(errPaths(validateBundle(b))).toContain('books[0].status');
    expect(validateBundle({}).ok).toBe(false);
    expect(validateBundle(null).ok).toBe(false);
  });
  it('treats HTML in strings as data (not stripped to nothing)', () => {
    const b = bundle(); b.books[0].title = '<script>alert(1)</script>';
    expect(validateBundle(b).value.books[0].title).toContain('script');
  });
});
