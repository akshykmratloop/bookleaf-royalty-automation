// send_one: log the request, call n8n, store the job id (or the failure).
// bulk_step: pick the next author of the batch, send, and schedule itself until the batch is done.
import { chain, f, op, text, state, now, currentUser, prevStep, optionValue, injected, jsonSafe, formatList, dateFmt, yesNo } from '../expr.mjs';
import { PAGE, settings, recordsOf, finishedCountOf, batchQueue, batchLogs, authorsWithPending } from '../queries.mjs';
import { defaultTone, defaultLength } from '../sections/emailSettings.mjs';
import { customEvent, when, setState, trigger, schedule, create, change, apiCall, API } from './actions.mjs';

const author = () => state(PAGE, 'cur_author');
const mode = () => state(PAGE, 'cur_mode');
const isBulk = () => chain(mode(), op('equals', { args: 'bulk' }));
/** Writing options for this request: what the admin picked, else the Email settings defaults. */
const delivery = () => chain(state(PAGE, 'cur_delivery'), op('defaulting_to', { args: 'send' }));
const tone = () => chain(state(PAGE, 'cur_tone'), op('defaulting_to', { args: defaultTone() }));
const length = () => chain(state(PAGE, 'cur_len'), op('defaulting_to', { args: defaultLength() }));
const note = () => chain(state(PAGE, 'cur_note'), op('defaulting_to', { args: chain(settings(), f.text('email_note')) }));
/** Numbers have no JSON-safe operator in Bubble: empty -> null, otherwise the plain number. */
const numJson = (expr) => chain(expr, op('is_empty'), yesNo('null', [expr]));
const flag = (field) => text(chain(settings(), f.bool(field), op('is_true'), yesNo('true', 'false')));

/** One book as JSON, in the shape n8n's payload validator expects (see n8n/PAYLOAD.md). */
function bookJson() {
  const r = (...ops) => chain(injected(), ...ops);
  const b = (...ops) => r(f.thing('book', 'book'), ...ops);
  const platforms = b(f.optionList('platforms', 'platform'), formatList(text(chain(injected(), op('display'))), ', '), jsonSafe());
  return text(
    '{"code":', b(f.text('code'), jsonSafe()), ',"title":', b(f.text('title'), jsonSafe()),
    ',"isbn":', b(f.text('isbn'), jsonSafe()), ',"genre":', b(f.text('genre'), jsonSafe()),
    ',"status":', b(f.option('status', 'bookstatus'), op('display'), jsonSafe()),
    ',"publication_date":', b(f.date('publication_date'), jsonSafe()),
    ',"mrp":', numJson(b(f.num('mrp'))), ',"royalty_per_copy":', numJson(b(f.num('royalty_per_copy'))),
    ',"print_partner":', b(f.option('print_partner', 'printpartner'), op('display'), jsonSafe()),
    ',"platforms":', platforms,
    ',"copies_sold":', numJson(r(f.num('copies_sold'))), ',"earned":', numJson(r(f.num('earned'))),
    ',"paid":', numJson(r(f.num('paid'))), ',"pending":', numJson(r(f.num('pending'))),
    ',"last_payout_date":', r(f.date('last_payout_date'), jsonSafe()), '}',
  );
}

