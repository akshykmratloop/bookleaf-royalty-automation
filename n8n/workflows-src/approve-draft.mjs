import { APPROVE_ACTIONS } from '../src/pipeline/approve.js';
import { CLAIM_DRAFT, DISCARD_DRAFT, SELECT_DRAFT } from '../src/pipeline/sql-approve.js';
import { LOAD_SETTINGS } from '../src/pipeline/sql.js';
import { DELIVER_EMAIL } from './deliver-email.mjs';
import { code, executeWorkflow, ifTrue, IS_TRUE, NOT_EMPTY, pg, respond, switchRules, webhook, withNote } from './lib/nodes.mjs';

/**
 * POST /webhook/royalty-summary/approve {job_id, action: check|send|discard, subject, body}.
 * Every business outcome answers HTTP 200 with the same fields; 400 for a bad body (n8n answers 403
 * for a missing or wrong key before the workflow starts).
 */
const WEBHOOK = "$('Approve Webhook').first().json";
const PARSED = "$('Parse Request').first().json";
const DECIDED = "$('Decide').first().json";

const ABOUT = [
  '## BookLeaf approve draft',
  'POST /webhook/royalty-summary/approve with header X-BookLeaf-Key (n8n Header Auth). Every business answer is HTTP 200 with the same fields.',
  '**Decide** re-runs the fact check on the edited subject/body and works out every answer: **check** returns a preview at once; '
  + '**discard** closes the draft; **send** claims it atomically for this execution (one email per draft, however many clicks), '
  + 'answers at once, then hands the email to the **Deliver Email** sub-workflow. Code nodes are generated from n8n/src by n8n/build.mjs.',
].join('\n');

const nodes = [
  webhook('Approve Webhook', 'POST', 'royalty-summary/approve'),
  pg('Load Settings', LOAD_SETTINGS, null),
  code('Parse Request', 'parseApprove', `return main({ body: ${WEBHOOK}.body, settings: $json.settings });`),
  ifTrue('Request Valid?', '$json.ok', IS_TRUE),
  respond('Respond Rejected'),
  pg('Load Draft', SELECT_DRAFT, `${PARSED}.params`, { alwaysOutputData: true }),
  withNote(code('Decide', 'decide', `return main({ request: ${PARSED}.request, row: $json, settings: ${PARSED}.settings, executionId: $execution.id });`), 'Checks the edit; all answers'),
  switchRules('Action', '$json.action', [
    { output: 'Send', equals: APPROVE_ACTIONS.SEND }, { output: 'Discard', equals: APPROVE_ACTIONS.DISCARD }, { output: 'Answer', equals: APPROVE_ACTIONS.ANSWER },
  ]),
  withNote(pg('Discard Draft', DISCARD_DRAFT, `${DECIDED}.params`, { alwaysOutputData: true }), 'Only while still DRAFTED'),
  respond('Respond Discard', '200', `$json.job_id ? ${DECIDED}.response : ${DECIDED}.fallback`),
  respond('Respond Answer', '200'),
  withNote(pg('Claim Draft', CLAIM_DRAFT, `${DECIDED}.params`, { alwaysOutputData: true }), 'Atomic: one click wins'),
  withNote(ifTrue('Claimed?', '$json.job_id', NOT_EMPTY), 'false: another click won'),
  respond('Respond Sending', '200', `${DECIDED}.response`),
  respond('Respond Already Sent', '200', `${DECIDED}.fallback`),
  withNote(executeWorkflow('Deliver Email', DELIVER_EMAIL, `${DECIDED}.deliver`), 'Saves, sends once, records'),
];

const edges = [
  ['Approve Webhook', 'Load Settings'], ['Load Settings', 'Parse Request'], ['Parse Request', 'Request Valid?'],
  ['Request Valid?', 'Load Draft', 'true'], ['Request Valid?', 'Respond Rejected', 'false'],
  ['Load Draft', 'Decide'], ['Decide', 'Action'],
  ['Action', 'Claim Draft', 'Send'], ['Action', 'Discard Draft', 'Discard'], ['Action', 'Respond Answer', 'Answer'],
  ['Discard Draft', 'Respond Discard'],
  ['Claim Draft', 'Claimed?'], ['Claimed?', 'Respond Sending', 'true'], ['Claimed?', 'Respond Already Sent', 'false'],
  ['Respond Sending', 'Deliver Email'],
];

/** The send path is row 0, left to right (Send is Action's top output); discard and check answers sit below. */
const grid = {
  'Approve Webhook': [0, 0], 'Load Settings': [1, 0], 'Parse Request': [2, 0], 'Request Valid?': [3, 0], 'Respond Rejected': [4, 1],
  'Load Draft': [5, 0], Decide: [6, 0], Action: [7, 0],
  'Claim Draft': [8, 0], 'Claimed?': [9, 0], 'Respond Sending': [10, 0], 'Deliver Email': [11, 0], 'Respond Already Sent': [10, 1],
  'Discard Draft': [8, 3], 'Respond Discard': [9, 3], 'Respond Answer': [8, 4],
};
const sections = [
  { title: 'Intake', text: 'Settings and the body; a bad body gets 400.', nodes: ['Approve Webhook', 'Load Settings', 'Parse Request', 'Request Valid?', 'Respond Rejected'] },
  { title: 'Load & decide', text: 'Re-checks the edit and works out every answer.', nodes: ['Load Draft', 'Decide', 'Action'] },
  { title: 'Send', text: 'One click wins the draft; the email goes out once.', nodes: ['Claim Draft', 'Claimed?', 'Respond Sending', 'Deliver Email', 'Respond Already Sent'] },
  { title: 'Discard or check', text: 'Closes the draft, or answers a preview.', nodes: ['Discard Draft', 'Respond Discard', 'Respond Answer'] },
];

export default { name: 'BookLeaf - Approve Draft', nodes, edges, grid, sections, about: ABOUT, errorWorkflow: 'BookLeaf - Error Handler' };
