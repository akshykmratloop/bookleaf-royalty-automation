import { parseSectionsText } from './sections.js';

export const name = 'anthropic';
export const URL = 'https://api.anthropic.com/v1/messages';
/** Replaced by the n8n credential; never a real key. */
export const CREDENTIAL_PLACEHOLDER = '__ANTHROPIC_API_KEY__';
export const ANTHROPIC_VERSION = '2023-06-01';
/** Claude Sonnet 5.5 (claude-api skill, model table). */
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
/** Adaptive thinking counts towards max_tokens, so leave room above the ~600-token email. */
export const DEFAULT_MAX_TOKENS = 8000;
/** Effort for a short, rule-heavy writing task: thorough enough to follow the rules, not slow. */
export const DEFAULT_EFFORT = 'medium';
/** Server-side refusal fallback (claude-api skill): routes a declined request to another model in the same call. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const err = (code, message) => ({ ok: false, error: { code, message } });

/**
 * Messages API request with structured JSON output (output_config.format = json_schema).
 * Sonnet 5.5: no sampling params, no `thinking` field (adaptive by default), no assistant prefill.
 * The system prompt is one cached block (it is identical for every author).
 * @param {{system:string, user?:string, messages?:{role:'user'|'assistant', content:string}[], schema:Object,
 *   model?:string, maxTokens?:number, effort?:string, serverFallback?:boolean}} input
 *   `messages` (a regeneration conversation) wins over `user`.
 * @returns {{url:string, headers:Object, body:Object}}
 */
export function buildRequest({
  system, user, messages, schema, model = DEFAULT_MODEL, maxTokens = DEFAULT_MAX_TOKENS, effort = DEFAULT_EFFORT,
  serverFallback = true,
}) {
  const headers = { 'content-type': 'application/json', 'anthropic-version': ANTHROPIC_VERSION, 'x-api-key': CREDENTIAL_PLACEHOLDER };
  const body = {
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: messages ? messages.map((m) => ({ role: m.role, content: m.content })) : [{ role: 'user', content: user }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  };
  if (!serverFallback) return { url: URL, headers, body };
  return { url: URL, headers: { ...headers, 'anthropic-beta': FALLBACK_BETA }, body: { ...body, fallbacks: 'default' } };
}

/** @param {Object} json @returns {import('./cost.js').Usage} input_tokens excludes cache writes and reads */
export const usageOf = (json) => ({
  inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0,
  cacheWriteTokens: json.usage?.cache_creation_input_tokens ?? 0, cacheReadTokens: json.usage?.cache_read_input_tokens ?? 0,
});

function checkStop(json) {
  if (json.stop_reason === 'refusal') return err('REFUSED', 'The model declined to answer');
  if (json.stop_reason === 'max_tokens') return err('TRUNCATED', 'The answer hit the token limit');
  return null;
}

/**
 * @param {unknown} json parsed HTTP response body
 * @returns {{ok:true, sections:Object, usage:import('./cost.js').Usage, model:string}|{ok:false, error:{code:string, message:string}}}
 */
export function parseResponse(json) {
  if (typeof json !== 'object' || json === null) return err('INVALID_RESPONSE', 'Response is not an object');
  if (json.type === 'error') return err('API_ERROR', `${json.error?.type ?? 'error'}: ${json.error?.message ?? ''}`);
  const stop = checkStop(json);
  if (stop) return stop;
  const block = Array.isArray(json.content) ? json.content.find((b) => b.type === 'text') : undefined;
  if (!block) return err('EMPTY', 'Response has no text block');
  const parsed = parseSectionsText(block.text);
  if (!parsed.ok) return parsed;
  return { ok: true, sections: parsed.sections, usage: usageOf(json), model: json.model ?? DEFAULT_MODEL };
}
