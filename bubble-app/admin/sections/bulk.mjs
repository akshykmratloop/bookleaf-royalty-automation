// Bulk: one email for every author with pending royalties, either drafted for review first or
// sent straight away. Each author is one call to the same n8n webhook; progress updates live.
import { chain, op, text, state, injected, optionValue } from '../expr.mjs';
import { group, row, card, label, button, showWhen, hideWhen, grow } from '../ui.mjs';
import { T, font } from '../theme.mjs';
import { PAGE, authorsWithPending, batchLogs, batchQueue } from '../queries.mjs';

const count = (e) => chain(e, op('count'));
const batch = () => state(PAGE, 'cur_batch');
const batchWith = (status) =>
  chain(batchLogs(batch()), op('filtered', {
    properties: { constraints: { 0: { key: '_advanced_search_constraint', value: chain(injected(), op('status_option_sendstatus'), op('equals', { args: optionValue('sendstatus', status) })) } } },
  }), op('count'));

/** True while this page is working through a batch. */
export const bulkRunning = () => chain(batch(), op('is_not_empty'), op('and_', { args: chain(batchQueue(), op('count'), op('greater_than', { args: 0 })) }));

export function bulkCard() {
  const hasBatch = chain(batch(), op('is_not_empty'));
  const n = count(authorsWithPending());
  return card('ad_bulk', [
    group('ad_bulk_hd', [label('ad_bulk_h', 'Royalty emails in bulk', 'h2'), label('ad_bulk_d', text('One personalised email for each of the ', n, ' authors with money pending. Each is written by AI and checked figure by figure against the records. Draft them to read and edit first, or send them now.'), 'sub')], { gap: 4 }),
    hideWhen(row('ad_bulk_btns', [
      button('ad_bulk_draft', text('Draft all ', n, ' for review'), 'primary'),
      button('ad_bulk_btn', text('Send all ', n, ' now'), 'secondary'),
    ], { gap: 12 }), bulkRunning()),
    showWhen(label('ad_bulk_wait', 'Working through the batch. Keep this page open; each author takes a few seconds.', font(13, 700, T.brandInk)), bulkRunning()),
    showWhen(group('ad_bulk_prog', [
      label('ad_bulk_prog_t', text('Batch ', batch(), ' · ', state(PAGE, 'cur_delivery')), 'micro'),
      label('ad_bulk_prog_n', text(
        count(batchLogs(batch())), ' of ', n, ' requested · ', batchWith('Sent'), ' sent · ', batchWith('Draft ready'), ' drafted · ',
        batchWith('Failed'), ' failed · ', batchWith('Processing'), ' in progress',
      ), font(13, 700, T.text1)),
    ], { gap: 4 }), hasBatch),
  ], { gap: 16, props: grow({ min_width_css: '360px' }) });
}
