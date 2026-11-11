// Author detail popup (books, totals, history, Generate & Send) and the email preview popup.
import { chain, f, op, parent, text, dateFmt, rupees, inr, groupData } from '../expr.mjs';
import { group, row, cell, flexCell, label, button, html, list, thingGroup, popup, showWhen, hideWhen } from '../ui.mjs';
import { recordsOf, logsOf, inFlightOf } from '../queries.mjs';

const author = () => groupData('ad_pop_auth');
const a = (...ops) => chain(author(), ...ops);
const p = (...ops) => chain(parent(), ...ops);

function bookRow() {
  return thingGroup('ad_pb_row', 'royaltyrecord', parent(), [
    flexCell('ad_pb_title', text(p(f.thing('book', 'book'), f.text('title')))),
    cell('ad_pb_copies', text(p(f.num('copies_sold'))), 70, { align: 'right' }),
    cell('ad_pb_earned', rupees(p(f.num('earned'))), 96, { align: 'right' }),
    cell('ad_pb_paid', rupees(p(f.num('paid'))), 96, { align: 'right' }),
    cell('ad_pb_pend', rupees(p(f.num('pending'))), 96, { align: 'right' }),
  ], { layout: 'row', gap: 8, style: 'Group_table_row_', props: { padding_top: 8, padding_bottom: 8, padding_left: 12, padding_right: 12 } });
}

function historyRow() {
  return thingGroup('ad_ph_row', 'notificationlog', parent(), [
    cell('ad_ph_when', text(p({ type: 'Message', name: 'Created Date', is_slidable: false }, dateFmt('d mmm yyyy, HH:MM'))), 150, { style: 'Text_small_' }),
    cell('ad_ph_status', text(p(f.option('status', 'sendstatus'), op('display'))), 90, { style: 'Text_small_' }),
    flexCell('ad_ph_detail', text(p(f.text('subject'), op('defaulting_to', { args: chain(parent(), f.text('error')) }))), { style: 'Text_small_' }),
  ], { layout: 'row', gap: 8, props: { padding_top: 4, padding_bottom: 4 } });
}

export function authorPopup() {
  const busy = chain(inFlightOf(author()), op('count'), op('greater_than', { args: 0 }));
  return popup('ad_pop_auth', 'author', [
    label('ad_pa_name', text(a(f.text('name'))), 'Text_h2_'),
    label('ad_pa_meta', text(a(f.text('code')), ' · ', a(f.text('email')), ' · ', a(f.text('city'))), 'Text_muted_'),
    row('ad_pa_head', [
      flexCell('ad_pa_h1', 'BOOK', { style: 'Text_label_' }),
      cell('ad_pa_h2', 'COPIES', 70, { style: 'Text_label_', align: 'right' }),
      cell('ad_pa_h3', 'EARNED', 96, { style: 'Text_label_', align: 'right' }),
      cell('ad_pa_h4', 'PAID', 96, { style: 'Text_label_', align: 'right' }),
      cell('ad_pa_h5', 'PENDING', 96, { style: 'Text_label_', align: 'right' }),
    ], { gap: 8, style: 'Group_table_head_', props: { padding_top: 8, padding_bottom: 8, padding_left: 12, padding_right: 12 } }),
    list('ad_pa_books', 'royaltyrecord', recordsOf(author()), bookRow()),
    label('ad_pa_tot', text('Total pending ₹', chain(recordsOf(author()), f.num('pending'), op('sum'), ...inr())), 'Text_bold_'),
    label('ad_pa_hist_h', 'Statements sent', 'Text_h3_'),
    list('ad_pa_hist', 'notificationlog', chain(logsOf(author()), op('limit_to', { args: 5 })), historyRow()),
    showWhen(label('ad_pa_hist_none', 'None yet.', 'Text_muted_'), chain(logsOf(author()), op('count'), op('equals', { args: 0 }))),
    row('ad_pa_btns', [
      hideWhen(button('ad_pa_send', 'Generate & Send Royalty Summary', 'Button_primary_'), busy),
      showWhen(label('ad_pa_busy', 'Sending… the email is being written and checked. This takes about 20 seconds.', 'Text_small_'), busy),
      button('ad_pa_close', 'Close', 'Button_ghost_'),
    ], { gap: 12 }),
  ]);
}

export function emailPopup() {
  const l = (...ops) => chain(groupData('ad_pop_mail'), ...ops);
  return popup('ad_pop_mail', 'notificationlog', [
    label('ad_pm_subj', text(l(f.text('subject'))), 'Text_h3_'),
    label('ad_pm_meta', text('To ', l(f.text('sent_to')), ' · ', l(f.num('figures_verified')), ' figures verified · ', l(f.text('model'))), 'Text_small_'),
    html('ad_pm_html', text('<div style="max-height:65vh;overflow:auto;border:1px solid #E6E1D8;border-radius:8px">', l(f.text('email_html')), '</div>')),
    button('ad_pm_close', 'Close', 'Button_ghost_'),
  ], 760);
}
