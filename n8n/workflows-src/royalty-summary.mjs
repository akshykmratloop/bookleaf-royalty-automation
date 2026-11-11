import { ANTHROPIC_VERSION, FALLBACK_BETA, URL as ANTHROPIC_URL } from '../src/providers/anthropic.js';
import { URL as OPENAI_URL } from '../src/providers/openai.js';
import { AI_OUTCOMES } from '../src/pipeline/after-ai.js';
import { ENQUEUE_JOB, LOAD_SETTINGS, MARK_PROCESSING, SET_STAGE, UPDATE_JOB } from '../src/pipeline/sql.js';
import { DELIVER_EMAIL } from './deliver-email.mjs';
import { code, executeWorkflow, http, ifTrue, IS_TRUE, pg, respond, switchRules, webhook, withNote } from './lib/nodes.mjs';
import { TUNING } from './lib/tuning.mjs';

/**
 * Bubble posts the author and books with the request, gets 202 + job id at once, then polls job-status
 * (n8n never calls Bubble). The happy path is the top row; every other branch sits below it.
 */
const WEBHOOK = "$('Royalty Summary Webhook').first().json";
const VALIDATED = "$('Validate Body').first().json";
/** The job under the id Enqueue Job made; Build Context passes it on. */
const JOB = "$('Build Context').first().json.job";
const CTX = "$('Build Context').first().json.ctx";
const CHECK = "$('Check Draft').first().json";
/** Timeout from the ai_timeout_ms setting (carried on the job); retries are build-time node settings. */
const AI = { timeout: `={{ ${JOB}.settings.ai_timeout_ms }}`, retry: TUNING.aiRetries, waitMs: TUNING.aiRetryWaitMs, errorOutput: true };
const anthropicCall = (name, body) => http(name, {
  method: 'POST', url: ANTHROPIC_URL, credential: 'anthropic', authType: 'httpHeaderAuth', body, ...AI,
  headers: { 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-beta': FALLBACK_BETA },
});
const openaiCall = (name, body) => http(name, { method: 'POST', url: OPENAI_URL, credential: 'openai', authType: 'httpBearerAuth', body, ...AI });
/** AI Failed serves both phases: the rewrite ran when Stage: Rewriting did. */
const AI_FAILED = `const rewriting = $('Stage: Rewriting').isExecuted;
const anthropic = $(rewriting ? 'Rewrite (Anthropic)' : 'Call Anthropic').all(1)[0];
return main({ job: ${JOB}, rewriting, anthropicError: anthropic && anthropic.json, openaiError: $json, previous: rewriting ? ${CHECK}.ai : null });`;

const ABOUT = [
  '## BookLeaf royalty summary',
  'POST /webhook/royalty-summary with header X-BookLeaf-Key (n8n Header Auth: a missing or wrong key gets 403 before the workflow starts). '
  + 'Server settings come from the bookleaf_settings table (Load Settings).',
  '**Enqueue Job** calls enqueue_royalty_job: a double click gets the first job back (200, duplicate), more than max_sends_per_hour '
  + 'gets 429, anything else 202 {job_id} at once. Then the AI writes the email (Anthropic, OpenAI if it fails), the fact checker '
  + 'checks every figure (one rewrite with its notes), and **Deliver Email** sends it and records SENT or EMAIL_FAILED. A draft '
  + '(delivery=draft) and every failure end in **Record Result**. Code nodes are generated from n8n/src by n8n/build.mjs.',
].join('\n');

const nodes = [
  webhook('Royalty Summary Webhook', 'POST', 'royalty-summary'),
  pg('Load Settings', LOAD_SETTINGS, null),
  withNote(code('Check Settings', 'checkSettings', 'return main({ settings: $json.settings });'), 'Bad settings: 500'),
  ifTrue('Settings OK?', '$json.ok', IS_TRUE),
  withNote(code('Validate Body', 'prepare', `return main({ body: ${WEBHOOK}.body, settings: $json.settings, now: Date.now(), executionId: $execution.id });`), 'Bad body: 400'),
  ifTrue('Request Valid?', '$json.ok', IS_TRUE),
  respond('Respond Rejected'),
  withNote(pg('Enqueue Job', ENQUEUE_JOB, '$json.enqueue'), 'Locked: duplicate, cap, new'),
  switchRules('Outcome', '$json.outcome', [
    { output: 'Queued', equals: 'queued' }, { output: 'Duplicate', equals: 'duplicate' }, { output: 'Rate limited', equals: 'rate_limited' },
  ]),
  respond('Respond 202', '202', '{ job_id: $json.job_id, status: $json.status, duplicate: false }'),
  respond('Respond Duplicate', '200', 'Object.assign({ job_id: $json.job_id, status: $json.status, duplicate: true }, $json.error_code ? { error_code: $json.error_code } : {})'),
  respond('Respond 429', '429', `${VALIDATED}.rate_limited`),
  withNote(pg('Mark Processing', MARK_PROCESSING, "JSON.stringify({ job_id: $('Enqueue Job').first().json.job_id })"), 'PROCESSING, stage writing'),
  withNote(code('Build Context', 'context', `return main({ validated: ${VALIDATED}.job, jobId: $('Enqueue Job').first().json.job_id });`), 'Job id from Enqueue Job'),
  ifTrue('Context OK?', '$json.ok', IS_TRUE),
  anthropicCall('Call Anthropic', `JSON.stringify(${CTX}.requests.anthropic)`),
  withNote(openaiCall('Call OpenAI (fallback)', `JSON.stringify(${CTX}.requests.openai)`), 'Runs when Anthropic fails'),
  withNote(code('Check Draft', 'checkDraft', `return main({ response: $json, ctx: ${CTX}, job: ${JOB}, attempt: 1 });`), 'Checks every figure'),
  switchRules('Draft OK?', '$json.outcome', [
    { output: 'Pass', equals: AI_OUTCOMES.PASS }, { output: 'Rewrite', equals: AI_OUTCOMES.REWRITE }, { output: 'Fail', equals: AI_OUTCOMES.FAIL },
  ]),
  pg('Stage: Rewriting', SET_STAGE, `JSON.stringify({ job_id: ${JOB}.job_id, stage: 'rewriting' })`, { alwaysOutputData: true }),
  withNote(anthropicCall('Rewrite (Anthropic)', `JSON.stringify(${CHECK}.rewrite.anthropic)`), 'Same prompt + checker notes'),
  withNote(openaiCall('Rewrite (OpenAI fallback)', `JSON.stringify(${CHECK}.rewrite.openai)`), 'Runs when Anthropic fails'),
  code('Check Rewrite', 'checkDraft', `return main({ response: $json, ctx: ${CTX}, job: ${JOB}, attempt: 2, previous: ${CHECK}.ai });`),
  ifTrue('Rewrite OK?', '$json.ok', IS_TRUE),
  withNote(code('AI Failed', 'aiFailed', AI_FAILED), 'Both providers failed'),
  code('Render Email', 'render', `return main({ ctx: ${CTX}, job: ${JOB}, ai: $json.ai });`),
  withNote(ifTrue('Send Now?', '$json.send', IS_TRUE), 'false: delivery=draft'),
  withNote(executeWorkflow('Deliver Email', DELIVER_EMAIL, '$json.deliver'), 'Saves, sends once, records'),
  withNote(pg('Record Result', UPDATE_JOB, 'JSON.stringify($json.update)'), 'Drafts and every failure'),
];

const edges = [
  ['Royalty Summary Webhook', 'Load Settings'], ['Load Settings', 'Check Settings'], ['Check Settings', 'Settings OK?'],
  ['Settings OK?', 'Validate Body', 'true'], ['Settings OK?', 'Respond Rejected', 'false'], ['Validate Body', 'Request Valid?'],
  ['Request Valid?', 'Enqueue Job', 'true'], ['Request Valid?', 'Respond Rejected', 'false'], ['Enqueue Job', 'Outcome'],
  ['Outcome', 'Respond 202', 'Queued'], ['Outcome', 'Respond Duplicate', 'Duplicate'], ['Outcome', 'Respond 429', 'Rate limited'],
  ['Respond 202', 'Mark Processing'], ['Mark Processing', 'Build Context'], ['Build Context', 'Context OK?'],
  ['Context OK?', 'Call Anthropic', 'true'], ['Context OK?', 'Record Result', 'false'],
  ['Call Anthropic', 'Check Draft'], ['Call Anthropic', 'Call OpenAI (fallback)', 'error'],
  ['Call OpenAI (fallback)', 'Check Draft'], ['Call OpenAI (fallback)', 'AI Failed', 'error'],
  ['Check Draft', 'Draft OK?'],
  ['Draft OK?', 'Render Email', 'Pass'], ['Draft OK?', 'Stage: Rewriting', 'Rewrite'], ['Draft OK?', 'Record Result', 'Fail'],
  ['Stage: Rewriting', 'Rewrite (Anthropic)'],
  ['Rewrite (Anthropic)', 'Check Rewrite'], ['Rewrite (Anthropic)', 'Rewrite (OpenAI fallback)', 'error'],
  ['Rewrite (OpenAI fallback)', 'Check Rewrite'], ['Rewrite (OpenAI fallback)', 'AI Failed', 'error'],
  ['Check Rewrite', 'Rewrite OK?'], ['Rewrite OK?', 'Render Email', 'true'], ['Rewrite OK?', 'Record Result', 'false'],
  ['AI Failed', 'Record Result'],
  ['Render Email', 'Send Now?'], ['Send Now?', 'Deliver Email', 'true'], ['Send Now?', 'Record Result', 'false'],
];

/**
 * Grid cells [column, row]. The happy path is row 0, left to right; branches sit below the node they
 * leave. An empty column between sections keeps their notes apart.
 */
const grid = {
  'Royalty Summary Webhook': [0, 0], 'Load Settings': [1, 0], 'Check Settings': [2, 0], 'Settings OK?': [3, 0], 'Validate Body': [4, 0],
  'Request Valid?': [5, 0], 'Respond Rejected': [6, 1],
  'Enqueue Job': [7, 0], Outcome: [8, 0], 'Respond 202': [9, 0], 'Respond Duplicate': [9, 1], 'Respond 429': [9, 2], 'Mark Processing': [10, 0],
  'Build Context': [11, 0], 'Context OK?': [12, 0],
  'Call Anthropic': [13, 0], 'Call OpenAI (fallback)': [14, 1],
  'Check Draft': [15, 0], 'Draft OK?': [16, 0], 'Stage: Rewriting': [17, 1], 'Rewrite (Anthropic)': [18, 1],
  'Rewrite (OpenAI fallback)': [19, 2], 'Check Rewrite': [20, 1], 'Rewrite OK?': [21, 1],
  'Render Email': [22, 0], 'Send Now?': [23, 0], 'Deliver Email': [24, 0],
  'AI Failed': [23, 3], 'Record Result': [24, 3],
};

const sections = [
  { title: 'Intake', text: 'The settings are checked (bad settings: 500), then the body (a bad body: 400).',
    nodes: ['Royalty Summary Webhook', 'Load Settings', 'Check Settings', 'Settings OK?', 'Validate Body', 'Request Valid?', 'Respond Rejected'] },
  { title: 'Ledger', text: 'One locked call: a new job (202), a double click (200, the same job) or the hourly cap (429).',
    nodes: ['Enqueue Job', 'Outcome', 'Respond 202', 'Respond Duplicate', 'Respond 429', 'Mark Processing'] },
  { title: 'Data & facts', text: 'Figures checked, facts and prompt built.', nodes: ['Build Context', 'Context OK?'] },
  { title: 'AI writer', text: 'Anthropic writes; OpenAI if it fails.', nodes: ['Call Anthropic', 'Call OpenAI (fallback)'] },
  { title: 'Fact check', text: 'Every figure is checked against the data. One rewrite with the checker\'s notes (Anthropic, then OpenAI).',
    nodes: ['Check Draft', 'Draft OK?', 'Stage: Rewriting', 'Rewrite (Anthropic)', 'Rewrite (OpenAI fallback)', 'Check Rewrite', 'Rewrite OK?'] },
  { title: 'Render & deliver', text: 'HTML and text email; Deliver Email sends it once.', nodes: ['Render Email', 'Send Now?', 'Deliver Email'] },
  { title: 'Record', text: 'Drafts and every failure end here.', nodes: ['AI Failed', 'Record Result'] },
];

export default { name: 'BookLeaf - Royalty Summary', nodes, edges, grid, sections, about: ABOUT, errorWorkflow: 'BookLeaf - Error Handler' };
