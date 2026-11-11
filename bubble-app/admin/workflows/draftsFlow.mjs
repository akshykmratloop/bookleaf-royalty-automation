// Drafts list workflows: approve or discard one draft as written, and "Approve all", which works
// through the drafts one at a time (same pattern as bulk send). A draft the checker refuses is
// marked "needs review" so the loop moves on instead of retrying it forever.
import { chain, f, op, text, parent } from '../expr.mjs';
import { PAGE, logsWithStatus } from '../queries.mjs';
import { onClick, customEvent, setState, trigger, schedule, change, when } from './actions.mjs';
import { approveCall, okOf, notOkOf, reasonOf, markSending, markDiscarded } from './approve.mjs';

/** Drafts that can be approved as they are (not ones the checker already refused). */
const approvable = () => chain(logsWithStatus('Draft ready'), op('filtered', {
  properties: { constraints: { 0: { key: '_advanced_search_constraint', value: chain({ type: 'InjectedValue', is_slidable: false }, f.text('stage'), op('equals', { args: 'drafted' })) } } },
}));
const nextDraft = () => chain(approvable(), op('first_element'));
const left = () => chain(approvable(), op('count'), op('greater_than', { args: 0 }));

/** Approve one log as written: its own subject and edit text go back to n8n for the final check. */
function approveSteps(prefix, logExpr) {
  const l = (...ops) => chain(logExpr, ...ops);
  const c = `${prefix}_call`;
  return [
    approveCall(c, l, 'send', l(f.text('subject')), l(f.text('edit_text'))),
    when(markSending(logExpr, `${prefix}_ok`), okOf(c)),
    when(change(logExpr, { stage_text: text('needs_review'), issues_text: reasonOf(c) }, `${prefix}_err`), notOkOf(c)),
  ];
}

function approveStep() {
  return customEvent('approve_step', [
    ...approveSteps('approve_step', nextDraft()),
    when(schedule('approve_step', 1.5, 'approve_step_next'), left()),
    when(setState(PAGE, 'approving_all', text(''), 'approve_step_done'), chain(approvable(), op('count'), op('equals', { args: 0 }))),
  ]);
}

export function draftWorkflows() {
  const c = 'd_discard_call';
  return [
    approveStep(),
    onClick('wf_ad_d_approve', 'ad_d_approve', approveSteps('d_approve', parent()), 'Approve draft as written'),
    onClick('wf_ad_d_discard', 'ad_d_discard', [
      approveCall(c, (...ops) => chain(parent(), ...ops), 'discard'),
      when(markDiscarded(parent(), 'd_discard_mark'), okOf(c)),
    ], 'Discard draft'),
    onClick('wf_ad_dr_all', 'ad_dr_all', [
      setState(PAGE, 'approving_all', text('yes'), 'dr_all_flag'),
      trigger('approve_step', 'dr_all_go'),
    ], 'Approve all drafts'),
  ];
}

