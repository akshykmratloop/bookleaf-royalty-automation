import { amount, date, email, isObject, makeCtx, oneOf, str } from './validate-fields.js';

const ID = /^[A-Za-z0-9_-]+$/;

function validateAuthor(ctx, a) {
  if (!isObject(a)) return ctx.fail('author', 'TYPE', 'must be an object');
  return {
    id: str(ctx, 'author.id', a.id, 1, 64),
    code: str(ctx, 'author.code', a.code, 1, 64),
    name: str(ctx, 'author.name', a.name, 1, 80),
    firstName: str(ctx, 'author.firstName', a.firstName, 1, 80),
    email: email(ctx, 'author.email', a.email),
    city: str(ctx, 'author.city', a.city, 0, 80),
  };
}

function validatePlatforms(ctx, path, v) {
  if (!Array.isArray(v)) return ctx.fail(path, 'TYPE', 'must be an array');
  if (v.length > 10) return ctx.fail(path, 'TOO_MANY', 'at most 10 items');
  return v.map((p, i) => str(ctx, `${path}[${i}]`, p, 1, 40));
}

function validateBook(ctx, b, i) {
  const p = `books[${i}]`;
  if (!isObject(b)) return ctx.fail(p, 'TYPE', 'must be an object');
  const n = (k) => amount(ctx, `${p}.${k}`, b[k]);
  return {
    code: str(ctx, `${p}.code`, b.code, 1, 64),
    title: str(ctx, `${p}.title`, b.title, 1, 200),
    isbn: str(ctx, `${p}.isbn`, b.isbn, 0, 32),
    genre: str(ctx, `${p}.genre`, b.genre, 0, 80),
    status: oneOf(ctx, `${p}.status`, b.status, ['PUBLISHED', 'IN_PRODUCTION']),
    statusLabel: str(ctx, `${p}.statusLabel`, b.statusLabel, 1, 80),
    publicationDate: date(ctx, `${p}.publicationDate`, b.publicationDate, true),
    mrp: n('mrp'),
    royaltyPerCopy: n('royaltyPerCopy'),
    copiesSold: n('copiesSold'),
    earned: n('earned'),
    paid: n('paid'),
    pending: n('pending'),
    lastPayoutDate: date(ctx, `${p}.lastPayoutDate`, b.lastPayoutDate, true),
    printPartner: b.printPartner === null ? null : str(ctx, `${p}.printPartner`, b.printPartner, 1, 80),
    platforms: validatePlatforms(ctx, `${p}.platforms`, b.platforms),
  };
}

function bundleInto(ctx, bundle, prefix = '') {
  const start = ctx.errors.length;
  let value;
  if (!isObject(bundle)) ctx.fail('', 'TYPE', 'must be an object');
  else if (!Array.isArray(bundle.books)) ctx.fail('books', 'TYPE', 'must be an array');
  else if (bundle.books.length > 50) ctx.fail('books', 'TOO_MANY', 'at most 50 books');
  else value = { author: validateAuthor(ctx, bundle.author), books: bundle.books.map((b, i) => validateBook(ctx, b, i)) };
  if (prefix) ctx.errors.slice(start).forEach((e) => { e.path = e.path ? `${prefix}.${e.path}` : prefix; });
  return value;
}

/**
 * Validates and sanitises an AuthorBundle.
 * @param {unknown} bundle @returns {import('./types.js').Result}
 */
export function validateBundle(bundle) {
  const ctx = makeCtx();
  const value = bundleInto(ctx, bundle);
  return ctx.errors.length ? { ok: false, errors: ctx.errors } : { ok: true, value };
}

/**
 * Validates the enqueue webhook body.
 * @param {unknown} body @returns {import('./types.js').Result}
 */
export function validateEnqueue(body) {
  const ctx = makeCtx();
  if (!isObject(body)) return { ok: false, errors: [{ path: '', code: 'TYPE', message: 'body must be an object' }] };
  const value = {
    author_id: str(ctx, 'author_id', body.author_id, 1, 64, ID),
    mode: oneOf(ctx, 'mode', body.mode, ['single', 'bulk']),
  };
  if (body.log_id !== undefined) value.log_id = str(ctx, 'log_id', body.log_id, 1, 64);
  if (body.requested_by !== undefined) value.requested_by = str(ctx, 'requested_by', body.requested_by, 1, 254);
  if (body.reference_date !== undefined) value.reference_date = date(ctx, 'reference_date', body.reference_date, false);
  if (body.payload !== undefined) value.payload = bundleInto(ctx, body.payload, 'payload');
  return ctx.errors.length ? { ok: false, errors: ctx.errors } : { ok: true, value };
}
