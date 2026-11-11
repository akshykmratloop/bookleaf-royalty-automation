// Pull-mode status updates: every few seconds, ask n8n about the oldest email still Processing and
// write what it reports onto its log: the live stage while it works, then the outcome (Sent, Draft
// ready with the editable text, Failed with the reason, or Discarded).
// On a paid Bubble plan n8n can push the result instead (CALLBACK_MODE=push); see docs/integration.md.
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
const stillWorking = () => chain(jobStatusIs('QUEUED'), op('or_', { args: jobStatusIs('PROCESSING') }));

/** Fields n8n reports for a finished email (sent or drafted). */
const result = () => ({
  subject_text: text(job(op('_api_c2_subject'))),
  email_html_text: text(job(op('_api_c2_html'))),
  figures_verified_number: job(op('_api_c2_figures_verified')),
  model_text: text(job(op('_api_c2_model'))),
  cost_usd_number: job(op('_api_c2_cost_usd')),
  completed_at_date: now(),
});

export function poller() {
  const anyProcessing = chain(logsWithStatus('Processing'), op('count'), op('greater_than', { args: 0 }));
  const target = () => oldestProcessing();
  return workflow('poll_jobs', 'DoInterval', { interval: POLL_SECONDS, condition: anyProcessing }, [
    apiCall(API.jobs, { url_params_ids: text(chain(oldestProcessing(), op('job_id_text'))) }, 'poll_call'),
    when(change(target(), { stage_text: text(job(op('_api_c2_stage'))) }, 'poll_stage'), both(callOk(), stillWorking())),
    when(change(target(), {
      ...result(), status_option_sendstatus: sendStatus('Sent'), stage_text: text('sent'), sent_to_text: text(job(op('_api_c2_sent_to'))),
    }, 'poll_sent'), both(callOk(), jobStatusIs('SENT'))),
    when(change(target(), {
      ...result(), status_option_sendstatus: sendStatus('Draft ready'), stage_text: text('drafted'),
      edit_text_text: text(job(op('_api_c2_edit_text'))), issues_text: text(job(op('_api_c2_issues'))),
    }, 'poll_drafted'), both(callOk(), jobStatusIs('DRAFTED'))),
    when(change(target(), {
      status_option_sendstatus: sendStatus('Failed'), stage_text: text('failed'),
      error_text: text(job(op('_api_c2_error_code')), ': ', job(op('_api_c2_error'))), completed_at_date: now(),
    }, 'poll_failed'), both(callOk(), jobStatusIs('FAILED'))),
    when(change(target(), { status_option_sendstatus: sendStatus('Discarded'), stage_text: text('discarded'), completed_at_date: now() }, 'poll_discarded'),
      both(callOk(), jobStatusIs('DISCARDED'))),
    when(change(target(), {
      status_option_sendstatus: sendStatus('Failed'), stage_text: text('failed'), error_text: text('n8n has no record of this job.'), completed_at_date: now(),
    }, 'poll_missing'), both(callOk(), noJob())),
  ], 'Check n8n for progress and results');
}