function sendCall(logStep) {
  const a = (...ops) => chain(author(), ...ops);
  return apiCall(API.send, {
    body_params_author_id: text(a(op('_id'))),
    body_params_log_id: text(chain(prevStep(logStep), op('_id'))),
    body_params_batch_id: text(chain(isBulk(), yesNo(state(PAGE, 'cur_batch'), ''))),
    body_params_requested_by: text(chain(currentUser(), op('email'))),
    body_params_mode: text(mode()),
    body_params_reference_date: text(chain(state(PAGE, 'ref_date'), dateFmt('yyyy-mm-dd'))),
    body_params_demo_inbox: text(chain(settings(), f.text('demo_inbox'))),
    // Same attempt for a double click (n8n answers "duplicate"); a new one after each finished send.
    body_params_attempt: text(chain(finishedCountOf(author()), op('plus', { args: 1 }))),
    body_params_ai_down: flag('drill_ai_down'),
    body_params_email_down: flag('drill_email_down'),
    body_params_data_down: flag('drill_data_down'),
    body_params_primary_down: flag('drill_primary_down'),
    body_params_delivery: text(delivery()),
    body_params_tone: text(tone()),
    body_params_length: text(length()),
    // Free text goes in JSON-safe (quoted and escaped); the body template has no quotes around these.
    body_params_note: text(chain(note(), jsonSafe())),
    body_params_sign_off: text(chain(settings(), f.text('sign_off'), jsonSafe())),
    body_params_author_code: text(a(f.text('code'))),
    body_params_author_name: text(a(f.text('name'))),
    body_params_author_email: text(a(f.text('email'))),
    body_params_author_city: text(a(f.text('city'))),
    body_params_books: text('[', chain(recordsOf(author()), formatList(bookJson(), ',')), ']'),
  }, 'send_one_call');
}

const res = (...ops) => chain(prevStep('send_one_call'), ...ops);
const failed = () => res(op('_api_c2_returned_an_error'));
const ok = () => chain(failed(), op('is_false'));
const status = (v) => optionValue('sendstatus', v);

export function sendOne() {
  const log = () => prevStep('send_one_log');
  return customEvent('send_one', [
    create('notificationlog', {
      author_custom_author: author(),
      owner_user: chain(author(), f.user('user')),
      triggered_by_user: currentUser(),
      mode_text: text(mode()),
      batch_id_text: text(chain(isBulk(), yesNo(state(PAGE, 'cur_batch'), ''))),
      status_option_sendstatus: status('Queued'),
      stage_text: text('queued'),
      delivery_text: text(delivery()),
      tone_text: text(tone()),
      length_text: text(length()),
      requested_at_date: now(),
    }, 'send_one_log'),
    sendCall('send_one_log'),
    when(change(log(), {
      job_id_text: text(res(op('_api_c2_body'), op('_api_c2_job_id'))),
      status_option_sendstatus: status('Processing'),
    }, 'send_one_ok'), chain(ok(), op('and_', { args: res(op('_api_c2_body'), op('_api_c2_duplicate'), op('is_false')) }))),
    when(change(log(), {
      job_id_text: text(res(op('_api_c2_body'), op('_api_c2_job_id'))),
      status_option_sendstatus: status('Duplicate'),
      error_text: text('Same request within 10 minutes: n8n returned the existing job, no second email.'),
      completed_at_date: now(),
    }, 'send_one_dup'), chain(ok(), op('and_', { args: res(op('_api_c2_body'), op('_api_c2_duplicate'), op('is_true')) }))),
    when(change(log(), {
      status_option_sendstatus: status('Failed'),
      error_text: text('n8n refused the request (HTTP ', res(op('_api_c2_error'), op('_api_c2_status_code')), '): ', res(op('_api_c2_error'), op('_api_c2_body'))),
      stage_text: text('failed'),
      completed_at_date: now(),
    }, 'send_one_err'), failed()),
  ]);
}

export function bulkStep() {
  const left = () => chain(batchQueue(), op('count'), op('greater_than', { args: 0 }));
  const underCap = () => chain(batchLogs(state(PAGE, 'cur_batch')), op('count'), op('less_than', { args: chain(authorsWithPending(), op('count')) }));
  return customEvent('bulk_step', [
    when(setState(PAGE, 'cur_author', chain(batchQueue(), op('first_element')), 'bulk_step_pick'), left()),
    setState(PAGE, 'cur_mode', text('bulk'), 'bulk_step_mode'),
    when(trigger('send_one', 'bulk_step_send'), left()),
    when(schedule('bulk_step', 1.5, 'bulk_step_next'), chain(left(), op('and_', { args: underCap() }))),
  ]);
}
