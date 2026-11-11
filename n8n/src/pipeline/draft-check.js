import { checkEmail } from '../checker/index.js';
import { wordRange } from './style.js';

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
  return out;
}

/** @param {string} text @returns {number} */
export const countWords = (text) => text.split(/\s+/).filter(Boolean).length;

/** @param {number} words @param {string} [length] short | standard | detailed @returns {Object[]} a LENGTH warning or none */
export function lengthIssues(words, length) {
  const [min, max] = wordRange(length);
  return words < min || words > max ? [warn('LENGTH', `${words} words (target ${min}-${max})`)] : [];
}

/**
 * Fact-checks an AI draft against the author's facts (independently of the model).
 * @param {Object} sections @param {import('../facts-types.js').AuthorFacts} facts @param {string[]} titles
 * @param {string} [length] the job's length option; sets the word-count warning
 * @returns {{passed:boolean, issues:Object[], blocking:Object[], verifiedFigures:number, words:number}}
 */
export function checkDraft(sections, facts, titles, length = 'standard') {
  const text = proseText(sections);
  const r = checkEmail({ text, facts: facts.facts, titles });
  const words = countWords(text);
  const issues = [...r.issues, ...structureIssues(sections, facts), ...lengthIssues(words, length)];
  return { passed: r.passed, issues, blocking: issues.filter((i) => i.severity === 'BLOCK'), verifiedFigures: r.verifiedFigures, words };
}
