/**
 * Token cost in USD. Prices are the model_prices setting (n8n/src/pipeline/settings.js): USD per
 * million tokens, with the cache multipliers applied to the input price.
 * @typedef {{inputPerMTok:number, outputPerMTok:number, cacheWriteMultiplier:number, cacheReadMultiplier:number}} Price
 */

/**
 * @typedef {{inputTokens:number, outputTokens:number, cacheWriteTokens?:number, cacheReadTokens?:number}} Usage
 * inputTokens = uncached input only; cache writes/reads are counted separately.
 */

/** @param {Usage} u @returns {number} every input token, cached or not */
export const totalInputTokens = (u) => u.inputTokens + (u.cacheWriteTokens ?? 0) + (u.cacheReadTokens ?? 0);

/**
 * @param {Usage} usage @param {string} model as the provider reported it (a dated id matches its base name)
 * @param {Record<string, Price>} prices the model_prices setting
 * @returns {number|null} USD (6 dp), or null when the model has no price (never guessed)
 */
export function costUsd(usage, model, prices) {
  const key = Object.keys(prices).find((k) => model === k || String(model).startsWith(`${k}-`));
  if (!key) return null;
  const p = prices[key];
  const input = usage.inputTokens + (usage.cacheWriteTokens ?? 0) * p.cacheWriteMultiplier + (usage.cacheReadTokens ?? 0) * p.cacheReadMultiplier;
  const usd = (input * p.inputPerMTok + usage.outputTokens * p.outputPerMTok) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
