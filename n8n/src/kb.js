import { formatInr } from './money.js';

/**
 * Policy facts from the BookLeaf Knowledge Base, written once: the prompt, the facts the checker
 * allows, the status texts and the payout calendar all read them from here. They are versioned
 * code, not settings: changing one changes the prompt, so it goes with a new PROMPT_VERSION.
 */
export const PAYOUT_THRESHOLD_RUPEES = 1000;
export const PAYOUT_WINDOW_DAYS = 45;
export const OVERDUE_AFTER_DAYS = 90;
export const ESCALATION_HOURS = 48;
export const AUTHOR_SHARE_PERCENT = 80;

/** Each policy figure exactly as emails write it (and as the fact checker accepts it). */
export const KB_TEXT = Object.freeze({
  threshold: formatInr(PAYOUT_THRESHOLD_RUPEES),
  payoutWindow: `${PAYOUT_WINDOW_DAYS} days`,
  overdueWindow: `${OVERDUE_AFTER_DAYS} days`,
  escalation: `${ESCALATION_HOURS} hours`,
  authorShare: `${AUTHOR_SHARE_PERCENT}%`,
  bookleafShare: `${100 - AUTHOR_SHARE_PERCENT}%`,
});

const kb = (id, label, type, value, display, section) => ({
  id, label, type, value, display, source: { kind: 'KB', section, rule: label },
});

/** @type {readonly import('./facts-types.js').Fact[]} */
export const KB_FACTS = Object.freeze([
  kb('kb.payout_threshold', 'Minimum payout threshold', 'MONEY', PAYOUT_THRESHOLD_RUPEES * 100, KB_TEXT.threshold, 'Royalty Policy'),
  kb('kb.payout_window', 'Payout window after quarter end', 'DURATION', KB_TEXT.payoutWindow, KB_TEXT.payoutWindow, 'Royalty Policy'),
  kb('kb.royalty_split_author', 'Author share of net profit', 'PERCENT', AUTHOR_SHARE_PERCENT, KB_TEXT.authorShare, 'Royalty Policy'),
  kb('kb.royalty_split_bookleaf', 'BookLeaf share of net profit', 'PERCENT', 100 - AUTHOR_SHARE_PERCENT, KB_TEXT.bookleafShare, 'Royalty Policy'),
  kb('kb.escalation_window', 'Escalation response time', 'DURATION', KB_TEXT.escalation, KB_TEXT.escalation, 'Communication Tone'),
  kb('kb.overdue_window', 'Days without payout before a book is flagged overdue', 'DURATION', KB_TEXT.overdueWindow, KB_TEXT.overdueWindow, 'Royalty Dashboard'),
]);
