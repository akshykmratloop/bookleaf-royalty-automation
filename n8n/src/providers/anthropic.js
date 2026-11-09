import { parseSectionsText } from './sections.js';

export const name = 'anthropic';
export const URL = 'https://api.anthropic.com/v1/messages';
/** Replaced by the n8n credential; never a real key. */
export const CREDENTIAL_PLACEHOLDER = '__ANTHROPIC_API_KEY__';
export const ANTHROPIC_VERSION = '2023-06-01';
/** Claude Sonnet 5.5 (claude-api skill, model table). */
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_MAX_TOKENS = 4000;

const err = (code, message) => ({ ok: false, error: { code, message } });

/**
 * Messages API request with structured JSON output (output_config.format = json_schema).
 * Sonnet 5.5: no sampling params, no `thinking` field (adaptive by default), no assistant prefill.
 * @param {{system:string, user:string, schema:Object, model?:string, maxTokens?:number}} input
 * @returns {{url:string, headers:Object, body:Object}}
 */
export function buildRequest({ system, user, schema, model = DEFAULT_MODEL, maxTokens = DEFAULT_MAX_TOKENS }) {
  return {
    url: URL,
    headers: {
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      'x-api-key': CREDENTIAL_PLACEHOLDER,
    },
    body: {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema } },
    },
  };
}

function checkStop(json) {
  if (json.stop_reason === 'refusal') return err('REFUSED', 'The model declined to answer');
  if (json.stop_reason === 'max_tokens') return err('TRUNCATED', 'The answer hit the token limit');
  return null;
}

/**
 * @param {unknown} json parsed HTTP response body
 * @returns {{ok:true, sections:Object, usage:{inputTokens:number, outputTokens:number}, model:string}|{ok:false, error:{code:string, message:string}}}
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
  const usage = { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 };
  return { ok: true, sections: parsed.sections, usage, model: json.model ?? DEFAULT_MODEL };
}
