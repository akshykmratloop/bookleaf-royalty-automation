import { AI_OUTCOMES } from '../src/pipeline/after-ai.js';
import { errorBody, failure } from '../src/pipeline/errors.js';
import { ENQUEUE_JOB, LOAD_SETTINGS, MARK_PROCESSING, SET_STAGE, UPDATE_JOB } from '../src/pipeline/sql.js';
import { TUNING } from '../src/pipeline/tuning.js';
import { DELIVER_EMAIL } from './deliver-email.mjs';
import { executeWorkflow } from './lib/flow-nodes.mjs';
import { code, ifTrue, IS_TRUE, pg, respond, respondDatabaseDown, respondFixed, stopAndError, switchRules, webhook, withNote } from './lib/nodes.mjs';
import { WRITE_DRAFT } from './write-draft.mjs';

/**
 * Bubble posts the author and books with the request, gets 202 + job id at once, then polls job-status
 * (n8n never calls Bubble). The happy path is the top row; every other branch sits below it.
 */
const WEBHOOK = "$('Royalty Summary Webhook').first().json";
const VALIDATED = "$('Validate Body').first().json";
const ENQUEUED = "$('Enqueue Job').first().json";
/** The job under the id Enqueue Job made, and its context; Build Context passes both on. */
const JOB = "$('Build Context').first().json.job";
const CTX = "$('Build Context').first().json.ctx";
const FIRST = "$('Write Draft').first().json";
const UNEXPECTED_ENQUEUE = errorBody(failure('INTERNAL', 'The enqueue gave an unexpected answer.'));

const ABOUT = [
  '## BookLeaf royalty summary',
  'POST /webhook/royalty-summary with header X-BookLeaf-Key (n8n Header Auth: a missing or wrong key gets 403 before the workflow starts). '
  + 'Server settings come from the bookleaf_settings table (Load Settings, then Check Settings).',
  '**Enqueue Job** calls enqueue_royalty_job, which makes the job id: a double click gets the first job back (200, duplicate), more '
  + 'than max_sends_per_hour gets 429, anything else 202 {job_id} at once. Then the **Write Draft** sub-workflow writes and fact-checks '
  + 'the email (Anthropic, OpenAI if it fails); **Rewrite Draft** runs it once more with the checker\'s notes. **Deliver Email** sends '
  + 'it and records SENT or EMAIL_FAILED. A draft (delivery=draft) and every failure end in **Record Result**. Code nodes are '
  + 'generated from n8n/src by n8n/build.mjs.',
].join('\n');

const nodes = [
  webhook('Royalty Summary Webhook', 'POST', 'royalty-summary'),
  pg('Load Settings', LOAD_SETTINGS, null, { errorOutput: true, retry: true }),
  withNote(code('Check Settings', 'checkSettings', 'return main({ settings: $json.settings });'), 'Bad settings: 500'),
  ifTrue('Settings OK?', '$json.ok', IS_TRUE),
  withNote(code('Validate Body', 'prepare', `return main({ body: ${WEBHOOK}.body, settings: $json.settings, now: Date.now(), executionId: $execution.id });`), 'Bad body: 400'),
  ifTrue('Request Valid?', '$json.ok', IS_TRUE),
  respond('Respond Rejected'),
  withNote(pg('Enqueue Job', ENQUEUE_JOB, '$json.enqueue', { errorOutput: true }), 'Locked: duplicate, cap, new'),
  switchRules('Outcome', '$json.outcome', [
    { output: 'Queued', equals: 'queued' }, { output: 'Duplicate', equals: 'duplicate' }, { output: 'Rate limited', equals: 'rate_limited' },
  ], 'Unexpected'),
  respond('Respond 202', '202', '{ job_id: $json.job_id, status: $json.status, duplicate: false }'),
  respond('Respond Duplicate', '200', 'Object.assign({ job_id: $json.job_id, status: $json.status, duplicate: true }, $json.error_code ? { error_code: $json.error_code } : {})'),
  respond('Respond 429', '429', `${VALIDATED}.rate_limited`),
  respondFixed('Respond 500', 500, UNEXPECTED_ENQUEUE),
  withNote(respondDatabaseDown('Respond 503'), 'Database down: 503'),
  withNote(pg('Mark Processing', MARK_PROCESSING, `JSON.stringify({ job_id: ${ENQUEUED}.job_id })`, { retry: true }), 'PROCESSING, stage writing'),
  withNote(code('Build Context', 'context', `return main({ validated: ${VALIDATED}.job, jobId: ${ENQUEUED}.job_id });`), 'Job id from Enqueue Job'),
  ifTrue('Context OK?', '$json.ok', IS_TRUE),
  withNote(executeWorkflow('Write Draft', WRITE_DRAFT, { job: JOB, ctx: CTX, request: `${CTX}.requests`, attempt: '1', previous: '{}' }), 'AI writes; figures checked'),
  switchRules('Draft OK?', '$json.outcome', [
    { output: 'Pass', equals: AI_OUTCOMES.PASS }, { output: 'Rewrite', equals: AI_OUTCOMES.REWRITE }, { output: 'Fail', equals: AI_OUTCOMES.FAIL },
  ], 'Unexpected'),
  pg('Stage: Rewriting', SET_STAGE, `JSON.stringify({ job_id: ${JOB}.job_id, stage: 'rewriting' })`, { alwaysOutputData: true, retry: true }),
  withNote(executeWorkflow('Rewrite Draft', WRITE_DRAFT, { job: JOB, ctx: CTX, request: `${FIRST}.rewrite`, attempt: '2', previous: `${FIRST}.ai` }), 'Again, with checker notes'),
  ifTrue('Rewrite OK?', '$json.ok', IS_TRUE),
  withNote(stopAndError('Stop: Unexpected', 'Write Draft gave an unexpected outcome.'), 'Error workflow fails the job'),
  code('Render Email', 'render', `return main({ ctx: ${CTX}, job: ${JOB}, ai: $json.ai });`),
  withNote(ifTrue('Send Now?', '$json.send', IS_TRUE), 'false: delivery=draft'),
  withNote(executeWorkflow('Deliver Email', DELIVER_EMAIL, '$json.deliver'), 'Saves, sends once, records'),
  withNote(pg('Record Result', UPDATE_JOB, 'JSON.stringify($json.update)', { retry: true }), 'Drafts and every failure'),
];

