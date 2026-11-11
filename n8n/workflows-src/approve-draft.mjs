import { APPROVE_ACTIONS } from '../src/pipeline/approve.js';
import { CLAIM_DRAFT, DISCARD_DRAFT, SELECT_DRAFT } from '../src/pipeline/sql-approve.js';
import { errorBody, failure } from '../src/pipeline/errors.js';
import { LOAD_SETTINGS } from '../src/pipeline/sql.js';
import { DELIVER_EMAIL } from './deliver-email.mjs';
import { executeWorkflow } from './lib/flow-nodes.mjs';
import { code, ifTrue, IS_TRUE, NOT_EMPTY, pg, respond, respondDatabaseDown, respondFixed, switchRules, webhook, withNote } from './lib/nodes.mjs';

/**
 * POST /webhook/royalty-summary/approve {job_id, action: check|send|discard, subject, body}.
 * Every business outcome answers HTTP 200 with the same fields; 400 for a bad body (n8n answers 403
 * for a missing or wrong key before the workflow starts).
 */
const WEBHOOK = "$('Approve Webhook').first().json";
const PARSED = "$('Parse Request').first().json";
const DECIDED = "$('Decide').first().json";
const UNEXPECTED_ACTION = errorBody(failure('INTERNAL', 'Decide gave an unexpected action.'));

const ABOUT = [
  '## BookLeaf approve draft',
  'POST /webhook/royalty-summary/approve with header X-BookLeaf-Key (n8n Header Auth). Every business answer is HTTP 200 with the same fields.',
  '**Decide** re-runs the fact check on the edited subject/body and works out every answer: **check** returns a preview at once; '
  + '**discard** closes the draft; **send** claims it atomically for this execution (one email per draft, however many clicks), '
  + 'answers at once, then hands the email to the **Deliver Email** sub-workflow. Code nodes are generated from n8n/src by n8n/build.mjs.',
].join('\n');

const nodes = [
  webhook('Approve Webhook', 'POST', 'royalty-summary/approve'),
  pg('Load Settings', LOAD_SETTINGS, null, { errorOutput: true, retry: true }),
  withNote(code('Check Settings', 'checkSettings', 'return main({ settings: $json.settings });'), 'Bad settings: 500'),
  ifTrue('Settings OK?', '$json.ok', IS_TRUE),
  code('Parse Request', 'parseApprove', `return main({ body: ${WEBHOOK}.body, settings: $json.settings });`),
  ifTrue('Request Valid?', '$json.ok', IS_TRUE),
  respond('Respond Rejected'),
  pg('Load Draft', SELECT_DRAFT, `${PARSED}.params`, { alwaysOutputData: true, errorOutput: true, retry: true }),
  withNote(code('Decide', 'decide', `return main({ request: ${PARSED}.request, row: $json, settings: ${PARSED}.settings, executionId: $execution.id });`), 'Checks the edit; all answers'),
  switchRules('Action', '$json.action', [
    { output: 'Send', equals: APPROVE_ACTIONS.SEND }, { output: 'Discard', equals: APPROVE_ACTIONS.DISCARD }, { output: 'Answer', equals: APPROVE_ACTIONS.ANSWER },
  ], 'Unexpected'),
  respondFixed('Respond 500', 500, UNEXPECTED_ACTION),
  withNote(respondDatabaseDown('Respond 503'), 'Database down: 503'),
  withNote(pg('Discard Draft', DISCARD_DRAFT, `${DECIDED}.params`, { alwaysOutputData: true, errorOutput: true }), 'Only while still DRAFTED'),
  respond('Respond Discard', '200', `$json.job_id ? ${DECIDED}.response : ${DECIDED}.fallback`),
  respond('Respond Answer', '200'),
  withNote(pg('Claim Draft', CLAIM_DRAFT, `${DECIDED}.params`, { alwaysOutputData: true, errorOutput: true }), 'Atomic: one click wins'),
  withNote(ifTrue('Claimed?', '$json.job_id', NOT_EMPTY), 'false: another click won'),
  respond('Respond Sending', '200', `${DECIDED}.response`),
  respond('Respond Already Sent', '200', `${DECIDED}.fallback`),
  withNote(executeWorkflow('Deliver Email', DELIVER_EMAIL, `${DECIDED}.deliver`), 'Saves, sends once, records'),
];

const edges = [
  ['Approve Webhook', 'Load Settings'], ['Load Settings', 'Check Settings'], ['Load Settings', 'Respond 503', 'error'], ['Check Settings', 'Settings OK?'],
  ['Settings OK?', 'Parse Request', 'true'], ['Settings OK?', 'Respond Rejected', 'false'], ['Parse Request', 'Request Valid?'],
  ['Request Valid?', 'Load Draft', 'true'], ['Request Valid?', 'Respond Rejected', 'false'],
  ['Load Draft', 'Decide'], ['Load Draft', 'Respond 503', 'error'], ['Decide', 'Action'],
  ['Action', 'Claim Draft', 'Send'], ['Action', 'Discard Draft', 'Discard'], ['Action', 'Respond Answer', 'Answer'],
  ['Action', 'Respond 500', 'Unexpected'],
  ['Discard Draft', 'Respond Discard'], ['Discard Draft', 'Respond 503', 'error'],
  ['Claim Draft', 'Claimed?'], ['Claim Draft', 'Respond 503', 'error'], ['Claimed?', 'Respond Sending', 'true'], ['Claimed?', 'Respond Already Sent', 'false'],
  ['Respond Sending', 'Deliver Email'],
];

/** The send path is row 0, left to right (Send is Action's top output); discard and check answers sit below. */
const grid = {
  'Approve Webhook': [0, 0], 'Load Settings': [1, 0], 'Check Settings': [2, 0], 'Settings OK?': [3, 0], 'Parse Request': [4, 0],
  'Request Valid?': [5, 0], 'Respond Rejected': [6, 1], 'Respond 503': [6, 2],
  'Load Draft': [7, 0], Decide: [8, 0], Action: [9, 0],
  'Claim Draft': [10, 0], 'Claimed?': [11, 0], 'Respond Sending': [12, 0], 'Deliver Email': [13, 0], 'Respond Already Sent': [12, 1],
  'Discard Draft': [10, 3], 'Respond Discard': [11, 3], 'Respond Answer': [10, 4], 'Respond 500': [10, 5],
};
const sections = [
  { title: 'Intake', text: 'The settings (bad: 500), then the body (bad: 400). Database down before the answer: 503.',
    nodes: ['Approve Webhook', 'Load Settings', 'Check Settings', 'Settings OK?', 'Parse Request', 'Request Valid?', 'Respond Rejected', 'Respond 503'] },
  { title: 'Load & decide', text: 'Re-checks the edit and works out every answer.', nodes: ['Load Draft', 'Decide', 'Action'] },
  { title: 'Send', text: 'One click wins the draft; the email goes out once.', nodes: ['Claim Draft', 'Claimed?', 'Respond Sending', 'Deliver Email', 'Respond Already Sent'] },
  { title: 'Discard or check', text: 'Closes the draft, or answers a preview.', nodes: ['Discard Draft', 'Respond Discard', 'Respond Answer', 'Respond 500'] },
];

export default { name: 'BookLeaf - Approve Draft', nodes, edges, grid, sections, about: ABOUT, errorWorkflow: 'BookLeaf - Error Handler' };
