// Authors table: name search, city filter, payout-status filter, one row per author with
// books, earned, pending, status badge, last statement and the send / view actions.
import { chain, f, op, parent, text, state, rupees, dateFmt, yesNo } from '../expr.mjs';
import { group, row, cell, flexCell, label, button, input, textDropdown, list, thingGroup, withStates, showWhen, hideWhen } from '../ui.mjs';
import { PAGE, filteredAuthors, allCities, authorsWithPending, authorsOverdue, recordsOf, booksOf, logsOf, pendingRecords, overdueRecords, inFlightOf } from '../queries.mjs';
import { statusBadge } from './badge.mjs';

const filterIs = (v) => chain(state(PAGE, 'status_filter'), op('equals', { args: v }));
const count = (e) => chain(e, op('count'));

/** Segmented control: All / Has pending / Overdue / All paid. */
function chip(id, caption, v) {
  const active = v === '' ? chain(state(PAGE, 'status_filter'), op('is_empty')) : filterIs(v);
  return withStates(button(id, caption, 'Button_ghost_'), [
    { when: active, set: { bgcolor: 'var(--color_blprimarysoft_default)', font_color: 'var(--color_blprimary_default)', border_color: 'var(--color_blprimary_default)' } },
  ]);
}

export function filters() {
  return row('ad_filters', [
    input('ad_q', 'Search authors by name'),
    textDropdown('ad_city', 'All cities', allCities()),
    row('ad_chips', [
      chip('ad_f_all', 'All', ''),
      chip('ad_f_pend', 'Has pending', 'pending'),
      chip('ad_f_over', 'Overdue', 'overdue'),
      chip('ad_f_paid', 'Fully paid', 'paid'),
    ], { gap: 8, props: { min_width_css: '380px' } }),
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

const head = () => row('ad_t_head', [
  label('ad_th_name', 'AUTHOR', 'Text_label_', { fit_width: false, min_width_css: '190px', vert_alignment: 'center' }),
  cell('ad_th_city', 'CITY', 100, { style: 'Text_label_' }),
  cell('ad_th_books', 'BOOKS', 56, { style: 'Text_label_', align: 'right' }),
  cell('ad_th_earned', 'EARNED', 96, { style: 'Text_label_', align: 'right' }),
  cell('ad_th_pend', 'PENDING', 96, { style: 'Text_label_', align: 'right' }),
  cell('ad_th_status', 'STATUS', 96, { style: 'Text_label_' }),
  cell('ad_th_last', 'LAST STATEMENT', 120, { style: 'Text_label_' }),
  cell('ad_th_act', '', 176, { style: 'Text_label_' }),
], { gap: 8, style: 'Group_table_head_', props: { padding_top: 10, padding_bottom: 10, padding_left: 14, padding_right: 14 } });

function lastStatement() {
  const last = chain(logsOf(parent()), op('first_element'));
  const t = text(
    chain(logsOf(parent()), op('count'), op('equals', { args: 0 }), yesNo('Never sent', [
      chain(last, f.option('status', 'sendstatus'), op('display')), ' · ', chain(last, { type: 'Message', name: 'Created Date', is_slidable: false }, dateFmt('d mmm, HH:MM')),
    ])),
  );
  return cell('ad_r_last', t, 120, { style: 'Text_small_' });
}

function actions() {
  const busy = chain(inFlightOf(parent()), op('count'), op('greater_than', { args: 0 }));
  return row('ad_r_act', [
    button('ad_r_view', 'View', 'Button_ghost_'),
    hideWhen(button('ad_r_send', 'Send', 'Button_primary_'), busy),
    showWhen(label('ad_r_busy', 'Sending…', 'Text_small_', { vert_alignment: 'center' }), busy),
  ], { gap: 8, props: { width: 176, single_width: true, min_width_css: '176px' } });
}

function tableRow() {
  return thingGroup('ad_t_row', 'author', parent(), [
    group('ad_r_namecol', [
      label('ad_r_name', text(chain(parent(), f.text('name'))), 'Text_bold_'),
      label('ad_r_code', text(chain(parent(), f.text('code')), ' · ', chain(parent(), f.text('email'))), 'Text_small_'),
    ], { gap: 2, props: { fit_width: false, min_width_css: '190px' } }),
    cell('ad_r_city', text(chain(parent(), f.text('city'))), 100),
    cell('ad_r_books', text(count(booksOf(parent()))), 56, { align: 'right' }),
    cell('ad_r_earned', rupees(chain(recordsOf(parent()), f.num('earned'), op('sum'))), 96, { align: 'right' }),
    cell('ad_r_pend', rupees(chain(recordsOf(parent()), f.num('pending'), op('sum'))), 96, { align: 'right' }),
    group('ad_r_status', [statusBadge('ad_r_badge', count(pendingRecords(parent())), count(overdueRecords(parent())))], { props: { width: 96, single_width: true, min_width_css: '96px' } }),
    lastStatement(),
    actions(),
  ], { layout: 'row', gap: 8, style: 'Group_table_row_', props: { padding_top: 12, padding_bottom: 12, padding_left: 14, padding_right: 14, vert_alignment: 'center' } });
}

export function authorsTable() {
  const src = tableSource();
  const rg = withStates(list('ad_t_rg', 'author', src.base, tableRow()), src.states);
  return group('ad_sec_auth', [
    label('ad_auth_h', 'Authors', 'Text_h2_'),
    filters(),
    group('ad_table', [head(), rg], { gap: 0 }),
    showWhen(label('ad_t_empty', 'No authors match these filters.', 'Text_muted_'), chain({ type: 'GetElement', is_slidable: false, properties: { element_id: 'ad_t_rg' } }, op('get_list_data'), op('count'), op('equals', { args: 0 }))),
  ], { gap: 16 });
}
