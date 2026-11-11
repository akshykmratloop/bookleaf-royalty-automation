// Notification log: every request to n8n with its outcome, newest first. Rows still on their way
// show the live progress stepper; finished rows show the subject or the failure reason.
import { chain, f, op, parent, search, text, dateFmt, sorted, yesNo } from '../expr.mjs';
import { group, row, card, cell, flexCell, label, button, list, thingGroup, showWhen, hideWhen, withStates, hover, grow } from '../ui.mjs';
import { T, TONES, fill, pad, sideBorder } from '../theme.mjs';
import { sendBadge } from './badge.mjs';
import { progress, isLive } from './progress.mjs';
import { pageHeader } from './overview.mjs';

export const LOG_LIMIT = 40;

const head = () => row('ad_l_head', [
  cell('ad_lh_when', 'WHEN', 104, { look: 'micro' }),
  cell('ad_lh_author', 'AUTHOR', 140, { look: 'micro' }),
  cell('ad_lh_mode', 'TYPE', 92, { look: 'micro' }),
  cell('ad_lh_status', 'STATUS', 112, { look: 'micro' }),
  flexCell('ad_lh_detail', 'SUBJECT, PROGRESS OR REASON', { look: 'micro' }),
  cell('ad_lh_fig', 'FIGURES', 64, { look: 'micro', align: 'right' }),
  cell('ad_lh_cost', 'AI COST', 70, { look: 'micro', align: 'right' }),
  cell('ad_lh_act', '', 76, { look: 'micro' }),
], { gap: 8, props: { ...fill(T.panel2), ...sideBorder('bottom'), ...pad(12, 16) } });

const p = (...ops) => chain(parent(), ...ops);
const statusIs = (v) => p(f.option('status', 'sendstatus'), op('display'), op('equals', { args: v }));

function detail() {
  const live = isLive(p);
  const subject = withStates(flexCell('ad_l_subj', text(p(f.text('subject'), op('defaulting_to', { args: '' }))), { look: 'cell' }), [
    { when: statusIs('Failed'), set: { text: text(p(f.text('error'), op('defaulting_to', { args: 'Failed' }))), font_color: TONES.danger[0] } },
  ]);
  return group('ad_l_detail', [hideWhen(subject, live), showWhen(progress('ad_l_prog', p), live)], { props: grow() });
}

function logRow() {
  const r = thingGroup('ad_l_row', 'notificationlog', parent(), [
    cell('ad_l_when', text(p({ type: 'Message', name: 'Created Date', is_slidable: false }, dateFmt('d mmm, HH:MM'))), 104, { look: 'hint' }),
    cell('ad_l_author', text(p(f.thing('author', 'author'), f.text('name'))), 140, { look: 'strong' }),
    cell('ad_l_mode', text(p(f.text('mode')), ' · ', p(f.text('delivery'), op('defaulting_to', { args: 'send' }))), 92, { look: 'hint' }),
    group('ad_l_status', [sendBadge('ad_l_badge', p(f.option('status', 'sendstatus'), op('display')))], { props: { width: 112, single_width: true, min_width_css: '112px' } }),
    detail(),
    cell('ad_l_fig', text(p(f.num('figures_verified'))), 64, { align: 'right' }),
    cell('ad_l_cost', text(p(f.num('cost_usd'), op('is_empty'), yesNo('—', ['$', p(f.num('cost_usd'), op('format_number', { properties: { formatting_type: 'number', decimal_place: 4 }, slidable: true }))]))), 70, { align: 'right', look: 'hint' }),
    group('ad_l_actcell', [
      withStates(showWhen(button('ad_l_view', 'Email', 'ghost', pad(6, 10)), p(f.text('email_html'), op('is_not_empty'))), [{ when: statusIs('Draft ready'), set: { is_visible: false } }]),
      showWhen(button('ad_l_rev', 'Review', 'soft', pad(6, 10)), statusIs('Draft ready')),
    ], { props: { width: 76, single_width: true, min_width_css: '76px' } }),
  ], { layout: 'row', gap: 8, props: { ...sideBorder('bottom'), ...pad(11, 16), vert_alignment: 'center' } });
  return hover(r, fill(T.panel2));
}

export function logSection() {
  const src = chain(search('notificationlog'), sorted('Created Date', true), op('limit_to', { args: LOG_LIMIT }));
  return group('ad_v_log', [
    pageHeader('ad_lg_hdr', 'Notification log', 'Every request to n8n, newest first. Rows in progress show each step live; the page checks n8n every 3 seconds.'),
    card('ad_log_table', [head(), list('ad_l_rg', 'notificationlog', src, logRow())], { gap: 0, props: pad(0) }),
    label('ad_log_note', `Showing the newest ${LOG_LIMIT}. Older test entries are cleared automatically to stay inside the free plan's 200-record limit.`, 'hint'),
  ], { gap: 16 });
}
