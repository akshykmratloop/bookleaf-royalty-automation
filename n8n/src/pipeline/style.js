import { oneOf } from '../validate-fields.js';

/**
 * Per-request writing options sent by Bubble as flat fields (contract: n8n/PAYLOAD.md).
 * All optional; empty means the default.
 */
export const DELIVERIES = Object.freeze(['send', 'draft']);
export const TONES = Object.freeze(['warm', 'formal', 'concise']);
export const LENGTHS = Object.freeze(['short', 'standard', 'detailed']);
/** Target words of prose (all sections together) per length. */
export const WORD_RANGES = Object.freeze({ short: [80, 180], standard: [150, 300], detailed: [250, 450] });
export const NOTE_MAX = 300;
export const SIGN_OFF_MAX = 60;

/** A name: letters, spaces and . , ' & ( ) -. No digits or symbols, so no figure can ride in on it. */
const SIGN_OFF_PATTERN = /^[\p{L}\p{M} .,'&()-]*$/u;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]+/g;

/**
 * @typedef {Object} Style
 * @property {'send'|'draft'} delivery @property {'warm'|'formal'|'concise'} tone
 * @property {'short'|'standard'|'detailed'} length @property {string} note '' when none
 * @property {string} sign_off '' = the brand sign-off
 */

const optional = (v) => v === undefined || v === null || v === '';
const pickOne = (ctx, path, v, allowed, dflt) => (optional(v) ? dflt : oneOf(ctx, path, v, allowed));

/** Free text on one line: control characters (newlines included) become spaces, then trimmed. */
const oneLine = (s) => s.replace(CONTROL, ' ').normalize('NFC').replace(/\s+/g, ' ').trim();

function freeText(ctx, path, v, max, pattern) {
  if (optional(v)) return '';
  if (typeof v !== 'string') return ctx.fail(path, 'TYPE', 'must be a string');
  const s = oneLine(v);
  if (s.length > max) return ctx.fail(path, 'TOO_LONG', `must be at most ${max} characters`);
  if (pattern && !pattern.test(s)) return ctx.fail(path, 'PATTERN', 'may only contain letters, spaces and . , \' & ( ) -');
  return s;
}

/**
 * @param {{fail:Function}} ctx validation collector @param {Record<string, unknown>} body webhook body
 * @returns {Style} (fields are undefined where an error was recorded)
 */
export function readStyle(ctx, body) {
  return {
    delivery: pickOne(ctx, 'delivery', body.delivery, DELIVERIES, 'send'),
    tone: pickOne(ctx, 'tone', body.tone, TONES, 'warm'),
    length: pickOne(ctx, 'length', body.length, LENGTHS, 'standard'),
    note: freeText(ctx, 'note', body.note, NOTE_MAX),
    sign_off: freeText(ctx, 'sign_off', body.sign_off, SIGN_OFF_MAX, SIGN_OFF_PATTERN),
  };
}

/** @param {string} [length] @returns {[number, number]} word range (standard when unknown) */
export const wordRange = (length) => WORD_RANGES[length] ?? WORD_RANGES.standard;
