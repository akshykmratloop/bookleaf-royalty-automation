/**
 * USD per million tokens. Cache multipliers apply to the input price.
 * Sonnet 5.5: claude-api skill model table (cached 2026-10-06): $2 in, $10 out, cache reads $0.20 (0.1x),
 * 5-minute cache writes 1.25x.
 */
export const SONNET_5_5_PRICE = Object.freeze({ inputPerMTok: 2, outputPerMTok: 10, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1 });
/**
 * gpt-4.1-mini, OpenAI standard tier (developers.openai.com/api/docs/pricing, checked 2026-11-11):
 * $0.40 in, $1.60 out, cached input $0.10 (0.25x); OpenAI charges nothing extra to write its cache.
 */
export const GPT_4_1_MINI_PRICE = Object.freeze({ inputPerMTok: 0.4, outputPerMTok: 1.6, cacheWriteMultiplier: 1, cacheReadMultiplier: 0.25 });

export const PRICES = Object.freeze({
  'claude-sonnet-5-5': SONNET_5_5_PRICE,
  'gpt-4.1-mini': GPT_4_1_MINI_PRICE,
});

/**
 * @typedef {{inputTokens:number, outputTokens:number, cacheWriteTokens?:number, cacheReadTokens?:number}} Usage
 * inputTokens = uncached input only; cache writes/reads are counted separately.
 */

/** @param {Usage} u @returns {number} every input token, cached or not */
export const totalInputTokens = (u) => u.inputTokens + (u.cacheWriteTokens ?? 0) + (u.cacheReadTokens ?? 0);

/**
 * @param {Usage} usage @param {string} model
 * @returns {number|null} USD (6 dp), or null when the model has no known price (never guessed)
 */
export function costUsd(usage, model) {
  const key = Object.keys(PRICES).find((k) => model === k || String(model).startsWith(`${k}-`));
  if (!key) return null;
  const p = PRICES[key];
  const input = usage.inputTokens + (usage.cacheWriteTokens ?? 0) * p.cacheWriteMultiplier + (usage.cacheReadTokens ?? 0) * p.cacheReadMultiplier;
  const usd = (input * p.inputPerMTok + usage.outputTokens * p.outputPerMTok) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
