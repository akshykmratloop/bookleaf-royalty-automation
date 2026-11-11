import { CLAIM_DRAFT, DISCARD_DRAFT, SELECT_DRAFT } from '../src/pipeline/sql-approve.js';
import { LOAD_SETTINGS, UPDATE_JOB } from '../src/pipeline/sql.js';
import { code, note, pg, respond, route, sendEmail, webhook } from './lib/nodes.mjs';

/**
 * POST /webhook/royalty-summary/approve {job_id, action: check|send|discard, subject, body}.
 * Every business outcome answers HTTP 200 with the same fields; 400 for a bad body (n8n answers 403
 * for a missing or wrong key before the workflow starts).
 */
const WEBHOOK = "$('Approve Webhook').first().json";
const PARSED = "$('Parse Request').first().json";
const DECIDED = "$('Decide').first().json";
const JOB_ID = `${PARSED}.job_id`;

const nodes = [
  note('About', '## BookLeaf approve draft\nPOST /webhook/royalty-summary/approve with header X-BookLeaf-Key (n8n Header Auth).\n**check** re-runs the fact check on the edited subject/body and returns a preview; **send** checks, claims the draft atomically (one email per draft, however many clicks), answers at once, then sends; **discard** closes the draft. Code nodes are generated from n8n/src by n8n/build.mjs.', 260),
  webhook('Approve Webhook', 'POST', 'royalty-summary/approve'),
  pg('Load Settings', LOAD_SETTINGS, null),
  code('Parse Request', 'parseApprove', `return main({ body: ${WEBHOOK}.body, settings: $json.settings });`),
  route('Valid?', 2, '$json.route'),
  respond('Respond Rejected'),
  pg('Load Draft', SELECT_DRAFT, `${PARSED}.params`, { alwaysOutputData: true }),
  code('Decide', 'decide', `return main({ request: ${PARSED}.request, row: $json, settings: ${PARSED}.settings });`),
  route('Action', 3, '$json.route'),
  respond('Respond Result'),
  pg('Discard Draft', DISCARD_DRAFT, `${DECIDED}.params`, { alwaysOutputData: true }),
  code('Discard Result', 'discarded', `return main({ row: $json, jobId: ${JOB_ID} });`),
  pg('Claim Draft', CLAIM_DRAFT, `${DECIDED}.params`, { alwaysOutputData: true }),
  code('Claim Result', 'claimed', `return main({ row: $json, decided: ${DECIDED} });`),
  route('Claimed?', 2, '$json.route'),
  respond('Respond Sending'),
  route('Email Drill?', 2, `${DECIDED}.drill ? 1 : 0`),
  sendEmail('Send Email', 'smtp', `${DECIDED}.email`),
  sendEmail('Send Email (drill: SMTP down)', 'smtpDrill', `${DECIDED}.email`),
  code('Mark Sent', 'approvedSent', `return main({ jobId: ${JOB_ID}, email: ${DECIDED}.email });`),
  code('Email Failed', 'approvedFailed', `return main({ jobId: ${JOB_ID}, email: ${DECIDED}.email, error: $json });`),
  pg('Update Job', UPDATE_JOB, 'JSON.stringify($json.update)'),
];

const edges = [
  ['Approve Webhook', 'Load Settings'], ['Load Settings', 'Parse Request'], ['Parse Request', 'Valid?'], ['Valid?', 'Respond Rejected', 0], ['Valid?', 'Load Draft', 1],
  ['Load Draft', 'Decide'], ['Decide', 'Action'],
  ['Action', 'Respond Result', 0], ['Action', 'Discard Draft', 1], ['Action', 'Claim Draft', 2],
  ['Discard Draft', 'Discard Result'], ['Discard Result', 'Respond Result'],
  ['Claim Draft', 'Claim Result'], ['Claim Result', 'Claimed?'], ['Claimed?', 'Respond Result', 0], ['Claimed?', 'Respond Sending', 1],
  ['Respond Sending', 'Email Drill?'], ['Email Drill?', 'Send Email', 0], ['Email Drill?', 'Send Email (drill: SMTP down)', 1],
  ['Send Email', 'Mark Sent', 0], ['Send Email', 'Email Failed', 1],
  ['Send Email (drill: SMTP down)', 'Mark Sent', 0], ['Send Email (drill: SMTP down)', 'Email Failed', 1],
  ['Mark Sent', 'Update Job'], ['Email Failed', 'Update Job'],
];

export default { name: 'BookLeaf - Approve Draft', nodes, edges, errorWorkflow: 'BookLeaf - Error Handler' };
