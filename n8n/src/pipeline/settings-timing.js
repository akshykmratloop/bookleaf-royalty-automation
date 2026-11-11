import { TUNING } from './tuning.js';

/** Time a run needs besides the AI calls (enqueue, context, render, the send), at most. */
export const RUN_MARGIN_MS = 60_000;
/** The draft and at most one rewrite, each by Anthropic and then OpenAI. */
const AI_CALLS = 2 * 2;

/**
 * The longest a run can spend on AI calls: every try of every call times out, with the longest wait
 * between tries (Write Draft retries only 429, 5xx and timeouts).
 * @param {{ai_timeout_ms:number}} settings @returns {number} milliseconds
 */
export function worstCaseAiMs(settings) {
  const perCall = (TUNING.aiRetries + 1) * settings.ai_timeout_ms + TUNING.aiRetries * TUNING.aiRetryMaxWaitSeconds * 1000;
  return AI_CALLS * perCall;
}

/**
 * @param {{ai_timeout_ms:number, stuck_job_minutes:number}} settings already valid one by one
 * @returns {string|null} why the AI time cannot fit before the sweeper and the run timeout end the job, or null
 */
export function timingProblem(settings) {
  const needed = worstCaseAiMs(settings) + RUN_MARGIN_MS;
  const limit = Math.min(settings.stuck_job_minutes * 60_000, TUNING.runTimeoutSeconds * 1000);
  if (needed <= limit) return null;
  return `ai_timeout_ms (${settings.ai_timeout_ms} ms) allows up to ${worstCaseAiMs(settings) / 1000} s of AI calls; with `
    + `${RUN_MARGIN_MS / 1000} s for the rest of the run that must fit within stuck_job_minutes (${settings.stuck_job_minutes}) `
    + `and the run timeout (${TUNING.runTimeoutSeconds} s, n8n/src/pipeline/tuning.js): lower ai_timeout_ms or raise both`;
}
