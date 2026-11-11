import { ANTHROPIC_VERSION, FALLBACK_BETA, URL as ANTHROPIC_URL } from '../src/providers/anthropic.js';
import { URL as OPENAI_URL } from '../src/providers/openai.js';
import { INSERT_JOB, MARK_PROCESSING, SET_STAGE, UPDATE_CALLBACK, UPDATE_JOB } from '../src/pipeline/sql.js';
import { code, http, KEY_HASHES_PLACEHOLDER, note, pg, respond, route, sendEmail, webhook } from './lib/nodes.mjs';

/** Pull mode: Bubble posts the author payload, gets 202 + job id at once, then polls job-status. */
const JOB = "$('Prepare Job').first().json.job";
const CTX = "$('Build Context').first().json.ctx";
const S = `const job = ${JOB};\n`;
const AI = { timeoutMs: 45_000, retry: 2, waitMs: 2000, errorOutput: true };
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
const bubbleGet = (name, urlExpr) => http(name, {
  method: 'GET', url: `={{ ${urlExpr} }}`, credential: 'bubble', authType: 'httpBearerAuth', timeoutMs: 20_000, retry: 2, waitMs: 2000, errorOutput: true,
});

const nodes = [
  note('About', '## BookLeaf royalty summary (pull mode)\nPOST /webhook/royalty-summary with header X-BookLeaf-Key (checked in Prepare Job; current and next key accepted).\nAnswers 202 {job_id} at once, then writes, fact-checks and sends the email (or saves a DRAFTED job for approval when delivery=draft) and records the result in royalty_jobs, with a live `stage`. Every failure branch ends in **Update Job**. Code nodes are generated from n8n/src by n8n/build.mjs.', 260),
  webhook('Royalty Summary Webhook', 'POST', 'royalty-summary'),
  code('Prepare Job', 'prepare', `return main({ body: $json.body, headers: $json.headers, keyHashes: '${KEY_HASHES_PLACEHOLDER}', env: $env, now: Date.now() });`),
  route('Valid?', 2, '$json.route'),
  respond('Respond Rejected'),
  pg('Insert Job', INSERT_JOB, '$json.insert_params'),
  code('Classify', 'classify', `return main({ row: $json, job: ${JOB} });`),
  respond('Respond Accepted'),
  route('Queued?', 3, '$json.route'),
  pg('Mark Processing', MARK_PROCESSING, `JSON.stringify({ job_id: ${JOB}.job_id })`),
  route('Data Source', 2, `${JOB}.config.dataSource === 'bubble' ? 1 : 0`),
  code('Bubble Queries', 'bubbleQueries', `return main({ job: ${JOB} });`),
  bubbleGet('Bubble Author', '$json.author_url'),
  bubbleGet('Bubble Books', "$('Bubble Queries').first().json.books_url"),
  bubbleGet('Bubble Royalties', "$('Bubble Queries').first().json.royalties_url"),
  code('Bubble Data Failed', 'dataFailed', `return main({ job: ${JOB}, error: $json });`),
  code('Build Context', 'context', `${S}const bubble = job.config.dataSource === 'bubble'
  ? { author: $('Bubble Author').first().json, books: $('Bubble Books').first().json, royalties: $('Bubble Royalties').first().json }
  : null;
return main({ job, bubble });`),
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
  code('Mark Sent', 'markSent', `return main({ job: ${JOB}, rendered: ${RENDERED} });`),
  code('Email Failed', 'emailFailed', `return main({ job: ${JOB}, rendered: ${RENDERED}, error: $json });`),
  pg('Update Job', UPDATE_JOB, 'JSON.stringify($json.update)'),
  code('After Update', 'afterUpdate', `return main({ row: $json, job: ${JOB} });`),
  route('Push Callback?', 2, '$json.route'),
  http('Notify Bubble', {
    method: 'POST', url: '={{ $json.callback.url }}', credential: 'bubble', authType: 'httpBearerAuth',
    body: 'JSON.stringify($json.callback.body)', timeoutMs: 20_000, retry: 3, waitMs: 5000, errorOutput: true,
  }),
  code('Callback Result', 'callbackResult', "return main({ jobId: $('After Update').first().json.job_id, error: $json.error ? $json : null });"),
  pg('Update Callback', UPDATE_CALLBACK, '$json.params'),
];

const edges = [
  ['Royalty Summary Webhook', 'Prepare Job'], ['Prepare Job', 'Valid?'],
  ['Valid?', 'Respond Rejected', 0], ['Valid?', 'Insert Job', 1],
  ['Insert Job', 'Classify'], ['Classify', 'Respond Accepted'], ['Respond Accepted', 'Queued?'],
  ['Queued?', 'Mark Processing', 0], ['Mark Processing', 'Data Source'],
  ['Data Source', 'Build Context', 0], ['Data Source', 'Bubble Queries', 1],
  ['Bubble Queries', 'Bubble Author'], ['Bubble Author', 'Bubble Books', 0], ['Bubble Author', 'Bubble Data Failed', 1],
  ['Bubble Books', 'Bubble Royalties', 0], ['Bubble Books', 'Bubble Data Failed', 1],
  ['Bubble Royalties', 'Build Context', 0], ['Bubble Royalties', 'Bubble Data Failed', 1],
  ['Bubble Data Failed', 'Update Job'],
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
  ['Update Job', 'After Update'], ['After Update', 'Push Callback?'], ['Push Callback?', 'Notify Bubble', 1],
  ['Notify Bubble', 'Callback Result', 0], ['Notify Bubble', 'Callback Result', 1], ['Callback Result', 'Update Callback'],
];

export default { name: 'BookLeaf - Royalty Summary', nodes, edges, errorWorkflow: 'BookLeaf - Error Handler' };