const edges = [
  ['Royalty Summary Webhook', 'Load Settings'], ['Load Settings', 'Check Settings'], ['Load Settings', 'Respond 503', 'error'],
  ['Check Settings', 'Settings OK?'],
  ['Settings OK?', 'Validate Body', 'true'], ['Settings OK?', 'Respond Rejected', 'false'], ['Validate Body', 'Request Valid?'],
  ['Request Valid?', 'Enqueue Job', 'true'], ['Request Valid?', 'Respond Rejected', 'false'], ['Enqueue Job', 'Outcome'], ['Enqueue Job', 'Respond 503', 'error'],
  ['Outcome', 'Respond 202', 'Queued'], ['Outcome', 'Respond Duplicate', 'Duplicate'], ['Outcome', 'Respond 429', 'Rate limited'],
  ['Outcome', 'Respond 500', 'Unexpected'],
  ['Respond 202', 'Mark Processing'], ['Mark Processing', 'Build Context'], ['Build Context', 'Context OK?'],
  ['Context OK?', 'Write Draft', 'true'], ['Context OK?', 'Record Result', 'false'], ['Write Draft', 'Draft OK?'],
  ['Draft OK?', 'Render Email', 'Pass'], ['Draft OK?', 'Stage: Rewriting', 'Rewrite'], ['Draft OK?', 'Record Result', 'Fail'],
  ['Draft OK?', 'Stop: Unexpected', 'Unexpected'],
  ['Stage: Rewriting', 'Rewrite Draft'], ['Rewrite Draft', 'Rewrite OK?'],
  ['Rewrite OK?', 'Render Email', 'true'], ['Rewrite OK?', 'Record Result', 'false'],
  ['Render Email', 'Send Now?'], ['Send Now?', 'Deliver Email', 'true'], ['Send Now?', 'Record Result', 'false'],
];

/**
 * Grid cells [column, row]. The happy path is row 0, left to right; branches sit below the node they
 * leave.
 */
const grid = {
  'Royalty Summary Webhook': [0, 0], 'Load Settings': [1, 0], 'Check Settings': [2, 0], 'Settings OK?': [3, 0], 'Validate Body': [4, 0],
  'Request Valid?': [5, 0], 'Respond Rejected': [6, 1], 'Respond 503': [6, 2],
  'Enqueue Job': [7, 0], Outcome: [8, 0], 'Respond 202': [9, 0], 'Respond Duplicate': [9, 1], 'Respond 429': [9, 2], 'Respond 500': [9, 3],
  'Mark Processing': [10, 0],
  'Build Context': [11, 0], 'Context OK?': [12, 0],
  'Write Draft': [13, 0],
  'Draft OK?': [14, 0], 'Stage: Rewriting': [15, 1], 'Rewrite Draft': [16, 1], 'Rewrite OK?': [17, 1], 'Stop: Unexpected': [15, 2],
  'Render Email': [18, 0], 'Send Now?': [19, 0], 'Deliver Email': [20, 0],
  'Record Result': [19, 3],
};

const sections = [
  { title: 'Intake', text: 'The settings are checked (bad settings: 500), then the body (a bad body: 400). Database down before the answer: 503.',
    nodes: ['Royalty Summary Webhook', 'Load Settings', 'Check Settings', 'Settings OK?', 'Validate Body', 'Request Valid?', 'Respond Rejected', 'Respond 503'] },
  { title: 'Ledger', text: 'One locked call: a new job (202), a double click (200, the same job) or the hourly cap (429).',
    nodes: ['Enqueue Job', 'Outcome', 'Respond 202', 'Respond Duplicate', 'Respond 429', 'Respond 500', 'Mark Processing'] },
  { title: 'Data & facts', text: 'Figures checked, facts and prompt built.', nodes: ['Build Context', 'Context OK?'] },
  { title: 'AI writer', text: 'Sub-workflow: Anthropic, OpenAI if it fails, then the fact check.', nodes: ['Write Draft'], tone: 'ai' },
  { title: 'Fact check', text: 'Pass, one rewrite with the checker\'s notes, or fail.',
    nodes: ['Draft OK?', 'Stage: Rewriting', 'Rewrite Draft', 'Rewrite OK?', 'Stop: Unexpected'] },
  { title: 'Render & deliver', text: 'HTML and text email; Deliver Email sends it once.', nodes: ['Render Email', 'Send Now?', 'Deliver Email'] },
  { title: 'Record', text: 'Drafts and every failure end here.', nodes: ['Record Result'] },
];

export default {
  name: 'BookLeaf - Royalty Summary', nodes, edges, grid, sections, about: ABOUT, errorWorkflow: 'BookLeaf - Error Handler',
  settings: { executionTimeout: TUNING.runTimeoutSeconds },
};
