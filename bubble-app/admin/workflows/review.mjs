// Review drawer workflows: check edits, approve & send, discard, regenerate with another tone or
// length, and opening the drawer from the Drafts list, the log, or right after a draft is requested.
import { chain, f, op, text, value, groupData, parent, state, search, sorted } from '../expr.mjs';
import { PAGE } from '../queries.mjs';
import { onClick, setState, trigger, show, hide, display, when } from './actions.mjs';
import { approveCall, out, okOf, notOkOf, reasonOf, markSending, markDiscarded } from './approve.mjs';
import { TONES_CHOICES, LENGTHS } from '../sections/emailSettings.mjs';
import { rvTone, rvLength } from '../sections/reviewDrawer.mjs';

const log = (...ops) => chain(groupData('ad_pop_rev'), ...ops);

/** Clear what a previous check left behind. */
export const resetReview = (prefix) => [
  setState(PAGE, 'rv_checked', text(''), `${prefix}_r1`),
  setState(PAGE, 'rv_issues', text(''), `${prefix}_r2`),
  setState(PAGE, 'rv_preview', text(''), `${prefix}_r3`),
  setState(PAGE, 'rv_tone', text(''), `${prefix}_r4`),
  setState(PAGE, 'rv_len', text(''), `${prefix}_r5`),
];

/** Open the drawer on a log. */
export const openReview = (prefix, logExpr) => [...resetReview(prefix), display('ad_pop_rev', logExpr), show('ad_pop_rev')];

/** The newest log of an author: the one send_one just created. */
export const newestLogOf = (authorExpr) =>
  chain(search('notificationlog', [['author_custom_author', 'equals', authorExpr]]), sorted('Created Date', true), op('first_element'));

function check() {
  const c = 'rv_check_call';
  return onClick('wf_ad_rv_check', 'ad_rv_check', [
    approveCall(c, log, 'check', value('ad_rv_subj'), value('ad_rv_body')),
    setState(PAGE, 'rv_checked', text('yes'), 'rv_check_s1'),
    setState(PAGE, 'rv_preview', text(out(c, op('_api_c2_html'))), 'rv_check_s2'),
    setState(PAGE, 'rv_issues', text(''), 'rv_check_s3'),
    when(setState(PAGE, 'rv_issues', reasonOf(c), 'rv_check_s4'), chain(notOkOf(c), op('or_', { args: out(c, op('_api_c2_passed'), op('is_false')) }))),
  ], 'Check edits');
}

function approve() {
  const c = 'rv_approve_call';
  return onClick('wf_ad_rv_approve', 'ad_rv_approve', [
    approveCall(c, log, 'send', value('ad_rv_subj'), value('ad_rv_body')),
    when(markSending(groupData('ad_pop_rev'), 'rv_approve_mark', { subject_text: text(value('ad_rv_subj')), edit_text_text: text(value('ad_rv_body')) }), okOf(c)),
    when(hide('ad_pop_rev'), okOf(c)),
    when(setState(PAGE, 'rv_issues', reasonOf(c), 'rv_approve_err'), notOkOf(c)),
  ], 'Approve & send');
}

function discard() {
  const c = 'rv_discard_call';
  return onClick('wf_ad_rv_discard', 'ad_rv_discard', [
    approveCall(c, log, 'discard'),
    when(markDiscarded(groupData('ad_pop_rev'), 'rv_discard_mark'), okOf(c)),
    when(hide('ad_pop_rev'), okOf(c)),
    when(setState(PAGE, 'rv_issues', reasonOf(c), 'rv_discard_err'), notOkOf(c)),
  ], 'Discard draft');
}

/** New draft for the same author with the tone/length picked in the drawer; the old one is discarded. */
function regenerate() {
  const c = 'rv_regen_call';
  const authorOfLog = log(op('author_custom_author'));
  return onClick('wf_ad_rv_regen', 'ad_rv_regen', [
    setState(PAGE, 'cur_tone', text(rvTone()), 'rv_regen_t'),
    setState(PAGE, 'cur_len', text(rvLength()), 'rv_regen_l'),
    setState(PAGE, 'cur_note', text(value('ad_rv_note')), 'rv_regen_n'),
    setState(PAGE, 'cur_author', authorOfLog, 'rv_regen_a'),
    setState(PAGE, 'cur_mode', text('single'), 'rv_regen_m'),
    setState(PAGE, 'cur_delivery', text('draft'), 'rv_regen_d'),
    approveCall(c, log, 'discard'),
    markDiscarded(groupData('ad_pop_rev'), 'rv_regen_mark'),
    trigger('send_one', 'rv_regen_send'),
    ...openReview('rv_regen', newestLogOf(state(PAGE, 'cur_author'))),
  ], 'Regenerate draft');
}

const chips = () => [
  ...TONES_CHOICES.map(([k]) => onClick(`wf_ad_rv_tone_${k}`, `ad_rv_tone_${k}`, [setState(PAGE, 'rv_tone', text(k))])),
  ...LENGTHS.map(([k]) => onClick(`wf_ad_rv_len_${k}`, `ad_rv_len_${k}`, [setState(PAGE, 'rv_len', text(k))])),
];

export function reviewWorkflows() {
  return [
    check(), approve(), discard(), regenerate(), ...chips(),
    onClick('wf_ad_rv_close', 'ad_rv_close', [hide('ad_pop_rev')]),
    onClick('wf_ad_l_rev', 'ad_l_rev', openReview('l_rev', parent()), 'Review draft from log'),
    onClick('wf_ad_d_review', 'ad_d_review', openReview('d_rev', parent()), 'Review draft'),
  ];
}

