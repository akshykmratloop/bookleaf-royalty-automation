// Authors: name search, city filter, payout-status segmented filter, and one row per author with
// books, earned, pending, status pill, last email and actions.
import { chain, f, op, parent, text, state, rupees, dateFmt, yesNo } from '../expr.mjs';
import { group, row, card, cell, cellGroup, label, button, input, textDropdown, list, thingGroup, withStates, showWhen, hideWhen, hover, grow, fixedWidth } from '../ui.mjs';
import { T, fill, border, pad, font, sideBorder, shadow } from '../theme.mjs';
import { PAGE, settings, filteredAuthors, allCities, authorsWithPending, authorsOverdue, recordsOf, booksOf, logsOf, pendingRecords, overdueRecords, inFlightOf, draftOf } from '../queries.mjs';
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
    ], { gap: 4, props: { ...fill(T.inset), ...border(T.border, 12), ...pad(4), fit_width: true } }),
  ], { gap: 12 });
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

/**
 * Table columns, shared by the header and every row so they cannot drift: [key, caption, width, align].
 * Numbers are right-aligned (header too); text and badges are left-aligned. The status column gets 12px of
 * left padding so it never touches the right-aligned PENDING figure next to it.
 * Fixed widths + gaps leave the name column 178px in a 1280px window (942px of row), so a row stays on
 * one line and an email address wraps only at the " · " before it. STATUS fits the widest badge ("Fully paid").
 */
const COLS = { city: ['CITY', 84], books: ['BOOKS', 56, 'right'], earned: ['EARNED', 76, 'right'], pend: ['PENDING', 76, 'right'], status: ['STATUS', 112], last: ['LAST EMAIL', 112] };
const NAME_MIN = '160px';
const ACT_W = 184;
const ROW_GAP = 8;
const STATUS_PAD = { padding_left: 12 };
const tableRowProps = () => ({ ...sideBorder('bottom'), ...pad(12, 16) });
const col = (id, key, t, opts = {}) => cell(id, t, COLS[key][1], { align: COLS[key][2] ?? 'left', ...opts });

const head = () => row('ad_t_head', [
  label('ad_th_name', 'AUTHOR', 'micro', grow({ min_width_css: NAME_MIN })),
  ...Object.keys(COLS).map((k) => col(`ad_th_${k}`, k, COLS[k][0], { look: 'micro', props: k === 'status' ? STATUS_PAD : {} })),
  cell('ad_th_act', '', ACT_W, { look: 'micro' }),
], { gap: ROW_GAP, props: { ...fill(T.panel2), ...tableRowProps() } });

function lastEmail() {
  const last = chain(logsOf(parent()), op('first_element'));
  const t = text(chain(logsOf(parent()), op('count'), op('equals', { args: 0 }), yesNo('Never sent', [
    chain(last, f.option('status', 'sendstatus'), op('display')), ' · ', chain(last, { type: 'Message', name: 'Created Date', is_slidable: false }, dateFmt('d mmm')),
  ])));
  return col('ad_r_last', 'last', t, { look: 'hint' });
}

/** Actions: View, then one fixed-width slot (Send / Draft & review / Review draft / Working…), so both line up on every row. */
function actions() {
  const busy = chain(inFlightOf(parent()), op('count'), op('greater_than', { args: 0 }));
  const hasDraft = chain(draftOf(parent()), op('is_not_empty'));
  const slot = { ...pad(8, 12), ...fixedWidth(120) };
  const send = withStates(button('ad_r_send', 'Send', 'primary', slot), [{ when: reviewFirst(), set: { text: text('Draft & review') } }]);
  return row('ad_r_act', [
    button('ad_r_view', 'View', 'ghost', { ...pad(8, 8), ...fixedWidth(56) }),
    // A waiting draft is reviewed, not sent again: the row offers Review instead of Send.
    hideWhen(hideWhen(send, busy), hasDraft),
    showWhen(button('ad_r_rev', 'Review draft', 'soft', slot), hasDraft),
    showWhen(pill('ad_r_busy', text('Working…'), 'brand'), busy),
  ], { gap: 8, props: fixedWidth(ACT_W) });
}

function tableRow() {
  const p = (...ops) => chain(parent(), ...ops);
  const sum = (field) => rupees(chain(recordsOf(parent()), f.num(field), op('sum')));
  const r = thingGroup('ad_t_row', 'author', parent(), [
    group('ad_r_namecol', [
      label('ad_r_name', text(p(f.text('name'))), 'strong'),
      label('ad_r_code', text(p(f.text('code')), ' · ', p(f.text('email'))), 'hint'),
    ], { gap: 2, props: grow({ min_width_css: NAME_MIN }) }),
    col('ad_r_city', 'city', text(p(f.text('city')))),
    col('ad_r_books', 'books', text(count(booksOf(parent())))),
    col('ad_r_earned', 'earned', sum('earned')),
    col('ad_r_pend', 'pend', sum('pending'), { look: 'strong' }),
    cellGroup('ad_r_status', [statusBadge('ad_r_badge', count(pendingRecords(parent())), count(overdueRecords(parent())))], COLS.status[1], { props: STATUS_PAD }),
    lastEmail(),
    actions(),
  ], { layout: 'row', gap: ROW_GAP, props: tableRowProps() });
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
