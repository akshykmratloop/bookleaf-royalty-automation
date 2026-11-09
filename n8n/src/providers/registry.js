import * as anthropicModule from './anthropic.js';
import * as openaiModule from './openai.js';

/** Plain objects (not module namespaces), so the registry also works inside n8n's Code-node sandbox. */
const pick = (m) => Object.freeze({ name: m.name, buildRequest: m.buildRequest, parseResponse: m.parseResponse, DEFAULT_MODEL: m.DEFAULT_MODEL });
const PROVIDERS = Object.freeze({ anthropic: pick(anthropicModule), openai: pick(openaiModule) });
export const PROVIDER_NAMES = Object.freeze(Object.keys(PROVIDERS));

/**
 * Selects the AI provider by validated config name (AI_PROVIDER). The only place that maps names to modules.
 * @param {string} providerName @returns {{name:string, buildRequest:Function, parseResponse:Function, DEFAULT_MODEL:string}}
 * @throws {Error} Unknown AI provider
 */
export function getProvider(providerName) {
  const p = PROVIDERS[providerName];
  if (!p) throw new Error(`Unknown AI provider "${providerName}". Use one of: ${PROVIDER_NAMES.join(', ')}`);
  return p;
}
