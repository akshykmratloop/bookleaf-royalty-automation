/** USD per million tokens. Source: Anthropic model pricing (claude-api skill, cached 2026-10-06). */
export const SONNET_5_5_PRICE = Object.freeze({ inputPerMTok: 2, outputPerMTok: 10 });
/** PLACEHOLDER rates for a gpt-4.1-mini-class model: verify against OpenAI pricing before relying on them. */
export const OPENAI_MINI_PLACEHOLDER_PRICE = Object.freeze({ inputPerMTok: 0.4, outputPerMTok: 1.6 });

export const PRICES = Object.freeze({
  'claude-sonnet-5-5': SONNET_5_5_PRICE,
  'gpt-4.1-mini': OPENAI_MINI_PLACEHOLDER_PRICE,
});

/**
 * @param {{inputTokens:number, outputTokens:number}} usage @param {string} model
 * @returns {number|null} USD (6 dp), or null when the model has no known price (never guessed)
 */
export function costUsd(usage, model) {
  const key = Object.keys(PRICES).find((k) => model === k || String(model).startsWith(`${k}-`));
  if (!key) return null;
  const p = PRICES[key];
  const usd = (usage.inputTokens * p.inputPerMTok + usage.outputTokens * p.outputPerMTok) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
