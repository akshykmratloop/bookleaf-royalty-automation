import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bundleFromSample } from '../src/normalize.js';
import { buildFacts } from '../src/facts.js';
import { escapeHtml, renderEmail } from '../src/render-email.js';

const data = JSON.parse(readFileSync(new URL('../../data/bookleaf_sample_data.json', import.meta.url), 'utf8'));
const bundleOf = (id) => bundleFromSample(data.authors.find((a) => a.author_id === id));
const brand = { name: 'BookLeaf Publishing', supportEmail: 'support@bookleafpub.in' };
const sectionsFor = (b) => ({
  subject: 'Your royalty summary',
  greeting: `Hi ${b.author.firstName},`,
  intro: 'Here is where your royalties stand.',
  bookParagraphs: b.books.map((k) => ({ code: k.code, text: `About ${k.title}.` })),
  totalsParagraph: 'Across your books, this is the total.',
  payoutParagraph: 'Your next payout cycle is below.',
  closing: 'Warm regards, the BookLeaf team',
});
const render = (id, over = {}, ref = '2025-12-31') => {
  const bundle = bundleOf(id);
  return renderEmail({ sections: { ...sectionsFor(bundle), ...over }, facts: buildFacts(bundle, ref), bundle, brand });
};

describe('escapeHtml', () => {
  it('escapes the five special characters', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
  it('coerces non-strings safely', () => expect(escapeHtml(null)).toBe(''));
});

describe('renderEmail', () => {
  it('renders brand, layout constraints and the subject', () => {
    const r = render('AUTH001');
    expect(r.subject).toBe('Your royalty summary');
    expect(r.html).toContain('#1f4d3a');
    expect(r.html).toContain('#faf7f2');
    expect(r.html).toContain('max-width:600px');
    expect(r.html).toContain('Hi Priya,');
    expect(r.html).toContain('BookLeaf Publishing');
  });
  it('renders the figures table from facts, with rupee grouping', () => {
    const r = render('AUTH002');
    expect(r.html).toContain('Code &amp; Karma');
    expect(r.html).toContain('₹26,280');
    expect(r.html).toContain('₹5,280');
    expect(r.html).toContain('1 Sep 2025');
  });
  it('totals row is correct', () => {
    const r = render('AUTH002');
    expect(r.html).toMatch(/Total<\/td>[\s\S]*₹84,024[\s\S]*₹71,000[\s\S]*₹13,024/);
    expect(r.text).toContain('Total');
    expect(r.text).toContain('₹13,024');
  });
  it('shows badges and the next payout date', () => {
    const r = render('AUTH003');
    expect(r.html).toContain('Overdue');
    expect(r.html).toContain('#b3261e');
    expect(r.html).toContain('14 Feb 2026');
    expect(r.html).toContain('No payout yet');
    const g = render('AUTH008');
    expect(g.html).toContain('Fully paid');
    expect(render('AUTH001').html).toContain('Pending');
  });
  it('lists in-production books outside the figures table', () => {
    const r = render('AUTH009');
    expect(r.html).toContain('Raising Roots');
    expect(r.html).toContain('In Production - Typesetting');
    expect(r.text).toContain('Raising Roots');
  });
  it('escapes a hostile book title', () => {
    const bundle = bundleOf('AUTH001');
    bundle.books[0].title = '<script>alert(1)</script>';
    const r = renderEmail({ sections: sectionsFor(bundle), facts: buildFacts(bundle, '2025-12-31'), bundle, brand });
    expect(r.html).not.toContain('<script');
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('AI text cannot inject HTML', () => {
    const evil = '<img src=x onerror=alert(1)><a href="javascript:x">c</a>';
    const r = render('AUTH001', { intro: evil, greeting: evil, closing: evil, totalsParagraph: evil, payoutParagraph: evil,
      productionParagraph: evil, allPaidParagraph: evil, bookParagraphs: [{ code: 'BK001', text: evil }] });
    expect(r.html).not.toContain('<img');
    expect(r.html).not.toContain('<a href="javascript');
    expect(r.html).toContain('&lt;img');
  });
  it('subject cannot contain line breaks (header injection) and is capped', () => {
    const r = render('AUTH001', { subject: `Hello\r\nBcc: evil@x.com ${'x'.repeat(300)}` });
    expect(r.subject).not.toMatch(/[\r\n]/);
    expect(r.subject.length).toBeLessThanOrEqual(150);
  });
  it('ignores a malicious brand colour', () => {
    const bundle = bundleOf('AUTH001');
    const r = renderEmail({ sections: sectionsFor(bundle), facts: buildFacts(bundle, '2025-12-31'), bundle,
      brand: { ...brand, headerColor: 'red;} </style><script>' } });
    expect(r.html).not.toContain('<script');
    expect(r.html).toContain('#1f4d3a');
  });
  it('includes optional paragraphs only when provided and prose paragraphs on the matching book', () => {
    const r = render('AUTH008', { allPaidParagraph: 'Everything is paid up.' });
    expect(r.html).toContain('Everything is paid up.');
    expect(render('AUTH008').html).not.toContain('Everything is paid up.');
  });
  it('plain text mirrors the prose and figures', () => {
    const r = render('AUTH001');
    expect(r.text).toContain('Hi Priya,');
    expect(r.text).toContain('Whispers of the Ganges');
    expect(r.text).toContain('₹3,570');
    expect(r.text).toContain('14 Feb 2026');
    expect(r.text).not.toMatch(/<[a-z]/i);
  });
});
