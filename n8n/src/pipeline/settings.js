import { SETTING_CHECKS } from './settings-checks.js';

/**
 * The server settings: one row each in the `bookleaf_settings` table of the `bookleaf` database.
 * This schema is the single source of their defaults and descriptions (n8n/tools/settings-seed.mjs
 * writes the seed SQL into infra/db); each key's check comes from settings-checks.js, which the
 * workflows bundle on its own. `perEnvironment`: the value differs between local and production and
 * is written per environment, never committed; the default is only a safe placeholder.
 */

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (typeof v === 'object' && v !== null) deepFreeze(v);
  return Object.freeze(o);
};

const PRICE_SOURCES = 'claude-sonnet-5-5: Anthropic list price (claude-api model table, 2026-10-06); '
  + 'gpt-4.1-mini: OpenAI standard tier (developers.openai.com/api/docs/pricing, checked 2026-11-11).';

export const SETTINGS_SCHEMA = deepFreeze({
  brand_name: {
    default: 'BookLeaf Publishing', check: SETTING_CHECKS.brand_name,
    description: 'Publisher name shown in the email header, subject line and footer.',
  },
  sender_name: {
    default: 'BookLeaf Author Relations', check: SETTING_CHECKS.sender_name,
    description: 'Name in the From line of every email and in the default signature.',
  },
  email_from: {
    default: '', check: SETTING_CHECKS.email_from, perEnvironment: true,
    description: 'Sender address. Required: set it for each environment to an address the SMTP account may send from.',
  },
  support_email: {
    default: '', check: SETTING_CHECKS.support_email,
    description: 'Support address printed in the email footer; empty leaves the line out.',
  },
  default_demo_inbox: {
    default: '', check: SETTING_CHECKS.default_demo_inbox, perEnvironment: true,
    description: 'Inbox for requests that name no demo_inbox; empty makes such requests fail with NO_RECIPIENT. Never an author address.',
  },
  allow_drills: {
    default: false, check: SETTING_CHECKS.allow_drills, perEnvironment: true,
    description: 'true lets a request force failure drills (ai_down, email_down, data_down, primary_down, crash); keep false where real authors are emailed.',
  },
  reference_date_default: {
    default: '2025-12-31', check: SETTING_CHECKS.reference_date_default,
    description: 'Date the royalty status is worked out against when a request gives none: YYYY-MM-DD, or "today" (IST).',
  },
  ai_primary: {
    default: { model: 'claude-sonnet-5-5', effort: 'medium', max_tokens: 8000 },
    check: SETTING_CHECKS.ai_primary,
    description: 'Primary AI writer (Anthropic Messages API): model, effort (low, medium or high) and output token limit.',
  },
  ai_fallback: {
    default: { model: 'gpt-4.1-mini', max_tokens: 4000 },
    check: SETTING_CHECKS.ai_fallback,
    description: 'Fallback AI writer (OpenAI Responses API), used when the primary fails: model and output token limit.',
  },
  ai_timeout_ms: {
    default: 45000, check: SETTING_CHECKS.ai_timeout_ms,
    description: 'Time limit for one AI request, in milliseconds. All AI calls of a run at worst (draft and rewrite, two providers, two tries each) plus 60 s must end within stuck_job_minutes and the 600 s run timeout; 62500 is the most that fits.',
  },
  model_prices: {
    default: {
      'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1 },
      'gpt-4.1-mini': { inputPerMTok: 0.4, outputPerMTok: 1.6, cacheWriteMultiplier: 1, cacheReadMultiplier: 0.25 },
    },
    check: SETTING_CHECKS.model_prices,
    description: `USD per million tokens by model, for cost_usd; cache multipliers apply to the input price, and a model with no entry records no cost. ${PRICE_SOURCES}`,
  },
  max_sends_per_hour: {
    default: 60, check: SETTING_CHECKS.max_sends_per_hour,
    description: 'Jobs accepted per rolling hour (discarded jobs and jobs that failed before any AI answer do not count); beyond it the webhook answers 429.',
  },
  duplicate_window_minutes: {
    default: 10, check: SETTING_CHECKS.duplicate_window_minutes,
    description: 'A request identical to one accepted within this many minutes gets that job back (duplicate) instead of a new one.',
  },
  draft_ttl_hours: {
    default: 24, check: SETTING_CHECKS.draft_ttl_hours,
    description: 'Hours a draft can still be approved and sent; after that, approval answers DRAFT_EXPIRED.',
  },
  stuck_job_minutes: {
    default: 10, check: SETTING_CHECKS.stuck_job_minutes,
    description: 'A job still running after this many minutes is stopped by the sweeper and marked failed. Must leave room for the AI worst case (see ai_timeout_ms).',
  },
  alert_email: {
    default: '', check: SETTING_CHECKS.alert_email, perEnvironment: true,
    description: 'Address told about unexpected workflow errors; empty sends no alert.',
  },
});

/**
 * The validated settings a workflow run uses, keyed as stored.
 * @typedef {Object} Settings
 * @property {string} brand_name @property {string} sender_name @property {string} email_from @property {string} support_email
 * @property {string} default_demo_inbox @property {boolean} allow_drills @property {string} reference_date_default
 * @property {{model:string, effort:'low'|'medium'|'high', max_tokens:number}} ai_primary
 * @property {{model:string, max_tokens:number}} ai_fallback @property {number} ai_timeout_ms
 * @property {Record<string, import('../providers/cost.js').Price>} model_prices @property {number} max_sends_per_hour
 * @property {number} duplicate_window_minutes @property {number} draft_ttl_hours @property {number} stuck_job_minutes
 * @property {string} alert_email
 */
