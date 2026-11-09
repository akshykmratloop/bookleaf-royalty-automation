import { ANTHROPIC_VERSION, FALLBACK_BETA, URL as ANTHROPIC_URL } from '../src/providers/anthropic.js';
import { URL as OPENAI_URL } from '../src/providers/openai.js';
import { INSERT_JOB, MARK_PROCESSING, UPDATE_CALLBACK, UPDATE_JOB } from '../src/pipeline/sql.js';
import { code, http, note, pg, respond, route, sendEmail, webhook } from './lib/nodes.mjs';

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
const bubbleGet = (name, urlExpr) => http(name, {
  method: 'GET', url: `={{ ${urlExpr} }}`, credential: 'bubble', authType: 'httpBearerAuth', timeoutMs: 20_000, retry: 2, waitMs: 2000, errorOutput: true,
});

const nodes = [
  note('About', '## BookLeaf royalty summary (pull mode)\nPOST /webhook/royalty-summary with header X-BookLeaf-Key.\nAnswers 202 {job_id} at once, then writes, fact-checks and sends the email and records SENT/FAILED in royalty_jobs. Every failure branch ends in **Update Job**. Code nodes are generated from n8n/src by n8n/build.mjs.', 240),
  webhook('Royalty Summary Webhook', 'POST', 'royalty-summary'),
  code('Prepare Job', 'prepare', 'return main({ body: $json.body, env: $env, now: Date.now() });'),
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
  anthropicCall('Call Anthropic', 'JSON.stringify($json.ctx.requests.anthropic)'),
  openaiCall('Call OpenAI (fallback)', `JSON.stringify(${CTX}.requests.openai)`),
  code('AI Failed', 'aiFailed', `return main({ job: ${JOB}, anthropicError: $('Call Anthropic').all(1)[0]?.json, openaiError: $json });`),
  code('Check Draft', 'checkDraft', `return main({ response: $json, ctx: ${CTX}, job: ${JOB}, attempt: 1 });`),
  route('Draft OK?', 4, '$json.route'),
  anthropicCall('Regenerate (Anthropic)', 'JSON.stringify($json.regenerate.body)'),
  openaiCall('Regenerate (OpenAI)', 'JSON.stringify($json.regenerate.body)'),
  code('Regeneration Failed', 'regenerationFailed', `return main({ job: ${JOB}, error: $json, previous: $('Check Draft').first().json.ai });`),
  code('Check Draft (retry)', 'checkDraft', `return main({ response: $json, ctx: ${CTX}, job: ${JOB}, attempt: 2, previous: $('Check Draft').first().json.ai });`),
  route('Retry OK?', 2, '$json.route'),
  code('Render Email', 'render', `return main({ ctx: ${CTX}, job: ${JOB}, ai: $json.ai });`),
  route('Email Drill?', 2, '$json.route'),
  sendEmail('Send Email', 'smtp'),
  sendEmail('Send Email (drill: SMTP down)', 'smtpDrill'),
  code('Mark Sent', 'markSent', `return main({ job: ${JOB}, rendered: $('Render Email').first().json });`),
  code('Email Failed', 'emailFailed', `return main({ job: ${JOB}, rendered: $('Render Email').first().json, error: $json });`),
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
  ['Build Context', 'Context OK?'], ['Context OK?', 'Update Job', 0], ['Context OK?', 'Call Anthropic', 1],
  ['Call Anthropic', 'Check Draft', 0], ['Call Anthropic', 'Call OpenAI (fallback)', 1],
  ['Call OpenAI (fallback)', 'Check Draft', 0], ['Call OpenAI (fallback)', 'AI Failed', 1], ['AI Failed', 'Update Job'],
  ['Check Draft', 'Draft OK?'],
  ['Draft OK?', 'Render Email', 0], ['Draft OK?', 'Regenerate (Anthropic)', 1], ['Draft OK?', 'Regenerate (OpenAI)', 2], ['Draft OK?', 'Update Job', 3],
  ['Regenerate (Anthropic)', 'Check Draft (retry)', 0], ['Regenerate (Anthropic)', 'Regeneration Failed', 1],
  ['Regenerate (OpenAI)', 'Check Draft (retry)', 0], ['Regenerate (OpenAI)', 'Regeneration Failed', 1],
  ['Regeneration Failed', 'Update Job'],
  ['Check Draft (retry)', 'Retry OK?'], ['Retry OK?', 'Render Email', 0], ['Retry OK?', 'Update Job', 1],
  ['Render Email', 'Email Drill?'], ['Email Drill?', 'Send Email', 0], ['Email Drill?', 'Send Email (drill: SMTP down)', 1],
  ['Send Email', 'Mark Sent', 0], ['Send Email', 'Email Failed', 1],
  ['Send Email (drill: SMTP down)', 'Mark Sent', 0], ['Send Email (drill: SMTP down)', 'Email Failed', 1],
  ['Mark Sent', 'Update Job'], ['Email Failed', 'Update Job'],
  ['Update Job', 'After Update'], ['After Update', 'Push Callback?'], ['Push Callback?', 'Notify Bubble', 1],
  ['Notify Bubble', 'Callback Result', 0], ['Notify Bubble', 'Callback Result', 1], ['Callback Result', 'Update Callback'],
];

export default { name: 'BookLeaf - Royalty Summary', nodes, edges, errorWorkflow: 'BookLeaf - Error Handler' };
