import { strictSectionsSchema } from './schema.js';
import { parseSectionsText } from './sections.js';

export const name = 'openai';
export const URL = 'https://api.openai.com/v1/responses';
/** Replaced by the n8n credential; never a real key. */
export const CREDENTIAL_PLACEHOLDER = 'Bearer __OPENAI_API_KEY__';
export const DEFAULT_MODEL = 'gpt-4.1-mini';
export const DEFAULT_MAX_TOKENS = 4000;
export const SCHEMA_NAME = 'royalty_email_sections';

const err = (code, message) => ({ ok: false, error: { code, message } });

/**
 * Responses API request with strict json_schema output. OpenAI strict mode needs every property
 * required, so the strict schema is always used regardless of the schema passed in.
 * @param {{system:string, user?:string, messages?:{role:'user'|'assistant', content:string}[], schema?:Object,
 *   model?:string, maxTokens?:number}} input  `messages` (a regeneration conversation) wins over `user`.
 */
export function buildRequest({ system, user, messages, model = DEFAULT_MODEL, maxTokens = DEFAULT_MAX_TOKENS }) {
  return {
    url: URL,
    headers: { 'content-type': 'application/json', authorization: CREDENTIAL_PLACEHOLDER },
    body: {
      model,
      instructions: system,
      input: messages ? messages.map((m) => ({ role: m.role, content: m.content })) : user,
      max_output_tokens: maxTokens,
      text: { format: { type: 'json_schema', name: SCHEMA_NAME, strict: true, schema: strictSectionsSchema } },
    },
  };
}

/** @param {Object} json @returns {import('./cost.js').Usage} OpenAI counts cached tokens inside input_tokens */
export function usageOf(json) {
  const cached = json.usage?.input_tokens_details?.cached_tokens ?? 0;
  return { inputTokens: (json.usage?.input_tokens ?? 0) - cached, outputTokens: json.usage?.output_tokens ?? 0, cacheWriteTokens: 0, cacheReadTokens: cached };
}

function outputText(json) {
  const contents = (json.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
  if (contents.some((c) => c.type === 'refusal')) return err('REFUSED', 'The model declined to answer');
  const t = contents.find((c) => c.type === 'output_text');
  return t ? { ok: true, text: t.text } : err('EMPTY', 'Response has no output text');
}

/**
 * @param {unknown} json parsed HTTP response body
 * @returns {{ok:true, sections:Object, usage:import('./cost.js').Usage, model:string}|{ok:false, error:{code:string, message:string}}}
 */
export function parseResponse(json) {
  if (typeof json !== 'object' || json === null) return err('INVALID_RESPONSE', 'Response is not an object');
  if (json.error) return err('API_ERROR', `${json.error.code ?? 'error'}: ${json.error.message ?? ''}`);
  if (json.status === 'incomplete') return err('TRUNCATED', 'The answer was cut short');
  const text = outputText(json);
  if (!text.ok) return text;
  const parsed = parseSectionsText(text.text);
  if (!parsed.ok) return parsed;
  return { ok: true, sections: parsed.sections, usage: usageOf(json), model: json.model ?? DEFAULT_MODEL };
}
