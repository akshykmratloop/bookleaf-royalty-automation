// Searches shared by the admin page's sections and workflows.
// The status rule is the brief's, applied per author at the page's reference date:
//   green  = nothing pending
//   red    = something pending whose due anchor (last payout, or publication if never paid)
//            is more than 90 days before the reference date
//   yellow = pending, but not yet overdue
import { chain, f, op, search, state, value, filtered, injected, sorted, optionValue } from './expr.mjs';

export const PAGE = 'admin';
export const OVERDUE_DAYS = 90;

export const refDate = () => state(PAGE, 'ref_date');
/** Reference date minus 90 days: anchors before this are overdue. */
export const overdueCutoff = () => chain(refDate(), op('plus_days', { args: -OVERDUE_DAYS }));

export const settings = () => chain(search('appsettings'), op('first_element'));

/** Royalty records with something pending, optionally for one author. */
export function pendingRecords(authorExpr) {
  const c = [['pending_number', 'greater than', 0]];
  if (authorExpr) c.push(['author_custom_author', 'equals', authorExpr]);
  return search('royaltyrecord', c);
}

export function overdueRecords(authorExpr) {
  const c = [['pending_number', 'greater than', 0], ['due_anchor_date_date', 'less than', overdueCutoff()]];
  if (authorExpr) c.push(['author_custom_author', 'equals', authorExpr]);
  return search('royaltyrecord', c);
}

/** Distinct authors that have something pending / overdue. */
export const authorsWithPending = () => chain(pendingRecords(), f.thing('author', 'author'), op('unique'));
export const authorsOverdue = () => chain(overdueRecords(), f.thing('author', 'author'), op('unique'));

export const recordsOf = (authorExpr) => search('royaltyrecord', [['author_custom_author', 'equals', authorExpr]]);
export const booksOf = (authorExpr) => search('book', [['author_custom_author', 'equals', authorExpr]]);
export const logsOf = (authorExpr) =>
  chain(search('notificationlog', [['author_custom_author', 'equals', authorExpr]]), sorted('Created Date', true));

/** Statuses that mean n8n is finished with a request, or is waiting on the admin (a draft). */
export const SETTLED_STATUSES = ['Sent', 'Failed', 'Duplicate', 'Draft ready', 'Discarded'];

/** The author's send that is still on its way (Queued or Processing), if any. */
export const inFlightOf = (authorExpr) =>
  search('notificationlog', [
    ['author_custom_author', 'equals', authorExpr],
    ...SETTLED_STATUSES.map((s) => ['status_option_sendstatus', 'not equal', optionValue('sendstatus', s)]),
  ]);

/** The author's newest draft waiting for review, if any. */
export const draftOf = (authorExpr) =>
  chain(
    search('notificationlog', [
      ['author_custom_author', 'equals', authorExpr],
      ['status_option_sendstatus', 'equals', optionValue('sendstatus', 'Draft ready')],
    ]),
    sorted('Created Date', true),
    op('first_element'),
  );

/** Finished sends (Sent or Failed): a new click after these is a deliberate new attempt. */
export const finishedCountOf = (authorExpr) =>
  chain(
    search('notificationlog', [
      ['author_custom_author', 'equals', authorExpr],
      ['status_option_sendstatus', 'not equal', optionValue('sendstatus', 'Queued')],
      ['status_option_sendstatus', 'not equal', optionValue('sendstatus', 'Processing')],
      ['status_option_sendstatus', 'not equal', optionValue('sendstatus', 'Duplicate')],
    ]),
    op('count'),
  );

export const logsWithStatus = (status) =>
  search('notificationlog', [['status_option_sendstatus', 'equals', optionValue('sendstatus', status)]]);

/** Every request n8n has not settled yet (Queued or Processing). */
export const unsettledLogs = () =>
  search('notificationlog', SETTLED_STATUSES.map((s) => ['status_option_sendstatus', 'not equal', optionValue('sendstatus', s)]));
export const oldestUnsettled = () => chain(unsettledLogs(), sorted('Created Date', false), op('first_element'));

/** The oldest log still waiting for n8n's answer: the poller settles one per tick. */
export const oldestProcessing = () =>
  chain(logsWithStatus('Processing'), sorted('Created Date', false), op('first_element'));

/** Authors table base list: city filter (ignored when empty) + name filter, A→Z. */
export function filteredAuthors(searchInputId, cityDropdownId) {
  const byName = chain(injected(), f.text('name'), op('to_lowercase'), op('contains', { args: chain(value(searchInputId), op('to_lowercase')) }));
  return chain(
    search('author', [['city_text', 'equals', value(cityDropdownId)]], { ignoreEmpty: true }),
    filtered(byName),
    sorted('name_text', false),
  );
}

export const allCities = () => chain(search('author'), f.text('city'), op('unique'), op('sorted', { properties: { descending: false } }));

/** Batch members already queued, and the authors still to send in this batch. */
export const batchLogs = (batchExpr) => search('notificationlog', [['batch_id_text', 'equals', batchExpr]]);
export const batchQueue = () =>
  chain(authorsWithPending(), op('minus_list', { args: chain(batchLogs(state(PAGE, 'cur_batch')), f.thing('author', 'author')) }));
