import { feedbackMessage } from '../prompt.js';
import { parseResponse as parseAnthropic, usageOf as anthropicUsage } from '../providers/anthropic.js';
import { parseResponse as parseOpenai, usageOf as openaiUsage } from '../providers/openai.js';
import { costUsd, totalInputTokens } from '../providers/cost.js';
import { providerRequests } from './context.js';
import { checkDraft } from './draft-check.js';
import { failure } from './errors.js';
import { nodeErrorSummary } from './node-errors.js';

/** What the fact check decided: the "Draft OK?" Switch names its outputs after these. */
export const AI_OUTCOMES = Object.freeze({ PASS: 'PASS', REWRITE: 'REWRITE', FAIL: 'FAIL' });
/** Plain object, not a module namespace: namespace getters do not survive n8n's Code-node sandbox. */
const PARSERS = Object.freeze({ anthropic: parseAnthropic, openai: parseOpenai });
const USAGE = Object.freeze({ anthropic: anthropicUsage, openai: openaiUsage });

/** @param {unknown} json HTTP body @returns {'anthropic'|'openai'|null} */
export function detectProvider(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.type === 'message' || json.type === 'error' || Array.isArray(json.content)) return 'anthropic';
  if (json.object === 'response' || Array.isArray(json.output)) return 'openai';
  return null;
}

/** Usage and cost summed over attempts; cost is null if any attempt's model has no price in model_prices. */
function addUsage(previous, usage, model, prices) {
  const cost = costUsd(usage, model, prices);
  const prevCost = previous ? previous.cost_usd : 0;
  return {
    input_tokens: (previous?.input_tokens ?? 0) + totalInputTokens(usage),
    output_tokens: (previous?.output_tokens ?? 0) + usage.outputTokens,
    cost_usd: cost === null || prevCost === null ? null : Math.round((prevCost + cost) * 1e6) / 1e6,
  };
}

/** Tokens are billed even when the answer is unusable. */
const rawUsage = (provider, r) => USAGE[provider](r);

/**
 * One rewrite with feedback. Both providers' bodies, so the rewrite has the same fallback as the first
 * draft (Anthropic, then OpenAI); the drills still apply to them.
 */
function rewrite(ctx, job, messages, ai, issues) {
  return { outcome: AI_OUTCOMES.REWRITE, rewrite: providerRequests({ system: ctx.prompt.system, messages }, job), ai, issues };
}

function failAi(code, detail, ai, issues = []) {
  return { outcome: AI_OUTCOMES.FAIL, failure: failure(code, detail), ai, issues };
}

/**
 * Reads one provider answer, fact-checks it and decides: pass, rewrite once with feedback, or fail.
 * @param {{response:unknown, ctx:import('./context.js').Context, job:import('./prepare.js').Job, attempt:1|2,
 *   previous?:{input_tokens:number, output_tokens:number, cost_usd:number|null}}} input
 */
export function afterAi({ response, ctx, job, attempt, previous }) {
  const provider = detectProvider(response);
  if (!provider) return failAi('AI_UNAVAILABLE', 'The AI answer was not recognised.', null);
  const prices = job.settings.model_prices;
  const parsed = PARSERS[provider](response);
  if (!parsed.ok) {
    const detail = `${provider}: ${parsed.error.code} ${parsed.error.message}`;
    const spent = { provider, model: response.model ?? null, attempts: attempt, ...addUsage(previous, rawUsage(provider, response), response.model, prices) };
    if (attempt >= 2) return failAi('AI_UNAVAILABLE', detail, spent);
    return rewrite(ctx, job, [{ role: 'user', content: ctx.prompt.user }], spent, [{ code: parsed.error.code, message: detail }]);
  }
  const ai = { provider, model: parsed.model, sections: parsed.sections, attempts: attempt, ...addUsage(previous, parsed.usage, parsed.model, prices) };
  const check = checkDraft(parsed.sections, ctx.facts, ctx.titles, job.length);
  const withCheck = { ...ai, verified_figures: check.verifiedFigures, words: check.words, warnings: check.issues.filter((i) => i.severity !== 'BLOCK') };
  if (check.passed) return { outcome: AI_OUTCOMES.PASS, ai: withCheck, issues: check.issues };
  if (attempt >= 2) {
    const list = check.blocking.slice(0, 3).map((i) => i.excerpt ?? i.code).join(', ');
    return failAi('AI_FACT_CHECK_FAILED', `Unsupported: ${list}.`, withCheck, check.issues);
  }
  const messages = [
    { role: 'user', content: ctx.prompt.user },
    { role: 'assistant', content: JSON.stringify(parsed.sections) },
    { role: 'user', content: feedbackMessage(check.blocking) },
  ];
  return rewrite(ctx, job, messages, withCheck, check.issues);
}

/**
 * Neither provider answered (the "AI Failed" node, after both HTTP nodes of the first draft or of the rewrite).
 * @param {{rewriting:boolean, anthropicError:unknown, openaiError:unknown}} input the two error-output items
 * @returns {import('./errors.js').Failure}
 */
export function aiUnavailable({ rewriting, anthropicError, openaiError }) {
  const detail = `${nodeErrorSummary(anthropicError, 'anthropic')} | ${nodeErrorSummary(openaiError, 'openai')}`;
  return failure('AI_UNAVAILABLE', rewriting ? `The rewrite failed. ${detail}` : detail);
}
