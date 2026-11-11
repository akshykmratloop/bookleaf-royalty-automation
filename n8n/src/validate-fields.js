import { isRealDate } from './dates.js';

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
const EMAIL = /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\.]+$/;
export const MAX_AMOUNT = 1e9;

/** @param {unknown} s @returns {boolean} a plain email address (no display name) */
export const isEmail = (s) => typeof s === 'string' && EMAIL.test(s);

/** @param {string} s @returns {string} control chars removed, NFC normalised, trimmed */
export const cleanString = (s) => s.replace(CONTROL_CHARS, '').normalize('NFC').trim();

/** Collector of errors with a path prefix. */
export function makeCtx() {
  /** @type {import('./types.js').ValidationError[]} */
  const errors = [];
  const fail = (path, code, message) => { errors.push({ path, code, message }); return undefined; };
  return { errors, fail };
}

/** Reads a string field with length bounds; returns cleaned value or undefined after recording an error. */
export function str(ctx, path, v, min, max, pattern) {
  if (typeof v !== 'string') return ctx.fail(path, 'TYPE', 'must be a string');
  const s = cleanString(v);
  if (s.length < min) return ctx.fail(path, 'TOO_SHORT', `must be at least ${min} characters`);
  if (s.length > max) return ctx.fail(path, 'TOO_LONG', `must be at most ${max} characters`);
  if (pattern && !pattern.test(s)) return ctx.fail(path, 'PATTERN', 'has an invalid format');
  return s;
}

export const email = (ctx, path, v) => {
  const s = str(ctx, path, v, 5, 254);
  return s !== undefined && !EMAIL.test(s) ? ctx.fail(path, 'PATTERN', 'must be a valid email') : s;
};

export function amount(ctx, path, v) {
  if (!Number.isInteger(v)) return ctx.fail(path, 'TYPE', 'must be an integer');
  if (v < 0 || v > MAX_AMOUNT) return ctx.fail(path, 'RANGE', `must be between 0 and ${MAX_AMOUNT}`);
  return v;
}

export function date(ctx, path, v, nullable) {
  if (v === null && nullable) return null;
  return isRealDate(v) ? v : ctx.fail(path, 'DATE', 'must be a real date YYYY-MM-DD');
}

export function oneOf(ctx, path, v, allowed) {
  return allowed.includes(v) ? v : ctx.fail(path, 'ENUM', `must be one of ${allowed.join(', ')}`);
}

export const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
