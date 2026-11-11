// Pull-mode status updates: every few seconds, ask n8n about the oldest send still Processing
// and write the outcome (subject, email, figures verified, cost or the failure reason) onto its log.
// On a paid Bubble plan n8n pushes the result instead (CALLBACK_MODE=push); see docs/integration.md.
import { chain, op, text, now, prevStep, optionValue } from '../expr.mjs';
import { oldestProcessing, logsWithStatus } from '../queries.mjs';
import { workflow, when, change, apiCall, API } from './actions.mjs';

export const POLL_SECONDS = 3;

const job = (...ops) => chain(prevStep('poll_call'), op('_api_c2_body'), op('_api_c2_jobs'), op('first_element'), ...ops);
const jobStatusIs = (v) => job(op('_api_c2_status'), op('equals', { args: v }));
const callOk = () => chain(prevStep('poll_call'), op('_api_c2_returned_an_error'), op('is_false'));
const noJob = () => chain(prevStep('poll_call'), op('_api_c2_body'), op('_api_c2_jobs'), op('count'), op('equals', { args: 0 }));
const both = (a, b) => chain(a, op('and_', { args: b }));
const sendStatus = (v) => optionValue('sendstatus', v);

export function poller() {
  const anyProcessing = chain(logsWithStatus('Processing'), op('count'), op('greater_than', { args: 0 }));
  return workflow('poll_jobs', 'DoInterval', { interval: POLL_SECONDS, condition: anyProcessing }, [
    apiCall(API.jobs, { url_params_ids: text(chain(oldestProcessing(), op('job_id_text'))) }, 'poll_call'),
    when(change(oldestProcessing(), {
      status_option_sendstatus: sendStatus('Sent'),
      subject_text: text(job(op('_api_c2_subject'))),
      email_html_text: text(job(op('_api_c2_html'))),
      sent_to_text: text(job(op('_api_c2_sent_to'))),
      figures_verified_number: job(op('_api_c2_figures_verified')),
      model_text: text(job(op('_api_c2_model'))),
      cost_usd_number: job(op('_api_c2_cost_usd')),
      completed_at_date: now(),
    }, 'poll_sent'), both(callOk(), jobStatusIs('SENT'))),
    when(change(oldestProcessing(), {
      status_option_sendstatus: sendStatus('Failed'),
      error_text: text(job(op('_api_c2_error_code')), ': ', job(op('_api_c2_error'))),
      completed_at_date: now(),
    }, 'poll_failed'), both(callOk(), jobStatusIs('FAILED'))),
    when(change(oldestProcessing(), {
      status_option_sendstatus: sendStatus('Failed'),
      error_text: text('n8n has no record of this job.'),
      completed_at_date: now(),
    }, 'poll_missing'), both(callOk(), noJob())),
  ], 'Check n8n for finished sends');
}
