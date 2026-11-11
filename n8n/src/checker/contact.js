import { blankOut } from './patterns.js';

/**
 * Contact details the prose must not carry: a reply to an author never has a link, an email address
 * other than BookLeaf's configured ones, or a phone number. The data gives none of these, so one in the
 * text came from the model (or a steered `note`) and could turn the email into phishing.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL_WITH_SCHEME = /\b(?:https?:\/\/|www\.)[^\s<>"'()]*[^\s<>"'().,;:!?]/gi;
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
/** A domain followed by a path, any top-level domain: "x.com/abc", "bit.ly/3xYz". */
const DOMAIN_WITH_PATH = new RegExp(`(?<![\\w@.-])${LABEL}(?:\\.${LABEL})*\\.[A-Za-z]{2,}\\/[^\\s<>"'()]*[^\\s<>"'().,;:!?]`, 'g');
/** A bare domain: only common top-level domains, written in lower case, so "Mumbai.In" or "e.g." never match. */
const BARE_DOMAIN = new RegExp(
  `(?<![\\w@.-])${LABEL}(?:\\.${LABEL})*\\.(?:com|in|net|org|io|co|info|biz|ly|app|xyz|link|site|online|shop|live|page|ai|gl)(?![\\w-])`,
  'g',
);
/**
 * A phone-shaped run: an optional +country code, an optional (area code), then groups of digits joined by
 * one space, dot or hyphen (2-5 digits; later ones may be shorter, as in an ISBN); or 10-13 digits in one
 * block. Never commas, so 1,23,456 stays one amount.
 */
const DIGIT_RUN = /(?<![\w+])(?:(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,5}\)[ .-]?)?\d{2,5}(?:[ .-]\d{1,5}){1,4}|\+?\d{10,13})(?![\w])/g;
const MIN_PHONE_DIGITS = 10;
const MIN_INTERNATIONAL_DIGITS = 8;
const ISBN = /^97[89]\d{10}$/;

const block = (code, message, excerpt) => ({ code, severity: 'BLOCK', message, excerpt });
const RULES = Object.freeze({
  EMAIL_ADDRESS: 'Contains an email address that is not BookLeaf\'s own: the email must not ask the author to write anywhere else.',
  LINK: 'Contains a web link or domain: the email must not send the author to a website.',
  PHONE_NUMBER: 'Contains a phone number: the email must not ask the author to call anyone.',
});

/** @param {string} run @returns {boolean} a phone number, not an amount or a date */
function isPhone(run) {
  const digits = run.replace(/\D/g, '');
  if (run.startsWith('+')) return digits.length >= MIN_INTERNATIONAL_DIGITS;
  return digits.length >= MIN_PHONE_DIGITS && !ISBN.test(digits);
}

/** Finds `re` in `text`, reports each match `keep` accepts once, and blanks every match so later rules skip it. */
function scan(text, re, code, keep = () => true) {
  const issues = [];
  for (const m of text.matchAll(re)) {
    if (keep(m[0]) && !issues.some((i) => i.excerpt === m[0])) issues.push(block(code, RULES[code], m[0]));
  }
  return { issues, rest: blankOut(text, re) };
}

/**
 * @param {string} text the prose (titles and ISBNs already removed)
 * @param {readonly string[]} [allowedEmails] BookLeaf's own addresses (support_email, email_from), any case
 * @returns {import('./check.js').CheckIssue[]} one BLOCK issue per offending link, address or number
 */
export function contactIssues(text, allowedEmails = []) {
  const allowed = new Set(allowedEmails.map((e) => String(e).trim().toLowerCase()).filter(Boolean));
  const emails = scan(text, EMAIL, 'EMAIL_ADDRESS', (e) => !allowed.has(e.toLowerCase()));
  const urls = scan(emails.rest, URL_WITH_SCHEME, 'LINK');
  const paths = scan(urls.rest, DOMAIN_WITH_PATH, 'LINK');
  const domains = scan(paths.rest, BARE_DOMAIN, 'LINK');
  const phones = scan(domains.rest, DIGIT_RUN, 'PHONE_NUMBER', isPhone);
  return [emails, urls, paths, domains, phones].flatMap((r) => r.issues);
}
