// Authors: name search, city filter, payout-status segmented filter, and one row per author with
// books, earned, pending, status pill, last email and actions.
import { chain, f, op, parent, text, state, rupees, dateFmt, yesNo } from '../expr.mjs';
import { group, row, card, cell, label, button, input, textDropdown, list, thingGroup, withStates, showWhen, hideWhen, hover, grow } from '../ui.mjs';
import { T, fill, border, pad, font, sideBorder, shadow } from '../theme.mjs';
import { PAGE, settings, filteredAuthors, allCities, authorsWithPending, authorsOverdue, recordsOf, booksOf, logsOf, pendingRecords, overdueRecords, inFlightOf } from '../queries.mjs';
import { statusBadge, pill } from './badge.mjs';
import { pageHeader } from './overview.mjs';

const filterIs = (v) => chain(state(PAGE, 'status_filter'), op('equals', { args: v }));
const count = (e) => chain(e, op('count'));
export const reviewFirst = () => chain(settings(), f.bool('review_first'), op('is_true'));

/** One option of the segmented control. */
function chip(id, caption, v) {
  const active = v === '' ? chain(state(PAGE, 'status_filter'), op('is_empty')) : filterIs(v);
  const look = { ...fill('rgba(0,0,0,0)'), ...border('rgba(0,0,0,0)', 8), ...font(12.5, 700, T.text2), ...pad(6, 12) };
  return withStates(hover(button(id, caption, 'ghost', look), { font_color: T.text1 }), [
    { when: active, set: { ...fill(T.panel), font_color: T.text1, ...shadow('soft') } },
  ]);
}

export function filters() {
  return row('ad_filters', [
    input('ad_q', 'Search authors by name', grow({ min_width_css: '200px' })),
    textDropdown('ad_city', 'All cities', allCities()),
    row('ad_chips', [
      chip('ad_f_all', 'All', ''), chip('ad_f_pend', 'Pending', 'pending'),
      chip('ad_f_over', 'Overdue', 'overdue'), chip('ad_f_paid', 'Fully paid', 'paid'),
    ], { gap: 2, props: { ...fill(T.inset), ...border(T.border, 12), ...pad(3), fit_width: true } }),
  ], { gap: 10 });
}

/** The table's list: base filter, then intersected with the chosen payout status. */
function tableSource() {
  const base = filteredAuthors('ad_q', 'ad_city');
  return {
    base,
    states: [
      { when: filterIs('pending'), set: { data_source: chain(base, op('intersect_with', { args: authorsWithPending() })) } },
      { when: filterIs('overdue'), set: { data_source: chain(base, op('intersect_with', { args: authorsOverdue() })) } },
      { when: filterIs('paid'), set: { data_source: chain(base, op('minus_list', { args: authorsWithPending() })) } },
    ],
  };
}

const COLS = [['city', 'CITY', 100], ['books', 'BOOKS', 56, 'right'], ['earned', 'EARNED', 100, 'right'], ['pend', 'PENDING', 100, 'right'], ['status', 'STATUS', 104], ['last', 'LAST EMAIL', 130]];

const head = () => row('ad_t_head', [
  label('ad_th_name', 'AUTHOR', 'micro', grow({ min_width_css: '190px' })),
  ...COLS.map(([k, cap, w, align]) => cell(`ad_th_${k}`, cap, w, { look: 'micro', align })),
  cell('ad_th_act', '', 196, { look: 'micro' }),
], { gap: 8, props: { ...fill(T.panel2), ...sideBorder('bottom'), ...pad(12, 16) } });

function lastEmail() {
  const last = chain(logsOf(parent()), op('first_element'));
  const t = text(chain(logsOf(parent()), op('count'), op('equals', { args: 0 }), yesNo('Never sent', [
    chain(last, f.option('status', 'sendstatus'), op('display')), ' · ', chain(last, { type: 'Message', name: 'Created Date', is_slidable: false }, dateFmt('d mmm')),
  ])));
  return cell('ad_r_last', t, 130, { look: 'hint' });
}

function actions() {
  const busy = chain(inFlightOf(parent()), op('count'), op('greater_than', { args: 0 }));
  const send = withStates(button('ad_r_send', 'Send', 'primary', pad(7, 12)), [{ when: reviewFirst(), set: { text: text('Draft & review') } }]);
  return row('ad_r_act', [
    button('ad_r_view', 'View', 'ghost', pad(7, 10)),
    hideWhen(send, busy),
    showWhen(pill('ad_r_busy', text('Working…'), 'brand'), busy),
  ], { gap: 6, props: { width: 196, single_width: true, min_width_css: '196px' } });
}

function tableRow() {
  const p = (...ops) => chain(parent(), ...ops);
  const r = thingGroup('ad_t_row', 'author', parent(), [
    group('ad_r_namecol', [
      label('ad_r_name', text(p(f.text('name'))), 'strong'),
      label('ad_r_code', text(p(f.text('code')), ' · ', p(f.text('email'))), 'hint'),
    ], { gap: 1, props: grow({ min_width_css: '190px' }) }),
    cell('ad_r_city', text(p(f.text('city'))), 100),
    cell('ad_r_books', text(count(booksOf(parent()))), 56, { align: 'right' }),
    cell('ad_r_earned', rupees(chain(recordsOf(parent()), f.num('earned'), op('sum'))), 100, { align: 'right' }),
    cell('ad_r_pend', rupees(chain(recordsOf(parent()), f.num('pending'), op('sum'))), 100, { align: 'right', look: 'strong' }),
    group('ad_r_status', [statusBadge('ad_r_badge', count(pendingRecords(parent())), count(overdueRecords(parent())))], { props: { width: 104, single_width: true, min_width_css: '104px' } }),
    lastEmail(),
    actions(),
  ], { layout: 'row', gap: 8, props: { ...sideBorder('bottom'), ...pad(12, 16), vert_alignment: 'center' } });
  return hover(r, fill(T.panel2));
}

export function authorsSection() {
  const src = tableSource();
  const rg = withStates(list('ad_t_rg', 'author', src.base, tableRow()), src.states);
  const none = chain({ type: 'GetElement', is_slidable: false, properties: { element_id: 'ad_t_rg' } }, op('get_list_data'), op('count'), op('equals', { args: 0 }));
  return group('ad_v_authors', [
    pageHeader('ad_au_hdr', 'Authors', 'Search, filter by city or payout status, open an author, or send their royalty summary.'),
    filters(),
    card('ad_table', [head(), rg, showWhen(label('ad_t_empty', 'No authors match these filters.', 'sub', pad(24)), none)], { gap: 0, props: pad(0) }),
  ], { gap: 16 });
}
