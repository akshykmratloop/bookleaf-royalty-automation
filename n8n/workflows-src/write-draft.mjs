import { ANTHROPIC_VERSION, FALLBACK_BETA, URL as ANTHROPIC_URL } from '../src/providers/anthropic.js';
import { URL as OPENAI_URL } from '../src/providers/openai.js';
import { TUNING } from '../src/pipeline/tuning.js';
import { code, http, subWorkflowTrigger, switchWhen, wait, withNote } from './lib/nodes.mjs';

/**
 * "BookLeaf - Write Draft": one AI draft, checked. Royalty Summary calls it twice: Write Draft (attempt 1,
 * the context's requests) and, when the checker asks for one, Rewrite Draft (attempt 2, the checker's
 * requests, the first draft's usage in `previous`). It returns Check Draft's or AI Failed's item.
 */
export const WRITE_DRAFT = Object.freeze({
  name: 'BookLeaf - Write Draft',
  inputs: Object.freeze([
    { name: 'job', type: 'object' }, // the running job (settings included)
    { name: 'ctx', type: 'object' }, // Build Context's facts, prompt and titles
    { name: 'request', type: 'object' }, // {anthropic, openai}: the two providers' request bodies
    { name: 'attempt', type: 'number' }, // 1 = the draft, 2 = the rewrite
    { name: 'previous', type: 'object' }, // the draft's AI usage on attempt 2; {} on attempt 1
  ]),
});

const CALL = "$('When Called').first().json";
const OK = '$json.statusCode >= 200 && $json.statusCode < 300';
/** No answer at all (timeout, connection refused), too many requests, or a server error: worth one more try. */
const TRANSIENT = `(!$json.statusCode || $json.statusCode === 429 || $json.statusCode >= 500) && $runIndex < ${TUNING.aiRetries}`;
/** Retry-After (seconds) when the provider sends it, else the base doubled per earlier wait; never over the cap. */
const BACKOFF = `Math.min(Number(($json.headers || {})['retry-after']) || ${TUNING.aiRetryBaseSeconds} * Math.pow(2, $runIndex), `
  + `${TUNING.aiRetryMaxWaitSeconds})`;
const AI = { method: 'POST', timeout: `={{ ${CALL}.job.settings.ai_timeout_ms }}` };
const answer = (name, giveUp) => switchWhen(name, [{ output: 'Answer', when: OK }, { output: 'Retry', when: TRANSIENT }], giveUp);
const PREVIOUS = `${CALL}.attempt > 1 ? ${CALL}.previous : null`;

const ABOUT = [
  '## BookLeaf write draft',
  'Called by **Royalty Summary** with `job`, `ctx`, `request` (both providers\' bodies), `attempt` (1 draft, 2 rewrite) and `previous`.',
  '**Call Anthropic** writes; its answer Switch sends a 2xx to **Check Draft**, retries a 429, 5xx or timeout after a short wait '
  + `(${TUNING.aiRetries} extra try, Retry-After honoured, at most ${TUNING.aiRetryMaxWaitSeconds} s), and hands anything else to `
  + '**Call OpenAI (fallback)**, which works the same way and ends in **AI Failed**. Check Draft checks every figure: PASS, REWRITE '
  + '(with both providers\' rewrite bodies) or FAIL. No error workflow here: a crash fails the caller\'s node.',
].join('\n');

const nodes = [
  subWorkflowTrigger('When Called', WRITE_DRAFT.inputs),
  http('Call Anthropic', {
    ...AI, url: ANTHROPIC_URL, credential: 'anthropic', authType: 'httpHeaderAuth', body: `JSON.stringify(${CALL}.request.anthropic)`,
    headers: { 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-beta': FALLBACK_BETA },
  }),
  withNote(answer('Anthropic Answer', 'Fallback'), 'Retry 429/5xx; else OpenAI'),
  withNote(wait('Wait (Anthropic)', BACKOFF), 'Growing wait; Retry-After'),
  http('Call OpenAI (fallback)', { ...AI, url: OPENAI_URL, credential: 'openai', authType: 'httpBearerAuth', body: `JSON.stringify(${CALL}.request.openai)` }),
  withNote(answer('OpenAI Answer', 'Give up'), 'Retry 429/5xx; else fail'),
  withNote(wait('Wait (OpenAI)', BACKOFF), 'Growing wait; Retry-After'),
  withNote(code('Check Draft', 'checkDraft', `return main({ response: $json.body, ctx: ${CALL}.ctx, job: ${CALL}.job, attempt: ${CALL}.attempt, previous: ${PREVIOUS} });`), 'Checks every figure'),
  withNote(code('AI Failed', 'aiFailed', `return main({ job: ${CALL}.job, rewriting: ${CALL}.attempt > 1, anthropicError: $('Anthropic Answer').first(2).json, openaiError: $json, previous: ${PREVIOUS} });`), 'Both providers failed'),
];

const edges = [
  ['When Called', 'Call Anthropic'], ['Call Anthropic', 'Anthropic Answer'], ['Call Anthropic', 'Anthropic Answer', 'error'],
  ['Anthropic Answer', 'Check Draft', 'Answer'], ['Anthropic Answer', 'Wait (Anthropic)', 'Retry'], ['Anthropic Answer', 'Call OpenAI (fallback)', 'Fallback'],
  ['Wait (Anthropic)', 'Call Anthropic'],
  ['Call OpenAI (fallback)', 'OpenAI Answer'], ['Call OpenAI (fallback)', 'OpenAI Answer', 'error'],
  ['OpenAI Answer', 'Check Draft', 'Answer'], ['OpenAI Answer', 'Wait (OpenAI)', 'Retry'], ['OpenAI Answer', 'AI Failed', 'Give up'],
  ['Wait (OpenAI)', 'Call OpenAI (fallback)'],
];

/** The Anthropic answer reads left to right on row 0; the OpenAI fallback sits below it, AI Failed below Check Draft. */
const grid = {
  'When Called': [0, 0], 'Call Anthropic': [1, 0], 'Anthropic Answer': [2, 0], 'Wait (Anthropic)': [2, 1],
  'Call OpenAI (fallback)': [3, 2], 'OpenAI Answer': [4, 2], 'Wait (OpenAI)': [4, 3],
  'Check Draft': [6, 0], 'AI Failed': [6, 3],
};
const sections = [
  { title: 'AI writer', text: 'Anthropic writes; OpenAI if it fails. Only a 429, 5xx or timeout is tried again.',
    nodes: ['When Called', 'Call Anthropic', 'Anthropic Answer', 'Wait (Anthropic)', 'Call OpenAI (fallback)', 'OpenAI Answer', 'Wait (OpenAI)'] },
  { title: 'Fact check', text: 'Every figure against the data.', nodes: ['Check Draft'] },
  { title: 'Record', text: 'Neither provider answered.', nodes: ['AI Failed'] },
];

export default { name: WRITE_DRAFT.name, nodes, edges, grid, sections, about: ABOUT };
