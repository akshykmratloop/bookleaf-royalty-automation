// Pills: 24px tall, fully round, soft background with strong text and a status dot centred on the text.
// Bubble rows have no align-items, so the dot and the text each carry vert_alignment: 'center' (align-self).
// statusBadge: Fully paid (green) → Pending (amber) → Overdue (red); later rules win.
// sendBadge: the notification log status (Queued, Processing, Draft ready, Sent, Failed, ...).
import { chain, op, text } from '../expr.mjs';
import { row, label, group, withStates } from '../ui.mjs';
import { TONES, fill, border, pad, font } from '../theme.mjs';

const gt0 = (countExpr) => chain(countExpr, op('greater_than', { args: 0 }));
const toneSet = (tone) => ({ fg: { font_color: TONES[tone][0] }, bg: { bgcolor: TONES[tone][1], border_color: TONES[tone][1] }, dot: { bgcolor: TONES[tone][0], border_color: TONES[tone][0] } });

/** A pill whose tone switches by condition: rules = [{ when, tone, text? }]. */
export function pill(id, baseText, baseTone, rules = []) {
  const base = toneSet(baseTone);
  const t = withStates(label(`${id}_t`, baseText, font(11.5, 700, TONES[baseTone][0], { line_height: 1.4 }), { fit_width: true, min_width_css: 'max-content', vert_alignment: 'center' }),
    rules.map((r) => ({ when: r.when, set: { ...toneSet(r.tone).fg, ...(r.text ? { text: r.text } : {}) } })));
  const dot = withStates(group(`${id}_d`, [], { props: { ...fill(TONES[baseTone][0]), ...border(TONES[baseTone][0], 999), width: 6, height: 6, single_width: true, single_height: true, min_width_css: '6px', min_height_css: '6px', fit_height: false, vert_alignment: 'center' } }),
    rules.map((r) => ({ when: r.when, set: toneSet(r.tone).dot })));
  const shell = row(id, [dot, t], { gap: 8, props: { ...fill(base.bg.bgcolor), ...border(base.bg.bgcolor, 999), ...pad(4, 12), fit_width: true } });
  return withStates(shell, rules.map((r) => ({ when: r.when, set: toneSet(r.tone).bg })));
}

/** pendingCount / overdueCount: numbers of this author's records pending / overdue. */
export const statusBadge = (id, pendingCount, overdueCount) =>
  pill(id, text('Fully paid'), 'success', [
    { when: gt0(pendingCount), tone: 'warning', text: text('Pending') },
    { when: gt0(overdueCount), tone: 'danger', text: text('Overdue') },
  ]);

/** Send status pill; `statusDisplayExpr` is the log's status:display. */
export function sendBadge(id, statusDisplayExpr) {
  const is = (v) => chain(statusDisplayExpr, op('equals', { args: v }));
  return pill(id, text(statusDisplayExpr), 'warning', [
    { when: is('Draft ready'), tone: 'info' },
    { when: is('Sent'), tone: 'success' },
    { when: is('Failed'), tone: 'danger' },
    { when: is('Discarded'), tone: 'neutral' },
    { when: is('Duplicate'), tone: 'neutral' },
  ]);
}
