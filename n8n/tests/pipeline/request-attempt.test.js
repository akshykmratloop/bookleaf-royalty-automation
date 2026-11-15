import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPT, validateRequest } from '../../src/pipeline/request.js';

/** Whether validateRequest flags `attempt` (other fields of this partial body may also fail; only attempt matters here). */
const attemptRejected = (attempt) => {
  const r = validateRequest({ attempt });
  return !r.ok && r.errors.some((e) => e.path === 'attempt');
};

describe('validateRequest: attempt', () => {
  it('allows many sends for one author (an author with 20+ finished sends can still be sent to)', () => {
    expect(MAX_ATTEMPT).toBeGreaterThanOrEqual(100000);
    for (const n of [1, 20, 21, 500, MAX_ATTEMPT, String(21)]) expect(attemptRejected(n)).toBe(false);
  });

  it('defaults a missing attempt to 1', () => {
    expect(attemptRejected(undefined)).toBe(false);
    expect(attemptRejected(null)).toBe(false);
  });

  it('rejects values outside 1..MAX_ATTEMPT and non-whole numbers', () => {
    for (const n of [0, -1, MAX_ATTEMPT + 1, 1.5, '2a', true]) expect(attemptRejected(n)).toBe(true);
  });
});
