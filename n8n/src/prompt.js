import { formatDate } from './dates.js';
import { formatInr } from './money.js';
import { PROMPT_VERSION, SYSTEM_PROMPT } from './prompt-system.js';
import { styleLines } from './prompt-style.js';

export { PROMPT_VERSION, SYSTEM_PROMPT };

/** @typedef {import('./facts-types.js').AuthorFacts} AuthorFacts */
/** @typedef {import('./facts-types.js').BookFacts} BookFacts */

/** Stage text after "In Production - ", e.g. "Cover Design"; the full label when there is no dash. */
export const stageOf = (label) => String(label).replace(/^in production\s*[-–—:]\s*/i, '').trim() || String(label);

const quoted = (titles) => titles.map((t) => `"${t}"`).join(', ');
const lastPayout = (b) => (b.lastPayoutDate ? formatDate(b.lastPayoutDate) : 'No payout yet');

/**
 * Which SITUATIONS from the system prompt apply. Below the payout minimum, a book flagged overdue
 * is not late under the policy (it rolls over), so BELOW_THRESHOLD replaces the OVERDUE escalation.
 * @param {AuthorFacts} facts @returns {{key:string, text:string}[]}
 */
export function situationsFor(facts) {
  const published = facts.books.filter((b) => b.badge !== 'NONE');
  const belowThreshold = facts.totals.pending > 0 && !facts.eligibleForPayout;
  const red = published.filter((b) => b.badge === 'RED');
  const yellow = published.filter((b) => b.badge === 'YELLOW');
  const out = [];
  if (published.length === 0) out.push({ key: 'NO_SALES_YET', text: 'No published books with royalties yet.' });
  if (red.length && !belowThreshold) out.push({ key: 'OVERDUE', text: `Payout later than our usual cycle for: ${quoted(red.map((b) => b.title))}.` });
  if (belowThreshold) {
    out.push({ key: 'BELOW_THRESHOLD', text: `Total pending ${formatInr(facts.totals.pending)} is below the ₹1,000 minimum payout, so it rolls over to the next quarter.` });
  }
  if (yellow.length && !belowThreshold) out.push({ key: 'PENDING', text: `Pending royalty due in the next payout cycle for: ${quoted(yellow.map((b) => b.title))}.` });
  if (facts.allPaid) out.push({ key: 'ALL_PAID', text: 'Every rupee earned so far has been paid; nothing is pending.' });
  if (facts.inProduction.length) {
    const list = facts.inProduction.map((b) => `"${b.title}" (stage: ${stageOf(b.statusLabel)})`).join(', ');
    out.push({ key: 'IN_PRODUCTION', text: `Books in production: ${list}.` });
  }
  return out;
}

/** @param {BookFacts} b @returns {string} one BOOKS line (display values only) */
function bookLine(b) {
  if (b.badge === 'NONE') return `- ${b.code} | "${b.title}" | ${b.statusText} | in production, no sales yet`;
  return `- ${b.code} | "${b.title}" | ${b.statusText} | copies sold ${b.copiesSold} | ` +
    `earned ${formatInr(b.earned)} | paid ${formatInr(b.paid)} | pending ${formatInr(b.pending)} | last payout ${lastPayout(b)}`;
}

/** @param {import('./facts-types.js').Fact} f */
const factLine = (f) => `- ${f.id} | ${f.label} | ${f.display}`;

/**
 * Builds the prompt for one author. The system prompt is constant (cache-friendly); everything
 * author- or request-specific (writing style, admin note) is in the user message.
 * @param {{bundle: import('./types.js').AuthorBundle, facts: AuthorFacts, style?:{tone?:string, length?:string, note?:string}}} input
 * @returns {{system:string, user:string, version:string, situations:string[]}}
 */
export function buildPrompt({ bundle, facts, style }) {
  const situations = situationsFor(facts);
  const user = [
    `Author first name: ${bundle.author.firstName}`,
    `Figures as of: ${formatDate(facts.referenceDate)}`,
    `Next payout cycle closes by: ${formatDate(facts.nextPayoutDate)}`,
    '',
    'SITUATIONS THAT APPLY:',
    ...situations.map((s) => `- ${s.key}: ${s.text}`),
    '',
    'BOOKS (code | title | status | figures):',
    ...facts.books.map(bookLine),
    '',
    'VERIFIED FACTS (id | label | display):',
    ...facts.facts.map(factLine),
    '',
    ...styleLines(style),
  ].join('\n');
  return { system: SYSTEM_PROMPT, user, version: PROMPT_VERSION, situations: situations.map((s) => s.key) };
}

/**
 * Follow-up message after a failed fact-check: lists what was wrong and asks for the whole JSON again.
 * @param {{code:string, message:string, excerpt?:string}[]} issues @returns {string}
 */
export function feedbackMessage(issues) {
  const lines = issues.slice(0, 10).map((i) => `- ${i.message}${i.excerpt ? ` (you wrote: "${i.excerpt}")` : ''}`);
  return [
    'Your draft failed BookLeaf\'s fact check, so it was not sent. Problems found:',
    ...lines,
    '',
    'Write the complete JSON again. Fix every problem above. Copy each figure exactly from the display column of',
    'VERIFIED FACTS, and leave out any figure that is not listed there. Keep everything else that was correct.',
  ].join('\n');
}
