import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, formatDate, payoutDeadlineFor, quarterEnd, resolveReferenceDate, toIsoDate } from '../src/dates.js';

const d = (s) => new Date(`${s}T00:00:00Z`);

describe('dates', () => {
  it('finds quarter end', () => {
    expect(toIsoDate(quarterEnd(d('2025-12-31')))).toBe('2025-12-31');
    expect(toIsoDate(quarterEnd(d('2026-02-01')))).toBe('2026-03-31');
    expect(toIsoDate(quarterEnd(d('2026-11-10')))).toBe('2026-12-31');
  });
  it('payout deadline is quarter end + 45 days', () => {
    expect(toIsoDate(payoutDeadlineFor(d('2025-12-31')))).toBe('2026-02-14');
    expect(toIsoDate(payoutDeadlineFor(d('2026-11-10')))).toBe('2027-02-14');
  });
  it('adds and diffs days', () => {
    expect(toIsoDate(addDays(d('2026-02-27'), 2))).toBe('2026-03-01');
    expect(daysBetween(d('2025-09-01'), d('2025-12-31'))).toBe(121);
  });
  it('formats dates', () => {
    expect(formatDate('2026-02-14')).toBe('14 Feb 2026');
    expect(formatDate('2025-12-01')).toBe('1 Dec 2025');
  });
});

describe('resolveReferenceDate', () => {
  it('turns "today" into the date in India and passes a fixed date through', () => {
    expect(resolveReferenceDate('today', Date.UTC(2026, 0, 31, 20, 0))).toBe('2026-02-01');
    expect(resolveReferenceDate('2025-12-31', Date.UTC(2026, 0, 31))).toBe('2025-12-31');
  });
});
