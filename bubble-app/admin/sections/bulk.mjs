// Bulk send: one button for every author with pending royalties, with live batch progress.
import { chain, op, text, state, optionValue } from '../expr.mjs';
import { group, row, label, button, showWhen, hideWhen } from '../ui.mjs';
import { PAGE, authorsWithPending, batchLogs, batchQueue } from '../queries.mjs';

const count = (e) => chain(e, op('count'));
const batch = () => state(PAGE, 'cur_batch');
const batchWith = (status) =>
  chain(batchLogs(batch()), op('filtered', {
    properties: { constraints: { 0: { key: '_advanced_search_constraint', value: chain({ type: 'InjectedValue', is_slidable: false }, op('status_option_sendstatus'), op('equals', { args: optionValue('sendstatus', status) })) } } },
  }), op('count'));

/** True while this page is working through a batch. */
export const bulkRunning = () => chain(batch(), op('is_not_empty'), op('and_', { args: chain(batchQueue(), op('count'), op('greater_than', { args: 0 })) }));

export function bulkCard() {
  const hasBatch = chain(batch(), op('is_not_empty'));
  return group('ad_bulk', [
    row('ad_bulk_top', [
      group('ad_bulk_txt', [
        label('ad_bulk_h', 'Send royalty summaries in bulk', 'Text_h3_'),
        label('ad_bulk_d', text('One personalised email for each of the ', count(authorsWithPending()), ' authors with pending royalties. Each is written by AI, checked figure by figure, then sent.'), 'Text_muted_'),
      ], { gap: 4, props: { fit_width: false, min_width_css: '0px' } }),
      hideWhen(button('ad_bulk_btn', text('Send to all ', count(authorsWithPending()), ' authors'), 'Button_primary_'), bulkRunning()),
      showWhen(label('ad_bulk_wait', 'Sending…', 'Text_bold_'), bulkRunning()),
    ], { gap: 16 }),
    showWhen(label('ad_bulk_prog', text(
      'Batch ', batch(), ': ', count(batchLogs(batch())), ' of ', count(authorsWithPending()), ' queued · ',
      batchWith('Sent'), ' sent · ', batchWith('Failed'), ' failed · ', batchWith('Processing'), ' in progress',
    ), 'Text_small_'), hasBatch),
  ], { gap: 12, style: 'Group_card_' });
}
