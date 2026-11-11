import { describe, expect, it } from 'vitest';
import { afterAi } from '../../src/pipeline/after-ai.js';
import { buildContext } from '../../src/pipeline/context.js';
import { checkEdited, EDIT_MARKER, formatIssues, parseEditText, renderEdited, toEditText } from '../../src/pipeline/edit.js';
import { prepareJob } from '../../src/pipeline/prepare.js';
import { renderEmail } from '../../src/render-email.js';
import { signatureFor } from '../../src/signature.js';
import { ENV, fixedRandom, NOW } from './env.js';
import { payloadFor } from './fixtures.js';
import { anthropicOk, goodSections } from './ai-fixtures.js';

const job = prepareJob(payloadFor('AUTH002'), ENV, NOW, fixedRandom).job;
const ctx = buildContext(job).ctx;
const ai = afterAi({ response: anthropicOk(), ctx, job, attempt: 1 }).ai;
const { facts, titles } = ctx;
const editText = toEditText(goodSections, facts);
const signature = signatureFor('warm', '');

describe('renderEmail with a data-rendered signature', () => {
  it('signs exactly once, even when the AI wrote its own sign-off', () => {
    const r = renderEmail({ sections: goodSections, facts, signature });
    expect(r.text.match(/Warm regards,/g)).toHaveLength(1);
    expect(r.text).toMatch(/simply reply to this email\.\n\nWarm regards,\nBookLeaf Author Relations$/);
  });
  it('a custom sign-off is escaped and the valediction follows the tone', () => {
    const r = renderEmail({ sections: goodSections, facts, signature: signatureFor('formal', "Anita & O'Brien") });
    expect(r.html).toContain('Kind regards,<br>Anita &amp; O&#39;Brien');
    expect(r.html).not.toContain('Warm regards');
  });
});

describe('toEditText', () => {
  it('lists the prose as paragraphs with the figures-table marker after the book paragraphs', () => {
    const paras = editText.split('\n\n');
    expect(paras[0]).toBe('Dear Rohit,');
    expect(paras[2]).toContain('Code & Karma has sold 876 copies');
    expect(paras[4]).toBe(EDIT_MARKER);
    expect(paras.at(-1)).toBe('If anything looks different from your own records, simply reply to this email.');
    expect(editText).not.toContain('Warm regards');
    expect(EDIT_MARKER).toBe('[FIGURES TABLE]');
  });
});

describe('parseEditText', () => {
  it('splits on blank lines and finds the marker', () => {
    const p = parseEditText('A\r\n\r\nB\n \nC\n\n[FIGURES TABLE]\n\nD\n\n\n\nE');
    expect(p).toEqual({ before: ['A', 'B', 'C'], after: ['D', 'E'], marker: true });
  });
  it('without the marker the table goes after the second paragraph; extra markers are dropped', () => {
    expect(parseEditText('A\n\nB\n\nC')).toEqual({ before: ['A', 'B'], after: ['C'], marker: false });
    expect(parseEditText('A\n\n[figures table]\n\nB\n\n[FIGURES TABLE]')).toEqual({ before: ['A'], after: ['B'], marker: true });
  });
  it('strips control characters but keeps line breaks inside a paragraph', () => {
    expect(parseEditText('Dear Rohit,\u0007\nline two').before).toEqual(['Dear Rohit,\nline two']);
  });
});

describe('checkEdited (the same checker as the AI draft)', () => {
  const check = (body, subject = 'Your BookLeaf royalty summary', length = 'standard') => checkEdited({ subject, body, facts, titles, length });
  it('the unedited draft passes with its verified figures', () => {
    const r = check(editText);
    expect(r.passed).toBe(true);
    expect(r.verifiedFigures).toBe(ai.verified_figures);
    expect(r.words).toBeGreaterThan(80);
  });
  it('an edited amount that is not in the data blocks', () => {
    const r = check(editText.replace('₹5,280', '₹9,999'));
    expect(r.passed).toBe(false);
    expect(r.blocking[0]).toMatchObject({ code: 'UNSUPPORTED_AMOUNT', excerpt: '₹9,999' });
  });
  it('an unsupported figure in the subject blocks too', () => {
    expect(check(editText, 'You are owed ₹12,345').passed).toBe(false);
  });
  it('warns, without blocking, when the length is off target', () => {
    const r = check(editText, undefined, 'detailed');
    expect(r.passed).toBe(true);
    expect(r.issues.map((i) => i.code)).toContain('LENGTH');
  });
  it('formatIssues writes one readable line per issue', () => {
    const r = check(editText.replace('₹5,280', '₹9,999'), undefined, 'detailed');
    const lines = formatIssues(r.issues).split('\n');
    expect(lines[0]).toBe('Blocked (UNSUPPORTED_AMOUNT): Amount "₹9,999" does not match any verified fact.');
    expect(lines.at(-1)).toMatch(/^Warning \(LENGTH\): /);
    expect(formatIssues([])).toBe('');
  });
});

describe('renderEdited', () => {
  const brand = { name: 'BookLeaf Publishing' };
  it('places the facts-rendered table at the marker and escapes the prose', () => {
    const body = editText.replace('Dear Rohit,', 'Dear Rohit, <b>hi</b>');
    const r = renderEdited({ subject: 'Hello\nthere', parsed: parseEditText(body), facts, brand, signature });
    expect(r.subject).toBe('Hello there');
    expect(r.html).toContain('Dear Rohit, &lt;b&gt;hi&lt;/b&gt;');
    expect(r.html.indexOf('₹13,024')).toBeGreaterThan(r.html.indexOf('Startup Sutra has earned'));
    expect(r.html.indexOf('Next payout cycle closes by 14 Feb 2026')).toBeLessThan(r.html.indexOf('Across both books'));
    expect(r.html).not.toContain(EDIT_MARKER);
    expect(r.text).toContain('Total: earned ₹84,024');
    expect(r.text).toMatch(/Warm regards,\nBookLeaf Author Relations$/);
  });
  it('a sign-off typed into the body is replaced by the data-rendered one', () => {
    const r = renderEdited({ subject: 's', parsed: parseEditText(`${editText}\n\nWarm regards,\nSomeone Else`), facts, brand, signature });
    expect(r.text.match(/regards,/g)).toHaveLength(1);
    expect(r.text).not.toContain('Someone Else');
  });
});
