import { findCopyCounts, findDates, findDurations, findMoney } from './extract.js';
import { findForeignMoney } from './loose.js';

/**
 * Everything an email may quote: typed fact values plus figures inside fact display text.
 * Sets: money (paise), dates, durations ("48 hours"), percents, counts, foreign ("USD:50000"),
 * monthDays ("--02-14"), figures (bare numbers that read as money).
 * @param {readonly import('../facts-types.js').Fact[]} facts
 */
export function allowedValues(facts) {
  const a = {
    money: new Set(),
    dates: new Set(),
    durations: new Set(),
    percents: new Set(),
    counts: new Set(),
    foreign: new Set(),
    monthDays: new Set(),
    figures: new Set(),
  };
  for (const f of facts) {
    if (f.type === 'UNKNOWN') continue;
    addTypedValue(a, f);
    addDisplayFigures(a, f.display);
  }
  a.dates.forEach((d) => a.monthDays.add(`--${d.slice(5)}`));
  a.money.forEach((m) => a.figures.add(m));
  a.counts.forEach((c) => a.figures.add(c * 100));
  return a;
}

/** The fact's own typed value goes into the set for its type. */
function addTypedValue(a, f) {
  const v = f.value;
  if (typeof v === 'number') {
    if (f.type === 'MONEY') a.money.add(v);
    if (f.type === 'PERCENT') a.percents.add(v);
    if (f.type === 'COUNT') a.counts.add(v);
  }
  if (typeof v === 'string') {
    if (f.type === 'DATE') a.dates.add(v);
    if (f.type === 'DURATION') a.durations.add(v);
  }
}

/** Figures written inside the display text, e.g. "₹1,000" in a status sentence. */
function addDisplayFigures(a, display) {
  findMoney(display).forEach((m) => a.money.add(m.value));
  findDates(display).forEach((d) => a.dates.add(d.value));
  findDurations(display).forEach((d) => a.durations.add(d.value));
  findCopyCounts(display).forEach((c) => a.counts.add(c.value));
  findForeignMoney(display).forEach((m) => a.foreign.add(m.value));
}
