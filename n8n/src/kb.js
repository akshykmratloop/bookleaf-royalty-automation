/** Policy facts from the BookLeaf Knowledge Base. */
export const PAYOUT_THRESHOLD_RUPEES = 1000;
export const OVERDUE_AFTER_DAYS = 90;

const kb = (id, label, type, value, display, section) => ({
  id, label, type, value, display, source: { kind: 'KB', section, rule: label },
});

/** @type {readonly import('./facts-types.js').Fact[]} */
export const KB_FACTS = Object.freeze([
  kb('kb.payout_threshold', 'Minimum payout threshold', 'MONEY', PAYOUT_THRESHOLD_RUPEES * 100, '₹1,000', 'Royalty Policy'),
  kb('kb.payout_window', 'Payout window after quarter end', 'DURATION', '45 days', '45 days', 'Royalty Policy'),
  kb('kb.royalty_split_author', 'Author share of net profit', 'PERCENT', 80, '80%', 'Royalty Policy'),
  kb('kb.royalty_split_bookleaf', 'BookLeaf share of net profit', 'PERCENT', 20, '20%', 'Royalty Policy'),
  kb('kb.escalation_window', 'Escalation response time', 'DURATION', '48 hours', '48 hours', 'Communication Tone'),
  kb('kb.overdue_window', 'Days without payout before a book is flagged overdue', 'DURATION', '90 days', '90 days', 'Royalty Dashboard'),
]);
