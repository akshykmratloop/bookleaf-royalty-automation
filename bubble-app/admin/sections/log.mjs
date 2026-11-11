// Notification log: every send with its outcome, newest first. Rows update live as n8n reports.
import { chain, f, op, parent, search, text, dateFmt, sorted, yesNo } from '../expr.mjs';
import { group, row, cell, flexCell, label, button, list, thingGroup, showWhen } from '../ui.mjs';
import { sendBadge } from './badge.mjs';

export const LOG_LIMIT = 30;

const head = () => row('ad_l_head', [
  cell('ad_lh_when', 'WHEN', 120, { style: 'Text_label_' }),
  cell('ad_lh_author', 'AUTHOR', 150, { style: 'Text_label_' }),
  cell('ad_lh_mode', 'MODE', 64, { style: 'Text_label_' }),
  cell('ad_lh_status', 'STATUS', 104, { style: 'Text_label_' }),
  flexCell('ad_lh_detail', 'SUBJECT / REASON', { style: 'Text_label_' }),
  cell('ad_lh_fig', 'FIGURES', 70, { style: 'Text_label_', align: 'right' }),
  cell('ad_lh_cost', 'AI COST', 76, { style: 'Text_label_', align: 'right' }),
  cell('ad_lh_act', '', 72, { style: 'Text_label_' }),
], { gap: 8, style: 'Group_table_head_', props: { padding_top: 10, padding_bottom: 10, padding_left: 14, padding_right: 14 } });

const p = (...ops) => chain(parent(), ...ops);
const statusIs = (v) => p(f.option('status', 'sendstatus'), op('display'), op('equals', { args: v }));

function detail() {
  const t = text(p(f.text('subject'), op('defaulting_to', { args: '' })));
  const failedText = text(p(f.text('error'), op('defaulting_to', { args: 'Failed' })));
  return {
    ...flexCell('ad_l_detail', t, { style: 'Text_small_' }),
    states: { 0: { condition: statusIs('Failed'), properties: { text: failedText, font_color: 'var(--color_badgeredtext_default)' }, type: 'State' } },
  };
}

function logRow() {
  return thingGroup('ad_l_row', 'notificationlog', parent(), [
    cell('ad_l_when', text(p({ type: 'Message', name: 'Created Date', is_slidable: false }, dateFmt('d mmm, HH:MM'))), 120, { style: 'Text_small_' }),
    cell('ad_l_author', text(p(f.thing('author', 'author'), f.text('name'))), 150),
    cell('ad_l_mode', text(p(f.text('mode'))), 64, { style: 'Text_small_' }),
    group('ad_l_status', [sendBadge('ad_l_badge', p(f.option('status', 'sendstatus'), op('display')))], { props: { width: 104, single_width: true, min_width_css: '104px' } }),
    detail(),
    cell('ad_l_fig', text(p(f.num('figures_verified'))), 70, { align: 'right', style: 'Text_small_' }),
    cell('ad_l_cost', text(p(f.num('cost_usd'), op('is_empty'), yesNo('—', ['$', p(f.num('cost_usd'), op('format_number', { properties: { formatting_type: 'number', decimal_place: 4 }, slidable: true }))]))), 76, { align: 'right', style: 'Text_small_' }),
    group('ad_l_actcell', [
      showWhen(button('ad_l_view', 'Email', 'Button_ghost_'), p(f.text('email_html'), op('is_not_empty'))),
    ], { props: { width: 72, single_width: true, min_width_css: '72px' } }),
  ], { layout: 'row', gap: 8, style: 'Group_table_row_', props: { padding_top: 10, padding_bottom: 10, padding_left: 14, padding_right: 14, vert_alignment: 'center' } });
}

export function logSection() {
  const src = chain(search('notificationlog'), sorted('Created Date', true), op('limit_to', { args: LOG_LIMIT }));
  return group('ad_sec_log', [
    label('ad_log_h', 'Notification log', 'Text_h2_'),
    label('ad_log_d', 'Each request to n8n, newest first. Status changes from Processing to Sent or Failed as soon as n8n finishes; the page checks every few seconds.', 'Text_muted_'),
    group('ad_log_table', [head(), list('ad_l_rg', 'notificationlog', src, logRow())], { gap: 0 }),
  ], { gap: 12 });
}
