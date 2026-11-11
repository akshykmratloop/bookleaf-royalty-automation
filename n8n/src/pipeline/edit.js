import { checkEmail } from '../checker/index.js';
import { bookProse, renderParagraphs } from '../render-email.js';
import { stripSignature } from '../signature.js';
import { countWords, lengthIssues } from './draft-check.js';

/**
 * Admin editing of a draft. The editable text is the prose only, one paragraph per blank-line
 * block; the figures table, payout line and signature always come from data. A line reading
 * exactly [FIGURES TABLE] marks where the data block goes.
 */
export const EDIT_MARKER = '[FIGURES TABLE]';
/** Where the data block goes when the marker was deleted: after the greeting and the intro. */
export const DEFAULT_MARKER_INDEX = 2;

const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]+/g;
const isMarker = (p) => p.toUpperCase() === EDIT_MARKER;
const filled = (t) => typeof t === 'string' && t.trim() !== '';

/**
 * @param {Object} sections AI sections @param {import('../facts-types.js').AuthorFacts} facts
 * @returns {string} the prose as editable plain text (no signature)
 */
export function toEditText(sections, facts) {
  return [
    sections.greeting, sections.intro, ...bookProse(sections, facts), EDIT_MARKER, sections.totalsParagraph,
    sections.payoutParagraph, sections.productionParagraph, sections.allPaidParagraph, stripSignature(sections.closing),
  ].filter(filled).map((t) => t.trim()).join('\n\n');
}

/**
 * @param {string} text edited body
 * @returns {{before:string[], after:string[], marker:boolean}} paragraphs before/after the data block
 */
export function parseEditText(text) {
  const clean = String(text ?? '').replace(/\r\n?/g, '\n').replace(CONTROL_EXCEPT_NEWLINE, ' ').normalize('NFC');
  const paras = clean.split(/\n[ \t]*\n/).map((p) => p.split('\n').map((l) => l.trim()).join('\n').trim()).filter(Boolean);
  const at = paras.findIndex(isMarker);
  const prose = paras.filter((p) => !isMarker(p));
  const cut = at === -1 ? Math.min(DEFAULT_MARKER_INDEX, prose.length) : at;
  return { before: prose.slice(0, cut), after: prose.slice(cut), marker: at !== -1 };
}

/**
 * Runs the SAME fact checker as the AI draft over the edited subject and prose.
 * @param {{subject:string, body:string, facts:import('../facts-types.js').AuthorFacts, titles:string[], length?:string}} input
 * @returns {{passed:boolean, issues:Object[], blocking:Object[], words:number, verifiedFigures:number, parsed:ReturnType<typeof parseEditText>}}
 */
export function checkEdited({ subject, body, facts, titles, length }) {
  const parsed = parseEditText(body);
  const text = [subject, ...parsed.before, ...parsed.after].join('\n\n');
  const r = checkEmail({ text, facts: facts.facts, titles });
  const words = countWords(text);
  const issues = [...r.issues, ...lengthIssues(words, length)];
  return { passed: r.passed, issues, blocking: issues.filter((i) => i.severity === 'BLOCK'), words, verifiedFigures: r.verifiedFigures, parsed };
}

/** The signature is rendered from data: drop one typed at the end of the last paragraph. */
function withoutTypedSignature({ before, after }, name) {
  const lists = after.length ? [before, after] : [[], before];
  const last = lists[1];
  const tail = stripSignature(last.at(-1) ?? '', [name]);
  const trimmed = tail ? [...last.slice(0, -1), tail] : last.slice(0, -1);
  return after.length ? { before, after: trimmed } : { before: trimmed, after: [] };
}

/**
 * @param {{subject:string, parsed:ReturnType<typeof parseEditText>, facts:import('../facts-types.js').AuthorFacts,
 *   brand?:Object, signature:{valediction:string, name:string}}} input
 * @returns {{subject:string, html:string, text:string}}
 */
export function renderEdited({ subject, parsed, facts, brand, signature }) {
  const { before, after } = withoutTypedSignature(parsed, signature.name);
  return renderParagraphs({ subject, before, after, facts, brand, signature });
}

/** @param {{code:string, severity:string, message:string}[]} issues @returns {string} one per line, '' when none */
export function formatIssues(issues) {
  return (issues ?? []).map((i) => `${i.severity === 'BLOCK' ? 'Blocked' : 'Warning'} (${i.code}): ${i.message}`).join('\n');
}
