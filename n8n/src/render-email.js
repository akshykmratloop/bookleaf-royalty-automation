import { resolveBrand } from './brand.js';
import { escapeHtml, escapeMultiline } from './html-escape.js';
import { formatDate } from './dates.js';
import { figuresTable, productionList } from './render-table.js';
import { figuresText } from './render-text.js';
import { stripSignature } from './signature.js';

export { escapeHtml };

const MAX_SUBJECT = 150;
const P = 'margin:0 0 14px;font-size:15px;line-height:1.55;color:#2b2b2b;';

/** @param {string} s @returns {string} single-line subject, capped */
const cleanSubject = (s) => String(s ?? '').replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT);
const para = (t) => (t ? `<p style="${P}">${escapeMultiline(t)}</p>` : '');

/** @typedef {{valediction:string, name:string}} Signature rendered from data (see signature.js) */

/** @param {Signature|undefined} sig */
const signatureHtml = (sig) => (sig ? para(`${sig.valediction}\n${sig.name}`) : '');
const signatureText = (sig) => (sig ? `${sig.valediction}\n${sig.name}` : '');
/** With a data-rendered signature, any sign-off already in the closing is removed first. */
const closingOf = (text, sig) => (sig ? stripSignature(text, [sig.name]) : text);
const payoutLineHtml = (facts) => `<p style="${P}font-weight:bold;">Next payout cycle closes by ${escapeHtml(formatDate(facts.nextPayoutDate))}</p>`;

function frame(brand, inner) {
  const heading = "font-family:Georgia,'Times New Roman',serif;";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(brand.name)}</title></head>` +
    `<body style="margin:0;padding:0;background:${brand.backgroundColor};font-family:Arial,Helvetica,sans-serif;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${brand.backgroundColor};"><tr><td align="center" style="padding:16px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:6px;">` +
    `<tr><td style="background:${brand.headerColor};padding:20px 24px;border-radius:6px 6px 0 0;"><span style="${heading}font-size:22px;color:#ffffff;">${escapeHtml(brand.name)}</span></td></tr>` +
    `<tr><td style="padding:24px;">${inner}</td></tr>` +
    `<tr><td style="padding:16px 24px;font-size:12px;color:#7a7a7a;border-top:1px solid #e6e0d6;">${escapeHtml(brand.name)}${brand.supportEmail ? ` &middot; ${escapeHtml(brand.supportEmail)}` : ''}</td></tr>` +
    `</table></td></tr></table></body></html>`;
}

/** @param {Object} sections @param {import('./facts-types.js').AuthorFacts} facts @returns {string[]} book prose in facts order */
export function bookProse(sections, facts) {
  const byCode = new Map((sections.bookParagraphs ?? []).map((p) => [p.code, p.text]));
  return facts.books.filter((b) => byCode.has(b.code)).map((b) => byCode.get(b.code));
}

function bodyHtml(sections, facts, sig) {
  return [
    para(sections.greeting), para(sections.intro), bookProse(sections, facts).map(para).join(''), figuresTable(facts),
    para(sections.totalsParagraph), payoutLineHtml(facts), para(sections.payoutParagraph), productionList(facts),
    para(sections.productionParagraph), para(sections.allPaidParagraph), para(closingOf(sections.closing, sig)), signatureHtml(sig),
  ].join('');
}

const joinBlocks = (blocks) => blocks.filter((b) => typeof b === 'string' && b.trim()).join('\n\n');

function bodyText(sections, facts, sig) {
  return joinBlocks([
    sections.greeting, sections.intro, ...bookProse(sections, facts), figuresText(facts), sections.totalsParagraph,
    sections.payoutParagraph, sections.productionParagraph, sections.allPaidParagraph, closingOf(sections.closing, sig),
    signatureText(sig),
  ]);
}

/**
 * Builds the final email. Prose comes from the AI sections (always escaped); every figure in the
 * table comes from facts. With `signature`, the sign-off is rendered from data (never AI text).
 * @param {{sections: Object, facts: import('./facts-types.js').AuthorFacts, bundle?: import('./types.js').AuthorBundle, brand?: Object, signature?: Signature}} input
 * @returns {{subject: string, html: string, text: string}}
 */
export function renderEmail({ sections, facts, brand, signature }) {
  const b = resolveBrand(brand);
  return {
    subject: cleanSubject(sections.subject),
    html: frame(b, bodyHtml(sections, facts, signature)),
    text: bodyText(sections, facts, signature),
  };
}

/**
 * An admin-edited email: free paragraphs around one facts block (figures table, payout line and
 * books in production, all from facts). Every paragraph is escaped.
 * @param {{subject:string, before:string[], after:string[], facts: import('./facts-types.js').AuthorFacts, brand?:Object, signature:Signature}} input
 * @returns {{subject: string, html: string, text: string}}
 */
export function renderParagraphs({ subject, before, after, facts, brand, signature }) {
  const factsHtml = figuresTable(facts) + payoutLineHtml(facts) + productionList(facts);
  return {
    subject: cleanSubject(subject),
    html: frame(resolveBrand(brand), [...before.map(para), factsHtml, ...after.map(para), signatureHtml(signature)].join('')),
    text: joinBlocks([...before, figuresText(facts), ...after, signatureText(signature)]),
  };
}
