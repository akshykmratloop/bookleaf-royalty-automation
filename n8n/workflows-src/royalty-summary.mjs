import { ANTHROPIC_VERSION, FALLBACK_BETA, URL as ANTHROPIC_URL } from '../src/providers/anthropic.js';
import { URL as OPENAI_URL } from '../src/providers/openai.js';
import { INSERT_JOB, LOAD_SETTINGS, MARK_PROCESSING, SET_STAGE, UPDATE_JOB } from '../src/pipeline/sql.js';
import { code, http, KEY_HASHES_PLACEHOLDER, note, pg, respond, route, sendEmail, webhook } from './lib/nodes.mjs';
import { TUNING } from './lib/tuning.mjs';

/**
 * Bubble posts the author and books with the request, gets 202 + job id at once, then polls job-status
 * (n8n never calls Bubble: no Data API reads, no push callback).
 */
const WEBHOOK = "$('Royalty Summary Webhook').first().json";
const JOB = "$('Prepare Job').first().json.job";
const CTX = "$('Build Context').first().json.ctx";
/** Timeout from the ai_timeout_ms setting (carried on the job); retries are build-time node settings. */
const AI = { timeout: `={{ ${JOB}.settings.ai_timeout_ms }}`, retry: TUNING.aiRetries, waitMs: TUNING.aiRetryWaitMs, errorOutput: true };
const anthropicCall = (name, body) => http(name, {
  method: 'POST', url: ANTHROPIC_URL, credential: 'anthropic', authType: 'httpHeaderAuth', body, ...AI,
  headers: { 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-beta': FALLBACK_BETA },
});
const openaiCall = (name, body) => http(name, { method: 'POST', url: OPENAI_URL, credential: 'openai', authType: 'httpBearerAuth', body, ...AI });
/** Live progress for job-status. alwaysOutputData: a job already finished elsewhere just continues to its end. */
const setStage = (name, stage) => pg(name, SET_STAGE, `JSON.stringify({ job_id: ${JOB}.job_id, stage: '${stage}' })`, { alwaysOutputData: true });
const CHECK = "$('Check Draft').first().json";
const RENDERED = "$('Render Email').first().json";
/** The first answer came from OpenAI when Anthropic failed and the fallback ran. */
const FIRST_ANSWER = "$('Call OpenAI (fallback)').isExecuted ? $('Call OpenAI (fallback)').first().json : $('Call Anthropic').first().json";

const nodes = [
  note('About', '## BookLeaf royalty summary\nPOST /webhook/royalty-summary with header X-BookLeaf-Key (checked in Prepare Job; current and next key accepted).\nServer settings come from the bookleaf_settings table (Load Settings). Answers 202 {job_id} at once, then writes, fact-checks and sends the email (or saves a DRAFTED job for approval when delivery=draft) and records the result in royalty_jobs, with a live `stage`. Every failure branch ends in **Update Job**. Code nodes are generated from n8n/src by n8n/build.mjs.', 260),
  webhook('Royalty Summary Webhook', 'POST', 'royalty-summary'),
  pg('Load Settings', LOAD_SETTINGS, null),
  code('Prepare Job', 'prepare', `return main({ body: ${WEBHOOK}.body, headers: ${WEBHOOK}.headers, keyHashes: '${KEY_HASHES_PLACEHOLDER}', settings: $json.settings, now: Date.now() });`),
  route('Valid?', 2, '$json.route'),
  respond('Respond Rejected'),
  pg('Insert Job', INSERT_JOB, '$json.insert_params'),
  code('Classify', 'classify', `return main({ row: $json, job: ${JOB} });`),
  respond('Respond Accepted'),
  route('Queued?', 3, '$json.route'),
  pg('Mark Processing', MARK_PROCESSING, `JSON.stringify({ job_id: ${JOB}.job_id })`),
  code('Build Context', 'context', `return main({ job: ${JOB} });`),
  route('Context OK?', 2, '$json.route'),
  setStage('Stage: Writing', 'writing'),
  anthropicCall('Call Anthropic', `JSON.stringify(${CTX}.requests.anthropic)`),
  openaiCall('Call OpenAI (fallback)', `JSON.stringify(${CTX}.requests.openai)`),
  code('AI Failed', 'aiFailed', `return main({ job: ${JOB}, anthropicError: $('Call Anthropic').all(1)[0]?.json, openaiError: $json });`),
  setStage('Stage: Checking', 'checking'),
  code('Check Draft', 'checkDraft', `return main({ response: ${FIRST_ANSWER}, ctx: ${CTX}, job: ${JOB}, attempt: 1 });`),
  route('Draft OK?', 4, '$json.route'),
  setStage('Stage: Rewriting', 'rewriting'),
  route('Rewrite With?', 2, `${CHECK}.route === 2 ? 1 : 0`),
  anthropicCall('Regenerate (Anthropic)', `JSON.stringify(${CHECK}.regenerate.body)`),
  openaiCall('Regenerate (OpenAI)', `JSON.stringify(${CHECK}.regenerate.body)`),
  code('Regeneration Failed', 'regenerationFailed', `return main({ job: ${JOB}, error: $json, previous: $('Check Draft').first().json.ai });`),
  code('Check Draft (retry)', 'checkDraft', `return main({ response: $json, ctx: ${CTX}, job: ${JOB}, attempt: 2, previous: $('Check Draft').first().json.ai });`),
  route('Retry OK?', 2, '$json.route'),
  code('Render Email', 'render', `return main({ ctx: ${CTX}, job: ${JOB}, ai: $json.ai });`),
  route('Draft?', 2, '$json.route'),
  setStage('Stage: Sending', 'sending'),
  route('Email Drill?', 2, `${RENDERED}.drill ? 1 : 0`),
  sendEmail('Send Email', 'smtp', `${RENDERED}.email`),
  sendEmail('Send Email (drill: SMTP down)', 'smtpDrill', `${RENDERED}.email`),
  code('Mark Sent', 'markSent', `return main({ rendered: ${RENDERED} });`),
  code('Email Failed', 'emailFailed', `return main({ job: ${JOB}, rendered: ${RENDERED}, error: $json });`),
  pg('Update Job', UPDATE_JOB, 'JSON.stringify($json.update)'),
];

const edges = [
  ['Royalty Summary Webhook', 'Load Settings'], ['Load Settings', 'Prepare Job'], ['Prepare Job', 'Valid?'],
  ['Valid?', 'Respond Rejected', 0], ['Valid?', 'Insert Job', 1],
  ['Insert Job', 'Classify'], ['Classify', 'Respond Accepted'], ['Respond Accepted', 'Queued?'],
  ['Queued?', 'Mark Processing', 0], ['Mark Processing', 'Build Context'],
  ['Build Context', 'Context OK?'], ['Context OK?', 'Update Job', 0], ['Context OK?', 'Stage: Writing', 1], ['Stage: Writing', 'Call Anthropic'],
  ['Call Anthropic', 'Stage: Checking', 0], ['Call Anthropic', 'Call OpenAI (fallback)', 1],
  ['Call OpenAI (fallback)', 'Stage: Checking', 0], ['Call OpenAI (fallback)', 'AI Failed', 1], ['AI Failed', 'Update Job'],
  ['Stage: Checking', 'Check Draft'], ['Check Draft', 'Draft OK?'],
  ['Draft OK?', 'Render Email', 0], ['Draft OK?', 'Stage: Rewriting', 1], ['Draft OK?', 'Stage: Rewriting', 2], ['Draft OK?', 'Update Job', 3],
  ['Stage: Rewriting', 'Rewrite With?'], ['Rewrite With?', 'Regenerate (Anthropic)', 0], ['Rewrite With?', 'Regenerate (OpenAI)', 1],
  ['Regenerate (Anthropic)', 'Check Draft (retry)', 0], ['Regenerate (Anthropic)', 'Regeneration Failed', 1],
  ['Regenerate (OpenAI)', 'Check Draft (retry)', 0], ['Regenerate (OpenAI)', 'Regeneration Failed', 1],
  ['Regeneration Failed', 'Update Job'],
  ['Check Draft (retry)', 'Retry OK?'], ['Retry OK?', 'Render Email', 0], ['Retry OK?', 'Update Job', 1],
  ['Render Email', 'Draft?'], ['Draft?', 'Stage: Sending', 0], ['Draft?', 'Update Job', 1], ['Stage: Sending', 'Email Drill?'],
  ['Email Drill?', 'Send Email', 0], ['Email Drill?', 'Send Email (drill: SMTP down)', 1],
  ['Send Email', 'Mark Sent', 0], ['Send Email', 'Email Failed', 1],
  ['Send Email (drill: SMTP down)', 'Mark Sent', 0], ['Send Email (drill: SMTP down)', 'Email Failed', 1],
  ['Mark Sent', 'Update Job'], ['Email Failed', 'Update Job'],
];

export default { name: 'BookLeaf - Royalty Summary', nodes, edges, errorWorkflow: 'BookLeaf - Error Handler' };
