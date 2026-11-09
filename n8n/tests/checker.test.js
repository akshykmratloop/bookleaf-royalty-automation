import { describe, expect, it } from 'vitest';
import { checkReply, priyaFacts as facts } from './checker-helpers.js';
import { findDates, findDurations, findMoney, stripExclusions } from '../src/checker/extract.js';

const codes = (body) => checkReply({ body, facts }).issues.map((i) => i.code);

describe('extraction and normalisation', () => {
  it('treats different money spellings as the same paise value', () => {
    expect(findMoney('₹3,570 or Rs. 3570.00 or 3570 rupees').map((m) => m.value)).toEqual([357000, 357000, 357000]);
  });
  it('normalises dates written in several formats', () => {
    expect(findDates('14 Feb 2026, February 14, 2026, 2026-02-14 and 14/02/2026').map((d) => d.value)).toEqual([
      '2026-02-14', '2026-02-14', '2026-02-14', '2026-02-14',
    ]);
  });
  it('normalises duration ranges and units', () => {
    expect(findDurations('within 24–48 hours, 5 to 7 working days').map((d) => d.value)).toEqual(['24-48 hours', '5-7 business days']);
  });
});

describe('checkEmail', () => {
  const good =
    'Hi Priya, thank you for reaching out. Your pending royalty of ₹3,570 will be paid in the payout cycle that closes by 14 February 2026. The minimum payout is ₹1,000.';

  it('passes an email whose every figure is backed by facts and counts verified figures', () => {
    const r = checkReply({ body: good });
    expect(r.issues).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.verifiedFigures).toBe(3);
  });
  it('blocks an invented amount, date and timeline', () => {
    expect(codes('Hi Priya, we will pay ₹5,000 on 1 March 2026 and it takes 3 days to process, thank you.')).toEqual(
      expect.arrayContaining(['UNSUPPORTED_AMOUNT', 'UNSUPPORTED_DATE', 'UNSUPPORTED_TIMELINE']),
    );
  });
  it('wrong figure for the right book is blocked', () => {
    expect(checkReply({ body: good.replace('₹3,570', '₹3,507') }).passed).toBe(false);
  });
  it('blocks placeholders', () => {
    for (const p of ['[CONFIRM: bank account linked?]', '{{pending}}']) {
      const r = checkReply({ body: `${good} Your bank is ${p}.` });
      expect(r.passed).toBe(false);
      expect(r.issues.map((i) => i.code)).toContain('PLACEHOLDER');
    }
  });
  it('does not read ISBNs, ticket numbers or titles as claims', () => {
    const r = checkReply({
      body: `${good} Regarding ticket BL-1004 for ISBN 978-93-5XXXX-01-1 and "2025 Diaries".`,
      ignorePhrases: ['2025 Diaries'],
    });
    expect(r.passed).toBe(true);
  });
  it('strips ticket labels with any prefix before scanning', () => {
    for (const label of ['BL-1004', 'AC-1004', 'AC2-1187', 'TKT-25001']) {
      expect(stripExclusions(`Regarding ticket ${label}.`), label).not.toMatch(/\d/);
    }
    expect(stripExclusions('Paid on 2026-02-14.')).toContain('2026-02-14');
  });
  it('blocks internal leaks and guarantees', () => {
    expect(codes(`${good} Per kb.payout_threshold this is final.`)).toContain('INTERNAL_LEAK');
    expect(codes(`${good} We guarantee it will arrive.`)).toContain('GUARANTEE');
  });
  it('warns but does not block on a very short or very long email', () => {
    const short = checkReply({ body: 'Thanks, noted.' });
    expect(short.passed).toBe(true);
    expect(short.issues[0].code).toBe('TOO_SHORT');
    const long = checkReply({ body: `${good} ${'Thank you for being an author with us. '.repeat(120)}` });
    expect(long.passed).toBe(true);
    expect(long.issues.map((i) => i.code)).toContain('TOO_LONG');
  });
  it('does not warn about length for a normal ~3000 char email', () => {
    expect(codes(`${good} ${'Thank you for being an author with us. '.repeat(70)}`)).not.toContain('TOO_LONG');
  });
});

describe('slash dates that read two ways', () => {
  const march4 = { id: 'record.paid_on', label: 'Paid on', type: 'DATE', value: '2026-03-04', display: '4 March 2026', source: { kind: 'RECORD' } };
  const dateCodes = (body) => checkReply({ body, facts: [march4] }).issues.map((i) => i.code);
  it('does not pass 04/03/2026 against 4 March', () => {
    expect(dateCodes('It was paid on 04/03/2026.')).toContain('UNSUPPORTED_DATE');
    expect(dateCodes('It was paid on 03/04/2026.')).toContain('UNSUPPORTED_DATE');
  });
  it('still reads unambiguous slash dates', () => {
    expect(findDates('25/03/2026').map((d) => d.value)).toEqual(['2026-03-25']);
    expect(dateCodes('It was paid on 4 March 2026.')).not.toContain('UNSUPPORTED_DATE');
  });
  it('same day and month is not ambiguous', () => {
    expect(findDates('04/04/2026').map((d) => d.value)).toEqual(['2026-04-04']);
  });
});
