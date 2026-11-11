// Author-level payout badge, worded like the author portal's per-book badges:
// Fully paid (green) → Pending (yellow) → Overdue (red); later rules win.
import { chain, op, text } from '../expr.mjs';
import { group, label, withStates } from '../ui.mjs';

const gt0 = (countExpr) => chain(countExpr, op('greater_than', { args: 0 }));
const colors = (tone) => ({ bg: `var(--color_badge${tone}bg_default)`, fg: `var(--color_badge${tone}text_default)` });

/** pendingCount / overdueCount: numbers of this author's records pending / overdue. */
export function statusBadge(id, pendingCount, overdueCount) {
  const amber = colors('amber');
  const red = colors('red');
  const t = withStates(label(`${id}_t`, text('Fully paid'), 'Text_badge_green_', { fit_width: true, min_width_css: 'max-content' }), [
    { when: gt0(pendingCount), set: { text: text('Pending'), font_color: amber.fg } },
    { when: gt0(overdueCount), set: { text: text('Overdue'), font_color: red.fg } },
  ]);
  return withStates(group(id, [t], { layout: 'row', gap: 0, style: 'Group_badge_green_', props: { fit_width: true, padding_top: 3, padding_bottom: 3, padding_left: 10, padding_right: 10 } }), [
    { when: gt0(pendingCount), set: { bgcolor: amber.bg } },
    { when: gt0(overdueCount), set: { bgcolor: red.bg } },
  ]);
}

/** Send status chip for the notification log (Queued/Processing/Sent/Failed/Duplicate). */
export function sendBadge(id, statusDisplayExpr) {
  const is = (v) => chain(statusDisplayExpr, op('equals', { args: v }));
  const t = withStates(label(`${id}_t`, text(statusDisplayExpr), 'Text_badge_amber_', { fit_width: true, min_width_css: 'max-content' }), [
    { when: is('Sent'), set: { font_color: colors('green').fg } },
    { when: is('Failed'), set: { font_color: colors('red').fg } },
  ]);
  return withStates(group(id, [t], { layout: 'row', gap: 0, style: 'Group_badge_amber_', props: { fit_width: true, padding_top: 3, padding_bottom: 3, padding_left: 10, padding_right: 10 } }), [
    { when: is('Sent'), set: { bgcolor: colors('green').bg } },
    { when: is('Failed'), set: { bgcolor: colors('red').bg } },
  ]);
}
