import * as anthropic from './anthropic.js';
import * as openai from './openai.js';

const PROVIDERS = Object.freeze({ anthropic, openai });
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
