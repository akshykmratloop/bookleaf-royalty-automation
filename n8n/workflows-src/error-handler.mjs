import { FAIL_JOB } from '../src/pipeline/sql-failures.js';
import { sendAlert } from './lib/flow-nodes.mjs';
import { errorTrigger, ifTrue, NOT_EMPTY, pg, withNote } from './lib/nodes.mjs';

/**
 * "BookLeaf - Error Handler", the error workflow of Royalty Summary and Approve Draft. n8n runs it with
 * the failed execution's id, last node and error (also when that execution was not saved). The job is
 * found by that id in the ledger: no n8n API call, no key.
 */
const TRIGGER = "$('Error Trigger').first().json";
/** `execution` is missing when a trigger could not start; `{}` keeps every read safe (no optional chaining in n8n expressions). */
const EXEC = (from) => `(${from}.execution || {})`;
const FAIL_PARAMS = `JSON.stringify({ execution_id: String(${EXEC('$json')}.id || ''), node: ${EXEC('$json')}.lastNodeExecuted || '', `
  + `message: (${EXEC('$json')}.error || {}).message || '' })`;

const MESSAGE = `((${EXEC(TRIGGER)}.error || (${TRIGGER}.trigger || {}).error || {}).message || 'no message')`;
const JOB_LINE = "($json.job_id ? 'Job ' + $json.job_id + ' is now FAILED (' + $json.error_code + ').' "
  + ": 'No running job belonged to this execution, so no job was changed.')";
const UNCERTAIN_LINE = "($json.error_code === 'EMAIL_UNCERTAIN' ? 'Its email may or may not have gone out: check the inbox before sending it again.' : '')";
const ALERT = {
  from: '$json.alert_from',
  to: '$json.alert_to',
  subject: `'BookLeaf alert: ' + ${TRIGGER}.workflow.name + ' failed'`,
  text: `['A BookLeaf workflow stopped with an unexpected error.', '', 'Workflow: ' + ${TRIGGER}.workflow.name, `
    + `'Execution: ' + (${EXEC(TRIGGER)}.url || ${EXEC(TRIGGER)}.id || 'none (the trigger could not start)'), `
    + `'Node: ' + (${EXEC(TRIGGER)}.lastNodeExecuted || 'unknown'), 'Error: ' + ${MESSAGE}, '', ${JOB_LINE}, ${UNCERTAIN_LINE}].join('\\n')`,
};

const ABOUT = [
  '## BookLeaf error handler',
  'Runs when **Royalty Summary** or **Approve Draft** stops with an unexpected error (a crash, a database or SMTP outage, the `crash` drill).',
  '**Fail Job** ends the job that belongs to the failed execution (its `execution_id`), only while it is still QUEUED/PROCESSING: '
  + '`EMAIL_UNCERTAIN` when it stopped at stage `sending` (the email may already be out), `INTERNAL` otherwise. It always returns one '
  + 'row with the `alert_email` setting; **Send Alert** tells that address (empty = nobody). A failed alert fails this run.',
].join('\n');

const nodes = [
  errorTrigger('Error Trigger'),
  withNote(pg('Fail Job', FAIL_JOB, FAIL_PARAMS), 'By execution id; one row'),
  withNote(ifTrue('Alert Set?', '$json.alert_to', NOT_EMPTY), 'false: alert_email empty'),
  sendAlert('Send Alert', 'smtp', ALERT),
];
const edges = [['Error Trigger', 'Fail Job'], ['Fail Job', 'Alert Set?'], ['Alert Set?', 'Send Alert', 'true']];

const grid = { 'Error Trigger': [0, 0], 'Fail Job': [1, 0], 'Alert Set?': [3, 0], 'Send Alert': [4, 0] };
const sections = [
  { title: 'Fail the job', text: 'Found by the failed run\'s execution id.', nodes: ['Error Trigger', 'Fail Job'] },
  { title: 'Alert', text: 'Emails alert_email, when set.', nodes: ['Alert Set?', 'Send Alert'] },
];

export default { name: 'BookLeaf - Error Handler', nodes, edges, grid, sections, about: ABOUT };
