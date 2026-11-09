/**
 * Spoken numbers to digits, so the figure checker can read a voice transcript: the voice
 * persona says amounts in English words ("three thousand five hundred and seventy rupees"),
 * and the checker only understands digits. Indian scale words (lakh, crore, hazaar) are read
 * too. Ordinals and spoken years ("fourteenth", "twenty twenty-six") are not converted.
 */
const UNITS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const SCALES = {
  thousand: 1_000,
  hazaar: 1_000,
  hazar: 1_000,
  lakh: 100_000,
  lakhs: 100_000,
  lac: 100_000,
  million: 1_000_000,
  crore: 10_000_000,
  crores: 10_000_000,
};
const HUNDRED = 100;

const NUMBER_WORD = /\b[a-z]+(?:-[a-z]+)?\b/g;

const isUnit = (w) => w.split('-').every((p) => p in UNITS);
const isNumberWord = (w) => isUnit(w) || w === 'hundred' || w in SCALES;

/** The value of a run like ["three", "thousand", "five", "hundred", "seventy"]. */
function valueOf(words) {
  let total = 0;
  let current = 0;
  for (const w of words) {
    if (isUnit(w)) current += w.split('-').reduce((sum, p) => sum + (UNITS[p] ?? 0), 0);
    else if (w === 'hundred') current = (current || 1) * HUNDRED;
    else {
      total += (current || 1) * (SCALES[w] ?? 1);
      current = 0;
    }
  }
  return total + current;
}

/** Runs of number words, joined by spaces or "and"; a run needs at least one digit word. */
function runsIn(text) {
  const runs = [];
  let open = null;
  for (const m of text.toLowerCase().matchAll(NUMBER_WORD)) {
    const word = m[0];
    const start = m.index ?? 0;
    const after = start + word.length;
    const joins = open !== null && /^\s+$/.test(text.slice(open.joinFrom, start));
    if (open && joins && word === 'and') {
      open.joinFrom = after;
    } else if (isNumberWord(word)) {
      if (!open || !joins) {
        open = { start, end: after, joinFrom: after, words: [] };
        runs.push(open);
      }
      open.words.push(word);
      open.end = after;
      open.joinFrom = after;
    } else open = null;
  }
  return runs.filter((r) => r.words.some(isUnit));
}

export function wordsToDigits(text) {
  let out = '';
  let at = 0;
  for (const r of runsIn(text)) {
    out += text.slice(at, r.start) + String(valueOf(r.words));
    at = r.end;
  }
  return out + text.slice(at);
}

/** "rupees" (or the Hinglish "rupaye") right after a run of number words. */
const RUPEES_AFTER = /^\s+(?:rupees|rupee|rupaye|rupaiye)\b/i;

/**
 * Spoken amounts to figures, for showing a call transcript: "one thousand rupees" → "₹1,000",
 * with Indian digit grouping. Only runs followed by "rupees" change, so spoken ISBN digits and
 * phrases like "one moment" read as said. The voice still says amounts in words.
 */
export function spokenRupeesToFigures(text) {
  let out = '';
  let at = 0;
  for (const r of runsIn(text)) {
    const rupees = RUPEES_AFTER.exec(text.slice(r.end));
    if (!rupees) continue;
    out += `${text.slice(at, r.start)}₹${valueOf(r.words).toLocaleString('en-IN')}`;
    at = r.end + rupees[0].length;
  }
  return out + text.slice(at);
}
