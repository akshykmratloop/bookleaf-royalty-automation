// Button workflows: filters, view / send from the table and popup, bulk start, settings.
import { chain, f, op, text, now, parent, search, value, groupData, dateFmt } from '../expr.mjs';
import { PAGE, settings } from '../queries.mjs';
import { TOGGLES } from '../sections/settings.mjs';
import { workflow, onClick, setState, trigger, show, hide, display, change, when, resetInputs } from './actions.mjs';

const filterClick = (elementId, v) => onClick(`wf_${elementId}`, elementId, [setState(PAGE, 'status_filter', text(v))]);

/** Send for one author: remember who, single mode, then run send_one. */
const sendFor = (id, elementId, authorExpr) =>
  onClick(id, elementId, [setState(PAGE, 'cur_author', authorExpr), setState(PAGE, 'cur_mode', text('single')), trigger('send_one')], 'Send royalty summary');

function refDateOnLoad() {
  const s = () => chain(search('appsettings'), op('first_element'));
  return workflow('ad_wf_refdate', 'PageLoaded', null, [
    setState(PAGE, 'ref_date', chain(s(), f.date('reference_date'))),
    when(setState(PAGE, 'ref_date', now()), chain(s(), f.bool('use_today'), op('is_true'))),
  ], 'Reference date');
}

function toggles() {
  return TOGGLES.map(([id, , field]) =>
    onClick(`wf_${id}`, id, [
      change(settings(), { [`${field}_boolean`]: chain(settings(), f.bool(field), op('is_false')) }),
      ...(field === 'use_today' ? [trigger('ad_wf_refresh')] : []),
    ]));
}

/** Re-reads the reference date after the "use today" switch. */
function refresh() {
  return workflow('ad_wf_refresh', 'CustomEvent', { event_name: 'ad_wf_refresh' }, [
    setState(PAGE, 'ref_date', chain(settings(), f.date('reference_date'))),
    when(setState(PAGE, 'ref_date', now()), chain(settings(), f.bool('use_today'), op('is_true'))),
  ], 'ad_wf_refresh');
}

export function clickWorkflows() {
  return [
    refDateOnLoad(),
    refresh(),
    filterClick('ad_f_all', ''),
    filterClick('ad_f_pend', 'pending'),
    filterClick('ad_f_over', 'overdue'),
    filterClick('ad_f_paid', 'paid'),
    onClick('wf_ad_r_view', 'ad_r_view', [display('ad_pop_auth', parent()), show('ad_pop_auth')], 'View author'),
    sendFor('wf_ad_r_send', 'ad_r_send', parent()),
    sendFor('wf_ad_pa_send', 'ad_pa_send', groupData('ad_pop_auth')),
    onClick('wf_ad_pa_close', 'ad_pa_close', [hide('ad_pop_auth')]),
    onClick('wf_ad_l_view', 'ad_l_view', [display('ad_pop_mail', parent()), show('ad_pop_mail')], 'View email'),
    onClick('wf_ad_pm_close', 'ad_pm_close', [hide('ad_pop_mail')]),
    onClick('wf_ad_bulk_btn', 'ad_bulk_btn', [
      setState(PAGE, 'cur_batch', text('bulk-', chain(now(), dateFmt('yyyymmdd-HHMMss')))),
      trigger('bulk_step'),
    ], 'Bulk send'),
    onClick('wf_ad_set_inbox_save', 'ad_set_inbox_save', [
      when(change(settings(), { demo_inbox_text: text(value('ad_set_inbox')) }), chain(value('ad_set_inbox'), op('is_not_empty'))),
      resetInputs(),
    ], 'Save demo inbox'),
    ...toggles(),
  ];
}
