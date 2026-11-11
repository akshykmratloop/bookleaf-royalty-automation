import { buildFacts } from '../facts.js';
import { checkIntegrity } from '../integrity.js';
import { buildPrompt } from '../prompt.js';
import * as anthropic from '../providers/anthropic.js';
import * as openai from '../providers/openai.js';
import { sectionsSchema } from '../providers/schema.js';
import { CrashDrillError } from './drills.js';
import { failure } from './errors.js';

/**
 * Drills ask a provider for a model that does not exist: a real HTTP error, no cost. ai_down fails
 * both providers; primary_down fails only Anthropic, so the OpenAI fallback writes the email.
 */
export const DRILL_MODEL = 'bookleaf-drill-model-does-not-exist';

/**
 * @typedef {Object} Context
 * @property {import('../types.js').AuthorBundle} bundle @property {import('../facts-types.js').AuthorFacts} facts
 * @property {{system:string, user:string, version:string, situations:string[]}} prompt @property {string[]} titles
 * @property {{anthropic:Object, openai:Object}} requests HTTP bodies for the two provider nodes
 */

/** The author data came with the request (validated in Prepare Job); the data_down drill withholds it. */
function loadBundle(job) {
  if (job.drills.data_down) return failure('DATA_UNAVAILABLE', 'Failure drill: the data source was switched off.');
  return { ok: true, value: job.bundle };
}

/**
 * The bodies of the two AI nodes: model, effort and token limit from the ai_primary / ai_fallback settings.
 * @param {{system:string, user?:string, messages?:Object[]}} prompt @param {import('./prepare.js').Job} job
 */
export function providerRequests(prompt, job) {
  const { ai_down: allDown, primary_down: primaryDown } = job.drills;
  const { ai_primary: primary, ai_fallback: fallback } = job.settings;
  const primaryModel = allDown || primaryDown ? DRILL_MODEL : primary.model;
  return {
    anthropic: anthropic.buildRequest({ ...prompt, schema: sectionsSchema, model: primaryModel, effort: primary.effort, maxTokens: primary.max_tokens }).body,
    openai: openai.buildRequest({ ...prompt, model: allDown ? DRILL_MODEL : fallback.model, maxTokens: fallback.max_tokens }).body,
  };
}

/**
 * After the job is accepted: data, integrity check, facts, prompt and the two provider requests.
 * @param {import('./prepare.js').Job} job
 * @returns {{ok:true, ctx:Context}|import('./errors.js').Failure}
 * @throws {CrashDrillError} on the crash drill
 */
export function buildContext(job) {
  if (job.drills.crash) throw new CrashDrillError();
  const loaded = loadBundle(job);
  if (!loaded.ok) return loaded;
  const bundle = loaded.value;
  const issues = checkIntegrity(bundle, job.reference_date);
  if (issues.length) {
    const list = issues.slice(0, 5).map((i) => `${i.bookCode ?? 'author'}: ${i.message}`).join('; ');
    return failure('INTEGRITY', list);
  }
  const facts = buildFacts(bundle, job.reference_date);
  const prompt = buildPrompt({ bundle, facts, style: { tone: job.tone, length: job.length, note: job.note } });
  const titles = bundle.books.map((b) => b.title);
  return { ok: true, ctx: { bundle, facts, prompt, titles, requests: providerRequests(prompt, job) } };
}
