/** Building blocks shared by the figure finders: month names, digit runs, scale words. */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const MONTH =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/**
 * A whole digit run, commas only between digits: "₹1,0000" is read whole (and then rejected by
 * parseAmount), never cut short to ₹1,000.
 */
export const NUM = '(\\d+(?:,\\d+)*(?:\\.\\d+)?)';
/** Scale words after a figure with a currency: "₹5 lakh", "₹2 million", "₹5k". */
export const MULT = '(lakhs?|lacs?|crores?|cr|k|thousand|million|mn)';
/** Scale words that make a bare figure money on their own: "50 lakh", "2 crore", "5k". */
export const BARE_MULT = '(lakhs?|lacs?|crores?|cr|k)';

export const pad = (n) => String(n).padStart(2, '0');
export const monthIndex = (name) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

const SCALE = { k: 1e3, thousand: 1e3, million: 1e6, mn: 1e6, cr: 1e7 };

function scaleOf(word) {
  const w = (word ?? '').toLowerCase();
  if (!w) return 1;
  if (w.startsWith('lakh') || w.startsWith('lac')) return 1e5;
  if (w.startsWith('crore')) return 1e7;
  return SCALE[w] ?? 1;
}

const GROUPED = /^\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?$/;
const PLAIN = /^\d+(?:\.\d{1,2})?$/;

/** A figure as written, or NaN when its grouping is malformed ("1,0000", "3570.555"). */
export function parseAmount(raw) {
  return GROUPED.test(raw) || PLAIN.test(raw) ? Number(raw.replace(/,/g, '')) : NaN;
}

/** Paise for a figure and its scale word; NaN (matches no fact) when the figure is malformed. */
export const toPaise = (raw, scale) => Math.round(parseAmount(raw) * scaleOf(scale) * 100);

/** Blanks every match, keeping offsets, so a later pattern cannot read the same figure again. */
export const blankOut = (text, re) => text.replace(re, (m) => ' '.repeat(m.length));
