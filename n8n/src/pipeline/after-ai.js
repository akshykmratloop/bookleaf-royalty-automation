import { feedbackMessage } from '../prompt.js';
import { parseResponse as parseAnthropic, usageOf as anthropicUsage } from '../providers/anthropic.js';
import { parseResponse as parseOpenai, usageOf as openaiUsage } from '../providers/openai.js';
import { costUsd, totalInputTokens } from '../providers/cost.js';
import { providerRequests } from './context.js';
import { checkDraft } from './draft-check.js';
import { failure } from './errors.js';

export const AI_ROUTES = Object.freeze({ PASS: 0, REGENERATE_ANTHROPIC: 1, REGENERATE_OPENAI: 2, FAIL: 3 });
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

/** Usage and cost summed over attempts; cost is null if any attempt's model has no known price. */
function addUsage(previous, usage, model) {
  const cost = costUsd(usage, model);
  const prevCost = previous ? previous.cost_usd : 0;
  return {
    input_tokens: (previous?.input_tokens ?? 0) + totalInputTokens(usage),
    output_tokens: (previous?.output_tokens ?? 0) + usage.outputTokens,
    cost_usd: cost === null || prevCost === null ? null : Math.round((prevCost + cost) * 1e6) / 1e6,
  };
}

/** Tokens are billed even when the answer is unusable. */
const rawUsage = (provider, r) => USAGE[provider](r);

function regenerate(provider, ctx, job, messages, ai, issues) {
  const body = providerRequests({ system: ctx.prompt.system, messages }, job)[provider];
  const route = provider === 'anthropic' ? AI_ROUTES.REGENERATE_ANTHROPIC : AI_ROUTES.REGENERATE_OPENAI;
  return { route, outcome: 'REGENERATE', provider, regenerate: { body }, ai, issues };
}

function failAi(code, detail, ai, issues = []) {
  return { route: AI_ROUTES.FAIL, outcome: 'FAIL', failure: failure(code, detail), ai, issues };
}

/**
 * Reads one provider answer, fact-checks it and decides: send, regenerate once with feedback, or fail.
 * @param {{response:unknown, ctx:import('./context.js').Context, job:import('./prepare.js').Job, attempt:1|2,
 *   previous?:{input_tokens:number, output_tokens:number, cost_usd:number|null}}} input
 */
export function afterAi({ response, ctx, job, attempt, previous }) {
  const provider = detectProvider(response);
  if (!provider) return failAi('AI_UNAVAILABLE', 'The AI answer was not recognised.', null);
  const parsed = PARSERS[provider](response);
  if (!parsed.ok) {
    const detail = `${provider}: ${parsed.error.code} ${parsed.error.message}`;
    const spent = { provider, model: response.model ?? null, attempts: attempt, ...addUsage(previous, rawUsage(provider, response), response.model) };
    if (attempt >= 2) return failAi('AI_UNAVAILABLE', detail, spent);
    return regenerate(provider, ctx, job, [{ role: 'user', content: ctx.prompt.user }], spent, [{ code: parsed.error.code, message: detail }]);
  }
  const ai = { provider, model: parsed.model, sections: parsed.sections, attempts: attempt, ...addUsage(previous, parsed.usage, parsed.model) };
  const check = checkDraft(parsed.sections, ctx.facts, ctx.titles, job.length);
  const withCheck = { ...ai, verified_figures: check.verifiedFigures, words: check.words, warnings: check.issues.filter((i) => i.severity !== 'BLOCK') };
  if (check.passed) return { route: AI_ROUTES.PASS, outcome: 'PASS', ai: withCheck, issues: check.issues };
  if (attempt >= 2) {
    const list = check.blocking.slice(0, 3).map((i) => i.excerpt ?? i.code).join(', ');
    return failAi('AI_FACT_CHECK_FAILED', `Unsupported: ${list}.`, withCheck, check.issues);
  }
  const messages = [
    { role: 'user', content: ctx.prompt.user },
    { role: 'assistant', content: JSON.stringify(parsed.sections) },
    { role: 'user', content: feedbackMessage(check.blocking) },
  ];
  return regenerate(provider, ctx, job, messages, withCheck, check.issues);
}
