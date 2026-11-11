// Overview: page header, headline numbers, charts, bulk send and the latest activity.
import { chain, f, op, text, search, sorted, parent, dateFmt, rupees, inr } from '../expr.mjs';
import { group, row, card, label, icon, list, thingGroup, grow } from '../ui.mjs';
import { T, TONES, fill, border, pad, font, sideBorder } from '../theme.mjs';
import { logsWithStatus, authorsWithPending } from '../queries.mjs';
import { payChart, outcomesChart } from './charts.mjs';
import { sendBadge } from './badge.mjs';
import { bulkCard } from './bulk.mjs';

const count = (expr) => chain(expr, op('count'));
const sumOf = (field) => chain(search('royaltyrecord'), f.num(field), op('sum'));
const spend = () => chain(search('notificationlog'), f.num('cost_usd'), op('sum'));
const usd = (expr) => text('$', chain(expr, op('format_number', { properties: { formatting_type: 'number', decimal_place: 3 }, slidable: true })));

/** Page heading used by every view. */
export const pageHeader = (id, title, subtitle) =>
  group(id, [label(`${id}_t`, title, 'h1'), label(`${id}_s`, subtitle, 'sub')], { gap: 4 });

function kpi(id, caption, value, note, iconName, tone = 'brand') {
  const chip = group(`${id}_c`, [icon(`${id}_i`, iconName, TONES[tone][0], 18)], {
    props: { ...fill(TONES[tone][1]), ...border(TONES[tone][1], 10), width: 34, height: 34, single_width: true, single_height: true, min_width_css: '34px', min_height_css: '34px', fit_height: false, vert_alignment: 'center', horiz_alignment: 'center' },
  });
  return card(id, [
    row(`${id}_top`, [label(`${id}_l`, caption, 'micro', grow()), chip], { gap: 8 }),
    label(`${id}_v`, value, 'kpi'),
    label(`${id}_n`, note, 'hint'),
  ], { gap: 6, props: { ...grow({ min_width_css: '170px' }), fit_height: true, ...pad(16, 18) } });
}

export function kpis() {
  return row('ad_kpis', [
    kpi('ad_k_auth', 'AUTHORS', text(count(search('author'))), text(count(search('book')), ' books in the catalogue'), 'users-three', 'info'),
    kpi('ad_k_earned', 'TOTAL EARNED', rupees(sumOf('earned')), text('₹', chain(sumOf('paid'), ...inr()), ' already paid out'), 'trend-up', 'success'),
    kpi('ad_k_pend', 'PENDING PAYOUTS', rupees(sumOf('pending')), text(count(authorsWithPending()), ' authors are owed money'), 'hourglass-medium', 'warning'),
    kpi('ad_k_sent', 'EMAILS SENT', text(count(logsWithStatus('Sent'))), text(count(logsWithStatus('Failed')), ' failed · ', count(logsWithStatus('Draft ready')), ' drafts waiting'), 'paper-plane-tilt', 'brand'),
    kpi('ad_k_ai', 'AI SPEND', usd(spend()), text('Exact cost from each provider\'s token usage'), 'sparkle', 'info'),
  ], { gap: 14, props: { vert_alignment: 'stretch' } });
}

function chartsRow() {
  return row('ad_charts', [
    card('ad_ch_pay', [
      label('ad_ch_pay_h', 'Paid vs pending, by author', 'h2'),
      label('ad_ch_pay_s', 'Royalties in rupees. Hover a bar for the exact amounts.', 'hint'),
      payChart('ad_ch_pay_c'),
    ], { gap: 6, props: grow({ min_width_css: '360px' }) }),
    card('ad_ch_out', [
      label('ad_ch_out_h', 'Email outcomes', 'h2'),
      label('ad_ch_out_s', 'Every royalty email requested so far.', 'hint'),
      outcomesChart('ad_ch_out_c'),
    ], { gap: 6, props: { width: 340, single_width: true, min_width_css: '300px' } }),
  ], { gap: 14, props: { vert_alignment: 'stretch' } });
}

function activityRow() {
  const p = (...ops) => chain(parent(), ...ops);
  return thingGroup('ad_act_row', 'notificationlog', parent(), [
    group('ad_act_txt', [
      label('ad_act_who', text(p(f.thing('author', 'author'), f.text('name'))), 'strong'),
      label('ad_act_when', text(p({ type: 'Message', name: 'Created Date', is_slidable: false }, dateFmt('d mmm, HH:MM')), ' · ', p(f.text('mode')), ' · ', p(f.text('delivery'), op('defaulting_to', { args: 'send' }))), 'hint'),
    ], { gap: 1, props: grow() }),
    sendBadge('ad_act_b', p(f.option('status', 'sendstatus'), op('display'))),
  ], { layout: 'row', gap: 10, props: { ...sideBorder('bottom'), ...pad(10, 0), vert_alignment: 'center' } });
}

function activityCard() {
  const src = chain(search('notificationlog'), sorted('Created Date', true), op('limit_to', { args: 6 }));
  return card('ad_act', [
    label('ad_act_h', 'Latest activity', 'h2'),
    list('ad_act_rg', 'notificationlog', src, activityRow()),
  ], { gap: 6, props: { width: 340, single_width: true, min_width_css: '300px' } });
}

export function overviewSection() {
  return group('ad_v_overview', [
    pageHeader('ad_ov_hdr', 'Royalty operations', 'Every author, what they are owed, and every royalty email the AI has written for them.'),
    kpis(),
    chartsRow(),
    row('ad_ov_bottom', [bulkCard(), activityCard()], { gap: 14, props: { vert_alignment: 'stretch' } }),
  ], { gap: 20 });
}
