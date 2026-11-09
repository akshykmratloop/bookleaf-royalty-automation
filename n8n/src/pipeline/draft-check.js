import { checkEmail } from '../checker/index.js';

const MIN_WORDS = 150;
const MAX_WORDS = 350;
const SIGN_OFF = 'BookLeaf Author Relations';
const PROSE_KEYS = ['subject', 'greeting', 'intro', 'totalsParagraph', 'payoutParagraph', 'productionParagraph', 'allPaidParagraph', 'closing'];

/** @param {Object} sections @returns {string} every piece of AI prose, the subject included */
export function proseText(sections) {
  const paras = (sections.bookParagraphs ?? []).map((p) => p.text);
  return [...PROSE_KEYS.slice(0, 3).map((k) => sections[k]), ...paras, ...PROSE_KEYS.slice(3).map((k) => sections[k])]
    .filter((t) => typeof t === 'string' && t.trim())
    .join('\n\n');
}

const warn = (code, message) => ({ code, severity: 'WARN', message });

/** Layout problems that do not make a figure wrong: reported, never blocking. */
function structureIssues(sections, facts) {
  const published = facts.books.filter((b) => b.badge !== 'NONE').map((b) => b.code);
  const codes = (sections.bookParagraphs ?? []).map((p) => p.code);
  const out = [];
  const unknown = codes.filter((c) => !published.includes(c));
  if (unknown.length) out.push(warn('UNKNOWN_BOOK', `Paragraphs for unknown books were dropped: ${unknown.join(', ')}`));
  const missing = published.filter((c) => !codes.includes(c));
  if (missing.length) out.push(warn('MISSING_BOOK', `No paragraph for: ${missing.join(', ')}`));
  if (!String(sections.closing ?? '').includes(SIGN_OFF)) out.push(warn('SIGN_OFF', 'Closing does not sign off as BookLeaf Author Relations'));
  return out;
}

/**
 * Fact-checks an AI draft against the author's facts (independently of the model).
 * @param {Object} sections @param {import('../facts-types.js').AuthorFacts} facts @param {string[]} titles
 * @returns {{passed:boolean, issues:Object[], blocking:Object[], verifiedFigures:number, words:number}}
 */
export function checkDraft(sections, facts, titles) {
  const text = proseText(sections);
  const r = checkEmail({ text, facts: facts.facts, titles });
  const words = text.split(/\s+/).filter(Boolean).length;
  const length = words < MIN_WORDS || words > MAX_WORDS ? [warn('LENGTH', `${words} words (target ${MIN_WORDS}-${MAX_WORDS})`)] : [];
  const issues = [...r.issues, ...structureIssues(sections, facts), ...length];
  return { passed: r.passed, issues, blocking: issues.filter((i) => i.severity === 'BLOCK'), verifiedFigures: r.verifiedFigures, words };
}
