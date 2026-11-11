import { ANTHROPIC_VERSION, FALLBACK_BETA, URL as ANTHROPIC_URL } from '../src/providers/anthropic.js';
import { URL as OPENAI_URL } from '../src/providers/openai.js';
import { AI_OUTCOMES } from '../src/pipeline/after-ai.js';
import { ENQUEUE_JOB, LOAD_SETTINGS, MARK_PROCESSING, SET_STAGE, UPDATE_JOB } from '../src/pipeline/sql.js';
import { DELIVER_EMAIL } from './deliver-email.mjs';
import { code, executeWorkflow, http, ifTrue, IS_TRUE, note, pg, respond, switchRules, webhook, withNote } from './lib/nodes.mjs';
import { TUNING } from './lib/tuning.mjs';

/**
 * Bubble posts the author and books with the request, gets 202 + job id at once, then polls job-status
 * (n8n never calls Bubble). The happy path is the top row; every other branch sits below it.
 */
const WEBHOOK = "$('Royalty Summary Webhook').first().json";
const JOB = "$('Prepare Job').first().json.job";
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
  note('About', ABOUT, 240, { position: [-40, -300], width: 1520 }),
  webhook('Royalty Summary Webhook', 'POST', 'royalty-summary'),
  pg('Load Settings', LOAD_SETTINGS, null),
  withNote(code('Prepare Job', 'prepare', `return main({ body: ${WEBHOOK}.body, settings: $json.settings, now: Date.now(), executionId: $execution.id });`), 'Checks the body; builds job'),
  ifTrue('Request Valid?', '$json.ok', IS_TRUE),
  respond('Respond Rejected'),
  withNote(pg('Enqueue Job', ENQUEUE_JOB, '$json.enqueue'), 'Locked: duplicate, cap, new'),
  switchRules('Outcome', '$json.outcome', [
    { output: 'Queued', equals: 'queued' }, { output: 'Duplicate', equals: 'duplicate' }, { output: 'Rate limited', equals: 'rate_limited' },
  ]),
  respond('Respond 202', '202', '{ job_id: $json.job_id, status: $json.status, duplicate: false }'),
  respond('Respond Duplicate', '200', 'Object.assign({ job_id: $json.job_id, status: $json.status, duplicate: true }, $json.error_code ? { error_code: $json.error_code } : {})'),
  respond('Respond 429', '429', "$('Prepare Job').first().json.rate_limited"),
  withNote(pg('Mark Processing', MARK_PROCESSING, `JSON.stringify({ job_id: ${JOB}.job_id })`), 'PROCESSING, stage writing'),
  code('Build Context', 'context', `return main({ job: ${JOB} });`),
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
  ['Royalty Summary Webhook', 'Load Settings'], ['Load Settings', 'Prepare Job'], ['Prepare Job', 'Request Valid?'],
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

/** The happy path: one row, left to right. */
const mainRow = ['Royalty Summary Webhook', 'Load Settings', 'Prepare Job', 'Request Valid?', 'Enqueue Job', 'Outcome', 'Respond 202',
  'Mark Processing', 'Build Context', 'Context OK?', 'Call Anthropic', 'Check Draft', 'Draft OK?', 'Render Email', 'Send Now?', 'Deliver Email'];

export default { name: 'BookLeaf - Royalty Summary', nodes, edges, mainRow, errorWorkflow: 'BookLeaf - Error Handler' };
