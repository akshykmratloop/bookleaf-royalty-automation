// Drafts to review: AI emails that were generated and fact-checked but not sent yet.
// Review opens the editor; Approve sends as written; Approve all works through the list.
import { chain, f, op, parent, search, text, dateFmt, sorted, state } from '../expr.mjs';
import { group, row, card, cell, flexCell, label, button, list, thingGroup, showWhen, hideWhen, hover, grow } from '../ui.mjs';
import { T, fill, pad, sideBorder, font } from '../theme.mjs';
import { PAGE, logsWithStatus } from '../queries.mjs';
import { pageHeader } from './overview.mjs';
import { pill } from './badge.mjs';

const count = (e) => chain(e, op('count'));
export const draftsSorted = () => chain(logsWithStatus('Draft ready'), sorted('Created Date', false));
export const approvingAll = () => chain(state(PAGE, 'approving_all'), op('equals', { args: 'yes' }));

const head = () => row('ad_d_head', [
  cell('ad_dh_author', 'AUTHOR', 160, { look: 'micro' }),
  flexCell('ad_dh_subj', 'SUBJECT', { look: 'micro' }),
  cell('ad_dh_style', 'STYLE', 130, { look: 'micro' }),
  cell('ad_dh_fig', 'CHECKED', 110, { look: 'micro' }),
  cell('ad_dh_act', '', 292, { look: 'micro' }),
], { gap: 8, props: { ...fill(T.panel2), ...sideBorder('bottom'), ...pad(12, 16) } });

function draftRow() {
  const p = (...ops) => chain(parent(), ...ops);
  const r = thingGroup('ad_d_row', 'notificationlog', parent(), [
    group('ad_d_who', [
      label('ad_d_name', text(p(f.thing('author', 'author'), f.text('name'))), 'strong'),
      label('ad_d_when', text('Drafted ', p({ type: 'Message', name: 'Created Date', is_slidable: false }, dateFmt('d mmm, HH:MM'))), 'hint'),
    ], { gap: 1, props: { width: 160, single_width: true, min_width_css: '160px' } }),
    flexCell('ad_d_subj', text(p(f.text('subject'))), { look: 'cell' }),
    cell('ad_d_style', text(p(f.text('tone'), op('defaulting_to', { args: 'warm' })), ' · ', p(f.text('length'), op('defaulting_to', { args: 'standard' }))), 130, { look: 'hint' }),
    group('ad_d_fig', [pill('ad_d_fig_p', text(p(f.num('figures_verified')), ' figures ✓'), 'success')], { props: { width: 110, single_width: true, min_width_css: '110px' } }),
    row('ad_d_act', [
      button('ad_d_review', 'Review & edit', 'soft', pad(7, 12)),
      button('ad_d_approve', 'Approve', 'primary', pad(7, 12)),
      button('ad_d_discard', 'Discard', 'ghost', pad(7, 10)),
    ], { gap: 6, props: { width: 292, single_width: true, min_width_css: '292px', vert_alignment: 'center' } }),
  ], { layout: 'row', gap: 8, props: { ...sideBorder('bottom'), ...pad(12, 16), vert_alignment: 'center' } });
  return hover(r, fill(T.panel2));
}

export function draftsSection() {
  const n = count(logsWithStatus('Draft ready'));
  const none = chain(n, op('equals', { args: 0 }));
  return group('ad_v_drafts', [
    row('ad_dr_top', [
      group('ad_dr_hdr_wrap', [pageHeader('ad_dr_hdr', 'Drafts to review', 'Read each AI email before it goes out. Edit the wording, change the tone or length, or approve as written. Every figure is checked again when you approve.')], { props: grow() }),
      hideWhen(button('ad_dr_all', text('Approve all ', n), 'primary'), chain(none, op('or_', { args: approvingAll() }))),
      showWhen(label('ad_dr_all_wait', text('Approving… ', n, ' left'), font(13, 700, T.brandInk)), approvingAll()),
    ], { gap: 16 }),
    hideWhen(card('ad_dr_table', [head(), list('ad_d_rg', 'notificationlog', draftsSorted(), draftRow())], { gap: 0, props: pad(0) }), none),
    showWhen(card('ad_dr_empty', [
      label('ad_dr_empty_t', 'No drafts waiting', 'h2'),
      label('ad_dr_empty_s', 'Use "Draft & review" on an author, or "Draft all for review" on the Overview, to see emails here before they are sent.', 'sub'),
    ], { gap: 6, props: pad(28) }), none),
  ], { gap: 16 });
}
