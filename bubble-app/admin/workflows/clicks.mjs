// Click and page-load workflows: navigation, opening an author, sending (straight away or as a
// draft to review), bulk, email settings, system toggles, and the old-log cleanup.
import { chain, f, op, text, now, parent, search, value, groupData, dateFmt, sorted, state } from '../expr.mjs';
import { PAGE, settings } from '../queries.mjs';
import { VIEWS } from '../shell.mjs';
import { TOGGLES } from '../sections/settings.mjs';
import { TONES_CHOICES, LENGTHS } from '../sections/emailSettings.mjs';
import { reviewFirst } from '../sections/authors.mjs';
import { workflow, onClick, setState, trigger, show, hide, display, change, when, resetInputs, deleteList } from './actions.mjs';
import { openReview, newestLogOf } from './review.mjs';

export const KEEP_LOGS = 100;

const filterClick = (elementId, v) => onClick(`wf_${elementId}`, elementId, [setState(PAGE, 'status_filter', text(v))]);
const clearStyle = () => [setState(PAGE, 'cur_tone', text('')), setState(PAGE, 'cur_len', text('')), setState(PAGE, 'cur_note', text(''))];

/** Send for one author: a draft to review when "Review before sending" is on, otherwise straight away. */
function sendFor(id, elementId, authorExpr, fromDrawer) {
  const rf = reviewFirst();
  return onClick(id, elementId, [
    setState(PAGE, 'cur_author', authorExpr),
    setState(PAGE, 'cur_mode', text('single')),
    setState(PAGE, 'cur_delivery', text('send')),
    when(setState(PAGE, 'cur_delivery', text('draft')), rf),
    ...clearStyle(),
    trigger('send_one'),
    ...(fromDrawer ? [when(hide('ad_pop_auth'), rf)] : []),
    ...openReview(`${id}_rv`, newestLogOf(state(PAGE, 'cur_author'))).map((a) => when(a, rf)),
  ], 'Generate & Send Royalty Summary');
}

function pageLoad() {
  const s = () => chain(search('appsettings'), op('first_element'));
  const newest = () => chain(search('notificationlog'), sorted('Created Date', true));
  const tooMany = chain(search('notificationlog'), op('count'), op('greater_than', { args: KEEP_LOGS }));
  return workflow('ad_wf_refdate', 'PageLoaded', null, [
    setState(PAGE, 'ref_date', chain(s(), f.date('reference_date'))),
    when(setState(PAGE, 'ref_date', now()), chain(s(), f.bool('use_today'), op('is_true'))),
    // Free plan: 200 records in total. Keep the newest 100 log entries, delete older test entries.
    when(deleteList('notificationlog', chain(newest(), op('minus_list', { args: chain(newest(), op('limit_to', { args: KEEP_LOGS })) })), 'ad_wf_cleanup'), tooMany),
  ], 'Reference date and log cleanup');
}

function refresh() {
  return workflow('ad_wf_refresh', 'CustomEvent', { event_name: 'ad_wf_refresh' }, [
    setState(PAGE, 'ref_date', chain(settings(), f.date('reference_date'))),
    when(setState(PAGE, 'ref_date', now()), chain(settings(), f.bool('use_today'), op('is_true'))),
  ], 'ad_wf_refresh');
}

const toggles = () => TOGGLES.map(([id, , field]) =>
  onClick(`wf_${id}`, id, [
    change(settings(), { [`${field}_boolean`]: chain(settings(), f.bool(field), op('is_false')) }),
    ...(field === 'use_today' ? [trigger('ad_wf_refresh')] : []),
  ]));

const saveText = (elementId, field) => onClick(`wf_${elementId}_save`, `${elementId}_save`, [
  change(settings(), { [`${field}_text`]: text(value(elementId)) }),
], `Save ${field}`);

function emailSettings() {
  return [
    ...TONES_CHOICES.map(([k]) => onClick(`wf_ad_es_tone_${k}`, `ad_es_tone_${k}`, [change(settings(), { email_tone_text: text(k) })])),
    ...LENGTHS.map(([k]) => onClick(`wf_ad_es_len_${k}`, `ad_es_len_${k}`, [change(settings(), { email_length_text: text(k) })])),
    onClick('wf_ad_es_rev_btn', 'ad_es_rev_btn', [change(settings(), { review_first_boolean: chain(settings(), f.bool('review_first'), op('is_false')) })], 'Review before sending'),
    saveText('ad_es_note', 'email_note'),
    saveText('ad_es_sign', 'sign_off'),
  ];
}

function bulkStart(elementId, delivery) {
  return onClick(`wf_${elementId}`, elementId, [
    setState(PAGE, 'cur_batch', text('bulk-', chain(now(), dateFmt('yyyymmdd-HHMMss')))),
    setState(PAGE, 'cur_delivery', text(delivery)),
    ...clearStyle(),
    trigger('bulk_step'),
  ], `Bulk ${delivery}`);
}

export function clickWorkflows() {
  return [
    pageLoad(), refresh(),
    ...VIEWS.map(([key]) => onClick(`wf_ad_nav_${key}`, `ad_nav_${key}`, [setState(PAGE, 'view', text(key))])),
    filterClick('ad_f_all', ''), filterClick('ad_f_pend', 'pending'), filterClick('ad_f_over', 'overdue'), filterClick('ad_f_paid', 'paid'),
    onClick('wf_ad_r_view', 'ad_r_view', [setState(PAGE, 'ad_tab', text('')), display('ad_pop_auth', parent()), show('ad_pop_auth')], 'View author'),
    onClick('wf_ad_pa_tab_books', 'ad_pa_tab_books', [setState(PAGE, 'ad_tab', text(''))]),
    onClick('wf_ad_pa_tab_hist', 'ad_pa_tab_hist', [setState(PAGE, 'ad_tab', text('history'))]),
    sendFor('wf_ad_r_send', 'ad_r_send', parent(), false),
    sendFor('wf_ad_pa_send', 'ad_pa_send', groupData('ad_pop_auth'), true),
    onClick('wf_ad_pa_close', 'ad_pa_close', [hide('ad_pop_auth')]),
    onClick('wf_ad_l_view', 'ad_l_view', [display('ad_pop_mail', parent()), show('ad_pop_mail')], 'View email'),
    onClick('wf_ad_pm_close', 'ad_pm_close', [hide('ad_pop_mail')]),
    bulkStart('ad_bulk_btn', 'send'),
    bulkStart('ad_bulk_draft', 'draft'),
    onClick('wf_ad_set_inbox_save', 'ad_set_inbox_save', [
      when(change(settings(), { demo_inbox_text: text(value('ad_set_inbox')) }), chain(value('ad_set_inbox'), op('is_not_empty'))),
      resetInputs(),
    ], 'Save demo inbox'),
    ...emailSettings(),
    ...toggles(),
  ];
}
