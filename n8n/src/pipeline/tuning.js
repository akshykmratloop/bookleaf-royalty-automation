/**
 * Build-time node settings: AI retries and the sweeper's schedule. They shape the workflow graph or
 * n8n node settings, which cannot come from bookleaf_settings at run time; changing one means
 * rebuilding and redeploying the workflows. Run-time values (timeouts, limits, windows) are settings.
 * Send Email is deliberately not here: it never retries (workflows-src/lib/nodes.mjs sendEmail).
 */
export const TUNING = Object.freeze({
  /**
   * Extra tries of an AI request that failed in a way that can pass (429, 5xx, a timeout); a 4xx goes
   * straight to the fallback provider. Each wait doubles from the base, or follows Retry-After, up to the cap.
   */
  aiRetries: 1,
  aiRetryBaseSeconds: 2,
  aiRetryMaxWaitSeconds: 10,
  /** The sweeper's cadence: every minute, so a stuck job fails close to stuck_job_minutes (lead's decision). */
  sweepEveryMinutes: 1,
});
