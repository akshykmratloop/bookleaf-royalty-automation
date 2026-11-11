import { describe, expect, it } from 'vitest';
import { contactIssues } from '../src/checker/contact.js';
import { checkReply, priyaFacts } from './checker-helpers.js';
import { checkEmail } from '../src/checker/index.js';

const ALLOWED = ['support@bookleaf.test', 'Sender@BookLeaf.test'];
const found = (text, allowed = ALLOWED) => contactIssues(text, allowed).map((i) => [i.code, i.excerpt]);

describe('contactIssues: links, email addresses and phone numbers the AI must not write', () => {
  it.each([
    ['Pay here: https://bookleaf-pay.example/verify now.', 'LINK', 'https://bookleaf-pay.example/verify'],
    ['Visit http://evil.test today', 'LINK', 'http://evil.test'],
    ['Log in at www.bookleaf-royalty.com to confirm.', 'LINK', 'www.bookleaf-royalty.com'],
    ['Update your bank details at x.com/abc today.', 'LINK', 'x.com/abc'],
    ['See bit.ly/3xYz for details.', 'LINK', 'bit.ly/3xYz'],
    ['Confirm on bookleaf-payments.com before Friday.', 'LINK', 'bookleaf-payments.com'],
    ['Our new portal is royalties.bookleaf.co.in.', 'LINK', 'royalties.bookleaf.co.in'],
  ])('%s → %s', (text, code, excerpt) => {
    expect(found(text)).toEqual([[code, excerpt]]);
  });
  it('blocks an email address other than the configured ones, case-insensitively allowing those', () => {
    expect(found('Write to payouts@bookleaf-help.com with your PAN.')).toEqual([['EMAIL_ADDRESS', 'payouts@bookleaf-help.com']]);
    expect(found('Write to SUPPORT@bookleaf.test or sender@bookleaf.test.')).toEqual([]);
    expect(found('Write to support@bookleaf.test.', [])).toEqual([['EMAIL_ADDRESS', 'support@bookleaf.test']]);
  });
  it('an allowed address is not read as a bare domain', () => {
    expect(found('Questions? support@bookleaf.test is the place.')).toEqual([]);
  });
  it.each([
    ['Call us on +91 98765 43210 today.', '+91 98765 43210'],
    ['Call 98765-43210 for help.', '98765-43210'],
    ['Phone (022) 2345 6789 any time.', '(022) 2345 6789'],
    ['Ring 1800 123 4567, toll free.', '1800 123 4567'],
    ['WhatsApp 9876543210.', '9876543210'],
    ['Call +44 20 7946 0958.', '+44 20 7946 0958'],
  ])('blocks the phone number in "%s"', (text, excerpt) => {
    expect(found(text)).toEqual([['PHONE_NUMBER', excerpt]]);
  });
  it.each([
    'You have earned ₹1,23,456 so far, and ₹12,34,567 across all books.',
    'Your pending royalty of 1,23,456 rupees will be paid.',
    'Figures as of 31 Dec 2025; the next payout closes by 14 February 2026 (2026-02-14, 14/02/2026).',
    'It sold 1,200 copies in 2024 and 876 copies in 2025.',
    'Rs. 3570.00 is pending; payouts run at 10 a.m., e.g. on 14 Feb 2026.',
    'ISBN 978-93-5626-123-4 is your book.',
    'Thank you for being part of BookLeaf. Simply reply to this email.',
    'Code & Karma has sold 876 copies. Its payout of ₹5,280 is later than usual.',
  ])('lets figures, dates and plain prose pass: "%s"', (text) => {
    expect(found(text)).toEqual([]);
  });
  it('every issue blocks and says why', () => {
    for (const i of contactIssues('https://a.test/x write@a.test +91 98765 43210', [])) {
      expect(i.severity).toBe('BLOCK');
      expect(i.message).toMatch(/must not/);
    }
  });
});

describe('checkEmail runs the contact check', () => {
  const good = 'Hi Priya, thank you for reaching out. Your pending royalty of ₹3,570 will be paid in the payout cycle that closes by 14 February 2026. The minimum payout is ₹1,000.';
  it('fails an otherwise good email that carries a link, and passes it with an allowed support address', () => {
    const linked = checkReply({ body: `${good} Confirm at bookleaf-pay.com/confirm.` });
    expect(linked.passed).toBe(false);
    expect(linked.issues.map((i) => i.code)).toContain('LINK');
    const withSupport = checkEmail({ text: `${good} Questions? support@bookleaf.test.`, facts: priyaFacts, allowedEmails: ALLOWED });
    expect(withSupport.issues).toEqual([]);
  });
  it('a book title that looks like a domain is not a link', () => {
    expect(checkEmail({ text: `${good} Love.com has new readers.`, facts: priyaFacts, titles: ['Love.com'] }).passed).toBe(true);
  });
});
