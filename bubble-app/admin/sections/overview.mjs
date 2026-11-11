// Header ("as of" date) and the four headline numbers.
import { chain, f, op, search, text, dateFmt, rupees, inr } from '../expr.mjs';
import { group, row, label } from '../ui.mjs';
import { refDate, logsWithStatus, authorsWithPending } from '../queries.mjs';

const count = (expr) => chain(expr, op('count'));
const sumOf = (field) => chain(search('royaltyrecord'), f.num(field), op('sum'));

function kpi(id, title, valueText, note) {
  return group(id, [
    label(`${id}_l`, title, 'Text_label_'),
    label(`${id}_v`, valueText, 'Text_kpi_'),
    note && label(`${id}_n`, note, 'Text_small_'),
  ], { gap: 8, style: 'Group_card_', props: { fit_height: false, min_width_css: '220px', vert_alignment: 'stretch' } });
}

export function header() {
  return group('ad_hdr', [
    label('ad_h1', 'Royalty operations', 'Text_h1_'),
    label('ad_sub', 'Every author, what they are owed, and the royalty statements sent to them.', 'Text_muted_'),
    label('ad_asof', text('Statuses as of ', chain(refDate(), dateFmt('d mmm yyyy')), ' · overdue = pending with no payout for more than 90 days'), 'Text_small_'),
  ], { gap: 8 });
}

export function kpis() {
  return row('ad_kpis', [
    kpi('ad_k_auth', 'AUTHORS', text(count(search('author'))), text(count(search('book')), ' books in the catalogue')),
    kpi('ad_k_earned', 'TOTAL EARNED', rupees(sumOf('earned')), text('Paid out ₹', chain(sumOf('paid'), ...inr()))),
    kpi('ad_k_pend', 'PENDING PAYOUTS', rupees(sumOf('pending')), text(count(authorsWithPending()), ' authors are owed money')),
    kpi('ad_k_sent', 'STATEMENTS SENT', text(count(logsWithStatus('Sent'))), text(count(logsWithStatus('Failed')), ' failed · ', count(logsWithStatus('Processing')), ' in progress')),
  ], { gap: 16, props: { vert_alignment: 'stretch' } });
}

