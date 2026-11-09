import { resolveBrand } from './brand.js';
import { escapeHtml, escapeMultiline } from './html-escape.js';
import { formatDate } from './dates.js';
import { figuresTable, productionList } from './render-table.js';
import { figuresText } from './render-text.js';

export { escapeHtml };

const MAX_SUBJECT = 150;
const P = 'margin:0 0 14px;font-size:15px;line-height:1.55;color:#2b2b2b;';

/** @param {string} s @returns {string} single-line subject, capped */
const cleanSubject = (s) => String(s ?? '').replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT);
const para = (t) => (t ? `<p style="${P}">${escapeMultiline(t)}</p>` : '');

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

function bodyHtml(sections, facts) {
  const byCode = new Map((sections.bookParagraphs ?? []).map((p) => [p.code, p.text]));
  const bookProse = facts.books.filter((b) => byCode.has(b.code)).map((b) => para(byCode.get(b.code))).join('');
  const payoutLine = `<p style="${P}font-weight:bold;">Next payout cycle closes by ${escapeHtml(formatDate(facts.nextPayoutDate))}</p>`;
  return [
    para(sections.greeting), para(sections.intro), bookProse, figuresTable(facts), para(sections.totalsParagraph),
    payoutLine, para(sections.payoutParagraph), productionList(facts), para(sections.productionParagraph),
    para(sections.allPaidParagraph), para(sections.closing),
  ].join('');
}

function bodyText(sections, facts) {
  const byCode = new Map((sections.bookParagraphs ?? []).map((p) => [p.code, p.text]));
  const prose = facts.books.filter((b) => byCode.has(b.code)).map((b) => byCode.get(b.code));
  const blocks = [
    sections.greeting, sections.intro, ...prose, figuresText(facts), sections.totalsParagraph,
    sections.payoutParagraph, sections.productionParagraph, sections.allPaidParagraph, sections.closing,
  ];
  return blocks.filter((b) => typeof b === 'string' && b.trim()).join('\n\n');
}

/**
 * Builds the final email. Prose comes from the AI sections (always escaped); every figure in the
 * table comes from facts.
 * @param {{sections: Object, facts: import('./facts-types.js').AuthorFacts, bundle: import('./types.js').AuthorBundle, brand?: Object}} input
 * @returns {{subject: string, html: string, text: string}}
 */
export function renderEmail({ sections, facts, brand }) {
  const b = resolveBrand(brand);
  return {
    subject: cleanSubject(sections.subject),
    html: frame(b, bodyHtml(sections, facts)),
    text: bodyText(sections, facts),
  };
}
