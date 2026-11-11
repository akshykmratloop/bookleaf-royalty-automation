// Author detail: who they are, every book with its royalty figures, their emails so far, and the
// "Generate & Send Royalty Summary" button with live progress while n8n works.
import { chain, f, op, parent, text, state, dateFmt, rupees, groupData } from '../expr.mjs';
import { group, row, card, cell, flexCell, label, button, list, thingGroup, popup, showWhen, hideWhen, withStates, grow } from '../ui.mjs';
import { T, fill, border, pad, font, sideBorder } from '../theme.mjs';
import { PAGE, recordsOf, logsOf, inFlightOf, pendingRecords, overdueRecords } from '../queries.mjs';
import { statusBadge, sendBadge } from './badge.mjs';
import { progress } from './progress.mjs';
import { reviewFirst } from './authors.mjs';

const author = () => groupData('ad_pop_auth');
const a = (...ops) => chain(author(), ...ops);
const p = (...ops) => chain(parent(), ...ops);
const count = (e) => chain(e, op('count'));
const tabIs = (v) => (v === '' ? chain(state(PAGE, 'ad_tab'), op('is_empty')) : chain(state(PAGE, 'ad_tab'), op('equals', { args: v })));
const sum = (field) => chain(recordsOf(author()), f.num(field), op('sum'));

function stat(id, caption, value, tone = T.text1) {
  return group(id, [label(`${id}_l`, caption, 'micro'), label(`${id}_v`, value, font(20, 800, tone))], {
    gap: 2, props: { ...fill(T.panel2), ...border(T.border, 12), ...pad(12, 14), ...grow({ min_width_css: '120px' }) },
  });
}

function bookRow() {
  return thingGroup('ad_pb_row', 'royaltyrecord', parent(), [
    group('ad_pb_tcol', [
      label('ad_pb_title', text(p(f.thing('book', 'book'), f.text('title'))), 'strong'),
      label('ad_pb_meta', text(p(f.thing('book', 'book'), f.option('status', 'bookstatus'), op('display')), ' · last payout ', p(f.date('last_payout_date'), dateFmt('d mmm yyyy'), op('defaulting_to', { args: 'never' }))), 'hint'),
    ], { gap: 1, props: grow() }),
    cell('ad_pb_copies', text(p(f.num('copies_sold'))), 64, { align: 'right' }),
    cell('ad_pb_earned', rupees(p(f.num('earned'))), 92, { align: 'right' }),
    cell('ad_pb_paid', rupees(p(f.num('paid'))), 92, { align: 'right' }),
    cell('ad_pb_pend', rupees(p(f.num('pending'))), 92, { align: 'right', look: 'strong' }),
  ], { layout: 'row', gap: 8, props: { ...sideBorder('bottom'), ...pad(10, 14), vert_alignment: 'center' } });
}

function historyRow() {
  return thingGroup('ad_ph_row', 'notificationlog', parent(), [
    cell('ad_ph_when', text(p({ type: 'Message', name: 'Created Date', is_slidable: false }, dateFmt('d mmm yyyy, HH:MM'))), 140, { look: 'hint' }),
    group('ad_ph_st', [sendBadge('ad_ph_b', p(f.option('status', 'sendstatus'), op('display')))], { props: { width: 112, single_width: true, min_width_css: '112px' } }),
    flexCell('ad_ph_detail', text(p(f.text('subject'), op('defaulting_to', { args: chain(parent(), f.text('error')) }))), { look: 'cell' }),
  ], { layout: 'row', gap: 8, props: { ...sideBorder('bottom'), ...pad(10, 14), vert_alignment: 'center' } });
}

function tabs() {
  const tab = (id, caption, v) => withStates(button(id, caption, 'ghost', pad(6, 14)), [{ when: tabIs(v), set: { ...fill(T.panel), font_color: T.text1, border_color: T.border } }]);
  return row('ad_pa_tabs', [tab('ad_pa_tab_books', 'Books & royalties', ''), tab('ad_pa_tab_hist', text('Emails (', count(logsOf(author())), ')'), 'history')],
    { gap: 4, props: { ...fill(T.panel2), ...border(T.border, 999), ...pad(4), fit_width: true } });
}

function sendArea() {
  const live = chain(inFlightOf(author()), op('count'), op('greater_than', { args: 0 }));
  const first = (...ops) => chain(inFlightOf(author()), op('first_element'), ...ops);
  return card('ad_pa_send_card', [
    hideWhen(row('ad_pa_btns', [
      button('ad_pa_send', 'Generate & Send Royalty Summary', 'primary'),
      withStates(label('ad_pa_send_n', 'Written by AI, every figure checked, then sent to the demo inbox.', 'hint', grow()), [
        { when: reviewFirst(), set: { text: text('Review is on: you will see the draft and can edit it before it is sent.') } },
      ]),
    ], { gap: 12 }), live),
    showWhen(group('ad_pa_live', [label('ad_pa_live_t', 'Working on it', font(13, 800, T.brandInk)), progress('ad_pa_prog', first)], { gap: 6 }), live),
  ], { gap: 8, props: { ...fill(T.brandSoft), ...border(T.brandSoft, 14), ...pad(14, 16) } });
}

export function authorPopup() {
  return popup('ad_pop_auth', 'author', [
    row('ad_pa_head', [
      group('ad_pa_id', [
        label('ad_pa_name', text(a(f.text('name'))), 'h1'),
        label('ad_pa_meta', text(a(f.text('code')), ' · ', a(f.text('email')), ' · ', a(f.text('city'))), 'sub'),
      ], { gap: 2, props: grow() }),
      statusBadge('ad_pa_badge', count(pendingRecords(author())), count(overdueRecords(author()))),
      button('ad_pa_close', 'Close', 'ghost'),
    ], { gap: 12 }),
    row('ad_pa_stats', [
      stat('ad_pa_s1', 'EARNED', rupees(sum('earned'))),
      stat('ad_pa_s2', 'PAID', rupees(sum('paid')), '#0f8a4f'),
      stat('ad_pa_s3', 'PENDING', rupees(sum('pending')), T.brandInk),
    ], { gap: 10 }),
    sendArea(),
    tabs(),
    showWhen(card('ad_pa_books_card', [list('ad_pa_books', 'royaltyrecord', recordsOf(author()), bookRow())], { gap: 0, props: pad(0) }), tabIs('')),
    showWhen(card('ad_pa_hist_card', [
      list('ad_pa_hist', 'notificationlog', chain(logsOf(author()), op('limit_to', { args: 8 })), historyRow()),
      showWhen(label('ad_pa_hist_none', 'No emails yet.', 'sub', pad(16)), chain(logsOf(author()), op('count'), op('equals', { args: 0 }))),
    ], { gap: 0, props: pad(0) }), tabIs('history')),
  ], 900);
}
